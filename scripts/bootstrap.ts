/**
 * Bootstrap a LIVE Firebase project for a new club:
 *   - seeds ONLY the structure (branding, ranks, activity types, patches)
 *   - creates ONE admin account (no demo members, no shared-password accounts)
 *   - prints a one-time "set your password" link for that admin
 *
 * Safe to re-run: structure is upserted, org counters are left alone if the org
 * already exists, and the admin account is reused if it already exists.
 *
 *   FIREBASE_SERVICE_ACCOUNT_B64=<base64 of serviceAccount.json> \
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID=silent-souls \
 *   ORG_ID=<slug> ADMIN_EMAIL=you@example.com \
 *   npx tsx scripts/bootstrap.ts
 *
 * (GOOGLE_APPLICATION_CREDENTIALS=<serviceAccount.json> works too.)
 */
import { config } from "dotenv";
// NOT `.env.local`. In this repo that file is the emulator profile: it sets
// FIRESTORE_EMULATOR_HOST, which this script refuses to run alongside, so
// loading it here would make a correctly-configured live run abort.
config({ path: [".env.bootstrap", ".env"] });

import { randomBytes } from "node:crypto";
import { hasLiveCredentials, scriptApp } from "./lib/adminApp";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { ACTIVITY_TYPE_SEEDS, DEFAULT_RANKS, rankDocId } from "../src/lib/constants";
import { writeCutConfig } from "./lib/writeCutConfig";
import {
  ORG_DISPLAY_NAME,
  ORG_LEGAL_NAME,
  ORG_LOCATION,
  ORG_PUBLIC_NAME,
  portalBranding,
  publicBranding,
} from "./lib/branding";
import type { Branding, Patch, SessionClaims, StatKey, UserDoc } from "../src/lib/types";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-brotherhood-portal";
const ORG_ID = process.env.ORG_ID ?? "brotherhood";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_ROAD_NAME = process.env.ADMIN_ROAD_NAME ?? "Prez";
const ADMIN_DISPLAY_NAME = process.env.ADMIN_DISPLAY_NAME ?? "Club President";

if (!ADMIN_EMAIL) {
  console.error("Refusing to bootstrap: set ADMIN_EMAIL to the founding admin's email.");
  process.exit(1);
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    `Refusing to bootstrap: FIRESTORE_EMULATOR_HOST is ${process.env.FIRESTORE_EMULATOR_HOST}. This script is for LIVE only.\n` +
      "If you did not set it in this shell, it came from an env file. Clear it and run again.",
  );
  process.exit(1);
}
if (!hasLiveCredentials()) {
  console.error("Refusing to bootstrap: no live credentials (FIREBASE_SERVICE_ACCOUNT_B64 or GOOGLE_APPLICATION_CREDENTIALS).");
  process.exit(1);
}

const app = scriptApp(PROJECT_ID);
const auth = getAuth(app);
const db: Firestore = getFirestore(app);

// ── Patches (same definitions as the demo seed) ────────────────────────
type PatchSeed = Omit<Patch, "id"> & { id: string };
const p = (
  id: string, name: string, category: Patch["category"], description: string, tier: number,
  requirement: { statKey: StatKey; threshold: number } | null, surface: "front" | "back", u: number, v: number,
): PatchSeed => ({
  id, name, category, description, tier, requirement,
  manual: requirement === null, active: true,
  defaultPlacement: { surface, u, v, scale: 0.8, rotationDeg: 0 },
});

