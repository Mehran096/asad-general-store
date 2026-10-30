"use client";
import { useEffect, useState, useCallback, useSyncExternalStore, useMemo } from "react";
import Link from "next/link";
import { offlineDB } from "@/lib/offline-db";
import type { OfflineEasypaisa } from "@/lib/offline-db";
import { saveEasypaisaOffline, syncAllOffline } from "@/lib/offline-sync";
import { getOfflineUser } from "@/lib/offline-auth";

type EasyType = "send" | "receive" | "bill" | "easyload" | "jazzcash" | "deposit" | "withdraw";
type RecordItem = { _id: string; localId?: string; customerName: string; phone?: string; type: EasyType; amount: number; commission: number; totalAmount: number; createdAt: string };
type EasypaisaApiResponse = { easypaisa: RecordItem[]; transactions?: RecordItem[]; totalAmount: number; totalCommission: number };
type OfflineUser = { _id?: string; id?: string } | null;

function useIsOnline(){
  const sub = useCallback((cb:()=>void)=>{ window.addEventListener("online",cb); window.addEventListener("offline",cb); return ()=>{ window.removeEventListener("online",cb); window.removeEventListener("offline",cb);};},[]);
  const snap = useCallback(()=> navigator.onLine,[]);
  const ss = useCallback(()=> true,[]);
  return useSyncExternalStore(sub,snap,ss);
}
function rnd(n:number){ return Math.round(n||0); }

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

function formatDate(d: string){
  const date = new Date(d);
  return `${date.getDate()}/${date.getMonth()+1}/${date.getFullYear()}`;
}
function formatTime(d: string){
  return new Date(d).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}
function formatDateTime(d: string){
  return `${formatDate(d)} ${formatTime(d)}`;
}

function isInFilter(dateStr: string, filter: string): boolean {
  if (filter === "all") return true;
  const d = new Date(dateStr);
  const now = new Date();
  const nowPKT = new Date(now.getTime() + PKT_OFFSET_MS);
  const y = nowPKT.getUTCFullYear(), m = nowPKT.getUTCMonth(), day = nowPKT.getUTCDate();
  const startToday = new Date(Date.UTC(y, m, day, 0, 0, 0, 0) - PKT_OFFSET_MS);
  const endToday = new Date(Date.UTC(y, m, day + 1, 0, 0, 0, 0) - PKT_OFFSET_MS);
  if (filter === "today") return d >= startToday && d < endToday;
  if (filter === "weekly") return d >= new Date(startToday.getTime() - 7*24*60*60*1000) && d < endToday;
  if (filter === "monthly") return d >= new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) - PKT_OFFSET_MS) && d < endToday;
  if (filter === "yearly") return d >= new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0) - PKT_OFFSET_MS) && d < endToday;
  return true;
}

