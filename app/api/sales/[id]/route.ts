import dbConnect from "@/lib/mongodb";
import Product from "@/models/Product";
import Sale from "@/models/Sale";
import Customer from "@/models/Customer";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

type SaleUpdateBody = {
  quantity?: number;
  sellPrice?: number;
  buyPrice?: number;
  buyPriceAvg?: number;
  customerName?: string;
  paymentType?: "cash" | "credit";
};

function isValidObjectId(id: string): boolean {
  return Types.ObjectId.isValid(id);
}

function rnd(n: number): number {
  return Math.round(Number(n) || 0);
}

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidObjectId(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const sale = await Sale.findOne({ _id: id, userId: new Types.ObjectId(session.user.id) }).lean();
    if (!sale) return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    return NextResponse.json(sale);
  } catch {
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidObjectId(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);
    const body = (await req.json()) as SaleUpdateBody;

    const sale = await Sale.findOne({ _id: id, userId });
    if (!sale) return NextResponse.json({ error: "Sale not found" }, { status: 404 });

    const oldQty = rnd(sale.quantity);
    const oldTotal = rnd(sale.total);
    const newQty = body.quantity !== undefined ? rnd(body.quantity) : oldQty;
    const newSellPrice = body.sellPrice !== undefined ? rnd(body.sellPrice) : rnd(sale.sellPrice);
    const buy = rnd(body.buyPriceAvg ?? body.buyPrice ?? sale.buyPriceAvg ?? sale.buyPrice ?? 0);

    if (newQty <= 0) return NextResponse.json({ error: "Quantity must be > 0" }, { status: 400 });

    const product = await Product.findOne({ _id: sale.productId, userId });
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    const diff = rnd(newQty - oldQty);
    if (product.stockMode === "limited" && diff > 0 && product.stock < diff) {
      return NextResponse.json({ error: `Only ${product.stock} pcs left, need ${diff} more` }, { status: 400 });
    }
    if (product.stockMode === "limited" && diff !== 0) {
      product.stock = rnd(product.stock - diff);
      await product.save();
    }

    const newTotal = rnd(newSellPrice * newQty);
    const newProfit = rnd((newSellPrice - buy) * newQty);
    const totalDiff = rnd(newTotal - oldTotal);

    sale.quantity = newQty;
    sale.sellPrice = newSellPrice;
    sale.buyPrice = buy;
    sale.buyPriceAvg = buy;
    sale.total = newTotal;
    sale.profit = newProfit;
    if (body.customerName) sale.customerName = body.customerName.trim();
    if (body.paymentType) {
      sale.paymentType = body.paymentType;
      sale.status = body.paymentType === "credit" ? "pending" : "paid";
    }
    await sale.save();

    if (sale.paymentType === "credit" || sale.status === "pending") {
      if (totalDiff !== 0) {
        await Customer.findOneAndUpdate(
          { userId, saleIds: sale._id, isPaid: false },
          { $inc: { totalUdhar: totalDiff, totalBusiness: totalDiff }, $set: { lastUdharDate: new Date() } }
        );
      }
      if (body.customerName) {
        await Customer.findOneAndUpdate(
          { userId, saleIds: sale._id, isPaid: false },
          { $set: { name: body.customerName.trim(), normalizedName: body.customerName.trim().toLowerCase() } }
        );
      }
    }

    return NextResponse.json(sale);
  } catch {
    return NextResponse.json({ error: "Failed to update sale" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);

    let saleDoc = null;
    if (isValidObjectId(id)) {
      saleDoc = await Sale.findOne({ _id: id, userId });
    }
    if (!saleDoc) {
      saleDoc = await Sale.findOne({ localId: id, userId });
    }
    if (!saleDoc) return NextResponse.json({ error: "Sale not found" }, { status: 404 });

    const product = await Product.findOne({ _id: saleDoc.productId, userId });
    if (product && product.stockMode === "limited") {
      product.stock = rnd(product.stock + saleDoc.quantity);
      await product.save();
    }

    if (saleDoc.paymentType === "credit" || saleDoc.status === "pending") {
      const updated = await Customer.findOneAndUpdate(
        { userId, saleIds: saleDoc._id, isPaid: false },
        { $inc: { totalUdhar: -saleDoc.total, totalBusiness: -saleDoc.total, billsCount: -1 }, $pull: { saleIds: saleDoc._id } },
        { new: true }
      );
      if (updated && (updated.totalUdhar <= 0 || updated.billsCount <= 0)) {
        await Customer.deleteOne({ _id: updated._id });
      }
    }

    await Sale.deleteOne({ _id: saleDoc._id, userId });
    return NextResponse.json({ success: true, message: "Sale deleted, stock restored", restored: saleDoc.quantity });
  } catch {
    return NextResponse.json({ error: "Failed to delete sale" }, { status: 500 });
  }
}