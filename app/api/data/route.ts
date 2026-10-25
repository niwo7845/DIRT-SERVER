import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getActiveCollection, NO_RECORD } from '@/lib/config';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const collectionName = await getActiveCollection();

    // Recording is off: acknowledge the reading so the ESP32 is happy, but drop it.
    if (collectionName === NO_RECORD) {
      return NextResponse.json({ message: 'Recording disabled, data discarded' }, { status: 200 });
    }

    const db = await getDb();
    const result = await db.collection(collectionName).insertOne(body);
    return NextResponse.json({ message: 'Data received', id: result.insertedId }, { status: 201 });
  } catch (err) {
    console.error('POST /api/data error:', err);
    return NextResponse.json({ error: 'Failed to insert data' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const collectionName = await getActiveCollection();
    if (collectionName === NO_RECORD) {
      return NextResponse.json({ data: [] });
    }

    const db = await getDb();
    const data = await db.collection(collectionName).find({}).sort({ _id: -1 }).limit(50).toArray();
    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /api/data error:', err);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}
