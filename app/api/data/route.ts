import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

interface SensorReading {
  metric: string;
  value: number;
  unit: string;
}
interface ConfigDoc {
  _id: string;
  value: string;
}

interface SensorPayload {
  samples: {
    ts: number;
    sensordata: SensorReading[];
  }[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const db = await getDb();
    const collection_entry = await db
    .collection<ConfigDoc>("config")
    .findOne({ _id: "activeCollection" });
    const collectionName = collection_entry?.value || "DIRT";
    console.log(collectionName);

    const result = await db.collection(collectionName).insertOne(body);
    return NextResponse.json({ message: 'Data received', id: result.insertedId }, { status: 201 });
  } catch (err) {
    console.error('POST /api/data error:', err);
    return NextResponse.json({ error: 'Failed to insert data' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const db = await getDb();
    const collection_entry = await db
    .collection<ConfigDoc>("config")
    .findOne({ _id: "activeCollection" });
    const collectionName = collection_entry?.value || "DIRT";
    const data = await db.collection(collectionName).find({}).sort({ _id: -1 }).limit(50).toArray();
    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /api/data error:', err);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}