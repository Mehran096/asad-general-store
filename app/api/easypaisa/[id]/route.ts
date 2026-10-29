import dbConnect from "@/lib/mongodb";
import Easypaisa from "@/models/Easypaisa";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function isValidObjectId(id: string): boolean {
  return Types.ObjectId.isValid(id);
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isValidObjectId(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !isValidObjectId(session.user.id)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);
    
    const record = await Easypaisa.findOne({ _id: id, userId }).lean();
    if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404 });

    return NextResponse.json(record);
  } catch (e) {
    console.error("GET /api/easypaisa/[id] error:", e);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !isValidObjectId(session.user.id)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);

    let doc = null;
    if (isValidObjectId(id)) {
      doc = await Easypaisa.findOne({ _id: id, userId }).lean();
    }
    if (!doc) {
      doc = await Easypaisa.findOne({ localId: id, userId }).lean();
    }
    if (!doc) return NextResponse.json({ error: "Record not found" }, { status: 404 });

    await Easypaisa.deleteOne({ _id: doc._id, userId });

    return NextResponse.json({ message: "Easypaisa record deleted", deletedId: id });
  } catch (e) {
    console.error("DELETE /api/easypaisa/[id] error:", e);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}