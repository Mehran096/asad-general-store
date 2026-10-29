import dbConnect from "@/lib/mongodb";
import Sale from "@/models/Sale";
import Easypaisa from "@/models/Easypaisa";
import Customer from "@/models/Customer";
import Product from "@/models/Product";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SaleAgg = { count: number; total: number; profit: number; profitPositive: number; profitNegative: number; cash: number; credit: number; };
type EasyAgg = { totalAmount: number; totalCommission: number; count: number; };
type KhataAgg = { totalUdhar: number; count: number; };
type StockAgg = { stockValue: number; stockValueSell: number; lowCount: number; lowValue: number; lowValueSell: number; };

type SaleMatch = { userId: Types.ObjectId; createdAt?: { $gte: Date; $lt: Date }; };
type EasyMatch = { userId: Types.ObjectId; createdAt?: { $gte: Date; $lt: Date }; };

type EmptySale = { count: number; total: number; profit: number; profitPositive: number; profitNegative: number; buy: number; cash: number; credit: number; };

function emptySale(): EmptySale { return { count: 0, total: 0, profit: 0, profitPositive: 0, profitNegative: 0, buy: 0, cash: 0, credit: 0 }; }
function emptyEasy(): EasyAgg { return { totalAmount: 0, totalCommission: 0, count: 0 }; }
function emptyStock(): StockAgg { return { stockValue: 0, stockValueSell: 0, lowCount: 0, lowValue: 0, lowValueSell: 0 }; }

function fmtSale(arr: SaleAgg[]): EmptySale {
  if (!arr?.[0]) return emptySale();
  const r = arr[0];
  const total = Math.round(r.total || 0);
  const profit = Math.round(r.profit || 0);
  return {
    count: r.count || 0,
    total,
    profit,
    profitPositive: Math.round(r.profitPositive || 0),
    profitNegative: Math.round(Math.abs(r.profitNegative || 0)),
    buy: Math.max(0, total - profit),
    cash: Math.round(r.cash || 0),
    credit: Math.round(r.credit || 0),
  };
}

function fmtEasy(arr: EasyAgg[]): EasyAgg {
  if (!arr?.[0]) return emptyEasy();
  const r = arr[0];
  return { totalAmount: Math.round(r.totalAmount || 0), totalCommission: Math.round(r.totalCommission || 0), count: r.count || 0 };
}

function fmtStock(arr: StockAgg[]): StockAgg {
  if (!arr?.[0]) return emptyStock();
  const r = arr[0];
  return {
    stockValue: Math.round(r.stockValue || 0),
    stockValueSell: Math.round(r.stockValueSell || 0),
    lowCount: r.lowCount || 0,
    lowValue: Math.round(r.lowValue || 0),
    lowValueSell: Math.round(r.lowValueSell || 0),
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
        khata: { totalUdhar: 0, customers: 0, totalWusool: 0, wusoolCustomers: 0 },
        stock: emptyStock(),
        todayRecent: [],
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
            profitPositive: { $sum: { $cond: [{ $gte: ["$profit", 0] }, { $ifNull: ["$profit", 0] }, 0] } },
            profitNegative: { $sum: { $cond: [{ $lt: ["$profit", 0] }, { $ifNull: ["$profit", 0] }, 0] } },
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

    const stockAgg = () =>
      Product.aggregate<StockAgg>([
        { $match: { userId, stock: { $gte: 0 } } },
        {
          $group: {
            _id: null,
            stockValue: { $sum: { $multiply: ["$stock", { $ifNull: ["$buyPriceAvg", { $ifNull: ["$buyPrice", 0] }] }] } },
            stockValueSell: { $sum: { $multiply: ["$stock", { $ifNull: ["$sellPrice", 0] }] } },
            lowCount: { $sum: { $cond: [{ $and: [{ $gt: ["$stock", 0] }, { $lte: ["$stock", 5] }, { $ne: ["$stockMode", "unlimited"] }] }, 1, 0] } },
            lowValue: { $sum: { $cond: [{ $and: [{ $gt: ["$stock", 0] }, { $lte: ["$stock", 5] }, { $ne: ["$stockMode", "unlimited"] }] }, { $multiply: ["$stock", { $ifNull: ["$buyPriceAvg", { $ifNull: ["$buyPrice", 0] }] }] }, 0] } },
            lowValueSell: { $sum: { $cond: [{ $and: [{ $gt: ["$stock", 0] }, { $lte: ["$stock", 5] }, { $ne: ["$stockMode", "unlimited"] }] }, { $multiply: ["$stock", { $ifNull: ["$sellPrice", 0] }] }, 0] } },
          },
        },
      ]);

    const [
      todaySale, monthSale, yearSale, allSale,
      todayEasy, monthEasy, yearEasy, allEasy,
      khataAgg, wusoolAgg, stockData, todayRecent
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
      stockAgg(),
      Sale.find({ userId, createdAt: { $gte: startTodayUTC, $lt: startTomorrowUTC } }).sort({ createdAt: -1 }).limit(8).lean(),
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
      stock: fmtStock(stockData),
      todayRecent,
    });
  } catch (err) {
    console.error("GET /api/reports error:", err);
    return NextResponse.json({
      today: emptySale(), month: emptySale(), year: emptySale(), all: emptySale(),
      todayEasy: emptyEasy(), monthEasy: emptyEasy(), yearEasy: emptyEasy(), allEasy: emptyEasy(),
      khata: { totalUdhar: 0, customers: 0, totalWusool: 0, wusoolCustomers: 0 },
      stock: emptyStock(),
      todayRecent: [],
    });
  }
}