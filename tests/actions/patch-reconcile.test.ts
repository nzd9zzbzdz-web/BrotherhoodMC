/**
 * Award reconciliation — the only path that DELETES awards.
 *
 * The guarantees worth pinning are the ones that protect a member's record:
 * a manual award is never revoked, an award with nothing to measure it against
 * is left alone, and the preview reports exactly what the write would do.
 *
 * Requires emulators running; isolated project.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "reconcile-test-isolated";

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

const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { findStaleAwards, reconcilePatchAwards } = await import(
  "@/actions/patch-reconcile"
);

const ORG = "reconcile-test-org";

async function addPatch(
  id: string,
  threshold: number | null,
  opts: { emblem?: boolean; statKey?: string } = {},
) {
  await orgRef(ORG).collection("patches").doc(id).set({
    name: id,
    category: "activity",
    description: id,
    tier: 1,
    requirement:
      threshold === null
        ? null
        : { statKey: opts.statKey ?? "jailTimeMonths", threshold },
    manual: threshold === null,
    active: true,
    ...(opts.emblem ? { emblem: true } : {}),
    defaultPlacement: { surface: "back", u: 0.3, v: 0.6, scale: 0.8, rotationDeg: 0 },
  });
}

async function addMember(id: string, stats: Record<string, number>, patchCount: number) {
  await orgRef(ORG).collection("members").doc(id).set({
    uid: null,
    displayName: id,
    roadName: id,
    rankId: "patched",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    patchCount,
    stats,
    createdAt: Timestamp.now(),
  });
}

async function award(memberId: string, patchId: string, by: string) {
  await orgRef(ORG).collection("awardedPatches").doc(`${memberId}_${patchId}`).set({
    memberId,
    patchId,
    awardedAt: Timestamp.now(),
    awardedBy: by,
    ...(by === "system" ? {} : { reason: "Held the line." }),
  });
}

async function heldBy(memberId: string): Promise<string[]> {
  const snap = await orgRef(ORG)
    .collection("awardedPatches")
    .where("memberId", "==", memberId)
    .get();
  return snap.docs.map((d) => (d.data() as { patchId: string }).patchId).sort();
}

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await orgRef(ORG).set({ name: "Reconcile Test", slug: ORG, memberCount: 0 });
});
afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
});

describe("reconcilePatchAwards", () => {
  it("revokes an award the member no longer reaches", async () => {
    // Hardened retuned 300 -> 2,000 with a member sitting on 380.
    await addPatch("hardened", 2_000, { emblem: true });
    await addMember("m1", { jailTimeMonths: 380 }, 1);
    await award("m1", "hardened", "system");

    const preview = await findStaleAwards(ORG);
    expect(preview.data).toHaveLength(1);
    expect(preview.data![0]).toMatchObject({
      memberName: "m1",
      patchName: "hardened",
      current: 380,
      threshold: 2_000,
    });

    const res = await reconcilePatchAwards(ORG);
    expect(res.data!.revoked).toBe(1);
    expect(await heldBy("m1")).toEqual([]);

    const member = (await orgRef(ORG).collection("members").doc("m1").get()).data()!;
    expect(member.patchCount).toBe(0);
  });

  it("never revokes a manual award, however far below the bar", async () => {
    await addPatch("hardened", 2_000, { emblem: true });
    await addMember("m1", { jailTimeMonths: 0 }, 1);
    await award("m1", "hardened", "prez-uid"); // leadership handed it over

    const preview = await findStaleAwards(ORG);
    expect(preview.data).toHaveLength(0);

    const res = await reconcilePatchAwards(ORG);
    expect(res.data!.revoked).toBe(0);
    expect(await heldBy("m1")).toEqual(["hardened"]);
  });

  it("keeps awards the member still qualifies for", async () => {
    await addPatch("low", 100, { emblem: true });
    await addPatch("high", 2_000, { emblem: true });
    await addMember("m1", { jailTimeMonths: 380 }, 2);
    await award("m1", "low", "system");
    await award("m1", "high", "system");

    await reconcilePatchAwards(ORG);
    expect(await heldBy("m1")).toEqual(["low"]);

    const member = (await orgRef(ORG).collection("members").doc("m1").get()).data()!;
    expect(member.patchCount).toBe(1);
  });

  it("leaves an award alone when there is nothing to measure it against", async () => {
    // Manual-only patch (no requirement) plus an award pointing at a patch
    // that has since been deleted — neither can be judged, so neither moves.
    await addPatch("citation", null);
    await addMember("m1", {}, 2);
    await award("m1", "citation", "system");
    await award("m1", "deleted-patch", "system");

    const res = await reconcilePatchAwards(ORG);
    expect(res.data!.revoked).toBe(0);
    expect(await heldBy("m1")).toEqual(["citation", "deleted-patch"]);
  });

  it("takes a revoked patch off the cut and leaves the rest of it intact", async () => {
    await addPatch("worn", 2_000, { statKey: "clubRuns" });
    await addMember("m1", { clubRuns: 5 }, 1);
    await award("m1", "worn", "system");
    await orgRef(ORG).collection("cutLayouts").doc("m1").set({
      surfaces: {
        front: [
          { kind: "rankTab", refId: "rank", surface: "front", u: 0.5, v: 0.16, scale: 1, rotationDeg: 0, zIndex: 1, mirrored: false },
        ],
        back: [
          { kind: "patch", refId: "worn", surface: "back", u: 0.3, v: 0.6, scale: 0.8, rotationDeg: 0, zIndex: 1, mirrored: false },
        ],
      },
      updatedAt: Timestamp.now(),
    });

    const res = await reconcilePatchAwards(ORG);
    expect(res.data!.cutsUpdated).toBe(1);

    const cut = (await orgRef(ORG).collection("cutLayouts").doc("m1").get()).data()!;
    expect(cut.surfaces.back).toEqual([]);
    expect(cut.surfaces.front).toHaveLength(1); // rank tab survives
  });

  it("is idempotent — a second run finds nothing", async () => {
    await addPatch("hardened", 2_000, { emblem: true });
    await addMember("m1", { jailTimeMonths: 380 }, 1);
    await award("m1", "hardened", "system");

    await reconcilePatchAwards(ORG);
    const second = await reconcilePatchAwards(ORG);
    expect(second.data!.revoked).toBe(0);
    expect(second.data!.membersAffected).toBe(0);
  });

  it("reports nothing to do on a healthy club", async () => {
    await addPatch("low", 100, { emblem: true });
    await addMember("m1", { jailTimeMonths: 380 }, 1);
    await award("m1", "low", "system");

    expect((await findStaleAwards(ORG)).data).toHaveLength(0);
    expect((await reconcilePatchAwards(ORG)).data!.revoked).toBe(0);
  });
});
