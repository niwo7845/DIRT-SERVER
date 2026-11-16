import DashboardLead from "@/components/DashboardLead";
import MetricGrid from "@/components/MetricGrid";
import { getSamples } from "@/lib/readings";
import { getAnnotation } from "@/lib/annotationStore";
import { getActiveCollection, getDataCollections, resolveViewedCollection } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const params = await searchParams;
  const view = typeof params.view === "string" ? params.view : undefined;

  const activeCollection = await getActiveCollection();
  const collections = await getDataCollections();
  const viewedCollection = resolveViewedCollection(view, collections, activeCollection);
  const viewOptions = Array.from(new Set([...collections, viewedCollection]));

  const [annotation, samples] = await Promise.all([
    getAnnotation(viewedCollection),
    getSamples(viewedCollection),
  ]);

  return (
    <main className="dashboard-page">
      {/* Keyed by collection: switching the view should start fresh, not carry
          another run's samples and polling cursor into this one. */}
      <MetricGrid
        key={viewedCollection}
        collection={viewedCollection}
        initialSamples={samples}
        annotation={annotation}
        heading={<DashboardLead collections={viewOptions} selected={viewedCollection} />}
      />
    </main>
  );
}
