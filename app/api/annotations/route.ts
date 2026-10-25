import { NextRequest, NextResponse } from "next/server";
import { getDataCollections } from "@/lib/config";
import { Range, Stage, validateAnnotation } from "@/lib/annotations";
import { applyClassifications, getAnnotation, saveAnnotation } from "@/lib/annotationStore";

// This endpoint writes to every reading in a collection, so nothing is trusted:
// the shape is checked here and the rules are checked again by validateAnnotation.
function parseStages(input: unknown): Stage[] | null {
  if (!Array.isArray(input)) return null;

  const stages: Stage[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const { id, name, color } = raw as Record<string, unknown>;

    if (typeof id !== "string" || !id || id.length > 64) return null;
    if (typeof name !== "string") return null;
    if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) return null;

    stages.push({ id, name: name.trim(), color });
  }
  return stages;
}

function parseRanges(input: unknown): Range[] | null {
  if (!Array.isArray(input)) return null;

  const ranges: Range[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const { stageId, startTs, endTs } = raw as Record<string, unknown>;

    if (typeof stageId !== "string" || !stageId) return null;
    if (typeof startTs !== "number" || !Number.isFinite(startTs)) return null;
    if (endTs !== null && (typeof endTs !== "number" || !Number.isFinite(endTs))) return null;

    ranges.push({
      stageId,
      startTs: Math.round(startTs),
      endTs: endTs === null ? null : Math.round(endTs as number),
    });
  }
  return ranges;
}

export async function GET(request: NextRequest) {
  try {
    const collection = request.nextUrl.searchParams.get("collection");
    if (!collection) {
      return NextResponse.json({ error: "Missing 'collection' query parameter" }, { status: 400 });
    }
    if (!(await getDataCollections()).includes(collection)) {
      return NextResponse.json({ error: `Unknown collection "${collection}"` }, { status: 400 });
    }

    return NextResponse.json(await getAnnotation(collection));
  } catch (err) {
    console.error("GET /api/annotations error:", err);
    return NextResponse.json({ error: "Failed to load annotation" }, { status: 500 });
  }
}

// Saves a run's stages and ranges, then writes the labels onto its readings.
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { collection } = body;

    if (!collection || typeof collection !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'collection' field" }, { status: 400 });
    }
    if (!(await getDataCollections()).includes(collection)) {
      return NextResponse.json({ error: `Unknown collection "${collection}"` }, { status: 400 });
    }

    const stages = parseStages(body.stages);
    const ranges = parseRanges(body.ranges);
    if (!stages || !ranges) {
      return NextResponse.json({ error: "Malformed stages or ranges" }, { status: 400 });
    }

    const problem = validateAnnotation(stages, ranges);
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400 });
    }

    await saveAnnotation(collection, stages, ranges);
    const { labeled, total } = await applyClassifications(collection, stages, ranges);

    return NextResponse.json({ message: "Annotation saved", labeled, total });
  } catch (err) {
    console.error("PUT /api/annotations error:", err);
    return NextResponse.json({ error: "Failed to save annotation" }, { status: 500 });
  }
}
