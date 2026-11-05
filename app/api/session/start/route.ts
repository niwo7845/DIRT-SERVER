import { NextResponse } from "next/server";
import { getActiveCollection, NO_RECORD } from "@/lib/config";
import { startSession } from "@/lib/sessionStore";

// The ESP32 posts this with no body. The server picks the collection, the id and
// the start time, so the device needs to know nothing about any of them.
export async function POST() {
  try {
    const collection = await getActiveCollection();

    // Recording is off: acknowledge, so the device isn't left retrying a request
    // that can never succeed, but there is no run to open a session on.
    if (collection === NO_RECORD) {
      return NextResponse.json(
        { message: "Recording disabled, no session started", sessionId: null },
        { status: 200 }
      );
    }

    const session = await startSession(collection);

    return NextResponse.json(
      {
        message: "Session started",
        sessionId: session._id,
        collection: session.collection,
        startTs: session.startTs,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/session/start error:", err);
    return NextResponse.json({ error: "Failed to start session" }, { status: 500 });
  }
}
