"use client";
import { useEffect, useState, useCallback, useSyncExternalStore, useRef } from "react";
import { offlineDB } from "@/lib/offline-db";
import type { OfflineSale } from "@/lib/offline-db";
import { getOfflineUser } from "@/lib/offline-auth";

type Category = "mobile_accessories" | "manyari" | "cosmetics" | "other";
type Product = { _id: string; name: string; category: Category; buyPrice: number; buyPriceAvg: number; sellPrice: number; stock: number; stockMode: "limited"|"unlimited"; };
type Sale = { _id: string; productId: string; productName: string; category: Category; quantity: number; sellPrice: number; total: number; profit: number; createdAt: string; customerName?: string; status?: string; paymentType?: string; };
type CartItem = { cartId: string; productId: string; name: string; qty: number; price: number; total: number; category: Category; buyPrice: number; buyPriceAvg: number };
type FilterType = "today"|"weekly"|"monthly"|"all";
type Pagination = { page: number; totalPages: number; hasMore: boolean; totalCount: number };
type SalesApiResponse = { sales: Sale[]; pagination: Pagination };
type ProductApiResponse = { products: Product[] } | Product[];

function useIsOnline(){ const s=useCallback((cb:()=>void)=>{window.addEventListener("online",cb);window.addEventListener("offline",cb);return()=>{window.removeEventListener("online",cb);window.removeEventListener("offline",cb);};},[]); const g=useCallback(()=>navigator.onLine,[]); const ss=useCallback(()=>true,[]); return useSyncExternalStore(s,g,ss); }
function rnd(n:number){return Math.round(n||0);}
function fmt(n:number){return rnd(n).toString();}

