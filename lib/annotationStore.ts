import { Document, Filter } from "mongodb";
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
//
// One updateMany, as a pipeline update: each reading goes straight from whatever
// label it had to the one it should have, and `$$REMOVE` drops the fields from
// anything now outside the bars. The earlier version cleared every label first and
// then stamped each range, which meant n+1 passes and a window where a failure in
// the middle left the run unlabeled.
//
// The filter then narrows it to only the readings whose label is actually wrong.
// This matters a lot: writes here run at roughly 2,300 documents/second, so visiting
// all of them costs seconds on a long run, while nudging one boundary touches a
// handful of readings and finishes in about 300ms.
//
// Note `classifiedAt` is deliberately not part of the staleness test — including it
// would make every save rewrite the whole collection just to bump a timestamp. So it
// records when a reading's label last *changed*; the annotation's own `appliedAt`
// records when the annotation was last applied.
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

  // One branch per range. A reading with no data.ts matches nothing, because in BSON
  // ordering null sorts below every number, so it ends up unlabeled rather than wrong.
  const cases = sortedRanges(ranges).flatMap((range) => {
    const index = stageIndex(stages, range.stageId);
    if (index < 0) return [];

    return [
      {
        // For the pipeline's $switch, which works on expressions.
        on:
          range.endTs === null
            ? { $gte: ["$data.ts", range.startTs] }
            : {
                $and: [
                  { $gte: ["$data.ts", range.startTs] },
                  { $lt: ["$data.ts", range.endTs] },
                ],
              },
        // The same span as a query, so the data.ts index can be used.
        query:
          range.endTs === null
            ? { "data.ts": { $gte: range.startTs } }
            : { "data.ts": { $gte: range.startTs, $lt: range.endTs } },
        name: stages[index].name,
        index,
      },
    ];
  });

  const pick = (then: (branch: (typeof cases)[number]) => unknown) => ({
    $switch: {
      branches: cases.map((branch) => ({ case: branch.on, then: then(branch) })),
      default: "$$REMOVE",
    },
  });

  // $switch rejects an empty branch list, so with no ranges just strip the fields.
  const update: Document[] =
    cases.length === 0
      ? [{ $unset: ["classification", "classificationIndex", "classifiedAt"] }]
      : [
          {
            $set: {
              classification: pick((branch) => branch.name),
              classificationIndex: pick((branch) => branch.index),
              classifiedAt: pick(() => classifiedAt),
            },
          },
        ];

  // Readings that are mislabeled or unlabeled inside a range, plus any that still
  // carry a label from outside every range. A `$ne` also matches a missing field,
  // so readings that have never been labeled are picked up here too.
  const stale: Filter<Document> =
    cases.length === 0
      ? { classification: { $exists: true } }
      : {
          $or: [
            ...cases.map((branch) => ({
              ...branch.query,
              $or: [
                { classification: { $ne: branch.name } },
                { classificationIndex: { $ne: branch.index } },
              ],
            })),
            {
              classification: { $exists: true },
              $nor: cases.map((branch) => branch.query),
            },
          ],
        };

  await readings.updateMany(stale, update);

  await db
    .collection<AnnotationDoc>(ANNOTATIONS_COLLECTION)
    .updateOne({ _id: collection }, { $set: { appliedAt: classifiedAt } });

  return {
    labeled: await readings.countDocuments({ classification: { $exists: true } }),
    total: await readings.countDocuments({}),
  };
}
