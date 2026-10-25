// components/ViewCollectionSelector.tsx
"use client";

import { useRouter } from "next/navigation";

export default function ViewCollectionSelector({
  collections,
  selected,
  basePath = "/",
}: {
  collections: string[];
  selected: string;
  basePath?: string; // page the ?view= belongs to, e.g. "/annotate"
}) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(`${basePath}?view=${encodeURIComponent(e.target.value)}`);
  }

  return (
    <div className="activeCollection">
      <div className="activeCollectionControl">
        <select
          className="activeCollectionSelect"
          value={selected}
          onChange={handleChange}
        >
          {collections.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
