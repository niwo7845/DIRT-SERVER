import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getActiveCollection, NO_RECORD } from '@/lib/config';
import { getAnnotation } from '@/lib/annotationStore';
import type { Annotation } from '@/lib/annotations';
import { prepareDocuments } from '@/lib/ingest';

// Every sample in a batch is labeled against the same annotation, so read it once
// instead of once per sample. Never blocks the insert.
async function annotationFor(collectionName: string): Promise<Annotation | null> {
  try {
    return await getAnnotation(collectionName);
  } catch (err) {
    console.error('POST /api/data classification lookup failed:', err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const collectionName = await getActiveCollection();

    // Recording is off: acknowledge the batch so the ESP32 is happy, but drop it.
    if (collectionName === NO_RECORD) {
      return NextResponse.json({ message: 'Recording disabled, data discarded' }, { status: 200 });
    }

    const { docs, discarded, recognised } = prepareDocuments(body, await annotationFor(collectionName));
    const collection = (await getDb()).collection(collectionName);

    // Payload we don't recognise: store it as sent rather than drop a reading.
    if (!recognised) {
      await collection.insertOne(body);
      return NextResponse.json({ message: 'Data received', inserted: 1, discarded: 0 }, { status: 201 });
    }

    if (docs.length === 0) {
      const message = discarded === 0 ? 'Empty batch' : 'All metrics missing, data discarded';
      return NextResponse.json({ message, inserted: 0, discarded }, { status: 200 });
    }

    // ordered: false so one rejected sample doesn't abandon the rest of the batch.
    const result = await collection.insertMany(docs, { ordered: false });
    return NextResponse.json(
      { message: 'Data received', inserted: result.insertedCount, discarded },
      { status: 201 }
    );
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
