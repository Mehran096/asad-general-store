import { offlineDB, calcProfit, calcTotal } from "./offline-db";
import type { OfflineSale, OfflineEasypaisa, EasyType, SaleCategory, SyncQueueItem, OfflinePayload } from "./offline-db";

export interface SaleInput {
  productId: string;
  productName: string;
  category: SaleCategory;
  quantity: number;
  buyPrice: number;
  buyPriceAvg: number;
  sellPrice: number;
  userId: string;
  customerName?: string;
  phone?: string;
  village?: string;
  paymentType?: "cash" | "credit";
  localId?: string;
}

export interface EasypaisaInput {
  customerName: string;
  phone?: string;
  type: EasyType;
  amount: number;
  commission: number;
  userId: string;
  localId?: string;
}

function genLocalId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
function rnd(n: number): number {
  return Math.round(n || 0);
}

type SyncableRegistration = ServiceWorkerRegistration & {
  sync?: { register: (tag: string) => Promise<void> };
};

export async function saveSaleOffline(data: SaleInput): Promise<string> {
  const buy = rnd(data.buyPriceAvg || data.buyPrice || 0);
  const sell = rnd(data.sellPrice || 0);
  const qty = rnd(data.quantity || 1);
  const total = calcTotal(sell, qty);
  const profit = calcProfit(sell, buy, qty);
  const isCredit = data.paymentType === "credit";
  const status = isCredit ? "pending" : "paid";
  const nowISO = new Date().toISOString();
  const localId = data.localId || genLocalId("sale");

  const sale: OfflineSale = {
    localId, productId: data.productId, productName: data.productName,
    category: data.category, quantity: qty, sellPrice: sell,
    buyPrice: buy, buyPriceAvg: buy, total, profit,
    customerName: data.customerName || "Walk-in",
    paymentType: data.paymentType || "cash", status, userId: data.userId,
    createdAt: nowISO, synced: 0,
  };

  try {
    await offlineDB.transaction("rw", offlineDB.products, offlineDB.sales, offlineDB.customers, offlineDB.syncQueue, async () => {
      try {
        const product =
          (await offlineDB.products.get(data.productId)) ||
          (await offlineDB.products.where("localId").equals(data.productId).first()) ||
          (await offlineDB.products.where("_id").equals(data.productId).first());
        if (product && product.stockMode === "limited") {
          const newStock = rnd(product.stock - qty);
          await offlineDB.products.update(product.localId, { stock: newStock < 0 ? 0 : newStock, synced: 0 });
        }
      } catch {}
      await offlineDB.sales.put(sale);
      await offlineDB.syncQueue.put({ type: "sale", localId, payload: sale as OfflinePayload, createdAt: new Date(), attempts: 0 } as SyncQueueItem);
      if (isCredit && data.customerName && data.customerName.toLowerCase() !== "walk-in") {
        const normalized = data.customerName.trim().toLowerCase();
        const existing = await offlineDB.customers.where("normalizedName").equals(normalized).first();
        if (existing && !existing.isPaid) {
          await offlineDB.customers.update(existing.localId, {
            totalUdhar: rnd(existing.totalUdhar + total), totalBusiness: rnd(existing.totalBusiness + total),
            saleIds: [...(existing.saleIds || []), localId], billsCount: rnd((existing.billsCount || 0) + 1),
            lastUdharDate: nowISO, synced: 0,
          });
          await offlineDB.sales.update(localId, { customerId: existing.localId });
        } else {
          const custLocalId = genLocalId("cust");
          await offlineDB.customers.add({
            localId: custLocalId, saleIds: [localId], name: data.customerName.trim(),
            normalizedName: normalized, phone: data.phone || "", village: data.village || "",
            totalUdhar: total, totalBusiness: total, lastUdharDate: nowISO, synced: 0,
            createdAt: nowISO, billsCount: 1, isPaid: false, paidAmount: 0, wusoolHistory: [], userId: data.userId,
          });
          await offlineDB.sales.update(localId, { customerId: custLocalId });
        }
      }
    });
  } catch (e) {
    console.warn("saveSaleOffline transaction failed, fallback", e);
    await offlineDB.sales.put(sale);
    await offlineDB.syncQueue.put({ type: "sale", localId, payload: sale as OfflinePayload, createdAt: new Date(), attempts: 0 } as SyncQueueItem);
  }

  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    try {
      const reg = (await navigator.serviceWorker.ready) as SyncableRegistration;
      if (reg.sync) await reg.sync.register("sync-sales");
    } catch {}
  }
  return localId;
}

export async function saveEasypaisaOffline(data: EasypaisaInput): Promise<string> {
  const localId = data.localId || genLocalId("easy");
  const entry: OfflineEasypaisa = {
    localId,
    customerName: data.customerName || "Walk-in",
    phone: data.phone || "",
    type: data.type,
    amount: rnd(data.amount),
    commission: rnd(data.commission),
    totalAmount: rnd(data.amount + data.commission),
    userId: data.userId,
    createdAt: new Date().toISOString(),
    synced: 0,
  };
  await offlineDB.easypaisa.put(entry);
  await offlineDB.syncQueue.put({
    type: "easypaisa",
    localId,
    payload: entry as OfflinePayload,
    createdAt: new Date(),
    attempts: 0,
  } as SyncQueueItem);
  return localId;
}

export async function syncOfflineSales(): Promise<{ synced: number }> {
  const sales = await offlineDB.sales.where("synced").equals(0).toArray();
  let synced = 0;
  for (const s of sales) {
    try {
      const res = await fetch("/api/sales", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: s.productId, productName: s.productName, quantity: s.quantity,
          sellPrice: s.sellPrice, buyPriceAvg: s.buyPriceAvg, buyPrice: s.buyPrice,
          customerName: s.customerName, paymentType: s.paymentType, category: s.category,
          localId: s.localId, userId: s.userId,
        }),
      });
      if (res.ok) {
        await offlineDB.sales.update(s.localId, { synced: 1 });
        await offlineDB.syncQueue.where("localId").equals(s.localId).delete();
        synced++;
      }
    } catch {}
  }
  return { synced };
}

export async function syncAllOffline(): Promise<{ sales: number; easypaisa: number }> {
  if (typeof window === "undefined" || !navigator.onLine) return { sales: 0, easypaisa: 0 };
  const salesResult = await syncOfflineSales();
  const easy = await offlineDB.easypaisa.where("synced").equals(0).toArray();
  let easySynced = 0;
  for (const e of easy) {
    try {
      const res = await fetch("/api/easypaisa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: e.type, amount: e.amount, commission: e.commission,
          customerName: e.customerName, phone: e.phone || "",
          localId: e.localId, userId: e.userId, createdAt: e.createdAt,
        }),
      });
      if (res.ok) {
        await offlineDB.easypaisa.update(e.localId, { synced: 1 });
        await offlineDB.syncQueue.where("localId").equals(e.localId).delete();
        easySynced++;
      }
    } catch {}
  }
  return { sales: salesResult.synced, easypaisa: easySynced };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { void syncAllOffline(); });
}