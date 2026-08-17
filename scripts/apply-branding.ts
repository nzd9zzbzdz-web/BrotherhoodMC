/**
 * Non-destructive rebrand: merge the Ravens of Death org name + portal/public
 * branding docs into an existing org WITHOUT wiping members, activities, cut,
 * or any other data (unlike `npm run seed`, which recursiveDeletes first).
 *
 * Use this to apply a name/theme change to a live emulator (or production) that
 * already has real data in it.
 *
 * Emulator:  npx tsx scripts/apply-branding.ts   (FIRESTORE_EMULATOR_HOST in .env.local)
 * Live:      set FIREBASE_SERVICE_ACCOUNT_B64 + NEXT_PUBLIC_FIREBASE_PROJECT_ID, then run.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { scriptApp } from "./lib/adminApp";
import { getFirestore } from "firebase-admin/firestore";
import {
  ORG_LEGAL_NAME,
  ORG_PUBLIC_NAME,
  portalBranding,
  publicBranding,
} from "./lib/branding";

const PROJECT_ID =
  process.env.PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-brotherhood-portal";
const ORG_ID = process.env.ORG_ID ?? "brotherhood";

if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
  console.error("No emulator host and no live credentials configured.");
  process.exit(1);
}

const db = getFirestore(scriptApp(PROJECT_ID));

(async () => {
  const target = process.env.FIRESTORE_EMULATOR_HOST ? "EMULATOR" : "LIVE";
  const org = db.collection("organizations").doc(ORG_ID);
  await org.set(
    { name: ORG_LEGAL_NAME, publicName: ORG_PUBLIC_NAME },
    { merge: true },
  );
  await org.collection("branding").doc("portal").set(portalBranding, { merge: true });
  await org.collection("branding").doc("public").set(publicBranding, { merge: true });
  console.log(`Applied Ravens of Death branding → ${target} · ${PROJECT_ID} · org ${ORG_ID}`);
  console.log("(name + publicName + portal/public branding merged; no other data touched)");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
