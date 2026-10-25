// Stages, time ranges and the rules that keep them consistent.
// No database code here, so the editor and the API can share one validator
// (same client-safe split as lib/recording.ts).

// One stage of spoilage, e.g. "ripe". The id is stable, so renaming or reordering
// a stage never breaks the ranges that point at it.
export interface Stage {
  id: string;
  name: string;
  color: string; // #rrggbb
}

// "Readings from startTs up to endTs are <stage>". Unix seconds, half-open
// [startTs, endTs) so neighbouring ranges can share a boundary.
export interface Range {
  stageId: string;
  startTs: number;
  endTs: number | null; // null = ongoing: this stage runs to the end of the data
}

// What one run's annotation looks like to the UI.
export interface Annotation {
  stages: Stage[]; // THE ORDER OF THIS ARRAY IS THE ORDER THE STAGES HAPPEN IN
  ranges: Range[];
  appliedAt: string | null; // ISO, last time the labels were written onto the readings
}

export const MAX_STAGES = 12;
export const MAX_STAGE_NAME = 40;

// Offered in the "add stage" box; just suggestions, any name works.
export const STAGE_SUGGESTIONS = ["unripe", "ripe", "overripe", "rotten", "fresh", "spoiled"];

// Assigned in order as stages are added: green through red, then some spares.
export const STAGE_COLORS = [
  "#22c55e",
  "#84cc16",
  "#eab308",
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#a855f7",
  "#0ea5e9",
  "#14b8a6",
  "#64748b",
];

export function newStageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// First colour not already in use, so added stages stay visually distinct.
export function nextStageColor(stages: Stage[]): string {
  const used = new Set(stages.map((s) => s.color.toLowerCase()));
  return (
    STAGE_COLORS.find((color) => !used.has(color)) ?? STAGE_COLORS[stages.length % STAGE_COLORS.length]
  );
}

export function stageIndex(stages: Stage[], stageId: string): number {
  return stages.findIndex((stage) => stage.id === stageId);
}

export function findStage(stages: Stage[], stageId: string): Stage | undefined {
  return stages.find((stage) => stage.id === stageId);
}

// Ranges in the order they happen. Everything downstream assumes this order.
export function sortedRanges(ranges: Range[]): Range[] {
  return [...ranges].sort((a, b) => a.startTs - b.startTs);
}

// Returns an error message, or null if the name can be used. `ignoreId` is the stage
// being renamed, so it doesn't collide with itself.
export function validateStageName(
  name: string,
  stages: Stage[],
  ignoreId?: string
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name is required";
  if (trimmed.length > MAX_STAGE_NAME) return `Name must be ${MAX_STAGE_NAME} characters or fewer`;

  const clash = stages.some(
    (stage) => stage.id !== ignoreId && stage.name.trim().toLowerCase() === trimmed.toLowerCase()
  );
  if (clash) return `"${trimmed}" is already a stage`;

  return null;
}

