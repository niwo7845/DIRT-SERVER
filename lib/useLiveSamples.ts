import { useEffect, useRef, useState } from "react";
import { Sample, compressSamples } from "@/lib/metrics";

// How often to ask the server for anything newer than what's already on screen.
// Cheap enough at the handful of viewers this dashboard has that there's no
// reason to make it configurable.
const POLL_MS = 5000;

// The samples a page was rendered with, kept current without a reload: poll for
// whatever's new and merge it in. Callers key their component by collection, so
// switching the viewed collection remounts and there's nothing to reset here.
export function useLiveSamples(collection: string, initialSamples: Sample[]): Sample[] {
  const [samples, setSamples] = useState<Sample[]>(initialSamples);

  // The cursor for the next poll. A ref, not state: it needs to be current
  // inside the interval's closure without retriggering the effect on every tick.
  const lastTsRef = useRef<number>(
    initialSamples.length ? initialSamples[initialSamples.length - 1].ts : 0
  );

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (document.hidden) return; // a backgrounded tab can wait for the next one

      try {
        const res = await fetch(
          `/api/data/live?view=${encodeURIComponent(collection)}&after=${lastTsRef.current}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;

        const { samples: fresh, latestTs } = await res.json();
        if (cancelled || !Array.isArray(fresh) || fresh.length === 0) return;

        setSamples((prev) => compressSamples([...prev, ...fresh]));
        if (typeof latestTs === "number") lastTsRef.current = latestTs;
      } catch {
        // dropped poll: the next tick picks up from the same cursor
      }
    }

    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [collection]);

  return samples;
}
