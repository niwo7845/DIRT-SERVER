import { NextRequest, NextResponse } from "next/server";
import { getActiveCollection, getDataCollections, resolveViewedCollection } from "@/lib/config";
import { getSamplesSince } from "@/lib/readings";

// Polled by the dashboard every few seconds for whatever landed after the last
// sample it already has.
//
// ?view= is resolved the same way the page and the export route do, so this can
// only ever read a registered data collection, never an arbitrary string.
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const view = params.get("view") ?? undefined;
    const afterParam = params.get("after");
    // Number(null) is 0, not NaN, so a missing param has to be checked for
    // before the conversion, not caught by it.
    const after = afterParam === null ? NaN : Number(afterParam);

    if (!Number.isFinite(after)) {
      return NextResponse.json({ error: "Missing or invalid 'after' parameter" }, { status: 400 });
    }

    const [collections, activeCollection] = await Promise.all([
      getDataCollections(),
      getActiveCollection(),
    ]);
    const collection = resolveViewedCollection(view, collections, activeCollection);

    const samples = await getSamplesSince(collection, after);
    const latestTs = samples.length ? samples[samples.length - 1].ts : null;

    return NextResponse.json(
      { collection, samples, latestTs },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("GET /api/data/live error:", err);
    return NextResponse.json({ error: "Failed to fetch live data" }, { status: 500 });
  }
}
