"use client";
import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { offlineDB } from "@/lib/offline-db";
import type { OfflineProduct } from "@/lib/offline-db";
import { getOfflineUser } from "@/lib/offline-auth";

type Category = "mobile_accessories" | "manyari" | "cosmetics" | "other";
type Product = {
  _id: string;
  name: string;
  category: Category;
  company?: string;
  buyPrice: number;
  buyPriceAvg: number;
  sellPrice: number;
  stock: number;
  localId?: string;
  synced?: number;
};
type FormState = { name: string; category: Category; company: string; buyPrice: string; sellPrice: string; stock: string; };
type Pagination = { page: number; totalPages: number; hasMore: boolean; totalCount: number };
type ProductsResponse = { products: Product[]; pagination: Pagination } | Product[];
type OfflineUser = { _id?: string } | null;

function generateLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `local_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function useIsOnline(): boolean {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener("online", cb);
    window.addEventListener("offline", cb);
    return () => {
      window.removeEventListener("online", cb);
      window.removeEventListener("offline", cb);
    };
  }, []);
  const getSnapshot = useCallback(() => window.navigator.onLine, []);
  const getServerSnapshot = useCallback(() => true, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
function rnd(n: number) {
  return Math.round(n || 0);
}
function toProductCategory(c: string | undefined): Category {
  if (c === "mobile_accessories" || c === "manyari" || c === "cosmetics" || c === "other") return c;
  return "other";
}

export default function ProductsPage() {
  const isOnline = useIsOnline();
  const isOffline = !isOnline;
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<FormState>({ name: "", category: "mobile_accessories", company: "", buyPrice: "", sellPrice: "", stock: "1" });
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, totalPages: 1, hasMore: false, totalCount: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refreshAfterAction = useCallback(async (currentSearch: string, cat: string) => {
    setPage(1);
    if (typeof window !== "undefined" && !window.navigator.onLine) {
      const cached = await offlineDB.products.toArray();
      const searchLower = currentSearch.toLowerCase();
      const filtered = cached.filter((c) => {
        const matchSearch = !currentSearch || c.name.toLowerCase().includes(searchLower);
        const matchCat = cat === "all" || c.category === cat;
        return matchSearch && matchCat;
      });
      const limit = 20;
      const paged = filtered.slice(0, limit).map((c): Product => ({
        _id: c._id || c.localId,
        name: c.name,
        category: toProductCategory(c.category),
        company: c.company,
        buyPrice: c.buyPriceAvg || c.buyPrice || 0,
        buyPriceAvg: c.buyPriceAvg || c.buyPrice || 0,
        sellPrice: c.sellPrice,
        stock: c.stock,
        localId: c.localId,
        synced: c.synced,
      }));
      setProducts(paged);
      setPagination({ page: 1, totalPages: Math.ceil(filtered.length / 20) || 1, hasMore: filtered.length > paged.length, totalCount: filtered.length });
      return;
    }
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(currentSearch)}&category=${cat}&page=1&limit=20`);
      const data = (await res.json()) as ProductsResponse;
      let list: Product[] = [];
      if (Array.isArray(data)) {
        list = data as Product[];
        setProducts(list);
        setPagination({ page: 1, totalPages: 1, hasMore: false, totalCount: data.length });
      } else {
        list = data.products;
        setProducts(data.products);
        setPagination(data.pagination);
      }
      if (list.length > 0) {
        const offlineUser = getOfflineUser() as OfflineUser;
        const userId = offlineUser?._id || "offline";
        const toCache: OfflineProduct[] = list.map((p) => ({
          _id: p._id,
          localId: p.localId || p._id,
          name: p.name,
          company: p.company || "",
          category: p.category,
          buyPrice: p.buyPriceAvg || p.buyPrice,
          buyPriceAvg: p.buyPriceAvg || p.buyPrice,
          sellPrice: p.sellPrice,
          stock: p.stock,
          stockMode: "limited",
          userId,
          synced: 1,
          createdAt: new Date().toISOString(),
        }));
        await offlineDB.products.bulkPut(toCache);
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  const syncPendingProducts = useCallback(async () => {
    if (typeof window === "undefined" || !window.navigator.onLine) return;
    const pending = await offlineDB.products.where("synced").equals(0).toArray();
    if (pending.length === 0) return;
    setSyncing(true);
    let synced = 0;
    for (const p of pending) {
      try {
        const isNew = !!p.localId && p.localId.startsWith("local_");
        const url = isNew ? "/api/products" : `/api/products/${p._id}`;
        const method = isNew ? "POST" : "PUT";
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: p.name,
            category: p.category || "other",
            company: p.company,
            buyPrice: p.buyPriceAvg,
            buyPriceAvg: p.buyPriceAvg,
            sellPrice: p.sellPrice,
            stock: p.stock,
            localId: p.localId,
          }),
        });
        if (res.ok) {
          await offlineDB.products.update(p.localId, { synced: 1 });
          synced++;
        }
      } catch {
        // ignore
      }
    }
    setPendingCount((prev) => Math.max(0, prev - synced));
    setSyncing(false);
    if (synced > 0) void refreshAfterAction(search, categoryFilter);
  }, [refreshAfterAction, search, categoryFilter]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async (currentSearch: string, cat: string, currentPage: number, signal: AbortSignal) => {
      if (currentPage === 1) setLoading(true);
      else setLoadingMore(true);
      try {
        const cached = await offlineDB.products.toArray();
        setPendingCount(cached.filter((c) => c.synced === 0).length);
        if (typeof window !== "undefined" && !window.navigator.onLine) {
          const searchLower = currentSearch.toLowerCase();
          const filtered = cached.filter((c) => {
            const matchSearch = !currentSearch || c.name.toLowerCase().includes(searchLower);
            const matchCat = cat === "all" || c.category === cat;
            return matchSearch && matchCat;
          });
          const limit = currentPage * 20;
          const paged = filtered.slice(0, limit).map((c): Product => ({
            _id: c._id || c.localId,
            name: c.name,
            category: toProductCategory(c.category),
            company: c.company,
            buyPrice: c.buyPriceAvg || c.buyPrice || 0,
            buyPriceAvg: c.buyPriceAvg || c.buyPrice || 0,
            sellPrice: c.sellPrice,
            stock: c.stock,
            localId: c.localId,
            synced: c.synced,
          }));
          setProducts(paged);
          setPagination({ page: currentPage, totalPages: Math.ceil(filtered.length / 20) || 1, hasMore: filtered.length > paged.length, totalCount: filtered.length });
          return;
        }
        const res = await fetch(`/api/products?search=${encodeURIComponent(currentSearch)}&category=${cat}&page=${currentPage}&limit=20`, { signal });
        const data = (await res.json()) as ProductsResponse;
        if (Array.isArray(data)) {
          setProducts(data as Product[]);
          setPagination({ page: 1, totalPages: 1, hasMore: false, totalCount: data.length });
        } else {
          if (currentPage === 1) setProducts(data.products);
          else setProducts((prev) => [...prev, ...data.products]);
          setPagination(data.pagination);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") console.error(err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    };
    void load(search, categoryFilter, page, controller.signal);
    return () => controller.abort();
  }, [search, categoryFilter, page]);

  useEffect(() => {
    if (isOnline) {
      const t = setTimeout(() => {
        void syncPendingProducts();
      }, 500);
      return () => clearTimeout(t);
    }
  }, [isOnline, syncPendingProducts]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const buy = rnd(Number(form.buyPrice));
    const sell = rnd(Number(form.sellPrice));
    const stock = rnd(Number(form.stock));
    if (!form.name.trim()) {
      alert("Name required");
      return;
    }
    if (buy <= 0 || sell <= 0) {
      alert("Buy & Sell required");
      return;
    }
    const payload = { name: form.name.trim(), category: form.category, company: form.company, buyPrice: buy, buyPriceAvg: buy, sellPrice: sell, stock };
    const offlineUser = getOfflineUser() as OfflineUser;
    setUpdating(true);
    try {
      if (isOffline) {
        const localId = editId && editId.startsWith("local_") ? editId : generateLocalId();
        await offlineDB.products.put({
          _id: editId && !editId.startsWith("local_") ? editId : localId,
          localId,
          name: payload.name,
          company: payload.company,
          category: payload.category,
          buyPrice: buy,
          buyPriceAvg: buy,
          sellPrice: sell,
          stock,
          stockMode: "limited",
          userId: offlineUser?._id || "offline",
          synced: 0,
          createdAt: new Date().toISOString(),
        });
        setPendingCount((c) => c + 1);
        setForm({ name: "", category: "mobile_accessories", company: "", buyPrice: "", sellPrice: "", stock: "1" });
        setEditId(null);
        await refreshAfterAction(search, categoryFilter);
        return;
      }
      const url = editId && !editId.startsWith("local_") ? `/api/products/${editId}` : "/api/products";
      const method = editId && !editId.startsWith("local_") ? "PUT" : "POST";
      const body = editId && editId.startsWith("local_") ? { ...payload, localId: editId } : payload;
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error("failed");
      if (editId && editId.startsWith("local_")) await offlineDB.products.delete(editId);
    } catch (err) {
      console.error(err);
      const localId = editId || generateLocalId();
      await offlineDB.products.put({
        _id: localId,
        localId,
        name: payload.name,
        company: payload.company,
        category: payload.category,
        buyPrice: buy,
        buyPriceAvg: buy,
        sellPrice: sell,
        stock,
        stockMode: "limited",
        userId: offlineUser?._id || "offline",
        synced: 0,
        createdAt: new Date().toISOString(),
      });
      setPendingCount((c) => c + 1);
    } finally {
      setUpdating(false);
    }
    setForm({ name: "", category: "mobile_accessories", company: "", buyPrice: "", sellPrice: "", stock: "1" });
    setEditId(null);
    await refreshAfterAction(search, categoryFilter);
  };

  const handleEdit = (p: Product) => {
    setEditId(p._id);
    setForm({ name: p.name, category: p.category, company: p.company || "", buyPrice: String(p.buyPriceAvg || p.buyPrice), sellPrice: String(p.sellPrice), stock: String(p.stock) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this product?")) return;
    setDeletingId(id);
    try {
      if (id.startsWith("local_")) {
        await offlineDB.products.delete(id);
        setPendingCount((c) => Math.max(0, c - 1));
        await refreshAfterAction(search, categoryFilter);
        return;
      }
      await fetch(`/api/products/${id}`, { method: "DELETE" });
      await refreshAfterAction(search, categoryFilter);
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto min-h-screen bg-gray-50">
      {isOffline && <div className="mb-3 bg-amber-50 border border-amber-200 text-amber-800 text-[12px] p-2.5 rounded-xl text-center">📶 Offline • {pendingCount} pending</div>}
      {pendingCount > 0 && !isOffline && <div className="mb-3 bg-blue-50 border border-blue-200 text-blue-800 text-[12px] p-2.5 rounded-xl flex justify-between"><span>{pendingCount} pending sync</span><button onClick={() => syncPendingProducts()} disabled={syncing} className="bg-blue-600 text-white px-3 py-1 rounded-lg text-[11px]">{syncing ? "Syncing..." : "Sync Now"}</button></div>}
      <div className="flex flex-col gap-3 mb-4">
        <h1 className="text-[20px] font-bold">📱 Asad Mobile & Manyari - Stock</h1>
        <div className="flex gap-2">
          <input placeholder="🔍 Search product..." value={search} onChange={(e) => handleSearchChange(e.target.value)} className="border p-2.5 rounded-xl flex-1 sm:w-72 bg-white text-[14px]" />
          <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }} className="border p-2.5 rounded-xl bg-white text-[13px]">
            <option value="all">All</option>
            <option value="mobile_accessories">📱 Mobile</option>
            <option value="manyari">💍 Manyari</option>
            <option value="cosmetics">💄 Cosmetics</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-3 rounded-xl shadow-sm border mb-6">
        <p className="font-semibold mb-3 text-[13px]">{editId ? "Edit Product" : "Add New Product"}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <input placeholder="Product Name * e.g Vivo Cover" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border p-2.5 rounded-lg col-span-2 sm:col-span-2 text-[13px]" required />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })} className="border p-2.5 rounded-lg bg-white text-[13px]">
            <option value="mobile_accessories">📱 Mobile Accessories</option>
            <option value="manyari">💍 Manyari</option>
            <option value="cosmetics">💄 Cosmetics</option>
            <option value="other">Other</option>
          </select>
          <input placeholder="Company (optional)" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="border p-2.5 rounded-lg text-[13px]" />
          <input placeholder="Buy Price * e.g 200" type="number" value={form.buyPrice} onChange={(e) => setForm({ ...form, buyPrice: e.target.value })} className="border p-2.5 rounded-lg text-[13px] bg-red-50" required />
          <input placeholder="Sell Price * e.g 350" type="number" value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} className="border p-2.5 rounded-lg text-[13px] bg-green-50" required />
          <input placeholder="Stock Qty" type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className="border p-2.5 rounded-lg text-[13px]" required />
        </div>
        {Number(form.buyPrice) > 0 && Number(form.sellPrice) > 0 && (
          <p className="mt-2 text-[12px] text-green-600">Profit: Rs.{rnd(Number(form.sellPrice) - Number(form.buyPrice))} per piece | Total Buy Rs.{rnd(Number(form.buyPrice) * (Number(form.stock) || 0))}</p>
        )}
        <div className="flex gap-2 mt-3">
          <button type="submit" disabled={updating} className="bg-green-600 text-white px-6 py-2 rounded-lg text-[13px] disabled:opacity-50">{updating ? "Saving..." : editId ? "Update" : "+ Add Product"}</button>
          {editId && <button type="button" onClick={() => { setEditId(null); setForm({ name: "", category: "mobile_accessories", company: "", buyPrice: "", sellPrice: "", stock: "1" }); }} className="bg-gray-100 px-6 py-2 rounded-lg text-[13px]">Cancel</button>}
        </div>
      </form>

      {loading ? <p className="text-center py-10 text-[13px]">Loading...</p> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {products.map((p) => {
              const buy = p.buyPriceAvg || p.buyPrice;
              const profit = p.sellPrice - buy;
              const totalBuy = p.stock * buy;
              const totalSell = p.stock * p.sellPrice;
              return (
                <div key={p._id} className="bg-white border p-3 rounded-xl shadow-sm">
                  <div className="flex justify-between"><p className="font-semibold text-[13px] truncate">{p.name}</p><span className={`text-[10px] px-2 py-0.5 rounded-full ${p.category === "mobile_accessories" ? "bg-blue-100 text-blue-700" : p.category === "manyari" ? "bg-pink-100 text-pink-700" : "bg-gray-100"}`}>{p.category}</span></div>
                  <p className="text-[11px] text-gray-500">{p.company || ""} • Stock: {p.stock}</p>
                  <div className="grid grid-cols-3 gap-1 mt-2 text-[10px]">
                    <div className="bg-red-50 p-1.5 rounded text-center"><div className="text-gray-500">Buy</div><div className="font-bold">Rs.{rnd(buy)}</div><div className="border-t mt-1 pt-1">Total {rnd(totalBuy)}</div></div>
                    <div className="bg-blue-50 p-1.5 rounded text-center"><div className="text-gray-500">Sell</div><div className="font-bold">Rs.{rnd(p.sellPrice)}</div><div className="border-t mt-1 pt-1">Total {rnd(totalSell)}</div></div>
                    <div className="bg-green-50 p-1.5 rounded text-center"><div className="text-gray-500">Profit</div><div className="font-bold text-green-700">Rs.{rnd(profit)}</div><div className="border-t mt-1 pt-1">{rnd(totalSell - totalBuy)}</div></div>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    <button onClick={() => handleEdit(p)} className="flex-1 bg-blue-50 text-blue-600 py-1.5 rounded-lg text-[11px]">Edit</button>
                    <button onClick={() => handleDelete(p._id)} disabled={deletingId === p._id} className="flex-1 bg-red-50 text-red-600 py-1.5 rounded-lg text-[11px]">{deletingId === p._id ? "..." : "Del"}</button>
                  </div>
                </div>
              );
            })}
          </div>
          {pagination.hasMore && <button onClick={() => setPage((pr) => pr + 1)} disabled={loadingMore} className="w-full mt-4 py-2.5 bg-white border rounded-xl text-[13px]">{loadingMore ? "Loading..." : `More (${pagination.totalCount - products.length})`}</button>}
        </>
      )}
    </div>
  );
}