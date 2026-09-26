import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

interface SensorReading {
  metric: string;
  value: number;
  unit: string;
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
    const result = await db.collection('DIRT').insertOne(body);
    return NextResponse.json({ message: 'Data received', id: result.insertedId }, { status: 201 });
  } catch (err) {
    console.error('POST /api/data error:', err);
    return NextResponse.json({ error: 'Failed to insert data' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const db = await getDb();
    const data = await db.collection('DIRT').find({}).sort({ _id: -1 }).limit(50).toArray();
    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /api/data error:', err);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}