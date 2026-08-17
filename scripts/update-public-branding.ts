/**
 * Flip an org's PUBLIC branding to the dark MC palette + copy.
 *
 * Emulator:  ORG_ID=silent-souls npx tsx scripts/update-public-branding.ts
 * Live:      GOOGLE_APPLICATION_CREDENTIALS=<sa.json> NEXT_PUBLIC_FIREBASE_PROJECT_ID=silent-souls \
 *            ORG_ID=silent-souls npx tsx scripts/update-public-branding.ts
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { scriptApp } from "./lib/adminApp";
import { getFirestore } from "firebase-admin/firestore";
import { publicBranding } from "./lib/branding";

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
    .doc("public")
    .set(publicBranding);
  console.log(`Updated public branding → ${target} · ${PROJECT_ID} · org ${ORG_ID}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
