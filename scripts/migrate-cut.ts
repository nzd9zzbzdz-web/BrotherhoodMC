/**
 * Backfill the Digital Cut configuration onto an EXISTING org (one already
 * created before M8). Idempotent — safe to run repeatedly.
 *
 * Emulator:
 *   npm run emulators   # in another terminal
 *   ORG_ID=silent-souls npx tsx scripts/migrate-cut.ts
 *
 * Live:
 *   GOOGLE_APPLICATION_CREDENTIALS=<sa.json> \
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID=silent-souls \
 *   ORG_ID=silent-souls \
 *   npx tsx scripts/migrate-cut.ts
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { scriptApp } from "./lib/adminApp";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { writeCutConfig } from "./lib/writeCutConfig";
import { ORG_DISPLAY_NAME } from "./lib/branding";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-brotherhood-portal";
const ORG_ID = process.env.ORG_ID ?? "brotherhood";
const ORG_NAME = process.env.ORG_NAME ?? ORG_DISPLAY_NAME;
const ORG_LOCATION = process.env.ORG_LOCATION ?? "San Andreas";

if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_SERVICE_ACCOUNT_B64 && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("Refusing to migrate: no emulator host and no live credentials configured.");
  process.exit(1);
}

const app = scriptApp(PROJECT_ID);
const db: Firestore = getFirestore(app);

async function main() {
  const target = process.env.FIRESTORE_EMULATOR_HOST ? "EMULATOR" : "LIVE";
  console.log(`Migrating Digital Cut config → ${target} project ${PROJECT_ID}, org ${ORG_ID}`);

  const org = await db.collection("organizations").doc(ORG_ID).get();
  if (!org.exists) {
    console.error(`Org "${ORG_ID}" not found — nothing to migrate.`);
    process.exit(1);
  }

  const result = await writeCutConfig(db, ORG_ID, { orgName: ORG_NAME, location: ORG_LOCATION });
  console.log("Done:");
  console.log(`  vest surfaces:     ${result.vestSurfaces}`);
  console.log(`  rank visuals:      ${result.rankVisuals}`);
  console.log(`  patches backfilled:${result.patchesBackfilled}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  });
