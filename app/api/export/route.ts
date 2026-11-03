import { NextRequest, NextResponse } from "next/server";
import { getActiveCollection, getDataCollections, resolveViewedCollection } from "@/lib/config";
import { streamCollectionCsv } from "@/lib/exportCsv";

// Downloads the viewed run as a CSV, one row per stored reading.
//
// ?view= goes through resolveViewedCollection, the same resolver the dashboard
// uses, so this endpoint can only ever read a registered data collection: an
// unknown or reserved name falls back to the active run instead of being queried.
export async function GET(request: NextRequest) {
  try {
    const view = request.nextUrl.searchParams.get("view") ?? undefined;

    const [collections, activeCollection] = await Promise.all([
      getDataCollections(),
      getActiveCollection(),
    ]);
    const collectionName = resolveViewedCollection(view, collections, activeCollection);

    const stream = await streamCollectionCsv(collectionName);

    // Belt and braces: collection names are validated on creation, but this ends
    // up in a header, so anything that could break the quoting is dropped.
    const filename = `${collectionName.replace(/[^A-Za-z0-9_-]/g, "_")}.csv`;

    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("GET /api/export error:", err);
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 });
  }
}