function groupByDate(list: RecordItem[]): Record<string, RecordItem[]> {
  const groups: Record<string, RecordItem[]> = {};
  for(const item of list){
    const key = formatDate(item.createdAt);
    if(!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  // sort keys by latest date first
  const sorted: Record<string, RecordItem[]> = {};
  Object.keys(groups).sort((a,b)=>{
    const da = new Date(groups[b][0].createdAt).getTime();
    const db = new Date(groups[a][0].createdAt).getTime();
    return da - db;
  }).forEach(k=>{ sorted[k]=groups[k]; });
  return sorted;
}

const TYPES: { id: EasyType; label: string; emoji: string; commission: number }[] = [
  { id: "send", label: "Send", emoji: "📤", commission: 20 },
  { id: "receive", label: "Receive", emoji: "📥", commission: 0 },
  { id: "bill", label: "Bill", emoji: "🧾", commission: 10 },
  { id: "easyload", label: "Easyload", emoji: "📱", commission: 5 },
  { id: "jazzcash", label: "JazzCash", emoji: "💳", commission: 20 },
  { id: "deposit", label: "Deposit", emoji: "🏦", commission: 0 },
  { id: "withdraw", label: "Withdraw", emoji: "💵", commission: 20 },
];

export default function EasypaisaPage(){
  const isOnline = useIsOnline();
  const isOffline = !isOnline;
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [filter, setFilter] = useState("today");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [totalAmount, setTotalAmount] = useState(0);
  const [totalCommission, setTotalCommission] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [commission, setCommission] = useState("");
  const [selectedType, setSelectedType] = useState<EasyType>("send");

  const load = useCallback(async()=>{
    setLoading(true);
    try{
      const offlineNow = typeof window!=="undefined" && !window.navigator.onLine;
      if(offlineNow){
        const all = await offlineDB.easypaisa.orderBy("createdAt").reverse().toArray();
        let filtered = all.filter((o: OfflineEasypaisa) => isInFilter(o.createdAt, filter));
        if(typeFilter!=="all") filtered = filtered.filter((o: OfflineEasypaisa)=>o.type===typeFilter);
        if(search) {
          const s = search.toLowerCase();
          filtered = filtered.filter((o: OfflineEasypaisa)=> o.customerName.toLowerCase().includes(s) || (o.phone||"").includes(s));
        }
        setRecords(filtered.map((o: OfflineEasypaisa)=>({ 
          _id:o.localId, localId:o.localId, customerName:o.customerName, phone:o.phone, 
          type:o.type, amount:o.amount, commission:o.commission, 
          totalAmount:o.totalAmount, createdAt:o.createdAt 
        })));
        setTotalAmount(rnd(filtered.reduce((a:number,b: OfflineEasypaisa)=>a+b.amount,0)));
        setTotalCommission(rnd(filtered.reduce((a:number,b: OfflineEasypaisa)=>a+b.commission,0)));
        setPendingCount(await offlineDB.easypaisa.where("synced").equals(0).count());
      } else {
        try { await syncAllOffline(); } catch { /* ignore */ }
        const res = await fetch(`/api/easypaisa?filter=${filter}&type=${typeFilter}&search=${encodeURIComponent(search)}&limit=100`);
        const data = await res.json() as EasypaisaApiResponse;
        const list = data.easypaisa || data.transactions || [];
        setRecords(list);
        setTotalAmount(rnd(data.totalAmount||0));
        setTotalCommission(rnd(data.totalCommission||0));
        setPendingCount(await offlineDB.easypaisa.where("synced").equals(0).count());
      }
    }catch{ /* ignore */ } finally{ setLoading(false); }
  },[filter, typeFilter, search]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{ void load(); },[load]);

  const breakdown = useMemo(()=>{
    const map: Record<string, { amount: number; commission: number; count: number }> = {};
    for(const t of TYPES) map[t.id] = { amount:0, commission:0, count:0 };
    for(const r of records){
      if(!map[r.type]) map[r.type] = { amount:0, commission:0, count:0 };
      map[r.type].amount = rnd(map[r.type].amount + r.amount);
      map[r.type].commission = rnd(map[r.type].commission + r.commission);
      map[r.type].count++;
    }
    return map;
  },[records]);

  const grouped = useMemo(()=> groupByDate(records), [records]);

  const onTypeSelect = (t: typeof TYPES[number]) => {
    setSelectedType(t.id);
    setCommission(t.commission.toString());
  };

  const onSubmit = async(e: React.FormEvent)=>{
    e.preventDefault();
    if(!amount){ alert("Amount required"); return; }
    const amt = rnd(Number(amount));
    const comm = rnd(Number(commission||0));
    const offlineUser = getOfflineUser() as OfflineUser;
    const userId = offlineUser?._id || offlineUser?.id || "offline";
    const now = new Date().toISOString();
    const localId = `easy_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

    const newItem: RecordItem = { _id:localId, localId, customerName: customerName||"Walk-in", phone, type:selectedType, amount:amt, commission:comm, totalAmount:amt+comm, createdAt:now };
    setRecords((prev)=>[newItem, ...prev]);
    setTotalAmount((t)=>rnd(t+amt));
    setTotalCommission((t)=>rnd(t+comm));
    const nameToSave = customerName;
    setCustomerName(""); setPhone(""); setAmount(""); setCommission("");

    let savedId = localId;
    try {
      savedId = await saveEasypaisaOffline({ customerName: nameToSave||"Walk-in", phone, type:selectedType, amount:amt, commission:comm, userId, localId });
    } catch { /* ignore */ }

    if(typeof window!=="undefined" && window.navigator.onLine){
      try{
        const res = await fetch("/api/easypaisa",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ customerName: nameToSave||"Walk-in", phone, type:selectedType, amount:amt, commission:comm, localId: savedId, userId }) });
        if(res.ok){
          await offlineDB.easypaisa.update(savedId, { synced: 1 });
          await offlineDB.syncQueue.where("localId").equals(savedId).delete();
        }
      }catch{ /* ignore */ }
    }
  };

  const onDelete = async(id:string)=>{
    if(!confirm("Delete?")) return;
    setRecords((prev)=>prev.filter((r)=>r._id!==id));
    try{
      if(id.startsWith("easy_")){
        await offlineDB.easypaisa.where("localId").equals(id).delete();
        await offlineDB.syncQueue.where("localId").equals(id).delete();
      } else {
        await offlineDB.easypaisa.where("_id").equals(id).delete();
        await offlineDB.easypaisa.where("localId").equals(id).delete();
        if(navigator.onLine) await fetch(`/api/easypaisa/${id}`,{ method:"DELETE" });
      }
    }catch{ /* ignore */ }
  };

  return(
    <div className="min-h-screen bg-gray-50 p-3 max-w-5xl mx-auto">
      <div className="flex justify-between mb-3">
        <h1 className="font-bold text-[18px]">💰 Asad Easypaisa {isOffline?"📶 Offline":""}</h1>
        <Link href="/dashboard" className="bg-white border px-3 py-1 rounded-full text-[11px] font-bold">← Dashboard</Link>
      </div>

      {isOffline && pendingCount>0 && <div className="mb-3 bg-amber-50 border text-amber-800 text-[11px] p-2 rounded-xl text-center">📶 Offline • {pendingCount} pending — will auto-sync when online</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="space-y-3 h-fit">
          <div className="bg-white border rounded-xl p-3">
            <p className="font-bold text-[13px] mb-3">+ New Transaction</p>
            <form onSubmit={onSubmit} className="space-y-2">
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {TYPES.map((t)=>(
                  <button key={t.id} type="button" onClick={()=>onTypeSelect(t)} className={`p-2 rounded-xl border text-[10px] font-bold ${selectedType===t.id?"bg-black text-white":"bg-gray-50"}`}>{t.emoji}<br/>{t.label}</button>
                ))}
              </div>
              <input value={customerName} onChange={(e)=>setCustomerName(e.target.value)} placeholder="Customer name (Walk-in)" className="w-full border p-2.5 rounded-xl text-[12px]" />
              <input value={phone} onChange={(e)=>setPhone(e.target.value)} placeholder="Phone 03XX..." className="w-full border p-2.5 rounded-xl text-[12px]" />
              <div className="grid grid-cols-2 gap-2">
                <input value={amount} onChange={(e)=>setAmount(e.target.value)} type="number" placeholder="Amount Rs." className="border p-2.5 rounded-xl text-[12px]" />
                <input value={commission} onChange={(e)=>setCommission(e.target.value)} type="number" placeholder="Commission Rs." className="border p-2.5 rounded-xl text-[12px] bg-yellow-50 font-bold" />
              </div>
              <button type="submit" className="w-full bg-black text-white py-2.5 rounded-xl font-bold text-[13px]">Add Rs.{amount||0} + Com {commission||0} = Rs.{rnd(Number(amount||0)+Number(commission||0))}</button>
            </form>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="bg-green-50 border border-green-200 p-2 rounded-xl text-center"><p className="text-[9px] text-gray-500">Total Amount {filter}</p><p className="font-bold text-[13px]">Rs.{totalAmount}</p></div>
              <div className="bg-blue-50 border border-blue-200 p-2 rounded-xl text-center"><p className="text-[9px] text-gray-500">Commission {filter}</p><p className="font-bold text-[13px] text-blue-700">Rs.{totalCommission}</p></div>
            </div>
          </div>

          <div className="bg-white border rounded-xl p-3">
            <p className="font-bold text-[11px] mb-2">📊 Breakdown — {filter} {typeFilter!=="all"? `• ${typeFilter}`:""}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {TYPES.map((t)=>{
                const b = breakdown[t.id];
                if(!b || b.count===0) return (
                  <div key={t.id} className="border bg-gray-50 rounded-lg p-2 text-[10px] opacity-60">
                    <div className="flex justify-between"><span>{t.emoji} {t.label}</span><span className="text-[9px]">0</span></div>
                    <div className="font-bold">Rs.0</div>
                  </div>
                );
                return (
                  <div key={t.id} className="border rounded-lg p-2 text-[10px] bg-white">
                    <div className="flex justify-between"><span className="font-bold">{t.emoji} {t.label}</span><span className="bg-black text-white px-1.5 rounded-full text-[9px]">{b.count}</span></div>
                    <div className="mt-1"><span className="text-gray-500">Amt:</span> <b>Rs.{b.amount}</b></div>
                    <div><span className="text-gray-500">Com:</span> <b className="text-green-600">Rs.{b.commission}</b></div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 pt-2 border-t flex justify-between text-[11px] font-bold">
              <span>Total {records.length} Tx</span><span>Rs.{totalAmount} <span className="text-green-600">+{totalCommission}</span></span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-2">
          <div className="bg-white border rounded-xl p-2 flex flex-wrap gap-1.5">
            {["today","weekly","monthly","all"].map((f)=><button key={f} onClick={()=>setFilter(f)} className={`px-3 py-1 rounded-full text-[10px] font-bold capitalize ${filter===f?"bg-black text-white":"bg-gray-100"}`}>{f}</button>)}
            <select value={typeFilter} onChange={(e)=>setTypeFilter(e.target.value)} className="border rounded-full px-2 py-1 text-[10px] ml-auto"><option value="all">All Types</option>{TYPES.map((t)=><option key={t.id} value={t.id}>{t.label}</option>)}</select>
          </div>
          <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="🔍 Search name / phone..." className="w-full border p-2.5 rounded-xl bg-white text-[12px]" />
          {loading? <p className="text-center py-10 text-[12px]">Loading...</p> :
          <div className="space-y-3">
            {records.length===0? <p className="text-center py-8 text-[11px] text-gray-400">No transactions — {filter}</p> :
            Object.entries(grouped).map(([date, items])=>(
              <div key={date} className="space-y-1.5">
                <div className="sticky top-0 z-10 bg-gray-100 border rounded-lg px-3 py-1.5 flex justify-between text-[11px] font-bold">
                  <span>📅 {date}</span><span className="bg-black text-white px-2 rounded-full text-[9px]">{items.length} Tx • Rs.{items.reduce((a,b)=>a+b.amount,0)} + Com {items.reduce((a,b)=>a+b.commission,0)}</span>
                </div>
                {items.map((r)=>(
                  <div key={r._id} className="bg-white border rounded-xl p-2.5 flex justify-between text-[11px]">
                    <div>
                      <b>{r.customerName}</b> {r.phone? `• ${r.phone}`:""} <span className="bg-gray-100 px-2 py-0.5 rounded-full text-[9px] ml-1">{r.type}</span>
                      <div className="text-[9px] text-gray-500">{formatDateTime(r.createdAt)} • Amt {r.amount} + Com {r.commission}</div>
                    </div>
                    <div className="text-right flex gap-2 items-center"><span className="font-bold">Rs.{r.totalAmount} <span className="text-green-600 text-[9px]">+{r.commission}</span></span><button onClick={()=>onDelete(r._id)} className="text-red-500">✕</button></div>
                  </div>
                ))}
              </div>
            ))}
          </div>}
        </div>
      </div>
    </div>
  );
}