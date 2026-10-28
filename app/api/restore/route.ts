import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Product from "@/models/Product";
import Sale from "@/models/Sale";
import Easypaisa from "@/models/Easypaisa";
import Customer from "@/models/Customer";
import { Types } from "mongoose";

type BackupBase = {
  _id?: string;
  localId?: string;
  userId?: string;
  name?: string;
};

type BackupProduct = BackupBase & Record<string, unknown>;
type BackupSale = BackupBase & Record<string, unknown> & { __v?: number };
type BackupEasy = BackupBase & Record<string, unknown> & { __v?: number };
type BackupCustomer = BackupBase & {
  normalizedName?: string;
  totalBusiness?: number;
  totalUdhar?: number;
  saleIds?: (string | Types.ObjectId)[];
  billsCount?: number;
  wusoolHistory?: { amount: number }[];
};

type RestorePayload = {
  data?: {
    products?: BackupProduct[];
    sales?: BackupSale[];
    easypaisa?: BackupEasy[];
    customers?: BackupCustomer[];
    batches?: BackupBase[];
    purchases?: BackupBase[];
  };
  products?: BackupProduct[];
  sales?: BackupSale[];
  easypaisa?: BackupEasy[];
  customers?: BackupCustomer[];
};

type RestoredCount = { products: number; sales: number; easypaisa: number; customers: number };

function getUserIdField(item: BackupBase): string | undefined {
  const rec = item as { userId?: string | Types.ObjectId };
  if (!rec.userId) return undefined;
  return rec.userId.toString();
}

function getNameField(item: BackupBase): string | undefined {
  return item.name;
}

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const body = (await req.json()) as RestorePayload;
    const src = (body.data || body) as RestorePayload & { products: BackupProduct[]; sales: BackupSale[]; easypaisa: BackupEasy[]; customers: BackupCustomer[] };

    const products = src.products || [];
    const sales = src.sales || [];
    const easypaisa = src.easypaisa || [];
    const customers = src.customers || [];

    const restored: RestoredCount = { products: 0, sales: 0, easypaisa: 0, customers: 0 };
    const skipped: RestoredCount = { products: 0, sales: 0, easypaisa: 0, customers: 0 };

    // 1. PRODUCTS
    for (const p of products) {
      const userIdVal = getUserIdField(p);
      const nameVal = getNameField(p);
      let exists = null as unknown as { _id: Types.ObjectId } | null;
      try { if (p._id && Types.ObjectId.isValid(p._id)) exists = await Product.findById(p._id).lean(); } catch { /* ignore */ }
      if (!exists && p.localId && userIdVal) exists = await Product.findOne({ localId: p.localId, userId: userIdVal }).lean();
      if (!exists && nameVal && userIdVal) {
        exists = await Product.findOne({ name: nameVal, userId: userIdVal }).lean();
      }
      if (!exists) {
        try { 
          const { _id: _omit, ...rest } = p as Record<string, unknown>;
          void _omit;
          await Product.create(rest); 
          restored.products++; 
        } catch { skipped.products++; }
      } else { skipped.products++; }
    }

    // 2. SALES
    for (const s of sales) {
      let exists = null as unknown as { _id: Types.ObjectId } | null;
      try { if (s._id && Types.ObjectId.isValid(s._id)) exists = await Sale.findById(s._id).lean(); } catch { /* ignore */ }
      if (!exists && s.localId) {
        const uid = getUserIdField(s);
        if (uid) exists = await Sale.findOne({ localId: s.localId, userId: uid }).lean();
      }
      if (!exists) {
        try {
          const rest = { ...(s as Record<string, unknown>) };
          delete rest._id;
          delete (rest as { __v?: number }).__v;
          await Sale.create(rest);
          restored.sales++;
        } catch { skipped.sales++; }
      } else { skipped.sales++; }
    }

    // 3. EASYPAISA
    for (const e of easypaisa) {
      let exists = null as unknown as { _id: Types.ObjectId } | null;
      try { if (e._id && Types.ObjectId.isValid(e._id)) exists = await Easypaisa.findById(e._id).lean(); } catch { /* ignore */ }
      if (!exists && e.localId) {
        const uid = getUserIdField(e);
        if (uid) exists = await Easypaisa.findOne({ localId: e.localId, userId: uid }).lean();
      }
      if (!exists) {
        try {
          const rest = { ...(e as Record<string, unknown>) };
          delete rest._id;
          delete (rest as { __v?: number }).__v;
          await Easypaisa.create(rest);
          restored.easypaisa++;
        } catch { skipped.easypaisa++; }
      } else { skipped.easypaisa++; }
    }

    // 4. CUSTOMERS - Asad Khata fix
    for (const c of customers) {
      const rec = c as BackupCustomer & { userId?: string };
      const norm = (rec.normalizedName || rec.name || "").trim().toLowerCase();
      if (!norm || !rec.userId) { skipped.customers++; continue; }

      const srcHistory = rec.wusoolHistory || [];
      const totalWusool = srcHistory.reduce((sum: number, h: { amount?: number }) => sum + (Number(h.amount) || 0), 0);
      const totalBusiness = Number(rec.totalBusiness) || Number(rec.totalUdhar) || 0;
      const remaining = Math.max(0, totalBusiness - totalWusool);

      const existing = await Customer.findOne({ userId: rec.userId, normalizedName: norm, isPaid: false });

      if (existing) {
        existing.totalBusiness = totalBusiness;
        existing.totalUdhar = remaining;
        existing.paidAmount = totalWusool;
        existing.wusoolHistory = srcHistory as unknown as typeof existing.wusoolHistory;
        if (rec.saleIds?.length) {
          const existingIds = (existing.saleIds || []).map((id: Types.ObjectId | string) => id.toString());
          const newIds = rec.saleIds.map((id) => id.toString());
          const merged = new Set([...existingIds, ...newIds]);
          existing.saleIds = Array.from(merged).map((id) => new Types.ObjectId(id)) as typeof existing.saleIds;
        }
        existing.billsCount = existing.saleIds?.length || rec.billsCount || 0;
        await existing.save();
        restored.customers++;
      } else {
        try {
          let byId: { _id: Types.ObjectId } | null = null;
          try { if (rec._id && Types.ObjectId.isValid(rec._id)) byId = await Customer.findById(rec._id).lean() as { _id: Types.ObjectId } | null; } catch { /* ignore */ }
          if (!byId) {
            const { _id: _omit, ...rest } = rec as unknown as Record<string, unknown>;
            void _omit;
            await Customer.create({
              ...(rest as object),
              normalizedName: norm,
              totalBusiness,
              totalUdhar: remaining,
              paidAmount: totalWusool,
              wusoolHistory: srcHistory,
              isPaid: remaining <= 0.01,
            });
            restored.customers++;
          } else { skipped.customers++; }
        } catch { skipped.customers++; }
      }
    }

    return NextResponse.json({ success: true, restored, skipped, message: "Asad backup restored" });
  } catch (e) {
    console.error("Restore error:", e);
    const msg = e instanceof Error ? e.message : "Restore failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}