import Dexie, { type Table } from "dexie";

export type WusoolHistoryEntry = { amount: number; date: string; note?: string };
export type WusoolSyncPayload = { amount: number; note?: string; date: string; customerLocalId?: string };
export type EasyType = "send" | "receive" | "bill" | "easyload" | "jazzcash" | "deposit" | "withdraw";
export type SaleCategory = "mobile_accessories" | "manyari" | "cosmetics" | "other";

export interface OfflineProduct {
  localId: string;
  _id?: string;
  name: string;
  category: SaleCategory;
  company?: string;
  buyPrice: number;
  buyPriceAvg: number;
  sellPrice: number;
  stock: number;
  stockMode: "limited" | "unlimited";
  userId: string;
  synced: number;
  createdAt: string;
  lastSyncedAt?: string;
}

export interface OfflineSale {
  localId: string;
  _id?: string;
  productId: string;
  productName: string;
  category: SaleCategory;
  quantity: number;
  sellPrice: number;
  buyPrice: number;
  buyPriceAvg: number;
  total: number;
  profit: number;
  customerName: string;
  paymentType: "cash" | "credit";
  status: "paid" | "pending";
  userId: string;
  createdAt: string;
  synced: number;
  customerId?: string;
}

export interface OfflineCustomer {
  localId: string;
  _id?: string;
  saleIds: string[];
  name: string;
  normalizedName: string;
  phone?: string;
  village?: string;
  totalUdhar: number;
  totalBusiness: number;
  lastUdharDate?: string;
  lastWusoolDate?: string;
  paidAt?: string;
  synced: number;
  createdAt?: string;
  billsCount: number;
  isPaid?: boolean;
  paidAmount?: number;
  wusoolHistory?: WusoolHistoryEntry[];
  userId?: string;
}

export interface OfflineEasypaisa {
  localId: string;
  _id?: string;
  customerName: string;
  phone?: string;
  type: EasyType;
  amount: number;
  commission: number;
  totalAmount: number;
  userId: string;
  createdAt: string;
  synced: number;
}

export type OfflinePayload = OfflineSale | OfflineProduct | OfflineCustomer | WusoolSyncPayload | OfflineEasypaisa;

export interface SyncQueueItem {
  id?: number;
  type: "sale" | "product" | "customer" | "wusool" | "easypaisa";
  localId: string;
  payload: OfflinePayload;
  createdAt: Date;
  attempts: number;
}

type LegacyProductForMigration = {
  buyPrice?: number;
  buyPriceAvg?: number;
};

function rnd(n: number): number {
  return Math.round(n || 0);
}

export class OfflineDB extends Dexie {
  products!: Table<OfflineProduct, string>;
  sales!: Table<OfflineSale, string>;
  customers!: Table<OfflineCustomer, string>;
  easypaisa!: Table<OfflineEasypaisa, string>;
  syncQueue!: Table<SyncQueueItem, number>;

  constructor() {
    super("AsadStoreOfflineV2");
    
    this.version(3).stores({
      products: "localId, _id, userId, synced, name, category, createdAt",
      sales: "localId, _id, productId, userId, synced, createdAt, customerName, status, category, paymentType",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      easypaisa: "localId, _id, userId, synced, createdAt, type, customerName",
      syncQueue: "++id, type, localId, createdAt",
    }).upgrade((tx) => {
      return tx.table("products").toCollection().modify((p: LegacyProductForMigration) => {
        if (p.buyPrice && !p.buyPriceAvg) p.buyPriceAvg = rnd(p.buyPrice);
        if (p.buyPriceAvg && !p.buyPrice) p.buyPrice = rnd(p.buyPriceAvg);
      });
    });

    this.version(4).stores({
      products: "localId, _id, userId, synced, name, category, createdAt",
      sales: "localId, _id, productId, userId, synced, createdAt, customerName, status, category, paymentType",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      easypaisa: "localId, _id, userId, synced, createdAt, type, customerName",
      syncQueue: "++id, type, localId, createdAt",
    });

    this.version(5).stores({
      products: "localId, _id, userId, synced, name, category, createdAt",
      sales: "localId, _id, productId, userId, synced, createdAt, customerName, status, category, paymentType",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      easypaisa: "localId, _id, userId, synced, createdAt, type, customerName",
      syncQueue: "++id, type, localId, createdAt",
    });

    // V6 — same schema, forces browser to refresh for Easypaisa fix
    this.version(6).stores({
      products: "localId, _id, userId, synced, name, category, createdAt",
      sales: "localId, _id, productId, userId, synced, createdAt, customerName, status, category, paymentType",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      easypaisa: "localId, _id, userId, synced, createdAt, type, customerName",
      syncQueue: "++id, type, localId, createdAt",
    });
  }
}

