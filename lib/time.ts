// Timestamps are unix seconds everywhere in this app. The display zone lives here
// so the charts, the tables and the annotation editor can't drift apart.
// Safe to import from client components (no database code here).

export const TIME_ZONE = "America/Denver";

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

// What a clock on the wall in TIME_ZONE reads at this instant.
function wallClock(ts: number): WallClock {
  return Object.fromEntries(
    partsFormat.formatToParts(new Date(ts * 1000)).map((p) => [p.type, Number(p.value)])
  ) as unknown as WallClock;
}

// Seconds to add to a UTC timestamp to get local wall-clock time (handles DST).
export function zoneOffset(ts: number): number {
  const w = wallClock(ts);
  const wall = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) / 1000;
  return wall - Math.floor(ts);
}

const pad = (n: number) => String(n).padStart(2, "0");

// unix seconds -> "2026-10-19T10:00" for <input type="datetime-local">, in TIME_ZONE.
export function tsToLocalInput(ts: number): string {
  const w = wallClock(ts);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

// "2026-10-19T10:00" read as a TIME_ZONE wall-clock time -> unix seconds.
// Returns NaN if the value isn't a complete date and time.
//
// Twice a year a wall-clock time is not a single instant, and no amount of care
// here can fix that — only a UTC offset in the UI could:
//   - On the autumn fall-back night an hour repeats (01:28 happens twice); we
//     resolve to the first, daylight-time occurrence.
//   - On the spring-forward night an hour does not exist (02:30 never happens);
//     we resolve to a real instant just before the jump.
// Either way the result is a valid instant, so a range boundary typed during one
// of those two hours can be an hour off from what was meant.
export function localInputToTs(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return NaN;

  const [, year, month, day, hour, minute] = match.map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute) / 1000;

  // The offset depends on the instant, which depends on the offset. Starting from the
  // offset at the naive instant and correcting once settles it, including across a
  // DST change (where the hour that doesn't exist resolves to the next real one).
  const ts = wall - zoneOffset(wall);
  return wall - zoneOffset(ts);
}
