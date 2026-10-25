import { getDb } from "@/lib/mongodb";
import {
  CONFIG_COLLECTION,
  DEFAULT_COLLECTION,
  NO_RECORD,
  REGISTRY_COLLECTION,
  RESERVED_NAMES,
} from "@/lib/recording";

export { NO_RECORD, DEFAULT_COLLECTION } from "@/lib/recording";

interface ConfigDoc {
  _id: string;
  value: string;
}

// One document per data collection; _id is the collection name.
interface RegistryDoc {
  _id: string;
  createdAt: Date;
}

// Where the ESP32's data is going: a collection name, or NO_RECORD.
export async function getActiveCollection(): Promise<string> {
  const db = await getDb();
  const config = await db
    .collection<ConfigDoc>(CONFIG_COLLECTION)
    .findOne({ _id: "activeCollection" });
  return config?.value || DEFAULT_COLLECTION;
}

export async function setActiveCollection(value: string): Promise<void> {
  const db = await getDb();
  if (value !== NO_RECORD) {
    await registerCollection(value);
  }
  await db.collection<ConfigDoc>(CONFIG_COLLECTION).updateOne(
    { _id: "activeCollection" },
    { $set: { value } },
    { upsert: true }
  );
}

// Adds a name to the registry; a no-op if it is already there.
export async function registerCollection(name: string): Promise<void> {
  const db = await getDb();
  await db.collection<RegistryDoc>(REGISTRY_COLLECTION).updateOne(
    { _id: name },
    { $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
}

// Names of all data collections, oldest first.
export async function getDataCollections(): Promise<string[]> {
  const db = await getDb();
  const registry = db.collection<RegistryDoc>(REGISTRY_COLLECTION);

  // First run: seed the registry from whatever data collections already exist.
  if ((await registry.estimatedDocumentCount()) === 0) {
    const existing = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((col) => col.name)
      .filter((name) => !RESERVED_NAMES.includes(name) && !name.startsWith("system."));
    for (const name of existing) {
      await registerCollection(name);
    }
  }

  const docs = await registry
    .find({ _id: { $nin: RESERVED_NAMES } })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  return docs.map((doc) => doc._id);
}
