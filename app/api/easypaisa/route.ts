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

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
function rnd(n: number): number { return Math.round(n || 0); }

function getPKTRange(filter: string): { start?: Date; end?: Date } {
  if (filter === "all") return {};
  const now = new Date();
  const nowPKT = new Date(now.getTime() + PKT_OFFSET_MS);
  const y = nowPKT.getUTCFullYear();
  const m = nowPKT.getUTCMonth();
  const d = nowPKT.getUTCDate();
  const startToday = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - PKT_OFFSET_MS);
  const endToday = new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0) - PKT_OFFSET_MS);
  if (filter === "today") return { start: startToday, end: endToday };
  if (filter === "weekly") return { start: new Date(startToday.getTime() - 7 * 24 * 60 * 60 * 1000), end: endToday };
  if (filter === "monthly") return { start: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) - PKT_OFFSET_MS), end: endToday };
  if (filter === "yearly") return { start: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0) - PKT_OFFSET_MS), end: endToday };
  return {};
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

    const userIdObj = new Types.ObjectId(session.user.id);
    const { start, end } = getPKTRange(filter);

    // Use Record<string, unknown> — Mongoose accepts this, no Overload error
    const filterQuery: Record<string, unknown> = { userId: userIdObj };
    if (start && end) filterQuery.createdAt = { $gte: start, $lt: end };
    if (type && type !== "all") filterQuery.type = type;
    if (search) {
      filterQuery.$or = [
        { customerName: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const [records, totalCount, agg] = await Promise.all([
      Easypaisa.find(filterQuery).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Easypaisa.countDocuments(filterQuery),
      Easypaisa.aggregate([
        { $match: filterQuery },
        { $group: { _id: null, totalAmount: { $sum: "$amount" }, totalCommission: { $sum: "$commission" } } },
      ]),
    ]);

    const first = agg[0] as { totalAmount?: number; totalCommission?: number } | undefined;
    return NextResponse.json({
      easypaisa: records,
      transactions: records,
      totalAmount: rnd(first?.totalAmount || 0),
      totalCommission: rnd(first?.totalCommission || 0),
      totalCount,
      pagination: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit), hasMore: totalCount > page * limit },
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
      localId: body.localId || `easy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    });

    return NextResponse.json(record, { status: 201 });
  } catch (e) {
    console.error("POST /api/easypaisa error:", e);
    return NextResponse.json({ error: "Failed to create" }, { status: 500 });
  }
}