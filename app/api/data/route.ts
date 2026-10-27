import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getActiveCollection, NO_RECORD } from '@/lib/config';
import { getAnnotation } from '@/lib/annotationStore';
import { stageForTs } from '@/lib/annotations';

// The value the ESP32 sends for a metric it couldn't read this cycle.
const MISSING = -1;

// Strips the metrics the device flagged as missing, so a dead or warming-up
// sensor leaves a gap in the charts instead of a -1 spike in the data.
// Returns null when nothing is left to store.
function withoutMissingMetrics(body: Record<string, unknown>) {
  const payload = body?.data as Record<string, unknown> | undefined;
  const readings = payload?.data;
  if (!Array.isArray(readings)) return body; // shape we don't recognise: store as sent

  const kept = readings.filter((reading) => reading?.value !== MISSING);
  if (kept.length === 0) return null;
  if (kept.length === readings.length) return body;

  return { ...body, data: { ...payload, data: kept } };
}

// Labels a reading as it arrives, so an ongoing final stage keeps labeling new data
// without anyone having to re-apply the annotation. Never blocks the insert.
async function classificationFor(collectionName: string, ts: unknown) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;

  try {
    const { stages, ranges } = await getAnnotation(collectionName);
    const match = stageForTs(ts, stages, ranges);
    if (!match) return null;

    return {
      classification: match.stage.name,
      classificationIndex: match.index,
      classifiedAt: new Date(),
    };
  } catch (err) {
    console.error('POST /api/data classification lookup failed:', err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const collectionName = await getActiveCollection();

    // Recording is off: acknowledge the reading so the ESP32 is happy, but drop it.
    if (collectionName === NO_RECORD) {
      return NextResponse.json({ message: 'Recording disabled, data discarded' }, { status: 200 });
    }

    // Every sensor reported missing: nothing but a timestamp left, so don't store it.
    const doc = withoutMissingMetrics(body);
    if (!doc) {
      return NextResponse.json({ message: 'All metrics missing, data discarded' }, { status: 200 });
    }

    const classification = await classificationFor(collectionName, body?.data?.ts);

    const db = await getDb();
    const result = await db
      .collection(collectionName)
      .insertOne(classification ? { ...doc, ...classification } : doc);
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
