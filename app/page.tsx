import Link from "next/link";
import ActiveCollectionControl from "@/components/ActiveCollectionControl";
import ViewCollectionSelector from "@/components/ViewCollectionSelector";
import LiveDashboard from "@/components/LiveDashboard";
import { getSamples } from "@/lib/readings";
import { getAnnotation } from "@/lib/annotationStore";
import { getActiveCollection, getDataCollections, resolveViewedCollection, NO_RECORD } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const view = typeof params.view === "string" ? params.view : undefined;

  const activeCollection = await getActiveCollection(); // where the ESP32 is writing, or NO_RECORD
  const recording = activeCollection !== NO_RECORD;
  const collections = await getDataCollections();

  const viewedCollection = resolveViewedCollection(view, collections, activeCollection);

  const viewOptions = Array.from(new Set([...collections, viewedCollection]));
  const recordOptions = recording
    ? Array.from(new Set([...collections, activeCollection]))
    : collections;

  const [annotation, samples] = await Promise.all([
    getAnnotation(viewedCollection),
    getSamples(viewedCollection),
  ]);

  return (
    <main>
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">DIRT Spoilage Monitor</h1>
          <p className="dashboard-subtitle">
            Real-time environmental monitoring
          </p>
        </div>

        <div className="header-actions">
          {/* A plain anchor, not a Link: the response is a file download, so the
              router must not try to navigate to it. */}
          <a
            href={`/api/export?view=${encodeURIComponent(viewedCollection)}`}
            className="nav-button"
            download={`${viewedCollection}.csv`}
          >
            Export data ↓
          </a>

          <Link
            href={`/dashboard?view=${encodeURIComponent(viewedCollection)}`}
            className="nav-button"
          >
            Dashboard →
          </Link>

          <Link
            href={`/annotate?view=${encodeURIComponent(viewedCollection)}`}
            className="nav-button"
          >
            Annotate data →
          </Link>
        </div>
      </header>

      <section className="run-card">
        <div>
          <p className="run-card-label">Currently Viewing</p>
          <h2>{viewedCollection}</h2>
          <ViewCollectionSelector
            collections={viewOptions}
            selected={viewedCollection}
          />
        </div>
        <div style={{background: recording ? "#ff696987" : "#94a3b833", borderRadius: "16px", padding:"15px"}}>
          <p className="run-card-label">Push Data To</p>
          <h2>{recording ? activeCollection : "Not recording"}</h2>
          <ActiveCollectionControl
            currentCollection={activeCollection}
            collections={recordOptions}
          />
        </div>
      </section>

      {/* Keyed by collection: switching the view should start fresh, not carry
          another run's samples and polling cursor into this one. */}
      <LiveDashboard key={viewedCollection} collection={viewedCollection} initialSamples={samples} annotation={annotation} />
    </main>
  );
}
