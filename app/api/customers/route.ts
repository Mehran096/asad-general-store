import dbConnect from "@/lib/mongodb";
import Customer from "@/models/Customer";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CustomerBody = {
  name?: string;
  phone?: string;
  village?: string;
  totalUdhar?: number;
  totalBusiness?: number;
  saleId?: string;
};

function rnd(n: number) { return Math.round(n || 0); }

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();

    const sp = req.nextUrl.searchParams;
    const search = sp.get("search")?.trim() || "";
    const status = sp.get("status") || "pending";
    const userId = new Types.ObjectId(session.user.id);

    // Build query without FilterQuery
    if (search) {
      const regex = { $regex: search, $options: "i" };
      const normRegex = { $regex: search.toLowerCase(), $options: "i" };
      const query = status === "all"
        ? { userId, $or: [{ name: regex }, { normalizedName: normRegex }, { phone: regex }, { village: regex }] }
        : { userId, isPaid: status === "paid", $or: [{ name: regex }, { normalizedName: normRegex }, { phone: regex }, { village: regex }] };
      const customers = await Customer.find(query).sort({ isPaid: 1, lastUdharDate: -1 }).lean();
      const rounded = customers.map((c) => ({
        ...c,
        totalUdhar: rnd(c.totalUdhar),
        totalBusiness: rnd(c.totalBusiness),
        paidAmount: rnd(c.paidAmount),
        billsCount: c.billsCount || c.saleIds?.length || 1,
      }));
      const totalUdharAgg = rounded.filter(c => !c.isPaid).reduce((s,c) => s + c.totalUdhar, 0);
      return NextResponse.json({ customers: rounded, totalUdhar: rnd(totalUdharAgg), totalCustomers: rounded.length });
    }

    if (status === "all") {
      const customers = await Customer.find({ userId }).sort({ isPaid: 1, lastUdharDate: -1 }).lean();
      const rounded = customers.map((c) => ({
        ...c,
        totalUdhar: rnd(c.totalUdhar),
        totalBusiness: rnd(c.totalBusiness),
        paidAmount: rnd(c.paidAmount),
        billsCount: c.billsCount || c.saleIds?.length || 1,
      }));
      const totalUdharAgg = rounded.filter(c => !c.isPaid).reduce((s,c) => s + c.totalUdhar, 0);
      return NextResponse.json({ customers: rounded, totalUdhar: rnd(totalUdharAgg), totalCustomers: rounded.length });
    }

    const customers = await Customer.find({ userId, isPaid: status === "paid" }).sort({ isPaid: 1, lastUdharDate: -1 }).lean();
    const rounded = customers.map((c) => ({
      ...c,
      totalUdhar: rnd(c.totalUdhar),
      totalBusiness: rnd(c.totalBusiness),
      paidAmount: rnd(c.paidAmount),
      billsCount: c.billsCount || c.saleIds?.length || 1,
    }));
    const totalUdharAgg = rounded.filter(c => !c.isPaid).reduce((s,c) => s + c.totalUdhar, 0);
    return NextResponse.json({ customers: rounded, totalUdhar: rnd(totalUdharAgg), totalCustomers: rounded.length });
  } catch (e) {
    console.error("GET /api/customers error:", e);
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const body = (await req.json()) as CustomerBody;

    if (!body.name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const userId = new Types.ObjectId(session.user.id);
    const trimmedName = body.name.trim();
    const normalized = trimmedName.toLowerCase();
    const total = rnd(body.totalUdhar || 0);
    const totalBiz = rnd(body.totalBusiness || body.totalUdhar || 0);
    const saleObjectId = body.saleId && Types.ObjectId.isValid(body.saleId) ? new Types.ObjectId(body.saleId) : undefined;

    const existing = await Customer.findOne({ userId, normalizedName: normalized, isPaid: false });
    if (existing) {
      existing.totalUdhar = rnd(existing.totalUdhar + total);
      existing.totalBusiness = rnd(existing.totalBusiness + totalBiz);
      if (saleObjectId) {
        if (!existing.saleIds) existing.saleIds = [];
        const already = existing.saleIds.some((id: Types.ObjectId) => id.toString() === saleObjectId.toString());
        if (!already) existing.saleIds.push(saleObjectId);
        existing.billsCount = (existing.billsCount || 0) + 1;
      }
      existing.lastUdharDate = new Date();
      if (body.phone?.trim()) existing.phone = body.phone.trim();
      if (body.village?.trim()) existing.village = body.village.trim();
      await existing.save();
      return NextResponse.json(existing, { status: 200 });
    }

    const cust = await Customer.create({
      name: trimmedName,
      normalizedName: normalized,
      phone: body.phone?.trim() || "",
      village: body.village?.trim() || "",
      totalUdhar: total,
      totalBusiness: totalBiz,
      saleIds: saleObjectId ? [saleObjectId] : [],
      billsCount: saleObjectId ? 1 : 0,
      lastUdharDate: new Date(),
      userId,
      isPaid: false,
      paidAmount: 0,
      wusoolHistory: [],
    });
    return NextResponse.json(cust, { status: 201 });
  } catch (e) {
    console.error("POST /api/customers error:", e);
    return NextResponse.json({ error: "Failed to create customer" }, { status: 500 });
  }
}