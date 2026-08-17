/**
 * Make the character screen's Criminal Record live, without wiping anything.
 *
 * Two merge-only steps, both idempotent — safe to run against production and
 * safe to re-run:
 *   1. Upsert the six criminal-record activity types so members can log them.
 *   2. Fold any hand-authored `member.rapSheet` values into `member.stats`,
 *      which is what the panel now reads. Skips a member if the stat is
 *      already set, so re-running never double-counts or clobbers real logs.
 *
 * Emulator:  npx tsx scripts/migrate-criminal-record.ts
 * Live:      set FIREBASE_SERVICE_ACCOUNT_B64 + NEXT_PUBLIC_FIREBASE_PROJECT_ID, then run.
 * Add --dry to print what would change without writing.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  ACTIVITY_TYPE_SEEDS,
  CRIMINAL_ACTIVITY_TYPE_SEEDS,
} from "../src/lib/constants";
import { rapSheetToStats } from "../src/lib/criminal-record";
import type { Member } from "../src/lib/types";

const PROJECT_ID =
  process.env.PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  "demo-brotherhood-portal";
const ORG_ID = process.env.ORG_ID ?? "brotherhood";
const DRY = process.argv.includes("--dry");

if (
  !process.env.FIRESTORE_EMULATOR_HOST &&
  !process.env.GOOGLE_APPLICATION_CREDENTIALS &&
  !process.env.FIREBASE_SERVICE_ACCOUNT_B64
) {
  console.error("No emulator host and no live credentials configured.");
  process.exit(1);
}

if (!getApps().length) {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  initializeApp(
    b64
      ? {
          credential: cert(JSON.parse(Buffer.from(b64, "base64").toString())),
          projectId: PROJECT_ID,
        }
      : { projectId: PROJECT_ID },
  );
}
const db = getFirestore();
const org = db.collection("organizations").doc(ORG_ID);

async function upsertActivityTypes(): Promise<void> {
  // Append after the existing club types so ordering stays stable.
  const base = ACTIVITY_TYPE_SEEDS.length;
  for (const [i, t] of CRIMINAL_ACTIVITY_TYPE_SEEDS.entries()) {
    const ref = org.collection("activityTypes").doc(t.id);
    const exists = (await ref.get()).exists;
    console.log(`  ${exists ? "update" : "create"} activityType ${t.id} (${t.name})`);
    if (DRY) continue;
    await ref.set(
      {
        name: t.name,
        statKey: t.statKey,
        requiresProof: t.requiresProof,
        allowQuantity: t.allowQuantity,
        defaultQuantity: 1,
        icon: t.icon,
        active: true,
        order: base + i + 1,
      },
      { merge: true },
    );
  }
}

async function migrateRapSheets(): Promise<void> {
  const snap = await org.collection("members").get();

  for (const doc of snap.docs) {
    const member = { id: doc.id, ...(doc.data() as Omit<Member, "id">) };
    const updates = rapSheetToStats(member);
    if (Object.keys(updates).length === 0) continue;
    console.log(`  ${doc.id} (${member.roadName}): ${JSON.stringify(updates)}`);
    if (DRY) continue;
    await doc.ref.set(
      {
        stats: { ...(member.stats ?? {}), ...updates },
      },
      { merge: true },
    );
  }
}

async function main() {
  console.log(
    `${DRY ? "[dry run] " : ""}Criminal record migration → ${PROJECT_ID} · org ${ORG_ID}`,
  );
  console.log("Activity types:");
  await upsertActivityTypes();
  console.log("Rap sheets → stats:");
  await migrateRapSheets();
  console.log(DRY ? "Dry run complete — nothing written." : "Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
