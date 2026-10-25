import { AnyBulkWriteOperation, Document } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { ANNOTATIONS_COLLECTION } from "@/lib/recording";
import { Annotation, Range, Stage, sortedRanges, stageIndex } from "@/lib/annotations";

// One document per data collection; _id is the collection name.
interface AnnotationDoc {
  _id: string;
  stages: Stage[];
  ranges: Range[];
  updatedAt: Date;
  appliedAt?: Date;
}

export interface ApplyResult {
  labeled: number; // readings that now carry a classification
  total: number; // readings in the collection
}

export async function getAnnotation(collection: string): Promise<Annotation> {
  const db = await getDb();
  const doc = await db
    .collection<AnnotationDoc>(ANNOTATIONS_COLLECTION)
    .findOne({ _id: collection });

  return {
    stages: doc?.stages ?? [],
    ranges: sortedRanges(doc?.ranges ?? []),
    appliedAt: doc?.appliedAt?.toISOString() ?? null,
  };
}

export async function saveAnnotation(
  collection: string,
  stages: Stage[],
  ranges: Range[]
): Promise<void> {
  const db = await getDb();
  await db.collection<AnnotationDoc>(ANNOTATIONS_COLLECTION).updateOne(
    { _id: collection },
    { $set: { stages, ranges: sortedRanges(ranges), updatedAt: new Date() } },
    { upsert: true }
  );
}

// Writes the labels onto the readings themselves, so training can query them directly:
//   { _id, data: {...}, classification: "ripe", classificationIndex: 1, classifiedAt: ... }
// Previous labels are cleared first, so deleting a range really does unlabel its readings.
export async function applyClassifications(
  collection: string,
  stages: Stage[],
  ranges: Range[]
): Promise<ApplyResult> {
  const db = await getDb();
  const readings = db.collection(collection);

  // Both this and the dashboard's read work off data.ts.
  await readings.createIndex({ "data.ts": 1 });

  const classifiedAt = new Date();
  const operations: AnyBulkWriteOperation<Document>[] = [
    {
      updateMany: {
        filter: {},
        update: { $unset: { classification: "", classificationIndex: "", classifiedAt: "" } },
      },
    },
  ];

  for (const range of sortedRanges(ranges)) {
    const index = stageIndex(stages, range.stageId);
    if (index < 0) continue;

    operations.push({
      updateMany: {
        filter: {
          "data.ts": {
            $gte: range.startTs,
            ...(range.endTs !== null ? { $lt: range.endTs } : {}),
          },
        },
        update: {
          $set: {
            classification: stages[index].name,
            classificationIndex: index,
            classifiedAt,
          },
        },
      },
    });
  }

  // Ordered, so the clear always runs before the labeling.
  await readings.bulkWrite(operations, { ordered: true });

  await db
    .collection<AnnotationDoc>(ANNOTATIONS_COLLECTION)
    .updateOne({ _id: collection }, { $set: { appliedAt: classifiedAt } });

  return {
    labeled: await readings.countDocuments({ classification: { $exists: true } }),
    total: await readings.countDocuments({}),
  };
}
