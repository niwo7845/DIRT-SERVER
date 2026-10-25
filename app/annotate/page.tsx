import Link from "next/link";
import AnnotationWorkspace from "@/components/AnnotationWorkspace";
import { getAnnotation } from "@/lib/annotationStore";
import { getActiveCollection, getDataCollections, resolveViewedCollection } from "@/lib/config";
import { getSamples } from "@/lib/readings";

export const dynamic = "force-dynamic";

export default async function AnnotatePage({ searchParams }: PageProps<"/annotate">) {
  const params = await searchParams;
  const view = typeof params.view === "string" ? params.view : undefined;

  const activeCollection = await getActiveCollection();
  const collections = await getDataCollections();
  const viewedCollection = resolveViewedCollection(view, collections, activeCollection);
  const viewOptions = Array.from(new Set([...collections, viewedCollection]));

  const [samples, annotation] = await Promise.all([
    getSamples(viewedCollection),
    getAnnotation(viewedCollection),
  ]);

  return (
    <main>
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Annotate Data</h1>
          <p className="dashboard-subtitle">
            Label stretches of a run with the stage the food was in
          </p>
        </div>

        <Link href="/" className="nav-button">
          ← Dashboard
        </Link>
      </header>

      {/* Keyed by run so switching collections starts from that run's own stages
          instead of keeping the previous run's edits in local state. */}
      <AnnotationWorkspace
        key={viewedCollection}
        collection={viewedCollection}
        collections={viewOptions}
        samples={samples}
        initial={annotation}
      />
    </main>
  );
}
