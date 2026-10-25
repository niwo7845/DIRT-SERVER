// Safe to import from client components (no database code here).

// Stored as the active collection when incoming data should be discarded.
export const NO_RECORD = "__none__";
export const DEFAULT_COLLECTION = "DIRT";

// App bookkeeping collections; never offered as places to view or record data.
export const CONFIG_COLLECTION = "config";
export const REGISTRY_COLLECTION = "collectionRegistry";
export const ANNOTATIONS_COLLECTION = "annotations";
export const RESERVED_NAMES = [
  NO_RECORD,
  CONFIG_COLLECTION,
  REGISTRY_COLLECTION,
  ANNOTATIONS_COLLECTION,
];

// Returns an error message, or null if the name can be used for a new data collection.
export function validateCollectionName(name: string): string | null {
  if (!name) return "Name is required";
  if (name.length > 100) return "Name must be 100 characters or fewer";
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return "Use only letters, numbers, - and _";
  if (RESERVED_NAMES.includes(name)) return `"${name}" is reserved`;
  return null;
}