const PATCHES: PatchSeed[] = [
  p("road-warrior", "Road Warrior", "activity", "Complete 10 club runs.", 1, { statKey: "clubRuns", threshold: 10 }, "front", 0.3, 0.42),
  p("iron-rider", "Iron Rider", "activity", "Complete 50 club runs.", 2, { statKey: "clubRuns", threshold: 50 }, "front", 0.3, 0.52),
  p("faithful", "Faithful", "activity", "Attend 10 church meetings.", 1, { statKey: "churchAttendance", threshold: 10 }, "front", 0.7, 0.42),
  p("dedicated-soul", "Dedicated Soul", "activity", "Attend 25 church meetings.", 2, { statKey: "churchAttendance", threshold: 25 }, "front", 0.7, 0.52),
  p("ghost-rider", "Ghost Rider", "activity", "Participate in 10 operations.", 2, { statKey: "operations", threshold: 10 }, "back", 0.3, 0.62),
  p("guardian", "Guardian", "activity", "Complete 10 security details.", 1, { statKey: "securityDetail", threshold: 10 }, "back", 0.7, 0.62),
  p("night-watchman", "Night Watchman", "activity", "Complete 15 territory patrols.", 1, { statKey: "territoryPatrol", threshold: 15 }, "back", 0.3, 0.72),
  p("territory-defender", "Territory Defender", "activity", "Defend the territory 10 times.", 2, { statKey: "territoryDefense", threshold: 10 }, "back", 0.7, 0.72),
  p("community-pillar", "Community Pillar", "service", "Complete 15 community outreach actions.", 1, { statKey: "communityOutreach", threshold: 15 }, "front", 0.3, 0.62),
  p("giving-soul", "Giving Soul", "service", "Work 10 charity events.", 1, { statKey: "charityEvents", threshold: 10 }, "front", 0.7, 0.62),
  p("mentor", "Mentor", "leadership", "Sponsor 3 prospects into the club.", 2, { statKey: "recruitment", threshold: 3 }, "front", 0.5, 0.3),
  p("shot-caller", "Shot Caller", "leadership", "Complete 5 special assignments.", 2, { statKey: "specialAssignments", threshold: 5 }, "back", 0.5, 0.3),
  p("presidents-citation", "President's Citation", "recognition", "Awarded personally by the President for exceptional service.", 3, null, "front", 0.5, 0.68),
  p("brotherhoods-honor", "Brotherhood's Honor", "recognition", "Awarded by club vote for embodying the spirit of the Ravens.", 3, null, "front", 0.5, 0.78),
  p("war-veteran", "War Veteran", "legendary", "Stood their ground when the club needed them most. Manual award.", 4, null, "back", 0.5, 0.45),
];