export default function SalesPage(){
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<FilterType>("today");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination>({page:1,totalPages:1,hasMore:false,totalCount:0});
  const [productSearch, setProductSearch] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingSales, setLoadingSales] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [customerName, setCustomerName] = useState("Walk-in");
  const [paymentType, setPaymentType] = useState<"cash"|"credit">("cash");
  const [pendingCount, setPendingCount] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [customerError, setCustomerError] = useState(false);
  const isOnlineHook = useIsOnline();
  const isOffline = mounted && !isOnlineHook;
  const searchRef = useRef<HTMLInputElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{setMounted(true);},[]);
  const refreshCounts = useCallback(async()=>{ try{ const c=await offlineDB.sales.where("synced").equals(0).count(); setPendingCount(c);}catch{} },[]);

  useEffect(()=>{
    let cancelled=false;
    const load=async()=>{
      setLoadingProducts(true);
      try{
        if(!navigator.onLine){
          const cached=await offlineDB.products.toArray();
          const filtered=cached.filter(c=>{ const s=productSearch.toLowerCase(); return (!s||c.name.toLowerCase().includes(s)) && (categoryFilter==="all"||c.category===categoryFilter); });
          if(!cancelled) setProducts(filtered.map(c=>({ _id:c._id||c.localId, name:c.name, category:c.category||"other", buyPrice:c.buyPriceAvg||c.buyPrice, buyPriceAvg:c.buyPriceAvg||c.buyPrice, sellPrice:c.sellPrice, stock:c.stock, stockMode:c.stockMode||"limited" })));
        } else {
          const res=await fetch(`/api/products?search=${encodeURIComponent(productSearch)}&category=${categoryFilter}&page=1&limit=50`);
          const data=(await res.json()) as ProductApiResponse;
          const list=Array.isArray(data)?data:data.products;
          if(!cancelled) setProducts(list.map(p=>({ _id:p._id, name:p.name, category:p.category, buyPrice:p.buyPriceAvg||p.buyPrice||0, buyPriceAvg:p.buyPriceAvg||p.buyPrice||0, sellPrice:p.sellPrice, stock:p.stock, stockMode:p.stockMode })));
        }
      }catch{} finally{ if(!cancelled) setLoadingProducts(false); }
    };
    void load(); return()=>{cancelled=true;};
  },[productSearch, categoryFilter]);

  const loadSales=useCallback(async(f:FilterType,p:number)=>{
    setLoadingSales(true);
    try{
      if(!navigator.onLine){
        const all=await offlineDB.sales.orderBy("createdAt").reverse().toArray();
        let filtered=all as OfflineSale[];
        const now=new Date();
        if(f==="today") filtered=filtered.filter(s=>new Date(s.createdAt).toDateString()===now.toDateString());
        if(f==="weekly"){ const w=new Date(); w.setDate(now.getDate()-7); filtered=filtered.filter(s=>new Date(s.createdAt)>=w); }
        if(f==="monthly"){ const m=new Date(); m.setMonth(now.getMonth()-1); filtered=filtered.filter(s=>new Date(s.createdAt)>=m); }
        const mapped: Sale[]=filtered.slice((p-1)*20,p*20).map(o=>({ _id:o.localId, productId:o.productId, productName:o.productName, category:o.category||"other", quantity:o.quantity, sellPrice:o.sellPrice, total:o.total, profit:o.profit, createdAt:o.createdAt, customerName:o.customerName, status:o.status, paymentType:o.paymentType }));
        if(p===1) setSales(mapped); else setSales(prev=>[...prev,...mapped]);
        setPagination({page:p,totalPages:Math.ceil(filtered.length/20),hasMore:filtered.length>p*20,totalCount:filtered.length});
      } else {
        const res=await fetch(`/api/sales?filter=${f}&page=${p}&limit=20`);
        const data=(await res.json()) as SalesApiResponse;
        const list=data.sales||[];
        if(p===1) setSales(list); else setSales(prev=>[...prev,...list]);
        setPagination(data.pagination||{page:p,totalPages:1,hasMore:false,totalCount:list.length});
      }
    }catch{} finally{ setLoadingSales(false); }
  },[]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{ void loadSales(filter,page); void refreshCounts(); },[filter,page,loadSales,refreshCounts]);

  const total=sales.reduce((a,b)=>a+b.total,0);
  const profit=sales.reduce((a,b)=>a+b.profit,0);

  const updateProductPrice = (id:string, newPrice:number)=>{
    if(newPrice<1) return;
    setProducts(prev=>prev.map(p=>p._id===id?{...p, sellPrice:rnd(newPrice)}:p));
  };

  const addToCart=useCallback((p:Product, qty=1)=>{
    // STOCK 0 BLOCK - FIRST
    if(p.stockMode==="limited" && p.stock<=0){
      alert(`Out of stock: ${p.name} - Stock 0`);
      return;
    }
    // UDHAR BLOCK
    if(paymentType==="credit"){
      const name=customerName.trim();
      if(name.length<2 || name.toLowerCase()==="walk-in"){
        setCustomerError(true);
        alert("Customer name required for Udhar! Please enter customer name first.");
        customerInputRef.current?.focus();
        customerInputRef.current?.scrollIntoView({behavior:"smooth", block:"center"});
        return;
      }
    }
    setCart(prev=>{
      const totalQtyInCart = prev.filter(c=>c.productId===p._id).reduce((s,c)=>s+c.qty,0);
      if(p.stockMode==="limited" && p.stock < totalQtyInCart + qty){
        alert(`Only ${p.stock} left for ${p.name}, you have ${totalQtyInCart} in cart. Can add max ${Math.max(0,p.stock-totalQtyInCart)} more`);
        return prev;
      }
      const newItem: CartItem = {
        cartId: `${p._id}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        productId: p._id,
        name: p.name,
        qty: rnd(qty),
        price: p.sellPrice,
        total: rnd(qty*p.sellPrice),
        category: p.category,
        buyPrice: p.buyPriceAvg,
        buyPriceAvg: p.buyPriceAvg,
      };
      return [...prev, newItem];
    });
  },[paymentType, customerName]);

  const removeFromCart=(cartId:string)=>setCart(prev=>prev.filter(c=>c.cartId!==cartId));
  const cartTotal=cart.reduce((s,c)=>s+c.total,0);
  const cartProfit=cart.reduce((s,c)=>s+rnd((c.price-c.buyPriceAvg)*c.qty),0);

  const checkout=useCallback(async()=>{
    if(cart.length===0){ alert("Cart empty"); return; }
    if(paymentType==="credit"){
      const name=customerName.trim();
      if(name.length<2 || name.toLowerCase()==="walk-in"){
        setCustomerError(true);
        alert("Customer name required for Udhar!");
        customerInputRef.current?.focus();
        return;
      }
    }
    const finalCustomer=customerName.trim()||"Walk-in";
    const copy=[...cart];
    const now=new Date().toISOString();

    type SessionRes = { user?: { id?: string; _id?: string } };
    let sessionUserId = "";
    try {
      const res = await fetch("/api/auth/session");
      if(res.ok){
        const data = await res.json() as SessionRes;
        sessionUserId = data?.user?.id || data?.user?._id || "";
      }
    } catch {}
    const offlineUser = getOfflineUser() as { _id?: string; id?: string } | null;
    const rawUserId = offlineUser?._id || offlineUser?.id || sessionUserId || "offline_user";
    
    const newSales: Sale[]=copy.map((c,i)=>({
      _id:`local_${Date.now()}_${i}_${Math.random().toString(36).slice(2,4)}`,
      productId:c.productId,
      productName:c.name,
      category:c.category,
      quantity:c.qty,
      sellPrice:c.price,
      total:c.total,
      profit:rnd((c.price-c.buyPriceAvg)*c.qty),
      createdAt:now,
      customerName:finalCustomer,
      status:paymentType==="credit"?"pending":"paid",
      paymentType,
    }));
    
    setSales(prev=>[...newSales, ...prev]);
    setCart([]);

    for(let i=0;i<copy.length;i++){
      const c=copy[i];
      const saleToSave: OfflineSale = {
        localId: newSales[i]._id,
        productId: c.productId,
        productName: c.name,
        category: c.category,
        quantity: c.qty,
        sellPrice: c.price,
        buyPrice: c.buyPriceAvg,
        buyPriceAvg: c.buyPriceAvg,
        total: c.total,
        profit: newSales[i].profit,
        customerName: finalCustomer,
        paymentType: paymentType,
        status: paymentType==="credit"?"pending":"paid",
        userId: rawUserId,
        createdAt: now,
        synced: 0,
      };
      try{ await offlineDB.sales.put(saleToSave); }catch(e){ console.error(e); }
    }
    await refreshCounts();

    if(navigator.onLine){
      for(let i=0;i<copy.length;i++){
        const c=copy[i];
        try{
          const res = await fetch("/api/sales",{ 
            method:"POST", 
            headers:{"Content-Type":"application/json"}, 
            body:JSON.stringify({ 
              productId:c.productId, productName:c.name, quantity:c.qty, 
              sellPrice:c.price, buyPrice:c.buyPriceAvg, buyPriceAvg:c.buyPriceAvg, 
              customerName:finalCustomer, paymentType, category:c.category,
              userId: sessionUserId || rawUserId, localId: newSales[i]._id,
            }) 
          });
          const text = await res.text();
          if(!res.ok) alert(`Mongo ${res.status}: ${text}`);
        }catch(e){ console.error(e); }
      }
    }
    setProducts(prev=>prev.map(prod=>{
      const totalQty = copy.filter(x=>x.productId===prod._id).reduce((s,x)=>s+x.qty,0);
      return totalQty>0 && prod.stockMode==="limited" ? {...prod, stock:Math.max(0,prod.stock-totalQty)} : prod;
    }));
  },[cart, customerName, paymentType, refreshCounts]);

  return(
    <div className="min-h-screen bg-gray-50 p-2 sm:p-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap justify-between gap-2 mb-3">
        <h1 className="font-bold text-[18px]">🛒 Asad POS {isOffline?"📶 Offline":""}</h1>
        <div className="flex gap-2">
          <span className="bg-green-600 text-white px-3 py-1 rounded-full text-[11px]">Sale Rs.{fmt(total)}</span>
          <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-[11px]">Profit Rs.{fmt(profit)}</span>
          {pendingCount>0 && <span className="bg-amber-500 text-white px-3 py-1 rounded-full text-[11px]">{pendingCount} pending</span>}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <div className="flex gap-2 mb-2">
            <input ref={searchRef} value={productSearch} onChange={e=>setProductSearch(e.target.value)} placeholder="🔍 Search e.g Vivo Cover" className="flex-1 border p-2.5 rounded-xl bg-white text-[13px]" />
            <select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)} className="border p-2.5 rounded-xl bg-white text-[12px]"><option value="all">All</option><option value="mobile_accessories">📱 Mobile</option><option value="manyari">💍 Manyari</option><option value="cosmetics">💄 Cosmetics</option><option value="other">Other</option></select>
          </div>
          {loadingProducts? <p className="text-center py-6 text-[12px]">Loading...</p> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {products.map(p=>{
                const qty=qtyMap[p._id]||1; const buy=p.buyPriceAvg||p.buyPrice;
                const isOutOfStock = p.stockMode==="limited" && p.stock<=0;
                const cartQty = cart.filter(c=>c.productId===p._id).reduce((s,c)=>s+c.qty,0);
                const remaining = p.stockMode==="limited" ? Math.max(0, p.stock - cartQty) : 999;
                return(
                  <div key={p._id} className={`bg-white border rounded-xl p-3 ${isOutOfStock ? "opacity-70 bg-red-50 border-red-200" : ""}`}>
                    <p className="font-bold text-[13px] truncate">{p.name} {isOutOfStock && <span className="text-red-600 text-[10px] ml-1">● OUT OF STOCK</span>}</p>
                    <p className="text-[11px] text-gray-500">{p.category} • Stock {p.stockMode==="unlimited"?"∞":p.stock} {!isOutOfStock && p.stockMode==="limited" ? `(Left ${remaining})` : ""} • Buy {fmt(buy)}</p>
                    <div className="flex gap-2 mt-2 items-center">
                      <span className="text-[11px]">Sell Rs.</span>
                      <input type="number" value={p.sellPrice} onChange={e=>updateProductPrice(p._id, Number(e.target.value))} className="w-20 border p-1 rounded-lg text-[12px] font-bold bg-yellow-50" disabled={isOutOfStock} />
                      <span className="text-[10px] text-green-600 font-bold ml-auto">Profit {fmt(p.sellPrice-buy)}</span>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <div className="flex border rounded-lg overflow-hidden h-8">
                        <button type="button" onClick={()=>setQtyMap({...qtyMap,[p._id]:Math.max(1,qty-1)})} className="px-2 bg-gray-100" disabled={isOutOfStock}>-</button>
                        <span className="w-8 flex items-center justify-center text-[12px] font-bold">{qty}</span>
                        <button type="button" onClick={()=>{ if(p.stockMode==="limited" && qty>=p.stock){ alert(`Only ${p.stock} left`); return; } setQtyMap({...qtyMap,[p._id]:qty+1}); }} className="px-2 bg-gray-100" disabled={isOutOfStock}>+</button>
                      </div>
                      <button type="button" onClick={()=>addToCart(p,qty)} disabled={isOutOfStock} className={`flex-1 px-3 py-1 rounded-lg text-[11px] font-bold ${isOutOfStock ? "bg-gray-300 text-gray-500 cursor-not-allowed" : "bg-green-600 text-white"}`}>{isOutOfStock ? "Out of Stock" : `Add Rs.${fmt(qty*p.sellPrice)}`}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <div className="bg-white border rounded-xl p-3">
            <p className="font-bold text-[13px] mb-2">🛒 Cart ({cart.length}) - Rs.{fmt(cartTotal)}</p>
            <div className="space-y-1 max-h-60 overflow-y-auto mb-3">
              {cart.length===0? <p className="text-[11px] text-gray-400 text-center py-4">Cart empty</p> : cart.map(c=>(
                <div key={c.cartId} className="flex justify-between text-[11px] border-b py-1.5">
                  <span>{c.name} x{c.qty} @ {fmt(c.price)}</span>
                  <span className="flex gap-2"><b>Rs.{fmt(c.total)}</b><button type="button" onClick={()=>removeFromCart(c.cartId)} className="text-red-600">✕</button></span>
                </div>
              ))}
            </div>
            <input ref={customerInputRef} value={customerName} onChange={e=>{ setCustomerName(e.target.value); if(e.target.value.trim().length>=2) setCustomerError(false); }} placeholder="Customer name for Udhar" className={`w-full border p-2 rounded-lg text-[12px] mb-2 ${customerError ? "border-red-500 bg-red-50 ring-2 ring-red-300" : ""}`} />
            {customerError && <p className="text-[10px] text-red-600 mb-2 font-bold">* Customer name required for Udhar</p>}
            <div className="flex bg-gray-100 rounded-lg p-1 mb-3">
              <button type="button" onClick={()=>{ setPaymentType("cash"); setCustomerError(false); }} className={`flex-1 py-1.5 rounded-md text-[11px] font-bold ${paymentType==="cash"?"bg-green-600 text-white":"text-gray-600"}`}>Cash</button>
              <button type="button" onClick={()=>{ const name=customerName.trim(); if(name.length<2 || name.toLowerCase()==="walk-in"){ setCustomerError(true); alert("Customer name required for Udhar! Enter name before selecting Udhar."); customerInputRef.current?.focus(); return; } setCustomerError(false); setPaymentType("credit"); }} className={`flex-1 py-1.5 rounded-md text-[11px] font-bold ${paymentType==="credit"?"bg-red-600 text-white":"text-gray-600"}`}>Udhar</button>
            </div>
            <button type="button" onClick={()=>{ void checkout(); }} disabled={cart.length===0} className="w-full bg-black text-white py-2.5 rounded-xl font-bold text-[13px] disabled:bg-gray-300">{paymentType==="credit"? `Udhar Rs.${fmt(cartTotal)}` : `Sell Rs.${fmt(cartTotal)} • Profit ${fmt(cartProfit)}`}</button>
          </div>
          <div className="bg-white border rounded-xl overflow-hidden">
            <div className="flex gap-1 p-2 border-b bg-gray-50 overflow-x-auto">{(["today","weekly","monthly","all"] as const).map(f=><button type="button" key={f} onClick={()=>{setFilter(f); setPage(1);}} className={`px-3 py-1 rounded-full text-[10px] font-bold capitalize ${filter===f?"bg-green-600 text-white":"bg-white border"}`}>{f}</button>)}</div>
            {loadingSales? <p className="p-4 text-center text-[11px]">Loading sales...</p> : <div>{sales.map(s=>(
              <div key={s._id} className={`p-2 border-b flex justify-between text-[11px] ${s.status==="pending"?"bg-red-50":""}`}>
                <div><b>{s.productName}</b> x{s.quantity} @ Rs.{fmt(s.sellPrice)}{s.customerName && s.customerName!=="Walk-in"?` 👤${s.customerName}`:""}<div className="text-[9px] text-gray-500">{new Date(s.createdAt).toLocaleTimeString()} • Profit {fmt(s.profit)}</div></div>
                <div className="text-right"><div className="font-bold">Rs.{fmt(s.total)}</div><div className={`text-[9px] ${s.status==="pending"?"text-red-600":"text-green-600"}`}>{s.status==="pending"?"UDHAR":"Paid"}</div></div>
              </div>
            ))}{pagination.hasMore && <button type="button" onClick={()=>setPage(p=>p+1)} className="w-full py-2 text-[11px] bg-gray-50">Load More</button>}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}