"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MetricChart from "@/components/MetricChart";
import ViewCollectionSelector from "@/components/ViewCollectionSelector";
import { METRICS, Sample, getMetric } from "@/lib/metrics";
import { TIME_ZONE, localInputToTs, tsToLocalInput } from "@/lib/time";
import {
  Annotation,
  MAX_STAGES,
  MAX_STAGE_NAME,
  MINUTE,
  STAGE_SUGGESTIONS,
  Stage,
  boundsFromRanges,
  clampBoundary,
  newStageId,
  nextStageColor,
  rangesFromBounds,
  templateBounds,
  validateAnnotation,
  validateStageName,
} from "@/lib/annotations";

const HOUR = 3600;

function formatApplied(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AnnotationWorkspace({
  collection,
  collections,
  samples,
  initial,
}: {
  collection: string;
  collections: string[];
  samples: Sample[];
  initial: Annotation;
}) {
  const router = useRouter();

  // Captured once, and only used as a fallback for a run with no samples at all.
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const dataStart = samples[0]?.ts ?? now - 7 * 24 * HOUR;
  const dataEnd = samples[samples.length - 1]?.ts ?? now;

  const [stages, setStages] = useState<Stage[]>(initial.stages);

  // Stages are back to back, so what we actually edit is the separators between
  // them. See lib/annotations.ts for the layout of this array.
  const initialBounds = useMemo(
    () => boundsFromRanges(initial.stages, initial.ranges, dataStart, dataEnd),
    [initial.stages, initial.ranges, dataStart, dataEnd]
  );
  const [bounds, setBounds] = useState<number[]>(initialBounds.bounds);
  const [openEnd, setOpenEnd] = useState(initialBounds.openEnd);
  const [isTemplate, setIsTemplate] = useState(initialBounds.isTemplate);

  const [newStageName, setNewStageName] = useState("");
  const [stageError, setStageError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const metrics = useMemo(() => {
    const present = Object.keys(METRICS).filter((key) =>
      samples.some((sample) => Number.isFinite(sample[key]))
    );
    return present.length ? present : Object.keys(METRICS);
  }, [samples]);
  const [metric, setMetric] = useState(metrics[0]);

  const ranges = useMemo(
    () => rangesFromBounds(stages, bounds, openEnd),
    [stages, bounds, openEnd]
  );

  const problem = useMemo(() => validateAnnotation(stages, ranges), [stages, ranges]);

  const baseline = useMemo(
    () => JSON.stringify({ stages: initial.stages, ranges: initial.ranges }),
    [initial.stages, initial.ranges]
  );
  const dirty = useMemo(
    () => JSON.stringify({ stages, ranges }) !== baseline,
    [stages, ranges, baseline]
  );

  // Separators to draw: the trailing bar is hidden while the last stage is ongoing.
  const separators = useMemo(
    () => (openEnd ? bounds.slice(0, -1) : bounds),
    [openEnd, bounds]
  );
  const separatorColors = useMemo(() => stages.map((stage) => stage.color), [stages]);

  // One pass over the samples instead of a filter per stage. Samples arrive
  // oldest-first, so the stage cursor only ever moves forward.
  const counts = useMemo(() => {
    const perStage = new Array<number>(stages.length).fill(0);
    let before = 0;
    let after = 0;

    if (bounds.length === stages.length + 1) {
      const lastEdge = openEnd ? Infinity : bounds[stages.length];
      let stage = 0;

      for (const sample of samples) {
        if (sample.ts < bounds[0]) {
          before++;
        } else if (sample.ts >= lastEdge) {
          after++;
        } else {
          while (stage < stages.length - 1 && sample.ts >= bounds[stage + 1]) stage++;
          perStage[stage]++;
        }
      }
    }

    return { perStage, before, after };
  }, [samples, bounds, stages.length, openEnd]);

  // A new object each render would invalidate the chart's band memo.
  const chartAnnotations = useMemo(() => ({ stages, ranges }), [stages, ranges]);

  // A separator can only move within its neighbours, so stages stay in order and
  // can never overlap — the model has no way to express it.
  const moveBoundary = useCallback((index: number, ts: number) => {
    setBounds((current) => {
      if (index < 0 || index >= current.length) return current;

      const next = [...current];
      next[index] = clampBoundary(current, index, ts, openEnd);
      return next;
    });

    setIsTemplate(false);
    setStatus("");
  }, [openEnd]);

  // The chart clamps a live drag against the same rule, so the separator can't be
  // dragged somewhere it would snap back from on release.
  const clampSeparator = useCallback(
    (index: number, ts: number) => clampBoundary(bounds, index, ts, openEnd),
    [bounds, openEnd]
  );

  function addStage(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = newStageName.trim();

    const nameError = validateStageName(name, stages);
    if (nameError) {
      setStageError(nameError);
      return;
    }
    if (stages.length >= MAX_STAGES) {
      setStageError(`At most ${MAX_STAGES} stages`);
      return;
    }

    const stage: Stage = { id: newStageId(), name, color: nextStageColor(stages) };

    if (stages.length === 0) {
      setBounds(templateBounds(1, dataStart, dataEnd));
    } else {
      // Split the final stage in half to make room for the new one.
      setBounds((current) => {
        const lastIndex = current.length - 1;
        const end = openEnd ? Math.max(dataEnd, current[lastIndex - 1] + HOUR) : current[lastIndex];
        const mid = Math.round((current[lastIndex - 1] + end) / 2 / MINUTE) * MINUTE;

        return [...current.slice(0, lastIndex), mid, current[lastIndex]];
      });
    }

    setStages([...stages, stage]);
    setNewStageName("");
    setStageError("");
  }

  function updateStage(id: string, patch: Partial<Stage>) {
    setStages(stages.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage)));
  }

  function moveStage(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= stages.length) return;

    const next = [...stages];
    [next[index], next[target]] = [next[target], next[index]];
    setStages(next);
    setIsTemplate(false);
  }

  function removeStage(index: number) {
    const stage = stages[index];
    if (
      ranges.length > 0 &&
      !window.confirm(`Delete "${stage.name}"? The stage next to it takes over its time.`)
    ) {
      return;
    }

    // Dropping the stage's end merges its span into the neighbouring stage.
    setBounds((current) => (stages.length <= 1 ? [] : current.filter((_, i) => i !== index + 1)));
    setStages(stages.filter((_, i) => i !== index));
    setIsTemplate(false);
  }

  function toggleOpenEnd(checked: boolean) {
    if (!checked) {
      // Give the trailing bar a sane position again.
      setBounds((current) => {
        const next = [...current];
        const lastIndex = next.length - 1;
        next[lastIndex] = Math.max(dataEnd, next[lastIndex - 1] + HOUR);
        return next;
      });
    }
    setOpenEnd(checked);
    setIsTemplate(false);
  }

  async function save() {
    setSaving(true);
    setError("");
    setStatus("");

    try {
      const res = await fetch("/api/annotations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection, stages, ranges }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to save annotation");
        return;
      }

      setIsTemplate(false);
      setStatus(`Saved — ${body.labeled} of ${body.total} readings labeled`);
    } catch {
      setError("Failed to save annotation");
    } finally {
      setSaving(false);
      router.refresh();
    }
  }

  return (
    <>
      <section className="run-card">
        <div>
          <p className="run-card-label">Annotating</p>
          <h2>{collection}</h2>
          <ViewCollectionSelector
            collections={collections}
            selected={collection}
            basePath="/annotate"
          />
        </div>

        <div className="annot-run-meta">
          <p className="run-card-label">Samples</p>
          <h2>{samples.length.toLocaleString()}</h2>
          <p className="annot-run-note">
            {initial.appliedAt
              ? `Labels applied ${formatApplied(initial.appliedAt)}`
              : "No labels applied yet"}
          </p>
        </div>
      </section>

      <section className="chart-card">
        <div className="chart-header annot-chart-header">
          <div>
            <h2>{getMetric(metric).label}</h2>
            <p>
              Drag the vertical separators to set where one stage becomes the next. The outer
              bars mark where labeling starts and stops — data beyond them stays unclassified.
            </p>
          </div>

          <div className="annot-control">
            <select
              className="annot-select"
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              aria-label="Metric to plot"
            >
              {metrics.map((key) => (
                <option key={key} value={key}>
                  {getMetric(key).label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isTemplate && stages.length > 0 && (
          <div className="annot-drag-banner">
            <span>
              <strong>Suggested split</strong> — an even division of the run, nothing is labeled
              yet. Drag the separators to fit the data, then save to apply.
            </span>
          </div>
        )}

        {stages.length === 0 && (
          <p className="annot-empty">Add some stages below and a suggested split will appear here.</p>
        )}

        {/* Fed from local state, so the bands follow the separators as you drag. */}
        <MetricChart
          data={samples}
          yKey={metric}
          annotations={chartAnnotations}
          separators={separators}
          separatorColors={separatorColors}
          clampSeparator={clampSeparator}
          onMoveSeparator={moveBoundary}
          tentative={isTemplate}
        />

        <div className="annot-savebar">
          <span className="annot-savebar-message">
            {problem ? (
              <span className="annot-error">{problem}</span>
            ) : error ? (
              <span className="annot-error">{error}</span>
            ) : status ? (
              <span className="annot-status">{status}</span>
            ) : isTemplate ? (
              <span className="annot-status">Not applied yet</span>
            ) : dirty ? (
              <span className="annot-status">Unsaved changes</span>
            ) : null}
          </span>

          <button
            type="button"
            className="annot-button annot-button-primary"
            onClick={save}
            disabled={saving || Boolean(problem) || !dirty}
          >
            {saving ? "Saving..." : isTemplate ? "Apply & save" : "Save & apply to data"}
          </button>
        </div>
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Stages</h2>
            <p>
              Listed in the order the food moves through them. Reordering swaps which stage owns
              which stretch of time.
            </p>
          </div>
        </div>

        {stages.length === 0 ? (
          <p className="annot-empty">
            No stages yet. Add the stages this run passes through, earliest first.
          </p>
        ) : (
          <ol className="stage-list">
            {stages.map((stage, index) => (
              <li key={stage.id} className="stage-row">
                <span className="stage-index">{index + 1}</span>

                <input
                  type="color"
                  className="stage-color"
                  value={stage.color}
                  onChange={(e) => updateStage(stage.id, { color: e.target.value })}
                  aria-label={`Colour for stage ${index + 1}`}
                />

                <input
                  type="text"
                  className="annot-input stage-name"
                  value={stage.name}
                  maxLength={MAX_STAGE_NAME}
                  onChange={(e) => updateStage(stage.id, { name: e.target.value })}
                  aria-label={`Stage ${index + 1} name`}
                />

                <div className="stage-actions">
                  <button
                    type="button"
                    className="chart-nav-button"
                    onClick={() => moveStage(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${stage.name} earlier`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="chart-nav-button"
                    onClick={() => moveStage(index, 1)}
                    disabled={index === stages.length - 1}
                    aria-label={`Move ${stage.name} later`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="chart-nav-button"
                    onClick={() => removeStage(index)}
                    aria-label={`Delete ${stage.name}`}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}

        <form className="stage-add" onSubmit={addStage}>
          <input
            type="text"
            className="annot-input"
            list="stage-suggestions"
            value={newStageName}
            maxLength={MAX_STAGE_NAME}
            placeholder="e.g. unripe"
            onChange={(e) => {
              setNewStageName(e.target.value);
              setStageError("");
            }}
            aria-label="New stage name"
          />
          <datalist id="stage-suggestions">
            {STAGE_SUGGESTIONS.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          <button type="submit" className="annot-button" disabled={!newStageName.trim()}>
            + Add stage
          </button>
        </form>

        {stageError && <p className="annot-error">{stageError}</p>}
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Ranges</h2>
            <p>
              The same separators, as exact times ({TIME_ZONE.split("/")[1]} local). Each one is
              shared, so changing when a stage starts also changes when the one before it ends.
            </p>
          </div>
        </div>

        {ranges.length === 0 ? (
          <p className="annot-empty">Nothing to show until there is at least one stage.</p>
        ) : (
          <>
            <ul className="range-list">
              {ranges.map((range, index) => {
                const stage = stages[index];
                const last = index === ranges.length - 1;

                return (
                  <li key={stage.id} className="range-row">
                    <span
                      className="range-swatch"
                      style={{ background: stage.color }}
                      aria-hidden="true"
                    />
                    <span className="range-name">{stage.name}</span>

                    <input
                      type="datetime-local"
                      className="annot-input"
                      value={tsToLocalInput(range.startTs)}
                      onChange={(e) => {
                        const ts = localInputToTs(e.target.value);
                        if (Number.isFinite(ts)) moveBoundary(index, ts);
                      }}
                      aria-label={`When ${stage.name} starts`}
                    />

                    <span className="range-arrow" aria-hidden="true">
                      →
                    </span>

                    <input
                      type="datetime-local"
                      className="annot-input"
                      value={range.endTs === null ? "" : tsToLocalInput(range.endTs)}
                      disabled={range.endTs === null}
                      onChange={(e) => {
                        const ts = localInputToTs(e.target.value);
                        if (Number.isFinite(ts)) moveBoundary(index + 1, ts);
                      }}
                      aria-label={`When ${stage.name} ends`}
                    />

                    {last && (
                      <label className="range-ongoing">
                        <input
                          type="checkbox"
                          checked={openEnd}
                          onChange={(e) => toggleOpenEnd(e.target.checked)}
                        />
                        ongoing
                      </label>
                    )}

                    <span className="range-count">
                      {counts.perStage[index].toLocaleString()} samples
                    </span>
                  </li>
                );
              })}
            </ul>

            <p className="annot-outside">
              Outside the outer bars:{" "}
              <strong>{counts.before.toLocaleString()}</strong> samples before{" "}
              {stages[0]?.name} and <strong>{counts.after.toLocaleString()}</strong>{" "}
              {openEnd ? "after (none — the last stage is ongoing)" : `after ${stages[stages.length - 1]?.name}`}{" "}
              stay unclassified.
            </p>
          </>
        )}
      </section>
    </>
  );
}
