"use client";
import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { offlineDB } from "@/lib/offline-db";

type Product = { _id: string; name: string; category: string; sellPrice: number; buyPrice: number; stock: number; stockMode: string; };
type Sale = { productName: string; quantity: number; total: number; profit: number; createdAt: string; customerName?: string; status?: string; };
type TopItem = { _id: string; category?: string; totalQty: number; totalSale: number; totalProfit: number; count: number };
type ReportBlock = { total: number; profit: number; count: number };
type ReportsState = { today: ReportBlock; month: ReportBlock; year: ReportBlock; all: ReportBlock; easypaisa: { commission: number } };
type ApiProducts = Product[] | { products: Product[] };
type ApiSales = { sales: Sale[] };
type ApiReports = { today?: ReportBlock; month?: ReportBlock; year?: ReportBlock; all?: ReportBlock };
type ApiEasypaisa = { totalCommission?: number };
type ApiCustomers = { customers: { totalUdhar?: number; isPaid?: boolean }[] };
type ApiTop = { top: TopItem[] };

function useIsOnline(){
  const sub = useCallback((cb:()=>void)=>{ window.addEventListener("online",cb); window.addEventListener("offline",cb); return ()=>{ window.removeEventListener("online",cb); window.removeEventListener("offline",cb);};},[]);
  const snap = useCallback(()=> navigator.onLine,[]);
  const ss = useCallback(()=> true,[]);
  return useSyncExternalStore(sub,snap,ss);
}
function fmt(n:number){ return Math.round(n||0).toString(); }
function isProductArray(v: unknown): v is Product[] { return Array.isArray(v); }

