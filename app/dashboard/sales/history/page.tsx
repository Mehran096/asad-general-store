"use client";
import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { offlineDB } from "@/lib/offline-db";
import type { OfflineSale } from "@/lib/offline-db";

type Category = "mobile_accessories" | "manyari" | "cosmetics" | "other";
type Sale = {
  _id: string;
  productName: string;
  category: Category;
  quantity: number;
  sellPrice: number;
  total: number;
  profit: number;
  createdAt: string;
  customerName?: string;
  status?: string;
  paymentType?: string;
};
type FilterType = "today" | "weekly" | "monthly" | "all";
type Pagination = { page: number; totalPages: number; hasMore: boolean; totalCount: number };
type SalesApiResponse = { sales: Sale[]; total: number; profit: number; pagination: Pagination };
type CustomerRow = { totalUdhar?: number };

const FILTERS: FilterType[] = ["today","weekly","monthly","all"];

function useIsOnline(){
  const subscribe = useCallback((cb:()=>void)=>{ window.addEventListener("online",cb); window.addEventListener("offline",cb); return ()=>{ window.removeEventListener("online",cb); window.removeEventListener("offline",cb);};},[]);
  const getSnapshot = useCallback(()=> navigator.onLine,[]);
  const getServerSnapshot = useCallback(()=> true,[]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
function rnd(n:number){ return Math.round(n||0); }

export default function SalesHistoryPage() {
  const isOnline = useIsOnline();
  const isOffline = !isOnline;
  const [sales, setSales] = useState<Sale[]>([]);
  const [total, setTotal] = useState(0);
  const [profit, setProfit] = useState(0);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [filter, setFilter] = useState<FilterType>("today");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all"|"paid"|"pending">("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination>({ page:1, totalPages:1, hasMore:false, totalCount:0 });
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (f: FilterType, s: string, p: number, status: string) => {
    if(p===1) setLoading(true);
    try{
      if(typeof window!=="undefined" && !window.navigator.onLine){
        const all = await offlineDB.sales.reverse().toArray();
        const filtered = all.filter((o: OfflineSale)=>{
          const matchSearch = !s || o.productName.toLowerCase().includes(s.toLowerCase()) || (o.customerName||"").toLowerCase().includes(s.toLowerCase());
          const matchStatus = status==="all" || (status==="pending" ? o.status==="pending" : o.status!=="pending");
          return matchSearch && matchStatus;
        });
        const paged = filtered.slice((p-1)*20, p*20);
        setSales(paged.map((o: OfflineSale)=>({ 
          _id:o.localId, productName:o.productName, category:o.category||"other", 
          quantity:o.quantity, sellPrice:o.sellPrice, total:o.total, profit:o.profit, 
          createdAt:o.createdAt, customerName:o.customerName, status:o.status, paymentType:o.paymentType 
        })));
        const t = filtered.reduce((a,b)=>a+b.total,0); 
        const pr = filtered.reduce((a,b)=>a+b.profit,0);
        setTotal(rnd(t)); setProfit(rnd(pr));
        setPagination({ page:p, totalPages: Math.ceil(filtered.length/20), hasMore: filtered.length > p*20, totalCount: filtered.length });
        return;
      }
      const statusQ = status!=="all" ? `&paymentType=${status==="pending"?"credit":"cash"}` : "";
      const res = await fetch(`/api/sales?filter=${f}&search=${encodeURIComponent(s)}&page=${p}&limit=20${statusQ}`);
      const data = (await res.json()) as SalesApiResponse;
      if(p===1) setSales(data.sales); else setSales(prev=>[...prev,...data.sales]);
      setTotal(rnd(data.total)); setProfit(rnd(data.profit)); setPagination(data.pagination);

      const pendingRes = await fetch(`/api/customers?status=pending&filter=${f}`);
      if(pendingRes.ok){
        const cData = (await pendingRes.json()) as { customers?: CustomerRow[] };
        const pending = (cData.customers||[]).reduce((a,b)=>a+(b.totalUdhar||0),0);
        setPendingTotal(rnd(pending));
      }
    }catch{ /* ignore */ } finally{ setLoading(false); }
  },[]);

  useEffect(()=>{ 
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData(filter, search, page, statusFilter); 
  },[filter,search,page,statusFilter,loadData]);

  const grouped: Record<string, Sale[]> = {};
  sales.forEach(s=>{ const d=new Date(s.createdAt).toLocaleDateString(); if(!grouped[d]) grouped[d]=[]; grouped[d].push(s); });

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto min-h-screen bg-gray-50">
      {isOffline && <div className="mb-3 bg-amber-50 border text-amber-800 text-[12px] p-2.5 rounded-xl text-center">📶 Offline</div>}
      {pendingTotal>0 && <div className="mb-3 bg-red-50 border border-red-200 text-red-800 text-[12px] p-2.5 rounded-xl flex justify-between"><span>📒 Udhar Pending: Rs.{pendingTotal}</span><Link href="/khata" className="bg-red-600 text-white px-3 py-1 rounded-lg text-[10px]">Khata</Link></div>}
      
      <div className="flex justify-between mb-4">
        <div><Link href="/sales" className="text-[11px] text-gray-500">← POS</Link><h1 className="text-[17px] font-bold">📜 Asad Sales History</h1><p className="text-[11px] text-gray-500">{filter.toUpperCase()} • {pagination.totalCount} sales • Rs.{total} profit {profit}</p></div>
        <Link href="/sales" className="bg-black text-white px-4 py-2 rounded-xl text-[12px] h-fit">+ New Sale</Link>
      </div>

      <div className="bg-white p-3 rounded-xl border mb-4 flex flex-col gap-2">
        <div className="flex gap-1.5 overflow-x-auto">{FILTERS.map(f=><button key={f} onClick={()=>{setFilter(f); setPage(1);}} className={`px-3 py-1.5 rounded-full text-[11px] capitalize ${filter===f?"bg-black text-white":"bg-gray-100"}`}>{f}</button>)}</div>
        <div className="flex gap-1.5"><button onClick={()=>{setStatusFilter("all"); setPage(1);}} className={`px-3 py-1.5 rounded-full text-[11px] ${statusFilter==="all"?"bg-black text-white":"bg-gray-100"}`}>All</button><button onClick={()=>{setStatusFilter("paid"); setPage(1);}} className={`px-3 py-1.5 rounded-full text-[11px] ${statusFilter==="paid"?"bg-green-600 text-white":"bg-gray-100"}`}>Cash</button><button onClick={()=>{setStatusFilter("pending"); setPage(1);}} className={`px-3 py-1.5 rounded-full text-[11px] ${statusFilter==="pending"?"bg-red-600 text-white":"bg-gray-100"}`}>Udhar</button></div>
        <input placeholder="🔍 Search product / customer..." value={search} onChange={e=>{setSearch(e.target.value); setPage(1);}} className="border p-2.5 rounded-lg w-full text-[12px]" />
      </div>

      {loading && page===1 ? <p className="text-center py-10 text-[12px]">Loading...</p> : (
        <div className="space-y-3">
          {Object.keys(grouped).length===0 ? <p className="text-center py-10 bg-white rounded-xl border text-[12px]">No sales</p> :
          Object.entries(grouped).map(([date, daySales])=>{
            const dt = daySales.reduce((a,b)=>a+b.total,0); const dp = daySales.reduce((a,b)=>a+b.profit,0);
            return(
              <div key={date} className="bg-white rounded-xl border overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 flex justify-between text-[11px] font-bold border-b"><span>{date} • {daySales.length}</span><span className="text-green-700">Rs.{dt} <span className="text-blue-600">+{dp}</span></span></div>
                {daySales.map(s=>(
                  <div key={s._id} className={`px-3 py-2.5 flex justify-between text-[12px] border-b last:border-0 ${s.status==="pending"?"bg-red-50/50":""}`}>
                    <div><p className="font-medium">{s.productName} <span className="text-blue-600">x{s.quantity}</span> {s.customerName && s.customerName!=="Walk-in" ? <span className="bg-yellow-100 px-2 rounded-full text-[10px]">👤 {s.customerName}</span> : null} {s.status==="pending" ? <span className="bg-red-600 text-white px-2 rounded-full text-[9px]">UDHAR</span> : null}</p><p className="text-[10px] text-gray-400">Rs.{s.sellPrice}/pcs • Profit Rs.{s.profit} • {new Date(s.createdAt).toLocaleTimeString()} • {s.category}</p></div>
                    <span className="font-bold">Rs.{s.total}</span>
                  </div>
                ))}
              </div>
            )
          })}
          {pagination.hasMore && <button onClick={()=>setPage(p=>p+1)} className="w-full py-2.5 bg-white border rounded-xl text-[12px]">Load More ({pagination.totalCount - sales.length})</button>}
        </div>
      )}
      <div className="mt-4 bg-black text-white p-4 rounded-xl flex justify-between"><div><p className="text-[12px] opacity-70">Total {filter}</p><p className="text-[11px] opacity-60">Profit Rs.{profit}</p></div><span className="text-[20px] font-bold">Rs.{total}</span></div>
    </div>
  );
}