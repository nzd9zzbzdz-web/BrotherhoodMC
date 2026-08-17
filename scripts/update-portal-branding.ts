/**
 * Add the character-stage art path to an org's PORTAL branding doc.
 * Merge-only — touches nothing else, safe to run against live data.
 *
 * Emulator:  npm run update-portal-branding
 * Live:      set FIREBASE_SERVICE_ACCOUNT_B64 (or GOOGLE_APPLICATION_CREDENTIALS)
 *            and NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local, then
 *            npx tsx scripts/update-portal-branding.ts
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { scriptApp } from "./lib/adminApp";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-brotherhood-portal";
const ORG_ID = process.env.ORG_ID ?? "brotherhood";

if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
  console.error("No emulator host and no live credentials configured.");
  process.exit(1);
}

const db = getFirestore(scriptApp(PROJECT_ID));

(async () => {
  const target = process.env.FIRESTORE_EMULATOR_HOST ? "EMULATOR" : "LIVE";
  await db
    .collection("organizations")
    .doc(ORG_ID)
    .collection("branding")
    .doc("portal")
    .set({ characterStagePath: "/brand/character-stage.webp" }, { merge: true });
  console.log(
    `Set characterStagePath on portal branding → ${target} · ${PROJECT_ID} · org ${ORG_ID}`,
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
