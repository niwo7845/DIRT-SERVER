"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NO_RECORD, validateCollectionName } from "@/lib/recording";

const CREATE_NEW = "__new__";

export default function ActiveCollectionControl({
  currentCollection,
  collections,
}: {
  currentCollection: string;
  collections: string[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [newCollection, setNewCollection] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [modalError, setModalError] = useState("");

  // Returns an error message, or null on success.
  async function saveActiveCollection(collection: string): Promise<string | null> {
    setSaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body.error ?? "Failed to update active collection";
      }
      return null;
    } catch {
      return "Failed to update active collection";
    } finally {
      setSaving(false);
      router.refresh();
    }
  }

  async function handleSelectionChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;

    if (value === CREATE_NEW) {
      setNewCollection("");
      setModalError("");
      dialogRef.current?.showModal();
      return;
    }

    setError((await saveActiveCollection(value)) ?? "");
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = newCollection.trim();

    const nameError = collections.includes(name)
      ? `"${name}" already exists`
      : validateCollectionName(name);
    if (nameError) {
      setModalError(nameError);
      return;
    }

    const saveError = await saveActiveCollection(name);
    if (saveError) {
      setModalError(saveError);
      return;
    }
    dialogRef.current?.close();
  }

  return (
    <div className="activeCollection">

      <div className="activeCollectionControl">
        <select
          className="activeCollectionSelect"
          value={currentCollection}
          onChange={handleSelectionChange}
          disabled={saving}
        >
          <option value={NO_RECORD}>
            Don&apos;t record (discard data)
          </option>

          {collections.map((collection) => (
            <option key={collection} value={collection}>
              {collection}
            </option>
          ))}

          <option value={CREATE_NEW}>
            + Create new collection...
          </option>
        </select>
      </div>

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

      <dialog ref={dialogRef} className="collectionModal">
        <form onSubmit={handleCreate}>
          <h3 className="collectionModalTitle">New collection</h3>
          <p className="collectionModalText">
            Data from the ESP32 will be recorded here once it is created.
          </p>

          <input
            className="activeCollectionInput collectionModalInput"
            type="text"
            value={newCollection}
            onChange={(e) => {
              setNewCollection(e.target.value);
              setModalError("");
            }}
            placeholder="e.g. banana-run-3"
            disabled={saving}
            autoFocus
          />

          {modalError && (
            <div className="activeCollectionError">
              {modalError}
            </div>
          )}

          <div className="collectionModalActions">
            <button
              type="button"
              className="collectionModalButton"
              onClick={() => dialogRef.current?.close()}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="collectionModalButton collectionModalButtonPrimary"
              disabled={saving || !newCollection.trim()}
            >
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
