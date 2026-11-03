import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getActiveCollection, NO_RECORD } from '@/lib/config';
import { getAnnotation } from '@/lib/annotationStore';
import { prepareDocuments } from '@/lib/ingest';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const collectionName = await getActiveCollection();

    // Recording is off: acknowledge the batch so the ESP32 is happy, but drop it.
    if (collectionName === NO_RECORD) {
      return NextResponse.json({ message: 'Recording disabled, data discarded' }, { status: 200 });
    }

    // A failed annotation read must not block the insert: the readings still land,
    // just unlabeled, and applying the annotation relabels them.
    const annotation = await getAnnotation(collectionName).catch((err) => {
      console.error('POST /api/data classification lookup failed:', err);
      return null;
    });

    const { docs, discarded } = prepareDocuments(body, annotation);
    if (docs.length === 0) {
      return NextResponse.json({ message: 'Nothing to store', inserted: 0, discarded }, { status: 200 });
    }

    // The whole batch in one round trip. ordered: false so a single rejected
    // document doesn't abandon the rest of it.
    const db = await getDb();
    const { insertedCount } = await db.collection(collectionName).insertMany(docs, { ordered: false });

    return NextResponse.json(
      { message: 'Data received', inserted: insertedCount, discarded },
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
