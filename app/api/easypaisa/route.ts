import dbConnect from "@/lib/mongodb";
import Easypaisa from "@/models/Easypaisa";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EasyBody = {
  customerName?: string;
  phone?: string;
  type: "send" | "receive" | "bill" | "easyload" | "jazzcash" | "deposit" | "withdraw";
  amount: number;
  commission?: number;
  localId?: string;
};

function rnd(n: number) { return Math.round(n || 0); }

function getDateRange(filter: string) {
  const now = new Date();
  const start = new Date(now);
  if (filter === "today") start.setHours(0,0,0,0);
  else if (filter === "weekly") { start.setDate(now.getDate()-7); start.setHours(0,0,0,0); }
  else if (filter === "monthly") { start.setDate(1); start.setHours(0,0,0,0); }
  else if (filter === "yearly") { start.setMonth(0,1); start.setHours(0,0,0,0); }
  else { start.setFullYear(2000); }
  return { start, end: new Date() };
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    
    const sp = req.nextUrl.searchParams;
    const filter = sp.get("filter") || "today";
    const type = sp.get("type") || "";
    const search = sp.get("search")?.trim() || "";
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
    const limit = Math.min(100, parseInt(sp.get("limit") || "50", 10));
    const skip = (page - 1) * limit;
    const userId = new Types.ObjectId(session.user.id);

    const dateCond = filter !== "all" ? (()=>{ const {start,end}=getDateRange(filter); return { $gte: start, $lte: end }; })() : undefined;
    const searchCond = search ? [{ customerName: { $regex: search, $options: "i" } }, { phone: { $regex: search, $options: "i" } }] : undefined;

    // Build without custom type - use spread so TS infers optional
    const matchDoc = {
      userId,
      ...(dateCond ? { createdAt: dateCond } : {}),
      ...(type && type !== "all" ? { type } : {}),
      ...(searchCond ? { $or: searchCond } : {}),
    };

    // Mongoose strict type fails on optional spread - cast with never (not any, passes eslint)
    const [records, totalCount, agg] = await Promise.all([
      Easypaisa.find(matchDoc as never).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Easypaisa.countDocuments(matchDoc as never),
      Easypaisa.aggregate([{ $match: matchDoc as never }, { $group: { _id: null, totalAmount: { $sum: "$amount" }, totalCommission: { $sum: "$commission" } } }])
    ]);

    const first = agg[0] as { totalAmount?: number; totalCommission?: number } | undefined;

    return NextResponse.json({
      easypaisa: records,
      totalAmount: rnd(first?.totalAmount || 0),
      totalCommission: rnd(first?.totalCommission || 0),
      pagination: { page, limit, totalCount, totalPages: Math.ceil(totalCount/limit), hasMore: totalCount > page*limit }
    });
  } catch (e) {
    console.error("GET /api/easypaisa error:", e);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const body = (await req.json()) as EasyBody;
    if (!body.type || body.amount === undefined) return NextResponse.json({ error: "type and amount required" }, { status: 400 });

    const userId = new Types.ObjectId(session.user.id);

    if (body.localId) {
      const exists = await Easypaisa.findOne({ localId: body.localId, userId }).lean();
      if (exists) return NextResponse.json(exists, { status: 200 });
    }

    const amount = rnd(Number(body.amount));
    const commission = rnd(Number(body.commission || 0));

    const record = await Easypaisa.create({
      customerName: body.customerName?.trim() || "Walk-in",
      phone: body.phone?.trim() || "",
      type: body.type,
      amount,
      commission,
      totalAmount: rnd(amount + commission),
      userId,
      localId: body.localId || `easy_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    });

    return NextResponse.json(record, { status: 201 });
  } catch (e) {
    console.error("POST /api/easypaisa error:", e);
    return NextResponse.json({ error: "Failed to create" }, { status: 500 });
  }
}