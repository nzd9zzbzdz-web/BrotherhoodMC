/**
 * The admin "sync default ranks" action. Ranks are only written on a
 * destructive reseed, so this is the only way a live club can pick up a rank
 * added later (Head Enforcer, Chaplain) or a rank that changed sides
 * (Enforcer leaving the officer table). Nothing may be deleted: members sit on
 * these ids.
 *
 * Requires emulators running; isolated project.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "ranks-test-isolated";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  // Actions clear cached reads via updateTag (see src/lib/cache.ts). No Server
  // Action context here, and NODE_ENV!=="production" means nothing is cached
  // in tests anyway — the stub just has to exist.
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("@/lib/auth/session", () => ({
  requireOrgRole: async () => ({
    user: { uid: "admin-1" },
    role: "admin",
    memberId: "m1",
    isSuper: false,
  }),
}));

const { adminDb, orgRef } = await import("@/lib/firebase/admin");
const { syncDefaultRanks } = await import("@/actions/ranks");
const { DEFAULT_RANKS, rankDocId } = await import("@/lib/constants");

const ORG = "ranks-test-org";

/** The rank set as it shipped before Head Enforcer and Chaplain existed. */
const LEGACY_RANKS = [
  { name: "President", order: 1, isOfficer: true },
  { name: "Vice President", order: 2, isOfficer: true },
  { name: "Sergeant-at-Arms", order: 3, isOfficer: true },
  { name: "Road Captain", order: 4, isOfficer: true },
  { name: "Secretary", order: 5, isOfficer: true },
  { name: "Treasurer", order: 6, isOfficer: true },
  { name: "Enforcer", order: 7, isOfficer: true },
  { name: "Patched Member", order: 8, isOfficer: false },
  { name: "Prospect", order: 9, isOfficer: false },
  { name: "Hangaround", order: 10, isOfficer: false },
];

async function seedLegacy() {
  for (const rank of LEGACY_RANKS) {
    await orgRef(ORG).collection("ranks").doc(rankDocId(rank.name)).set({
      name: rank.name,
      order: rank.order,
      isOfficer: rank.isOfficer,
      tab: { text: rank.name.toUpperCase(), surface: "front", u: 0.5, v: 0.16, scale: 1 },
    });
  }
}

async function rankIds(): Promise<string[]> {
  const snap = await orgRef(ORG).collection("ranks").get();
  return snap.docs.map((d) => d.id).sort();
}

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await orgRef(ORG).set({ name: "Rank Test MC", slug: ORG, memberCount: 0 });
});
afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
});

describe("syncDefaultRanks", () => {
  it("installs every shipped rank into an empty org", async () => {
    const res = await syncDefaultRanks(ORG);
    expect(res.ok).toBe(true);
    expect(res.data!.created).toHaveLength(DEFAULT_RANKS.length);
    expect(await rankIds()).toEqual(DEFAULT_RANKS.map((r) => rankDocId(r.name)).sort());
  });

  it("adds the new ranks and re-sides Enforcer — the production case", async () => {
    await seedLegacy();

    const res = await syncDefaultRanks(ORG);
    expect(res.data!.created).toEqual(["Head Enforcer", "Chaplain"]);
    // Enforcer flips to member; everything after it shifts down two slots.
    expect(res.data!.updated).toContain("Enforcer");

    const head = await orgRef(ORG).collection("ranks").doc("head-enforcer").get();
    expect(head.data()).toMatchObject({ name: "Head Enforcer", order: 7, isOfficer: true });

    const chaplain = await orgRef(ORG).collection("ranks").doc("chaplain").get();
    expect(chaplain.data()).toMatchObject({ name: "Chaplain", order: 9, isOfficer: false });

    const enforcer = await orgRef(ORG).collection("ranks").doc("enforcer").get();
    expect(enforcer.data()).toMatchObject({ order: 8, isOfficer: false });
    // Merge, not overwrite: the org's tab art survives.
    expect(enforcer.data()?.tab?.text).toBe("ENFORCER");
  });

  it("is idempotent — a second run changes nothing", async () => {
    await syncDefaultRanks(ORG);
    const res = await syncDefaultRanks(ORG);
    expect(res.data!.created).toEqual([]);
    expect(res.data!.updated).toEqual([]);
    expect(res.data!.visualsWritten).toBe(0);
    expect(res.data!.alreadyCurrent).toBe(DEFAULT_RANKS.length);
  });

  it("never deletes a rank the org added itself", async () => {
    await orgRef(ORG).collection("ranks").doc("tail-gunner").set({
      name: "Tail Gunner",
      order: 99,
      isOfficer: false,
    });

    await syncDefaultRanks(ORG);

    const custom = await orgRef(ORG).collection("ranks").doc("tail-gunner").get();
    expect(custom.exists).toBe(true);
    expect(custom.data()?.name).toBe("Tail Gunner");
  });

  it("dresses new ranks in the colors the club already wears", async () => {
    await seedLegacy();
    // A rebranded club: its rockers say something other than the org doc name.
    await orgRef(ORG).collection("rankVisuals").doc("patched-member").set({
      showsColors: true,
      grants: [
        { kind: "topRocker", surface: "back", u: 0.5, v: 0.15, scale: 1, text: "Ravens of Death MC" },
        { kind: "centerPatch", surface: "back", u: 0.5, v: 0.4, scale: 1, text: "" },
        { kind: "bottomRocker", surface: "back", u: 0.5, v: 0.68, scale: 1, text: "San Andreas" },
      ],
    });

    await syncDefaultRanks(ORG);

    const visual = (
      await orgRef(ORG).collection("rankVisuals").doc("head-enforcer").get()
    ).data()!;
    expect(visual.showsColors).toBe(true);
    expect(visual.grants).toContainEqual(
      expect.objectContaining({ kind: "topRocker", text: "Ravens of Death MC" }),
    );
    expect(visual.grants).toContainEqual(
      expect.objectContaining({ kind: "bottomRocker", text: "San Andreas" }),
    );
    expect(visual.grants).toContainEqual(
      expect.objectContaining({ kind: "rankTab", text: "HEAD ENFORCER" }),
    );

    // The rank visual the org had already tuned is left exactly as it was.
    const untouched = (
      await orgRef(ORG).collection("rankVisuals").doc("patched-member").get()
    ).data()!;
    expect(untouched.grants).toHaveLength(3);
  });

  it("gives Chaplain and Enforcer a tab even though they are not officers", async () => {
    await syncDefaultRanks(ORG);

    for (const id of ["chaplain", "enforcer"]) {
      const visual = (await orgRef(ORG).collection("rankVisuals").doc(id).get()).data()!;
      expect(visual.showsColors).toBe(true);
      expect(visual.grants.some((g: { kind: string }) => g.kind === "rankTab")).toBe(true);
    }
  });

  it("keeps rank ids stable — a member's rankId must never orphan", () => {
    // The id rule is load-bearing: change it and every member points at nothing.
    expect(rankDocId("Head Enforcer")).toBe("head-enforcer");
    expect(rankDocId("Sergeant-at-Arms")).toBe("sergeant-at-arms");
    expect(new Set(DEFAULT_RANKS.map((r) => rankDocId(r.name))).size).toBe(
      DEFAULT_RANKS.length,
    );
  });
});