export const offlineDB = new OfflineDB();
export const db = offlineDB;

export function calcProfit(sellPrice: number, buyPriceAvg: number, qty: number): number {
  return rnd((rnd(sellPrice) - rnd(buyPriceAvg)) * rnd(qty));
}
export function calcTotal(sellPrice: number, qty: number): number {
  return rnd(rnd(sellPrice) * rnd(qty));
}

export async function upsertOfflineCustomer(sale: OfflineSale, village = "", phone = ""): Promise<string | null> {
  const name = (sale.customerName || "").trim();
  if (!name || name.toLowerCase() === "walk-in") return null;
  const normalized = name.toLowerCase();
  const existing = await offlineDB.customers.where("normalizedName").equals(normalized).first();
  if (existing && !existing.isPaid) {
    await offlineDB.customers.update(existing.localId, {
      totalUdhar: rnd(existing.totalUdhar + sale.total),
      totalBusiness: rnd(existing.totalBusiness + sale.total),
      saleIds: [...(existing.saleIds || []), sale.localId],
      billsCount: (existing.billsCount || 1) + 1,
      lastUdharDate: new Date().toISOString(),
      synced: 0,
    });
    return existing.localId;
  } else {
    const localId = `cust_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await offlineDB.customers.add({
      localId,
      saleIds: [sale.localId],
      name,
      normalizedName: normalized,
      phone,
      village,
      totalUdhar: rnd(sale.total),
      totalBusiness: rnd(sale.total),
      lastUdharDate: new Date().toISOString(),
      synced: 0,
      createdAt: new Date().toISOString(),
      billsCount: 1,
      isPaid: false,
      paidAmount: 0,
      wusoolHistory: [],
      userId: sale.userId,
    });
    return localId;
  }
}

export async function addOfflineWusool(customerLocalId: string, amount: number, note = ""): Promise<WusoolHistoryEntry | null> {
  const customer = await offlineDB.customers.get(customerLocalId);
  if (!customer) return null;
  const paid = rnd(amount);
  const newUdhar = rnd(customer.totalUdhar - paid);
  const entry: WusoolHistoryEntry = { amount: paid, date: new Date().toISOString(), note };
  if (newUdhar <= 0) {
    await offlineDB.customers.update(customerLocalId, {
      totalUdhar: 0,
      isPaid: true,
      paidAmount: customer.totalBusiness,
      lastWusoolDate: entry.date,
      wusoolHistory: [...(customer.wusoolHistory || []), entry],
      synced: 0,
    });
  } else {
    await offlineDB.customers.update(customerLocalId, {
      totalUdhar: newUdhar,
      paidAmount: rnd((customer.paidAmount || 0) + paid),
      lastWusoolDate: entry.date,
      wusoolHistory: [...(customer.wusoolHistory || []), entry],
      synced: 0,
    });
  }
  await offlineDB.syncQueue.add({
    type: "wusool",
    localId: customerLocalId,
    payload: { amount: paid, note, date: entry.date, customerLocalId },
    createdAt: new Date(),
    attempts: 0,
  });
  return entry;
}

// Helper for Easypaisa offline save — use this in easypaisa/page.tsx
export async function addOfflineEasypaisa(data: Omit<OfflineEasypaisa, "localId" | "createdAt" | "synced" | "totalAmount"> & { totalAmount?: number }): Promise<string> {
  const localId = `easy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await offlineDB.easypaisa.add({
    localId,
    customerName: data.customerName || "Walk-in",
    phone: data.phone || "",
    type: data.type,
    amount: rnd(data.amount),
    commission: rnd(data.commission),
    totalAmount: rnd((data.totalAmount ?? data.amount + data.commission)),
    userId: data.userId,
    createdAt: new Date().toISOString(),
    synced: 0,
  });
  await offlineDB.syncQueue.add({
    type: "easypaisa",
    localId,
    payload: { ...data, localId, amount: rnd(data.amount), commission: rnd(data.commission) } as OfflinePayload,
    createdAt: new Date(),
    attempts: 0,
  });
  return localId;
}