const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const { FieldValue, FieldPath } = admin.firestore;

const PAGE_SIZE = 300;

const parseOccurrenceKeyDate = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isNaN(parsed) ? null : new Date(parsed);
};

const commitBatch = async (mutations = []) => {
  if (mutations.length === 0) return 0;
  let updated = 0;
  for (let i = 0; i < mutations.length; i += 400) {
    const batch = db.batch();
    const chunk = mutations.slice(i, i + 400);
    chunk.forEach((mutation) => mutation(batch));
    await batch.commit();
    updated += chunk.length;
  }
  return updated;
};

const normalizeEventOccurrences = async () => {
  let lastDoc = null;
  let totalUpdated = 0;

  while (true) {
    let query = db
      .collection("operationsEventOccurrences")
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const mutations = [];
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const patch = {};

      const normalizedDeleted = data.isDeleted === true;
      if (data.isDeleted !== normalizedDeleted) {
        patch.isDeleted = normalizedDeleted;
      }

      if (!data.updatedAt) {
        patch.updatedAt = data.createdAt || FieldValue.serverTimestamp();
      }

      if (!data.startAt && data.occurrenceKey) {
        const inferredStart = parseOccurrenceKeyDate(data.occurrenceKey);
        if (inferredStart) {
          patch.startAt = inferredStart;
        }
      }

      if (Object.keys(patch).length > 0) {
        mutations.push((batch) => batch.update(docSnap.ref, patch));
      }
    });

    totalUpdated += await commitBatch(mutations);
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) break;
  }

  return totalUpdated;
};

const normalizeEventTemplatesAndResync = async () => {
  const snapshot = await db.collection("operationsEvents").get();
  if (snapshot.empty) return { normalized: 0, resynced: 0 };

  const normalizeMutations = [];
  const resyncMutations = [];

  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (!data.updatedAt) {
      normalizeMutations.push((batch) =>
        batch.update(docSnap.ref, {
          updatedAt: data.createdAt || FieldValue.serverTimestamp(),
          updatedByUid: data.updatedByUid || "ops_backfill_script",
        })
      );
    }

    // Trigger onWrite sync for each template.
    resyncMutations.push((batch) =>
      batch.update(docSnap.ref, {
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: data.updatedByUid || "ops_backfill_script",
      })
    );
  });

  const normalized = await commitBatch(normalizeMutations);
  const resynced = await commitBatch(resyncMutations);
  return { normalized, resynced };
};

const run = async () => {
  console.log("Starting operations event backfill...");
  const [occurrenceUpdated, templateResult] = await Promise.all([
    normalizeEventOccurrences(),
    normalizeEventTemplatesAndResync(),
  ]);
  console.log("Backfill complete.", {
    occurrenceUpdated,
    templateNormalized: templateResult.normalized,
    templateResynced: templateResult.resynced,
  });
  process.exit(0);
};

run().catch((error) => {
  console.error("Backfill failed.", error);
  process.exit(1);
});
