// components/ViewCollectionSelector.tsx
"use client";

import { useRouter } from "next/navigation";

export default function ViewCollectionSelector({
  collections,
  selected,
}: {
  collections: string[];
  selected: string;
}) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(`/?view=${encodeURIComponent(e.target.value)}`);
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