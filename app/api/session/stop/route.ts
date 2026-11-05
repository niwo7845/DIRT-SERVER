import { NextResponse } from "next/server";
import { getActiveCollection } from "@/lib/config";
import { stopSession } from "@/lib/sessionStore";

// The ESP32 posts this with no body. Closes whatever session is open on the
// collection being recorded to; repeating it is harmless.
export async function POST() {
  try {
    const session = await stopSession(await getActiveCollection());

    if (!session) {
      return NextResponse.json({ message: "No open session", sessionId: null }, { status: 200 });
    }

    return NextResponse.json(
      {
        message: "Session stopped",
        sessionId: session._id,
        collection: session.collection,
        startTs: session.startTs,
        endTs: session.endTs,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("POST /api/session/stop error:", err);
    return NextResponse.json({ error: "Failed to stop session" }, { status: 500 });
  }
}