async function bootstrap() {
  console.log(`Bootstrapping LIVE project ${PROJECT_ID} (org: ${ORG_ID})`);
  console.log(`Founding admin: ${ADMIN_EMAIL}\n`);

  const org = db.collection("organizations").doc(ORG_ID);
  const orgSnap = await org.get();

  if (!orgSnap.exists) {
    await org.set({
      name: ORG_LEGAL_NAME,
      publicName: ORG_PUBLIC_NAME,
      slug: ORG_ID,
      status: "active",
      features: { gallery: true, cut3d: false },
      memberCount: 1, // the founding admin
      lastMemberNumber: 1,
      foundedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
    });
    console.log("  ✓ created organization");
  } else {
    console.log("  • organization already exists — leaving counters untouched");
  }

  await org.collection("branding").doc("portal").set(portalBranding);
  await org.collection("branding").doc("public").set(publicBranding);
  console.log("  ✓ branding (portal + public)");

  const rankIdByName = new Map<string, string>();
  for (const rank of DEFAULT_RANKS) {
    const id = rankDocId(rank.name);
    rankIdByName.set(rank.name, id);
    await org.collection("ranks").doc(id).set({
      name: rank.name,
      order: rank.order,
      isOfficer: rank.isOfficer,
      tab: { text: rank.name.toUpperCase(), surface: "front", u: 0.5, v: 0.16, scale: 1 },
    });
  }
  console.log(`  ✓ ${DEFAULT_RANKS.length} ranks`);

  for (const [i, t] of ACTIVITY_TYPE_SEEDS.entries()) {
    const id = t.name.toLowerCase().replace(/[^a-z]+/g, "-");
    await org.collection("activityTypes").doc(id).set({
      name: t.name,
      statKey: t.statKey,
      requiresProof: t.requiresProof,
      allowQuantity: t.allowQuantity,
      defaultQuantity: 1,
      icon: t.icon,
      active: true,
      order: i + 1,
    });
  }
  console.log(`  ✓ ${ACTIVITY_TYPE_SEEDS.length} activity types`);

  for (const { id, ...patch } of PATCHES) {
    await org.collection("patches").doc(id).set(patch);
  }
  console.log(`  ✓ ${PATCHES.length} patches`);

  // ── Founding admin ──
  let uid: string;
  try {
    uid = (await auth.getUserByEmail(ADMIN_EMAIL!)).uid;
    console.log("  • admin auth account already exists — reusing");
  } catch {
    uid = (
      await auth.createUser({
        email: ADMIN_EMAIL!,
        emailVerified: true,
        password: randomBytes(24).toString("base64url"), // placeholder; replaced via reset link below
        displayName: ADMIN_DISPLAY_NAME,
      })
    ).uid;
    console.log("  ✓ created admin auth account");
  }

  const memberId = "m-founder";
  await org.collection("members").doc(memberId).set(
    {
      uid,
      displayName: ADMIN_DISPLAY_NAME,
      roadName: ADMIN_ROAD_NAME,
      rankId: rankIdByName.get("President"),
      status: "patched",
      joinDate: Timestamp.now(),
      memberNumber: 1,
      stats: {},
      patchCount: 0,
      createdAt: Timestamp.now(),
    },
    { merge: true },
  );
  await db.collection("users").doc(uid).set(
    {
      email: ADMIN_EMAIL,
      displayName: ADMIN_DISPLAY_NAME,
      memberships: { [ORG_ID]: { memberId, role: "admin" } },
      createdAt: Timestamp.now(),
    },
    { merge: true },
  );
  // REBUILD claims from the users doc merged above, never replace them with
  // this club alone. Orgs share one Firebase project, so the founding admin
  // here may already be an admin of a sibling club and/or a platform
  // superAdmin, and a bare overwrite silently strips both. Same shape as
  // syncUserClaims() in src/lib/auth/claims.ts, which CLAUDE.md names as the
  // only thing allowed to move claims.
  const userDoc = (await db.collection("users").doc(uid).get()).data() as
    | UserDoc
    | undefined;
  const claims: SessionClaims = {};
  if (userDoc?.superAdmin) claims.superAdmin = true;
  if (userDoc?.memberships && Object.keys(userDoc.memberships).length > 0) {
    claims.orgs = {};
    for (const [id, m] of Object.entries(userDoc.memberships)) {
      claims.orgs[id] = { r: m.role, m: m.memberId };
    }
  }
  await auth.setCustomUserClaims(uid, claims as object);
  console.log("  ✓ admin member record + membership + claims");

  // Digital Cut config (M8): vest surfaces, slots, rank visuals, patch rarity.
  const cut = await writeCutConfig(db, ORG_ID, { orgName: ORG_DISPLAY_NAME, location: ORG_LOCATION });
  console.log(
    `  ✓ digital cut: ${cut.vestSurfaces} vest surfaces, ${cut.rankVisuals} rank visuals, ${cut.patchesBackfilled} patches tagged`,
  );

  const resetLink = await auth.generatePasswordResetLink(ADMIN_EMAIL!);
  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("BOOTSTRAP COMPLETE.\n");
  console.log(`Set your password with this one-time link (open in a browser):\n`);
  console.log(resetLink);
  console.log(`\nThen sign in at  /${ORG_ID}/volunteer-resources  with  ${ADMIN_EMAIL}`);
  console.log(`Your road name is "${ADMIN_ROAD_NAME}" — rename it any time in the portal's Members admin.`);
  console.log("──────────────────────────────────────────────────────────────");
}

bootstrap()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Bootstrap failed:", e);
    process.exit(1);
  });
