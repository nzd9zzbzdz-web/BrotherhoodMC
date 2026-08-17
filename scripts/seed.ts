/**
 * Seed the emulator (or a live project) with the Ravens of Death MC organization.
 *   npm run seed
 * Requires `firebase emulators:start` running (or live Admin credentials).
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { existsSync } from "node:fs";

import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  ACTIVITY_TYPE_SEEDS,
  CRIMINAL_ACTIVITY_TYPE_SEEDS,
  CRIMINAL_PATCH_SEEDS,
  DEFAULT_RANKS,
  rankDocId,
} from "../src/lib/constants";
import { writeCutConfig } from "./lib/writeCutConfig";
import {
  ORG_DISPLAY_NAME,
  ORG_LEGAL_NAME,
  ORG_LOCATION,
  ORG_PUBLIC_NAME,
  portalBranding,
  publicBranding,
} from "./lib/branding";
import type {
  CutLayout,
  CutPlacement,
  Patch,
  StatKey,
} from "../src/lib/types";

const PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-brotherhood-portal";

if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
  console.error("Refusing to seed: no emulator host and no service account configured.");
  process.exit(1);
}

const app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);
const db: Firestore = getFirestore(app);

const ORG_ID = "brotherhood";

// ── Patches ────────────────────────────────────────────────────────────

type PatchSeed = Omit<Patch, "id"> & { id: string };
const p = (
  id: string,
  name: string,
  category: Patch["category"],
  description: string,
  tier: number,
  requirement: { statKey: StatKey; threshold: number } | null,
  surface: "front" | "back",
  u: number,
  v: number,
): PatchSeed => ({
  id,
  name,
  category,
  description,
  tier,
  requirement,
  manual: requirement === null,
  active: true,
  defaultPlacement: { surface, u, v, scale: 0.8, rotationDeg: 0 },
});

const PATCHES: PatchSeed[] = [
  p("road-warrior", "Road Warrior", "activity", "Complete 10 club runs.", 1, { statKey: "clubRuns", threshold: 10 }, "front", 0.3, 0.42),
  p("iron-rider", "Iron Rider", "activity", "Complete 50 club runs.", 2, { statKey: "clubRuns", threshold: 50 }, "front", 0.3, 0.52),
  p("faithful", "Faithful", "activity", "Attend 10 church meetings.", 1, { statKey: "churchAttendance", threshold: 10 }, "front", 0.7, 0.42),
  p("dedicated-soul", "Dedicated Soul", "activity", "Attend 25 church meetings.", 2, { statKey: "churchAttendance", threshold: 25 }, "front", 0.7, 0.52),
  // Criminal record emblems (CRIMINAL_PATCH_SEEDS — the five-tier ladders
  // derived from PATCH_LADDERS) replace the retired club set here; see
  // RETIRED_PATCH_IDS in constants. `rarity` is carried through rather than
  // left to writeCutConfig's tier backfill, which would disagree with the
  // sync action on any tier that sets its own. `emblem` keeps them off the cut.
  ...CRIMINAL_PATCH_SEEDS.map((c) => ({
    ...p(c.id, c.name, c.category, c.description, c.tier, c.requirement, c.surface, c.u, c.v),
    rarity: c.rarity,
    emblem: c.emblem,
  })),
  p("presidents-citation", "President's Citation", "recognition", "Awarded personally by the President for exceptional service.", 3, null, "front", 0.5, 0.68),
  p("brotherhoods-honor", "Brotherhood's Honor", "recognition", "Awarded by club vote for embodying the spirit of the Ravens.", 3, null, "front", 0.5, 0.78),
  p("war-veteran", "War Veteran", "legendary", "Stood their ground when the club needed them most. Manual award.", 4, null, "back", 0.5, 0.45),
];

// ── Members ────────────────────────────────────────────────────────────

interface MemberSeed {
  id: string;
  displayName: string;
  roadName: string;
  email: string;
  rankName: string;
  role: "admin" | "officer" | "member";
  status: "patched" | "prospect";
  memberNumber: number;
  joinDate: string; // ISO
  sponsorId?: string;
  stats: Partial<Record<StatKey, number>>;
  rapStatus: string; // character-screen status line
}

// Criminal record stats, in character-screen display order. These are ordinary
// stats now — members log them and officers approve, same as a club run — so
// the seed just puts a plausible history on the books.
const rap = (
  crimes: number,
  heists: number,
  police: number,
  jailMonths: number,
  arrests: number,
  dirtyMoney: number,
): Partial<Record<StatKey, number>> => ({
  crimesCommitted: crimes,
  felonies: Math.round(crimes * 0.35),
  heistsCompleted: heists,
  drugSales: crimes * 3,
  drugsCooked: Math.round(crimes * 0.8),
  gunsManufactured: Math.round(crimes * 0.45),
  dirtyMoneyEarned: dirtyMoney,
  dirtyMoneyCleaned: Math.round(dirtyMoney * 0.6),
  policeGunnedDown: police,
  timesArrested: arrests,
  jailTimeMonths: jailMonths,
});

const MEMBERS: MemberSeed[] = [
  {
    id: "m-reaper", displayName: "Marcus Cole", roadName: "Reaper",
    email: "reaper@silentsouls.rp", rankName: "President", role: "admin",
    status: "patched", memberNumber: 1, joinDate: "2023-02-11",
    rapStatus: "At Large",
    stats: { ...rap(187, 12, 34, 96, 23, 2_400_000), clubRuns: 61, churchAttendance: 48, operations: 22, territoryDefense: 14, recruitment: 4, specialAssignments: 9, communityOutreach: 18, charityEvents: 12, securityDetail: 11, territoryPatrol: 20 },
  },
  {
    id: "m-six", displayName: "Danny Alvarez", roadName: "Six",
    email: "six@silentsouls.rp", rankName: "Sergeant-at-Arms", role: "officer",
    status: "patched", memberNumber: 3, joinDate: "2023-04-02",
    rapStatus: "At Large",
    stats: { ...rap(154, 9, 41, 54, 17, 1_100_000), clubRuns: 44, churchAttendance: 39, operations: 17, territoryDefense: 11, recruitment: 2, specialAssignments: 6, securityDetail: 16, territoryPatrol: 12, communityOutreach: 7 },
  },
  {
    id: "m-thorn", displayName: "Rosa Delgado", roadName: "Thorn",
    email: "thorn@silentsouls.rp", rankName: "Road Captain", role: "officer",
    status: "patched", memberNumber: 5, joinDate: "2023-07-19",
    rapStatus: "At Large",
    stats: { ...rap(121, 7, 12, 30, 11, 860_000), clubRuns: 52, churchAttendance: 31, operations: 12, territoryDefense: 8, recruitment: 1, specialAssignments: 4, territoryPatrol: 17, communityOutreach: 9, charityEvents: 6 },
  },
  {
    // The Treasurer seat: a MEMBER portal role who can still rule on the bank,
    // which is exactly the treasury permission carve-out worth demoing.
    id: "m-ledger", displayName: "Jimmy Okafor", roadName: "Ledger",
    email: "ledger@silentsouls.rp", rankName: "Treasurer", role: "member",
    status: "patched", memberNumber: 9, joinDate: "2024-03-08",
    rapStatus: "At Large",
    stats: { ...rap(64, 15, 3, 18, 6, 3_800_000), clubRuns: 23, churchAttendance: 19, operations: 6, territoryDefense: 3, communityOutreach: 11, charityEvents: 8, securityDetail: 5 },
  },
  {
    id: "m-static", displayName: "Tasha Reyes", roadName: "Static",
    email: "static@silentsouls.rp", rankName: "Patched Member", role: "member",
    status: "patched", memberNumber: 11, joinDate: "2024-09-30",
    rapStatus: "At Large",
    stats: { ...rap(43, 4, 7, 8, 5, 310_000), clubRuns: 14, churchAttendance: 12, operations: 3, territoryPatrol: 6, communityOutreach: 4 },
  },
  {
    id: "m-patch", displayName: "Eli Munoz", roadName: "Patch",
    email: "patch@silentsouls.rp", rankName: "Prospect", role: "member",
    status: "prospect", memberNumber: 14, joinDate: "2026-02-14", sponsorId: "m-six",
    rapStatus: "On Probation",
    // one club run away from Road Warrior — perfect for the golden-path demo
    stats: { ...rap(12, 1, 0, 0, 2, 18_000), clubRuns: 9, churchAttendance: 3, prospectTasks: 2, territoryPatrol: 4 },
  },
];

// Character art by convention: public/brand/members/<memberId>.webp if it
// exists, else the shared shadow silhouette. Drop a file in, re-seed, done.
function characterArt(memberId: string): string {
  return existsSync(`public/brand/members/${memberId}.webp`)
    ? `/brand/members/${memberId}.webp`
    : "/brand/members/silhouette.webp";
}

const DEMO_PASSWORD = "brotherhood";

// ── Helpers ────────────────────────────────────────────────────────────

function evaluateSeedAwards(member: MemberSeed): PatchSeed[] {
  return PATCHES.filter(
    (patch) =>
      patch.requirement &&
      (member.stats[patch.requirement.statKey] ?? 0) >= patch.requirement.threshold,
  );
}

function buildCutLayout(rankTab: { text: string } | null, awards: PatchSeed[]): CutLayout {
  const surfaces: CutLayout["surfaces"] = { front: [], back: [] };
  if (rankTab) {
    surfaces.front.push({
      kind: "rankTab", refId: "rank", surface: "front",
      u: 0.5, v: 0.16, scale: 1, rotationDeg: 0, zIndex: 1, mirrored: false,
    });
  }
  // Emblems are earned but never worn — same rule the patch engine applies via
  // isWorn. Without this a demo member shows up wearing all five tiers of every
  // criminal ladder, fifty-five deep.
  for (const patch of awards.filter((p) => p.emblem !== true)) {
    const base = patch.defaultPlacement;
    const list = surfaces[base.surface];
    let v = base.v;
    const occupied = (uu: number, vv: number) =>
      list.some((pl: CutPlacement) => Math.abs(pl.u - uu) < 0.05 && Math.abs(pl.v - vv) < 0.05);
    while (occupied(base.u, v) && v < 0.95) v += 0.06;
    list.push({
      kind: "patch", refId: patch.id, surface: base.surface,
      u: base.u, v, scale: base.scale, rotationDeg: base.rotationDeg,
      zIndex: list.length + 1, mirrored: false,
    });
  }
  return { surfaces, updatedAt: new Date() };
}

async function ensureAuthUser(email: string, displayName: string): Promise<string> {
  try {
    const existing = await auth.getUserByEmail(email);
    return existing.uid;
  } catch {
    const created = await auth.createUser({ email, password: DEMO_PASSWORD, displayName });
    return created.uid;
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function seed() {
  console.log(`Seeding project ${PROJECT_ID} (org: ${ORG_ID})...`);
  const org = db.collection("organizations").doc(ORG_ID);

  // Idempotent reset: wipe the org tree so re-seeding restores a clean demo state.
  await db.recursiveDelete(org);

  await org.set({
    name: ORG_LEGAL_NAME,
    publicName: ORG_PUBLIC_NAME,
    slug: ORG_ID,
    status: "active",
    features: { gallery: true, cut3d: false },
    memberCount: MEMBERS.length,
    // Monotonic source for new member numbers — seeded to the highest existing
    // number so createMember can never reuse 1..14.
    lastMemberNumber: Math.max(...MEMBERS.map((m) => m.memberNumber)),
    foundedAt: Timestamp.fromDate(new Date("2023-02-11")),
    createdAt: Timestamp.now(),
  });

  await org.collection("branding").doc("portal").set(portalBranding);
  await org.collection("branding").doc("public").set(publicBranding);

  // Ranks
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

  // Activity types — club work first, then the criminal record types that
  // drive the character screen's panel.
  const activityTypes = [
    ...ACTIVITY_TYPE_SEEDS.map((t) => ({
      ...t,
      id: t.name.toLowerCase().replace(/[^a-z]+/g, "-"),
    })),
    ...CRIMINAL_ACTIVITY_TYPE_SEEDS,
  ];
  for (const [i, t] of activityTypes.entries()) {
    await org.collection("activityTypes").doc(t.id).set({
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

  // Patches
  for (const { id, ...patch } of PATCHES) {
    await org.collection("patches").doc(id).set(patch);
  }

  // Members + auth users + claims + awards + cut layouts
  const superUid = await ensureAuthUser("platform@brotherhood.app", "Platform Owner");
  await auth.setCustomUserClaims(superUid, { superAdmin: true });
  await db.collection("users").doc(superUid).set({
    email: "platform@brotherhood.app",
    displayName: "Platform Owner",
    superAdmin: true,
    memberships: {},
    createdAt: Timestamp.now(),
  });

  for (const m of MEMBERS) {
    const uid = await ensureAuthUser(m.email, m.displayName);
    await auth.setCustomUserClaims(uid, {
      orgs: { [ORG_ID]: { r: m.role, m: m.id } },
    });
    await db.collection("users").doc(uid).set({
      email: m.email,
      displayName: m.displayName,
      memberships: { [ORG_ID]: { memberId: m.id, role: m.role } },
      createdAt: Timestamp.now(),
    });

    const awards = evaluateSeedAwards(m);
    await org.collection("members").doc(m.id).set({
      uid,
      displayName: m.displayName,
      roadName: m.roadName,
      photoPath: characterArt(m.id),
      rapStatus: m.rapStatus,
      rankId: rankIdByName.get(m.rankName),
      status: m.status,
      joinDate: Timestamp.fromDate(new Date(m.joinDate)),
      ...(m.sponsorId ? { sponsorMemberId: m.sponsorId } : {}),
      memberNumber: m.memberNumber,
      stats: m.stats,
      patchCount: awards.length,
      createdAt: Timestamp.now(),
    });

    for (const patch of awards) {
      await org.collection("awardedPatches").doc(`${m.id}_${patch.id}`).set({
        memberId: m.id,
        patchId: patch.id,
        awardedAt: Timestamp.fromDate(new Date(m.joinDate)),
        awardedBy: "system",
      });
    }
    await org.collection("cutLayouts").doc(m.id).set(
      buildCutLayout({ text: m.rankName.toUpperCase() }, awards) as object,
    );
  }

  // Prospect profile for Eli
  await org.collection("prospectProfiles").doc("m-patch").set({
    startDate: Timestamp.fromDate(new Date("2026-02-14")),
    sponsorMemberId: "m-six",
    requirements: [
      { key: "church", label: "Church Attendance", statKey: "churchAttendance", target: 5, manualProgress: null },
      { key: "runs", label: "Club Runs", statKey: "clubRuns", target: 10, manualProgress: null },
      { key: "officerTasks", label: "Officer Tasks", statKey: null, target: 3, manualProgress: 2 },
    ],
    status: "active",
  });

  // A pending activity for the golden path (Eli's 10th club ride)
  await org.collection("activities").doc("a-golden-path").set({
    memberId: "m-patch",
    entries: [{ typeId: "club-ride", statKey: "clubRuns", quantity: 1 }],
    date: Timestamp.fromDate(new Date("2026-07-05")),
    description: "Full club run out to Paleto Bay and back, rode sweep the whole way.",
    witnesses: ["m-six", "m-thorn"],
    status: "pending",
    createdAt: Timestamp.now(),
  });

  // Club Map: intel pins + turf zones (normalized u/v against the map image).
  const mapMarkers: Array<{
    id: string; label: string; style: string; description: string;
    u: number; v: number; createdByMemberId: string;
  }> = [
    { id: "mk-clubhouse", label: "The Clubhouse", style: "clubhouse", description: "Home. Sandy Shores. Colors on the wall, prospects on the door.", u: 0.63, v: 0.4, createdByMemberId: "m-reaper" },
    { id: "mk-sheriff", label: "Sandy Shores Sheriff", style: "cops", description: "BCSO substation. They watch the clubhouse from here, so assume eyes.", u: 0.6, v: 0.38, createdByMemberId: "m-six" },
    { id: "mk-grapeseed", label: "Rival hangout, Grapeseed", style: "rival", description: "Lost MC drink at the farmhouse most nights. Do not ride through alone.", u: 0.68, v: 0.32, createdByMemberId: "m-thorn" },
    { id: "mk-paleto", label: "Paleto fuel stop", style: "run", description: "Standard rally point on the northern run. Regroup before the coast road.", u: 0.42, v: 0.14, createdByMemberId: "m-six" },
    { id: "mk-legion", label: "Legion Square meet", style: "meet", description: "Neutral ground for city sit-downs. Public, cameras everywhere, so behave.", u: 0.42, v: 0.75, createdByMemberId: "m-reaper" },
  ];
  for (const mk of mapMarkers) {
    const { id, ...data } = mk;
    await org.collection("mapMarkers").doc(id).set({
      ...data,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }
  await org.collection("mapTerritories").doc("turf-ravens").set({
    crewName: ORG_DISPLAY_NAME,
    label: "Sandy Shores turf",
    color: null, // auto color from crew name
    points: [
      { u: 0.55, v: 0.33 }, { u: 0.72, v: 0.33 },
      { u: 0.74, v: 0.45 }, { u: 0.57, v: 0.47 },
    ],
    createdByMemberId: "m-reaper",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  await org.collection("mapTerritories").doc("turf-lost").set({
    crewName: "Lost MC",
    label: "East Los Santos",
    color: null,
    points: [
      { u: 0.48, v: 0.72 }, { u: 0.6, v: 0.73 },
      { u: 0.61, v: 0.82 }, { u: 0.49, v: 0.83 },
    ],
    createdByMemberId: "m-thorn",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

  // Digital Cut config (M8): vest surfaces, slots, rank visuals, patch rarity.
  const cut = await writeCutConfig(db, ORG_ID, { orgName: ORG_DISPLAY_NAME, location: ORG_LOCATION });
  console.log(
    `  cut: ${cut.vestSurfaces} vest surfaces, ${cut.rankVisuals} rank visuals, ${cut.patchesBackfilled} patches tagged`,
  );

  console.log("Seed complete.");
  console.log("──────────────────────────────────────────────");
  console.log("Demo logins (password: brotherhood):");
  for (const m of MEMBERS) console.log(`  ${m.email.padEnd(28)} ${m.rankName} (${m.role})`);
  console.log(`  platform@brotherhood.app     Super Admin`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
