import { NextRequest, NextResponse } from "next/server";
import { getActiveCollection, getDataCollections, setActiveCollection, NO_RECORD } from "@/lib/config";
import { validateCollectionName } from "@/lib/recording";

export async function GET() {
  return NextResponse.json({ activeCollection: await getActiveCollection() });
}

export async function POST(request: NextRequest) {
  try {
    const { collection } = await request.json();

    if (!collection || typeof collection !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'collection' field" }, { status: 400 });
    }

    // Existing collections and NO_RECORD are always allowed; new names must be valid.
    const known = collection === NO_RECORD || (await getDataCollections()).includes(collection);
    const nameError = known ? null : validateCollectionName(collection);
    if (nameError) {
      return NextResponse.json({ error: nameError }, { status: 400 });
    }

    await setActiveCollection(collection);

    return NextResponse.json({ message: "Active collection updated", collection });
  } catch (err) {
    console.error("POST /api/config error:", err);
    return NextResponse.json({ error: "Failed to update config" }, { status: 500 });
  }
}
