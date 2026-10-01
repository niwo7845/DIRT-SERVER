import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

interface ConfigDoc {
  _id: string;
  value: string;
}

export async function GET() {
  const db = await getDb();
  const config = await db
    .collection<ConfigDoc>("config")
    .findOne({ _id: "activeCollection" });
  return NextResponse.json({ activeCollection: config?.value || "DIRT" });
}

export async function POST(request: NextRequest) {
  try {
    const { collection } = await request.json();

    if (!collection || typeof collection !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'collection' field" }, { status: 400 });
    }

    const db = await getDb();
    await db.collection<ConfigDoc>("config").updateOne(
      { _id: "activeCollection" },
      { $set: { value: collection } },
      { upsert: true }
    );

    return NextResponse.json({ message: "Active collection updated", collection });
  } catch (err) {
    console.error("POST /api/config error:", err);
    return NextResponse.json({ error: "Failed to update config" }, { status: 500 });
  }
}