import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const rulesUnitTestingPath = path.resolve(
  process.cwd(),
  "node_modules",
  "@firebase",
  "rules-unit-testing",
  "dist",
  "index.cjs.js"
);
const firestoreCjsPath = path.resolve(
  process.cwd(),
  "node_modules",
  "firebase",
  "firestore",
  "dist",
  "index.cjs.js"
);
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require(rulesUnitTestingPath);
const { doc, setDoc } = require(firestoreCjsPath);

const PROJECT_ID = "thecrookedfence-rules-test";
const hasFirestoreEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const runWhenEmulatorAvailable = hasFirestoreEmulator ? it : it.skip;

describe("firestore rules", () => {
  runWhenEmulatorAvailable("blocks unauthenticated order writes", async () => {
    const rules = readFileSync("firestore.rules", "utf8");
    const env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules },
    });

    const unauthDb = env.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(unauthDb, "eggOrders", "test1"), {
        cellphone: "+27 82 111 2222",
      })
    );

    const staffDb = env.authenticatedContext("uid1", { role: "admin" }).firestore();
    await assertSucceeds(
      setDoc(doc(staffDb, "eggOrders", "test2"), {
        cellphone: "+27 82 111 2222",
      })
    );

    await env.cleanup();
  });
});
