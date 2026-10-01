"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ActiveCollectionControl({
  currentCollection,
  collections,
}: {
  currentCollection: string;
  collections: string[];
}) {
  const router = useRouter();

  const [selected, setSelected] = useState(currentCollection);
  const [newCollection, setNewCollection] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isCreating = selected === "__new__";

  async function handleSave(collection: string) {
    if (!collection.trim()) return;

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection: collection.trim() }),
      });

      if (!res.ok) {
        throw new Error("Failed to update");
      }

      router.refresh();
    } catch {
      setError("Failed to update active collection");
    } finally {
      setSaving(false);
    }
  }

  function handleSelectionChange(
    e: React.ChangeEvent<HTMLSelectElement>
  ) {
    const value = e.target.value;

    setSelected(value);

    if (value !== "__new__") {
      handleSave(value);
    }
  }

  function handleNewCollectionKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (e.key === "Enter") {
      handleSave(newCollection);
    }
  }

  return (
    <div className="activeCollection">

      <div className="activeCollectionControl">
        <select
          className="activeCollectionSelect"
          value={selected}
          onChange={handleSelectionChange}
          disabled={saving}
        >
          {collections.map((collection) => (
            <option key={collection} value={collection}>
              {collection}
            </option>
          ))}

          <option value="__new__">
            DO NOT CLICK - NOT IMPLEMENTED
            {/* + Create new collection... */}
          </option>
        </select>
      </div>

      {isCreating && (
        <div className="activeCollectionNew">
          <input
            className="activeCollectionInput"
            type="text"
            value={newCollection}
            onChange={(e) => setNewCollection(e.target.value)}
            onKeyDown={handleNewCollectionKeyDown}
            placeholder="Enter collection name"
            disabled={saving}
            autoFocus
          />

          <span className="activeCollectionHint">
            Press Enter to create
          </span>
        </div>
      )}

      {saving && (
        <div className="activeCollectionStatus">
          Saving...
        </div>
      )}

      {error && (
        <div className="activeCollectionError">
          {error}
        </div>
      )}
    </div>
  );
}
