import { getDb } from "@/lib/mongodb";
import { SESSIONS_COLLECTION } from "@/lib/recording";

// One run of the chamber between purges: the unit a training example is cut from.
//
// Everything here is decided by the server. The device just says "starting" and
// "stopping", because an id minted on the ESP32 resets when it reboots and it
// can't know which collection is being recorded to.
//
// startTs/endTs are unix seconds on the server clock, which is the same clock
// domain as the readings' data.ts, so a session's bounds can be compared with
// them directly.
export interface SessionDoc {
  _id: string;
  collection: string;
  status: "open" | "complete";
  startedAt: Date;
  endedAt: Date | null;
  startTs: number;
  endTs: number | null;
  endedBy: "stop" | "superseded" | null;
}

// Sortable by creation and short enough to read in a log.
function newSessionId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Opens a session, closing whatever was already open on the collection first, so a
// device that rebooted mid-run can't leave one open forever. The close is a no-op
// when nothing is open, which keeps this to two writes and no read.
export async function startSession(collection: string): Promise<SessionDoc> {
  const db = await getDb();
  const sessions = db.collection<SessionDoc>(SESSIONS_COLLECTION);
  const now = new Date();
  const ts = Math.floor(now.getTime() / 1000);

  await sessions.updateOne(
    { collection, status: "open" },
    { $set: { status: "complete", endedAt: now, endTs: ts, endedBy: "superseded" } }
  );

  const session: SessionDoc = {
    _id: newSessionId(),
    collection,
    status: "open",
    startedAt: now,
    endedAt: null,
    startTs: ts,
    endTs: null,
    endedBy: null,
  };

  await sessions.insertOne(session);
  return session;
}

// Closes the open session on the collection, in one round trip. Null when there
// wasn't one, so a repeated stop is harmless.
export async function stopSession(collection: string): Promise<SessionDoc | null> {
  const db = await getDb();
  const now = new Date();

  return db.collection<SessionDoc>(SESSIONS_COLLECTION).findOneAndUpdate(
    { collection, status: "open" },
    {
      $set: {
        status: "complete",
        endedAt: now,
        endTs: Math.floor(now.getTime() / 1000),
        endedBy: "stop",
      },
    },
    { returnDocument: "after" }
  );
}