export default function AsadDashboard(){
  const isOnline = useIsOnline();
  const isOffline = !isOnline;
  const [products, setProducts] = useState<Product[]>([]);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [reports, setReports] = useState<ReportsState>({ today:{ total:0, profit:0, count:0 }, month:{ total:0, profit:0, count:0 }, year:{ total:0, profit:0, count:0 }, all:{ total:0, profit:0, count:0 }, easypaisa:{ commission:0 } });
  const [khata, setKhata] = useState({ totalUdhar:0, customers:0 });
  const [topProducts, setTopProducts] = useState<TopItem[]>([]);
  const [topFilter, setTopFilter] = useState<"today"|"weekly"|"monthly"|"all">("monthly");
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(()=>{
    const ctrl = new AbortController();
    const load = async()=>{
      try{
        const offlineNow = typeof window!=="undefined" && !window.navigator.onLine;
        if(offlineNow){
          const offlineProds = await offlineDB.products.toArray();
          const offlineSales = await offlineDB.sales.reverse().toArray();
          const offlineCustomers = await offlineDB.customers.toArray();
          setProducts(offlineProds as unknown as Product[]);
          setRecentSales(offlineSales.slice(0,5).map(s=>{
            const o = s as unknown as Sale; return { productName: o.productName, quantity: o.quantity, total: o.total, profit: o.profit, createdAt: o.createdAt, customerName: o.customerName, status: o.status };
          }));
          const today = new Date(); today.setHours(0,0,0,0);
          const todaySales = offlineSales.filter(s=> new Date((s as unknown as Sale).createdAt) >= today);
          const sumTotal = (arr: typeof offlineSales)=> arr.reduce((a,b)=> a + (b as unknown as Sale).total, 0);
          const sumProfit = (arr: typeof offlineSales)=> arr.reduce((a,b)=> a + (b as unknown as Sale).profit, 0);
          setReports({ today:{ total: sumTotal(todaySales), profit: sumProfit(todaySales), count: todaySales.length }, month:{ total: sumTotal(offlineSales), profit: sumProfit(offlineSales), count: offlineSales.length }, year:{ total:0, profit:0, count:0 }, all:{ total:0, profit:0, count:0 }, easypaisa:{ commission:0 } });
          const totalUdhar = offlineCustomers.reduce((a,b)=> a + ((b as unknown as {isPaid?:boolean; totalUdhar?:number}).isPaid?0:((b as unknown as {totalUdhar?:number}).totalUdhar||0)), 0);
          setKhata({ totalUdhar, customers: offlineCustomers.filter(b=>!(b as unknown as {isPaid?:boolean}).isPaid).length });
          setPendingCount(offlineSales.filter(b=>!(b as unknown as {synced?:number}).synced).length);
        } else {
          const [prodRes, salesRes, reportRes, khataRes, topRes, easyRes, offlinePending] = await Promise.all([
            fetch("/api/products?limit=100",{signal:ctrl.signal}),
            fetch("/api/sales?filter=today&limit=5",{signal:ctrl.signal}),
            fetch("/api/reports",{signal:ctrl.signal}),
            fetch("/api/customers?search=",{signal:ctrl.signal}),
            fetch(`/api/sales/top?filter=${topFilter}`,{signal:ctrl.signal}),
            fetch("/api/easypaisa?filter=today",{signal:ctrl.signal}),
            offlineDB.sales.where("synced").equals(0).toArray(),
          ]);
          const prodJson = await prodRes.json() as ApiProducts;
          setProducts(isProductArray(prodJson) ? prodJson : (prodJson.products||[]));
          const salesJson = await salesRes.json() as ApiSales; setRecentSales(salesJson.sales||[]);
          const reportJson = await reportRes.json() as ApiReports; const easyJson = await easyRes.json() as ApiEasypaisa;
          setReports({
            today: reportJson.today||{total:0,profit:0,count:0},
            month: reportJson.month||{total:0,profit:0,count:0},
            year: reportJson.year||{total:0,profit:0,count:0},
            all: reportJson.all||{total:0,profit:0,count:0},
            easypaisa: { commission: easyJson.totalCommission||0 }
          });
          const khataJson = await khataRes.json() as ApiCustomers; const list = khataJson.customers||[];
          const filtered = list.filter(c=>!c.isPaid);
          setKhata({ totalUdhar: filtered.reduce((a,c)=>a+(c.totalUdhar||0),0), customers: filtered.length });
          const topJson = await topRes.json() as ApiTop; setTopProducts(topJson.top||[]);
          setPendingCount(offlinePending.length);
        }
      }catch{} finally{ setLoading(false); }
    };
    void load();
    return()=>ctrl.abort();
  },[topFilter]);

  const lowStock = products.filter(p=>p.stockMode!=="unlimited" && p.stock<5);
  const stockValue = products.reduce((s,p)=>s+p.sellPrice*p.stock,0);
  const stockProfit = products.reduce((s,p)=>s+(p.sellPrice-p.buyPrice)*p.stock,0);

  if(loading) return <p className="p-8 text-center text-[12px]">Loading Asad Store...</p>;

  return(
    <div className="p-3 sm:p-6 max-w-6xl mx-auto min-h-screen bg-gray-50">
      {isOffline && <div className="mb-3 bg-amber-50 border text-amber-800 text-[12px] p-2.5 rounded-xl text-center">📶 Offline • {pendingCount} pending</div>}
      {khata.totalUdhar>0 && <div className="mb-3 bg-red-50 border border-red-200 text-red-800 text-[12px] p-2.5 rounded-xl flex justify-between"><span>📒 Udhar: Rs.{fmt(khata.totalUdhar)} • {khata.customers} customers</span><Link href="/khata" className="bg-red-600 text-white px-3 py-1 rounded-lg text-[11px]">Khata</Link></div>}
      <h1 className="text-[20px] font-bold">🛍️ Asad Store Dashboard</h1>
      <p className="text-[11px] text-gray-500 mb-4">{new Date().toLocaleDateString()} • Mobile Accessories + Manyari • {isOffline?"Offline":"Online"}</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
        <div className="bg-white p-4 rounded-xl border"><p className="text-[10px] text-gray-400">Today Sale</p><p className="text-[18px] font-bold">Rs.{fmt(reports.today.total)}</p><p className="text-[10px] text-green-600">+Rs.{fmt(reports.today.profit)} • {reports.today.count} sales</p></div>
        <div className="bg-white p-4 rounded-xl border"><p className="text-[10px] text-gray-400">Month Sale</p><p className="text-[18px] font-bold">Rs.{fmt(reports.month.total)}</p><p className="text-[10px] text-blue-600">+Rs.{fmt(reports.month.profit)} • {reports.month.count} bills</p></div>
        <div className="bg-white p-4 rounded-xl border"><p className="text-[10px] text-gray-400">Stock Value</p><p className="text-[18px] font-bold">Rs.{fmt(stockValue)}</p><p className="text-[10px] text-gray-500">+Rs.{fmt(stockProfit)} • {products.length} items</p></div>
        <div className="bg-green-50 border border-green-200 p-4 rounded-xl"><p className="text-[10px] text-green-700 font-bold">Easypaisa Commission Today</p><p className="text-[18px] font-bold text-green-700">Rs.{fmt(reports.easypaisa.commission)}</p><Link href="/easypaisa" className="text-[10px] text-green-700 font-bold">View →</Link></div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-5">
        <Link href="/sales" className="bg-black text-white p-4 rounded-xl text-center font-bold text-[13px]">🛒 POS Sale</Link>
        <Link href="/products" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">📦 Products</Link>
        <Link href="/easypaisa" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">💰 Easypaisa</Link>
        <Link href="/khata" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">📒 Khata</Link>
        <Link href="/sales/history" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">📜 History</Link>
        <Link href="/sales/top" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">🔥 Top Sell</Link>
      </div>
    </div>
  );
}