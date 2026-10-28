import dbConnect from "@/lib/mongodb";
import Product from "@/models/Product";
import Sale from "@/models/Sale";
import Customer from "@/models/Customer";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SaleBody = {
  productId: string;
  quantity: number;
  sellPrice?: number;
  buyPrice?: number;
  buyPriceAvg?: number;
  customerName?: string;
  phone?: string;
  village?: string;
  paymentType?: "cash" | "credit";
  category?: "mobile_accessories" | "manyari" | "cosmetics" | "other";
  productName?: string;
  localId?: string;
  userId?: string; // <-- FIX: allow offline userId
};

function rnd(n: number): number {
  return Math.round(Number(n) || 0);
}

function getDateRange(filter: string): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  if (filter === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (filter === "yesterday") {
    start.setDate(now.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    end.setDate(now.getDate() - 1);
    end.setHours(23, 59, 59, 999);
  } else if (filter === "weekly") {
    start.setDate(now.getDate() - 7);
    start.setHours(0, 0, 0, 0);
  } else if (filter === "monthly") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

type SaleQuery = {
  userId: Types.ObjectId;
  createdAt?: { $gte?: Date; $lte?: Date };
  category?: string;
  paymentType?: string;
  $or?: Array<{ productName?: { $regex: string; $options: string }; customerName?: { $regex: string; $options: string } }>;
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ sales: [], total: 0, profit: 0, pagination: { page: 1, totalPages: 1, hasMore: false, totalCount: 0 } });
    }
    await dbConnect();
    const sp = req.nextUrl.searchParams;
    const filter = sp.get("filter") || "today";
    const search = sp.get("search")?.trim() || "";
    const category = sp.get("category") || "";
    const paymentType = sp.get("paymentType") || "";
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;
    const userId = new Types.ObjectId(session.user.id);

    const range = filter !== "all" ? getDateRange(filter) : null;
    const q: SaleQuery = { userId };

    if (range) {
      if (filter === "yesterday") q.createdAt = { $gte: range.start, $lte: range.end };
      else q.createdAt = { $gte: range.start };
    }
    if (search) {
      q.$or = [
        { productName: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
      ];
    }
    if (category && category !== "all") q.category = category;
    if (paymentType) q.paymentType = paymentType;

    const [sales, totalCount, agg] = await Promise.all([
      Sale.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Sale.countDocuments(q),
      Sale.aggregate([{ $match: q }, { $group: { _id: null, total: { $sum: "$total" }, profit: { $sum: "$profit" } } }]),
    ]);

    const firstAgg = agg[0] as { total?: number; profit?: number } | undefined;

    return NextResponse.json({
      sales, // ONE BY ONE — NO GROUPING
      total: rnd(firstAgg?.total || 0),
      profit: rnd(firstAgg?.profit || 0),
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: skip + sales.length < totalCount,
      },
    });
  } catch (e) {
    console.error("GET /api/sales error:", e);
    return NextResponse.json({ sales: [], total: 0, profit: 0, pagination: { page: 1, totalPages: 1, hasMore: false, totalCount: 0 } });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    await dbConnect();
    const body = (await req.json()) as SaleBody;

    if (!body.productId || !body.quantity) {
      return NextResponse.json({ error: "productId, quantity required" }, { status: 400 });
    }

    // FIX: Allow session OR userId from body (offline sync fix)
    let userId: Types.ObjectId;
    if (session?.user?.id && Types.ObjectId.isValid(session.user.id)) {
      userId = new Types.ObjectId(session.user.id);
    } else if (body.userId && Types.ObjectId.isValid(body.userId)) {
      userId = new Types.ObjectId(body.userId);
    } else {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (body.localId) {
      const exists = await Sale.findOne({ localId: body.localId, userId }).lean();
      if (exists) return NextResponse.json(exists, { status: 200 });
    }

    let productName = body.productName || "Product";
    let productCategory = body.category || "other";

    try {
      if (Types.ObjectId.isValid(body.productId)) {
        const product = await Product.findOne({ _id: body.productId, userId });
        if (product) {
          productName = product.name;
          productCategory = product.category as typeof productCategory;
          const qty = rnd(body.quantity);
          if (product.stockMode === "limited" && product.stock < qty) {
            return NextResponse.json({ error: `Only ${product.stock} pcs left for ${product.name}` }, { status: 400 });
          }
          if (product.stockMode === "limited") {
            product.stock = rnd(product.stock - qty);
            await product.save();
          }
        }
      }
    } catch {
      // offline productId — still create sale
    }

    const qty = rnd(body.quantity);
    const sellPrice = rnd(body.sellPrice || 0);
    const buyPrice = rnd(body.buyPriceAvg || body.buyPrice || 0);
    const total = rnd(sellPrice * qty);
    const profit = rnd((sellPrice - buyPrice) * qty);
    const isCredit = body.paymentType === "credit";
    const customerName = body.customerName?.trim() || "Walk-in";

    if (isCredit && customerName.toLowerCase() === "walk-in") {
      return NextResponse.json({ error: "Customer name required for Udhar" }, { status: 400 });
    }

    const productObjectId = Types.ObjectId.isValid(body.productId) ? new Types.ObjectId(body.productId) : new Types.ObjectId();

    const sale = await Sale.create({
      productId: productObjectId,
      productName,
      category: productCategory,
      quantity: qty,
      sellPrice,
      buyPrice,
      buyPriceAvg: buyPrice,
      total,
      profit,
      customerName,
      paymentType: isCredit ? "credit" : "cash",
      status: isCredit ? "pending" : "paid",
      userId,
      localId: body.localId || `sale_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    });

    if (isCredit) {
      const norm = customerName.toLowerCase();
      await Customer.findOneAndUpdate(
        { userId, normalizedName: norm, isPaid: false },
        {
          $setOnInsert: {
            name: customerName,
            normalizedName: norm,
            phone: body.phone || "",
            village: body.village || "",
            userId,
            paidAmount: 0,
            wusoolHistory: [],
          },
          $inc: { totalUdhar: total, totalBusiness: total, billsCount: 1 },
          $set: { lastUdharDate: new Date() },
          $addToSet: { saleIds: sale._id },
        },
        { upsert: true, new: true }
      );
    }

    return NextResponse.json(sale, { status: 201 });
  } catch (e) {
    console.error("POST /api/sales error:", e);
    return NextResponse.json({ error: "Failed to create sale" }, { status: 500 });
  }
}