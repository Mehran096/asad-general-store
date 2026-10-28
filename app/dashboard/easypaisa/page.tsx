"use client";
import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { offlineDB } from "@/lib/offline-db";
import type { OfflineEasypaisa } from "@/lib/offline-db";
import { saveEasypaisaOffline } from "@/lib/offline-sync";
import { getOfflineUser } from "@/lib/offline-auth";

type EasyType = "send" | "receive" | "bill" | "easyload" | "jazzcash" | "deposit" | "withdraw";
type RecordItem = { _id: string; localId?: string; customerName: string; phone?: string; type: EasyType; amount: number; commission: number; totalAmount: number; createdAt: string };
type EasypaisaApiResponse = { easypaisa: RecordItem[]; totalAmount: number; totalCommission: number };

function useIsOnline(){
  const sub = useCallback((cb:()=>void)=>{ window.addEventListener("online",cb); window.addEventListener("offline",cb); return ()=>{ window.removeEventListener("online",cb); window.removeEventListener("offline",cb);};},[]);
  const snap = useCallback(()=> navigator.onLine,[]);
  const ss = useCallback(()=> true,[]);
  return useSyncExternalStore(sub,snap,ss);
}
function rnd(n:number){ return Math.round(n||0); }

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
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [commission, setCommission] = useState("");
  const [selectedType, setSelectedType] = useState<EasyType>("send");

  const load = useCallback(async()=>{
    setLoading(true);
    try{
      if(typeof window!=="undefined" && !window.navigator.onLine){
        const all = await offlineDB.easypaisa.reverse().toArray();
        setRecords(all.map((o: OfflineEasypaisa)=>({ 
          _id:o.localId, localId:o.localId, customerName:o.customerName, phone:o.phone, 
          type:o.type, amount:o.amount, commission:o.commission, 
          totalAmount:o.totalAmount, createdAt:o.createdAt 
        })));
        setTotalAmount(rnd(all.reduce((a,b)=>a+b.amount,0)));
        setTotalCommission(rnd(all.reduce((a,b)=>a+b.commission,0)));
      } else {
        const res = await fetch(`/api/easypaisa?filter=${filter}&type=${typeFilter}&search=${encodeURIComponent(search)}&limit=50`);
        const data = (await res.json()) as EasypaisaApiResponse;
        setRecords(data.easypaisa||[]); setTotalAmount(rnd(data.totalAmount||0)); setTotalCommission(rnd(data.totalCommission||0));
      }
    }catch{ /* ignore */ } finally{ setLoading(false); }
  },[filter, typeFilter, search]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{ void load(); },[load]);

  const onTypeSelect = (t: typeof TYPES[number]) => {
    setSelectedType(t.id);
    setCommission(t.commission.toString());
  };

  const onSubmit = async(e: React.FormEvent)=>{
    e.preventDefault();
    if(!amount){ alert("Amount required"); return; }
    const amt = rnd(Number(amount));
    const comm = rnd(Number(commission||0));
    const offlineUser = getOfflineUser() as { _id?: string } | null;
    const now = new Date().toISOString();
    const localId = `easy_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

    setRecords(prev=>[{ _id:localId, localId, customerName: customerName||"Walk-in", phone, type:selectedType, amount:amt, commission:comm, totalAmount:amt+comm, createdAt:now }, ...prev]);
    setTotalAmount(t=>rnd(t+amt)); setTotalCommission(t=>rnd(t+comm));
    setCustomerName(""); setPhone(""); setAmount(""); setCommission("");

    try{
      if(typeof window!=="undefined" && window.navigator.onLine){
        const res = await fetch("/api/easypaisa",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ customerName: customerName||"Walk-in", phone, type:selectedType, amount:amt, commission:comm, localId }) });
        if(!res.ok) throw new Error();
      } else {
        await saveEasypaisaOffline({ customerName: customerName||"Walk-in", phone, type:selectedType, amount:amt, commission:comm, userId: offlineUser?._id||"offline" });
      }
    }catch{
      await saveEasypaisaOffline({ customerName: customerName||"Walk-in", phone, type:selectedType, amount:amt, commission:comm, userId: offlineUser?._id||"offline" });
    }
  };

  const onDelete = async(id:string)=>{
    if(!confirm("Delete?")) return;
    setRecords(prev=>prev.filter(r=>r._id!==id));
    try{
      if(id.startsWith("easy_")) await offlineDB.easypaisa.where("localId").equals(id).delete();
      else await fetch(`/api/easypaisa/${id}`,{ method:"DELETE" });
    }catch{ /* ignore */ }
  };

  return(
    <div className="min-h-screen bg-gray-50 p-3 max-w-5xl mx-auto">
      <div className="flex justify-between mb-3">
        <h1 className="font-bold text-[18px]">💰 Asad Easypaisa {isOffline?"📶 Offline":""}</h1>
        <Link href="/sales" className="bg-white border px-3 py-1 rounded-full text-[11px] font-bold">← POS</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="bg-white border rounded-xl p-3 h-fit">
          <p className="font-bold text-[13px] mb-3">+ New Transaction</p>
          <form onSubmit={onSubmit} className="space-y-2">
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {TYPES.map(t=>(
                <button key={t.id} type="button" onClick={()=>onTypeSelect(t)} className={`p-2 rounded-xl border text-[10px] font-bold ${selectedType===t.id?"bg-black text-white":"bg-gray-50"}`}>{t.emoji}<br/>{t.label}</button>
              ))}
            </div>
            <input value={customerName} onChange={e=>setCustomerName(e.target.value)} placeholder="Customer name (Walk-in)" className="w-full border p-2.5 rounded-xl text-[12px]" />
            <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Phone 03XX..." className="w-full border p-2.5 rounded-xl text-[12px]" />
            <div className="grid grid-cols-2 gap-2">
              <input value={amount} onChange={e=>setAmount(e.target.value)} type="number" placeholder="Amount Rs." className="border p-2.5 rounded-xl text-[12px]" />
              <input value={commission} onChange={e=>setCommission(e.target.value)} type="number" placeholder="Commission Rs." className="border p-2.5 rounded-xl text-[12px] bg-yellow-50 font-bold" />
            </div>
            <button type="submit" className="w-full bg-black text-white py-2.5 rounded-xl font-bold text-[13px]">Add Rs.{amount||0} + Com {commission||0} = Rs.{rnd(Number(amount||0)+Number(commission||0))}</button>
          </form>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="bg-green-50 border border-green-200 p-2 rounded-xl text-center"><p className="text-[9px] text-gray-500">Total Amount {filter}</p><p className="font-bold text-[13px]">Rs.{totalAmount}</p></div>
            <div className="bg-blue-50 border border-blue-200 p-2 rounded-xl text-center"><p className="text-[9px] text-gray-500">Commission {filter}</p><p className="font-bold text-[13px] text-blue-700">Rs.{totalCommission}</p></div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-2">
          <div className="bg-white border rounded-xl p-2 flex flex-wrap gap-1.5">
            {["today","weekly","monthly","all"].map(f=><button key={f} onClick={()=>setFilter(f)} className={`px-3 py-1 rounded-full text-[10px] font-bold capitalize ${filter===f?"bg-black text-white":"bg-gray-100"}`}>{f}</button>)}
            <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} className="border rounded-full px-2 py-1 text-[10px] ml-auto"><option value="all">All Types</option>{TYPES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select>
          </div>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search name / phone..." className="w-full border p-2.5 rounded-xl bg-white text-[12px]" />
          {loading? <p className="text-center py-10 text-[12px]">Loading...</p> :
          <div className="space-y-1.5">
            {records.map(r=>(
              <div key={r._id} className="bg-white border rounded-xl p-2.5 flex justify-between text-[11px]">
                <div><b>{r.customerName}</b> {r.phone? `• ${r.phone}`:""} <span className="bg-gray-100 px-2 py-0.5 rounded-full text-[9px] ml-1">{r.type}</span><div className="text-[9px] text-gray-400">{new Date(r.createdAt).toLocaleTimeString()} • Amount {r.amount} + Com {r.commission}</div></div>
                <div className="text-right flex gap-2 items-center"><span className="font-bold">Rs.{r.totalAmount} <span className="text-green-600 text-[9px]">+{r.commission}</span></span><button onClick={()=>onDelete(r._id)} className="text-red-500">✕</button></div>
              </div>
            ))}
          </div>}
        </div>
      </div>
    </div>
  );
}