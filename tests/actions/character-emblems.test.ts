/**
 * Saving which awards a member pins on their character stage and where. The
 * coordinates come from pointer maths (clamped, like the pose), but the patch
 * ids come from the client too — and those are NOT clamped, they're checked:
 * an id without an award doc behind it must refuse the whole save, or any
 * member could decorate their screen with patches they never earned.
 *
 * Requires emulators running; isolated project.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "character-emblems-test-isolated";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  // Actions clear cached reads via updateTag (see src/lib/cache.ts). No Server
  // Action context here, and NODE_ENV!=="production" means nothing is cached
  // in tests anyway — the stub just has to exist.
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

// Record what each action demands. Hiding the buttons in the UI is cosmetic —
// the action's own gate is the real boundary, so assert on it directly.
const gate = vi.hoisted(() => ({ demanded: [] as string[] }));
const adminAccess = {
  user: { uid: "admin-1" },
  role: "admin" as const,
  memberId: "m-admin",
  isSuper: false,
};
vi.mock("@/lib/auth/session", () => ({
  requireOrgRole: async (_orgId: string, minRole = "member") => {
    gate.demanded.push(minRole);
    return adminAccess;
  },
  requireSelfOrRole: async (
    _orgId: string,
    _memberId: string,
    elevatedRole = "admin",
  ) => {
    gate.demanded.push(elevatedRole);
    return { access: adminAccess, isSelf: false };
  },
}));

const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { saveCharacterEmblems } = await import("@/actions/character");
const { clampEmblemPlacements } = await import("@/lib/schemas/character");
const { CHARACTER_EMBLEM_LIMITS } = await import("@/lib/constants");

const ORG = "character-emblems-test-org";
const org = orgRef(ORG);
const E = CHARACTER_EMBLEM_LIMITS;

async function emblemsOf() {
  const snap = await org.collection("members").doc("m1").get();
  return snap.data()?.characterEmblems;
}

beforeEach(async () => {
  await adminDb.recursiveDelete(org);
  await org.set({ name: "Emblems Test", slug: ORG, memberCount: 1 });
  await org.collection("members").doc("m1").set({
    uid: null,
    displayName: "Test Member",
    roadName: "Testy",
    rankId: "patched",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    stats: {},
    patchCount: 2,
    createdAt: Timestamp.now(),
  });
  // Two earned awards; anything else is fair game for the forgery cases.
  for (const patchId of ["road-warrior", "hard-time-1"]) {
    await org.collection("awardedPatches").doc(`m1_${patchId}`).set({
      memberId: "m1",
      patchId,
      awardedAt: Timestamp.now(),
      awardedBy: "system",
    });
  }
});

afterAll(async () => {
  await adminDb.recursiveDelete(org);
});

describe("saveCharacterEmblems", () => {
  it("demands admin for someone else's stage", async () => {
    gate.demanded.length = 0;
    await saveCharacterEmblems({ orgId: ORG, memberId: "m1", placements: null });
    expect(gate.demanded).toEqual(["admin"]);
  });

  it("stores an arrangement of earned awards", async () => {
    const res = await saveCharacterEmblems({
      orgId: ORG,
      memberId: "m1",
      placements: [
        { patchId: "road-warrior", x: 70, y: 20, size: 8 },
        { patchId: "hard-time-1", x: 30, y: 60, size: 5 },
      ],
    });
    expect(res.ok).toBe(true);
    expect(await emblemsOf()).toEqual([
      { patchId: "road-warrior", x: 70, y: 20, size: 8 },
      { patchId: "hard-time-1", x: 30, y: 60, size: 5 },
    ]);
  });

  it("refuses a patch the member never earned", async () => {
    const res = await saveCharacterEmblems({
      orgId: ORG,
      memberId: "m1",
      placements: [{ patchId: "presidents-own", x: 50, y: 50, size: 8 }],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/earned/i);
    expect(await emblemsOf()).toBeUndefined();
  });

  it("clamps an overshooting drag to the edge instead of rejecting it", async () => {
    await saveCharacterEmblems({
      orgId: ORG,
      memberId: "m1",
      placements: [{ patchId: "road-warrior", x: 9999, y: -9999, size: 9999 }],
    });
    expect(await emblemsOf()).toEqual([
      { patchId: "road-warrior", x: E.x.max, y: E.y.min, size: E.size.max },
    ]);
  });

  it("rejects non-finite values rather than writing them", async () => {
    for (const bad of [NaN, Infinity]) {
      const res = await saveCharacterEmblems({
        orgId: ORG,
        memberId: "m1",
        placements: [{ patchId: "road-warrior", x: bad, y: 10, size: 6 }],
      });
      expect(res.ok).toBe(false);
    }
    expect(await emblemsOf()).toBeUndefined();
  });

  it("rejects more tiles than the cap", async () => {
    const res = await saveCharacterEmblems({
      orgId: ORG,
      memberId: "m1",
      placements: Array.from({ length: E.count + 1 }, (_, i) => ({
        patchId: `p${i}`,
        x: 50,
        y: 50,
        size: 5,
      })),
    });
    expect(res.ok).toBe(false);
    expect(await emblemsOf()).toBeUndefined();
  });

  it("stores an empty arrangement as 'show nothing', distinct from reset", async () => {
    const res = await saveCharacterEmblems({
      orgId: ORG,
      memberId: "m1",
      placements: [],
    });
    expect(res.ok).toBe(true);
    expect(await emblemsOf()).toEqual([]);
  });

  it("clears the arrangement so the automatic slots apply again", async () => {
    await saveCharacterEmblems({
      orgId: ORG,
      memberId: "m1",
      placements: [{ patchId: "road-warrior", x: 70, y: 20, size: 8 }],
    });
    const res = await saveCharacterEmblems({
      orgId: ORG,
      memberId: "m1",
      placements: null,
    });
    expect(res.ok).toBe(true);
    expect(await emblemsOf()).toBeUndefined();
  });

  it("reports a missing member rather than throwing", async () => {
    const res = await saveCharacterEmblems({
      orgId: ORG,
      memberId: "nobody",
      placements: null,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});

describe("clampEmblemPlacements", () => {
  it("rounds to one decimal and drops repeat patch ids, first one winning", () => {
    expect(
      clampEmblemPlacements([
        { patchId: "a", x: 12.345, y: 7.891, size: 6.04 },
        { patchId: "a", x: 90, y: 90, size: 20 },
        { patchId: "b", x: 50, y: 50, size: 5 },
      ]),
    ).toEqual([
      { patchId: "a", x: 12.3, y: 7.9, size: 6 },
      { patchId: "b", x: 50, y: 50, size: 5 },
    ]);
  });
});