// Returns a single human-readable problem, or null if the annotation can be saved.
// The editor shows this live; the API calls it again before writing anything.
export function validateAnnotation(stages: Stage[], ranges: Range[]): string | null {
  if (stages.length > MAX_STAGES) return `At most ${MAX_STAGES} stages`;

  for (const [index, stage] of stages.entries()) {
    const nameError = validateStageName(stage.name, stages, stage.id);
    if (nameError) return `Stage ${index + 1}: ${nameError}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(stage.color)) return `Stage ${index + 1}: invalid colour`;
  }

  const byTime = sortedRanges(ranges);
  const nameOf = (range: Range) => findStage(stages, range.stageId)?.name ?? "unknown stage";

  for (const range of byTime) {
    if (!findStage(stages, range.stageId)) {
      return "A range refers to a stage that no longer exists — delete the range or re-add the stage";
    }
    if (!Number.isFinite(range.startTs)) return `"${nameOf(range)}" needs a start time`;
    if (range.endTs !== null && !Number.isFinite(range.endTs)) {
      return `"${nameOf(range)}" needs an end time`;
    }
    if (range.endTs !== null && range.endTs <= range.startTs) {
      return `"${nameOf(range)}" must end after it starts`;
    }
  }

  // Only the last stage can still be running.
  const ongoing = byTime.filter((range) => range.endTs === null);
  if (ongoing.length > 1) return "Only one range can be left ongoing";
  if (ongoing.length === 1 && byTime[byTime.length - 1] !== ongoing[0]) {
    return `"${nameOf(ongoing[0])}" is ongoing, so no other range can come after it`;
  }

  for (let i = 1; i < byTime.length; i++) {
    const previous = byTime[i - 1];
    const current = byTime[i];

    if (previous.endTs === null || current.startTs < previous.endTs) {
      return `"${nameOf(previous)}" and "${nameOf(current)}" overlap in time`;
    }

    // The point of ordered stages: a run moves through them in the listed order,
    // so later readings must belong to a later stage.
    const previousIndex = stageIndex(stages, previous.stageId);
    const currentIndex = stageIndex(stages, current.stageId);

    if (currentIndex === previousIndex) {
      return `"${nameOf(current)}" is used by more than one range — a stage happens once per run`;
    }
    if (currentIndex < previousIndex) {
      return `Stages happen in the order they are listed, so "${nameOf(current)}" (stage ${
        currentIndex + 1
      }) cannot come after "${nameOf(previous)}" (stage ${previousIndex + 1}) in time`;
    }
  }

  return null;
}

export const MINUTE = 60;

// ---------------------------------------------------------------------------
// Boundaries
//
// Stages run back to back: the last unripe reading is immediately followed by a
// ripe one, with no buffer. So what the editor actually manipulates is a list of
// separators, not independent spans. For n stages there are n+1 boundaries:
//   bounds[0]        where the first stage starts (data before it is unclassified)
//   bounds[i]        where stage i-1 ends and stage i begins — one shared position
//   bounds[n]        where the last stage ends (data after it is unclassified)
// Moving one separator changes both stages it touches at once, which makes gaps
// and overlaps impossible to express rather than merely invalid.
// ---------------------------------------------------------------------------

// Keeps separators strictly ascending and at least a minute apart.
function enforceAscending(bounds: number[]): number[] {
  const out = [...bounds];
  for (let i = 1; i < out.length; i++) {
    if (out[i] <= out[i - 1]) out[i] = out[i - 1] + MINUTE;
  }
  return out;
}

// An even split across the run, inset slightly so there is visibly unclassified
// data beyond each outer bar. Only ever a suggestion — never saved on its own.
export function templateBounds(
  stageCount: number,
  dataStart: number,
  dataEnd: number
): number[] {
  if (stageCount <= 0) return [];

  const inset = Math.round((dataEnd - dataStart) * 0.05);
  const from = dataStart + inset;
  const to = Math.max(dataEnd - inset, from + stageCount * MINUTE);
  const step = (to - from) / stageCount;

  return enforceAscending(
    Array.from({ length: stageCount + 1 }, (_, i) => Math.round((from + step * i) / MINUTE) * MINUTE)
  );
}

// Fills in any boundary a stored range didn't pin down, by spreading it evenly
// between the ones that are known. Index 0 and the last index must be set.
function fillGaps(values: (number | null)[]): number[] {
  const out = [...values];

  for (let i = 1; i < out.length; i++) {
    if (out[i] !== null) continue;

    let next = i;
    while (next < out.length && out[next] === null) next++;

    const before = out[i - 1] as number;
    const after = next < out.length ? (out[next] as number) : before + (next - i + 1) * MINUTE;
    const steps = next - i + 1;

    for (let k = i; k < next; k++) {
      out[k] = Math.round(before + ((after - before) * (k - i + 1)) / steps);
    }
    i = next - 1;
  }

  return enforceAscending(out as number[]);
}

export interface BoundsState {
  bounds: number[]; // length stages.length + 1
  openEnd: boolean; // the last stage has no end, so new readings keep joining it
  isTemplate: boolean; // these are a suggestion, not something that was saved
}

// Reads a saved annotation back into separators, or suggests a split when there
// is nothing saved for these stages yet.
export function boundsFromRanges(
  stages: Stage[],
  ranges: Range[],
  dataStart: number,
  dataEnd: number
): BoundsState {
  const count = stages.length;
  if (count === 0) return { bounds: [], openEnd: false, isTemplate: false };

  const byStage = new Map(ranges.map((range) => [range.stageId, range]));
  const stored = stages.map((stage) => byStage.get(stage.id));

  if (!stored.some(Boolean)) {
    return {
      bounds: templateBounds(count, dataStart, dataEnd),
      openEnd: false,
      isTemplate: true,
    };
  }

  const known: (number | null)[] = Array(count + 1).fill(null);
  for (const [i, range] of stored.entries()) {
    if (!range) continue;
    known[i] = range.startTs;
    if (range.endTs !== null) known[i + 1] = range.endTs;
  }

  const openEnd = stored[count - 1]?.endTs === null;
  if (known[0] === null) known[0] = dataStart;
  if (known[count] === null) known[count] = dataEnd;

  return { bounds: fillGaps(known), openEnd, isTemplate: false };
}

// Where separator `index` is actually allowed to land: inside its neighbours, at
// least a minute clear of each. The outer bars are free to leave the data entirely.
// While the last stage is ongoing its trailing bar is unused, so the separator
// behind it has no upper limit.
export function clampBoundary(
  bounds: number[],
  index: number,
  ts: number,
  openEnd: boolean
): number {
  if (index < 0 || index >= bounds.length) return ts;

  const lastUsable = openEnd ? bounds.length - 2 : bounds.length - 1;
  const min = index > 0 ? bounds[index - 1] + MINUTE : -Infinity;
  const max = index < lastUsable ? bounds[index + 1] - MINUTE : Infinity;

  return Math.min(Math.max(ts, min), max);
}

// The contiguous spans the separators describe — one per stage, in order.
export function rangesFromBounds(
  stages: Stage[],
  bounds: number[],
  openEnd: boolean
): Range[] {
  if (stages.length === 0 || bounds.length !== stages.length + 1) return [];

  return stages.map((stage, i) => ({
    stageId: stage.id,
    startTs: bounds[i],
    endTs: openEnd && i === stages.length - 1 ? null : bounds[i + 1],
  }));
}

// The stage a reading at `ts` belongs to, or null if it falls in an unlabeled gap.
export function stageForTs(
  ts: number,
  stages: Stage[],
  ranges: Range[]
): { stage: Stage; index: number } | null {
  for (const range of ranges) {
    if (ts < range.startTs) continue;
    if (range.endTs !== null && ts >= range.endTs) continue;

    const index = stageIndex(stages, range.stageId);
    if (index >= 0) return { stage: stages[index], index };
  }
  return null;
}
