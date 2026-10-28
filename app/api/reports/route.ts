import dbConnect from "@/lib/mongodb";
import Sale from "@/models/Sale";
import Easypaisa from "@/models/Easypaisa";
import Customer from "@/models/Customer";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SaleAgg = { count: number; total: number; profit: number; cash: number; credit: number; };
type EasyAgg = { totalAmount: number; totalCommission: number; count: number; };
type KhataAgg = { totalUdhar: number; count: number; };

type SaleMatch = { userId: Types.ObjectId; createdAt?: { $gte: Date; $lt: Date }; };
type EasyMatch = { userId: Types.ObjectId; createdAt?: { $gte: Date; $lt: Date }; };

function emptySale() { return { count: 0, total: 0, profit: 0, buy: 0, cash: 0, credit: 0 }; }
function emptyEasy(): EasyAgg { return { totalAmount: 0, totalCommission: 0, count: 0 }; }

function fmtSale(arr: SaleAgg[]) {
  if (!arr?.[0]) return emptySale();
  const r = arr[0];
  const total = Math.round((r.total || 0));
  const profit = Math.round((r.profit || 0));
  const buy = Math.max(0, total - profit);
  return {
    count: r.count || 0,
    total,
    profit,
    buy,
    cash: Math.round((r.cash || 0)),
    credit: Math.round((r.credit || 0)),
  };
}

function fmtEasy(arr: EasyAgg[]) {
  if (!arr?.[0]) return emptyEasy();
  const r = arr[0];
  return {
    totalAmount: Math.round(r.totalAmount || 0),
    totalCommission: Math.round(r.totalCommission || 0),
    count: r.count || 0,
  };
}

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

function getPKTRange() {
  const now = new Date();
  const nowPKT = new Date(now.getTime() + PKT_OFFSET_MS);
  const y = nowPKT.getUTCFullYear();
  const m = nowPKT.getUTCMonth();
  const d = nowPKT.getUTCDate();

  const startTodayUTC = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - PKT_OFFSET_MS);
  const startTomorrowUTC = new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0) - PKT_OFFSET_MS);
  const startMonthUTC = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) - PKT_OFFSET_MS);
  const startYearUTC = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0) - PKT_OFFSET_MS);

  return { startTodayUTC, startTomorrowUTC, startMonthUTC, startYearUTC };
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({
        today: emptySale(), month: emptySale(), year: emptySale(), all: emptySale(),
        todayEasy: emptyEasy(), monthEasy: emptyEasy(), yearEasy: emptyEasy(), allEasy: emptyEasy(),
        khata: { totalUdhar: 0, customers: 0, totalWusool: 0 },
      });
    }

    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);
    const { startTodayUTC, startTomorrowUTC, startMonthUTC, startYearUTC } = getPKTRange();

    const saleAgg = (match: SaleMatch) =>
      Sale.aggregate<SaleAgg>([
        { $match: match },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            total: { $sum: "$total" },
            profit: { $sum: { $ifNull: ["$profit", 0] } },
            cash: { $sum: { $cond: [{ $eq: ["$paymentType", "cash"] }, "$total", 0] } },
            credit: { $sum: { $cond: [{ $eq: ["$paymentType", "credit"] }, "$total", 0] } },
          },
        },
      ]);

    const easyAgg = (match: EasyMatch) =>
      Easypaisa.aggregate<EasyAgg>([
        { $match: match },
        { $group: { _id: null, totalAmount: { $sum: "$amount" }, totalCommission: { $sum: "$commission" }, count: { $sum: 1 } } },
      ]);

    const [
      todaySale, monthSale, yearSale, allSale,
      todayEasy, monthEasy, yearEasy, allEasy,
      khataAgg, wusoolAgg
    ] = await Promise.all([
      saleAgg({ userId, createdAt: { $gte: startTodayUTC, $lt: startTomorrowUTC } }),
      saleAgg({ userId, createdAt: { $gte: startMonthUTC, $lt: startTomorrowUTC } }),
      saleAgg({ userId, createdAt: { $gte: startYearUTC, $lt: startTomorrowUTC } }),
      saleAgg({ userId }),
      easyAgg({ userId, createdAt: { $gte: startTodayUTC, $lt: startTomorrowUTC } }),
      easyAgg({ userId, createdAt: { $gte: startMonthUTC, $lt: startTomorrowUTC } }),
      easyAgg({ userId, createdAt: { $gte: startYearUTC, $lt: startTomorrowUTC } }),
      easyAgg({ userId }),
      Customer.aggregate<KhataAgg>([{ $match: { userId, isPaid: false, totalUdhar: { $gt: 0.5 } } }, { $group: { _id: null, totalUdhar: { $sum: "$totalUdhar" }, count: { $sum: 1 } } }]),
      Customer.aggregate<KhataAgg>([{ $match: { userId, isPaid: true } }, { $group: { _id: null, totalUdhar: { $sum: "$paidAmount" }, count: { $sum: 1 } } }]),
    ]);

    return NextResponse.json({
      today: fmtSale(todaySale),
      month: fmtSale(monthSale),
      year: fmtSale(yearSale),
      all: fmtSale(allSale),
      todayEasy: fmtEasy(todayEasy),
      monthEasy: fmtEasy(monthEasy),
      yearEasy: fmtEasy(yearEasy),
      allEasy: fmtEasy(allEasy),
      khata: {
        totalUdhar: Math.round(khataAgg[0]?.totalUdhar || 0),
        customers: khataAgg[0]?.count || 0,
        totalWusool: Math.round(wusoolAgg[0]?.totalUdhar || 0),
        wusoolCustomers: wusoolAgg[0]?.count || 0,
      },
    });
  } catch (err) {
    console.error("GET /api/reports error:", err);
    return NextResponse.json({
      today: emptySale(), month: emptySale(), year: emptySale(), all: emptySale(),
      todayEasy: emptyEasy(), monthEasy: emptyEasy(), yearEasy: emptyEasy(), allEasy: emptyEasy(),
      khata: { totalUdhar: 0, customers: 0, totalWusool: 0 },
    });
  }
}