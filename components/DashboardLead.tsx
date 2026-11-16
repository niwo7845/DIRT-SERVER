"use client";

import Link from "next/link";
import ViewCollectionSelector from "@/components/ViewCollectionSelector";

// The dashboard page's header controls: back to the home page, and which run to
// show. A client component taking plain props, rather than JSX built on the
// server and handed to MetricGrid, which React's dev checks flag for missing keys.
export default function DashboardLead({
  collections,
  selected,
}: {
  collections: string[];
  selected: string;
}) {
  return (
    <div className="grid-card-lead">
      <Link href={`/?view=${encodeURIComponent(selected)}`} className="nav-button">
        ← Home
      </Link>
      <ViewCollectionSelector collections={collections} selected={selected} basePath="/dashboard" />
    </div>
  );
}
