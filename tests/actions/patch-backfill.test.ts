/**
 * Backfill: award what members already qualify for.
 *
 * The engine only evaluates thresholds on activity approval, so this is the
 * only path by which a newly installed emblem or a lowered threshold reaches
 * anyone. It writes awards, so the risks worth pinning are double-awarding,
 * clobbering patchCount, and putting emblems on a cut.
 *
 * Requires emulators running; isolated project.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "backfill-test-isolated";

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
const { backfillPatchAwards } = await import("@/actions/patch-backfill");

const ORG = "backfill-test-org";

async function addPatch(
  id: string,
  statKey: string,
  threshold: number,
  opts: { emblem?: boolean; active?: boolean } = {},
) {
  await orgRef(ORG).collection("patches").doc(id).set({
    name: id,
    category: "activity",
    description: `${threshold} ${statKey}`,
    tier: 1,
    requirement: { statKey, threshold },
    manual: false,
    active: opts.active ?? true,
    ...(opts.emblem ? { emblem: true } : {}),
    defaultPlacement: { surface: "back", u: 0.3, v: 0.6, scale: 0.8, rotationDeg: 0 },
  });
}

async function addMember(id: string, stats: Record<string, number>, patchCount = 0) {
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

async function awardIds(memberId: string): Promise<string[]> {
  const snap = await orgRef(ORG)
    .collection("awardedPatches")
    .where("memberId", "==", memberId)
    .get();
  return snap.docs.map((d) => (d.data() as { patchId: string }).patchId).sort();
}

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await orgRef(ORG).set({ name: "Backfill Test", slug: ORG, memberCount: 0 });
});
afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
});

describe("backfillPatchAwards", () => {
  it("awards every rung a member has already cleared", async () => {
    // The launch case: emblems installed against stats that predate them.
    await addPatch("t1", "drugSales", 100, { emblem: true });
    await addPatch("t2", "drugSales", 500, { emblem: true });
    await addPatch("t3", "drugSales", 1_000, { emblem: true });
    await addMember("m1", { drugSales: 561 });

    const res = await backfillPatchAwards(ORG);
    expect(res.ok).toBe(true);
    expect(res.data!.awardsCreated).toBe(2);
    expect(res.data!.membersAwarded).toBe(1);
    expect(await awardIds("m1")).toEqual(["t1", "t2"]);

    const member = (await orgRef(ORG).collection("members").doc("m1").get()).data()!;
    expect(member.patchCount).toBe(2);
  });

  it("is idempotent — a second run awards nothing", async () => {
    await addPatch("t1", "drugSales", 100, { emblem: true });
    await addMember("m1", { drugSales: 561 });

    await backfillPatchAwards(ORG);
    const second = await backfillPatchAwards(ORG);

    expect(second.data!.awardsCreated).toBe(0);
    expect(second.data!.membersAwarded).toBe(0);
    const member = (await orgRef(ORG).collection("members").doc("m1").get()).data()!;
    expect(member.patchCount).toBe(1); // not double-counted
  });

  it("does not disturb awards a member already holds", async () => {
    await addPatch("t1", "drugSales", 100, { emblem: true });
    await addPatch("t2", "drugSales", 500, { emblem: true });
    await addMember("m1", { drugSales: 561 }, 1);
    await orgRef(ORG).collection("awardedPatches").doc("m1_t1").set({
      memberId: "m1",
      patchId: "t1",
      awardedAt: Timestamp.now(),
      awardedBy: "prez-uid",
      reason: "Hand-granted early.",
    });

    const res = await backfillPatchAwards(ORG);
    expect(res.data!.awardsCreated).toBe(1); // only t2

    const existing = (
      await orgRef(ORG).collection("awardedPatches").doc("m1_t1").get()
    ).data()!;
    expect(existing.awardedBy).toBe("prez-uid"); // untouched
    expect(existing.reason).toBe("Hand-granted early.");
  });

  it("keeps emblems off the cut but places real patches", async () => {
    await addPatch("emblem-1", "drugSales", 100, { emblem: true });
    await addPatch("worn-1", "clubRuns", 10);
    await addMember("m1", { drugSales: 561, clubRuns: 12 });

    const res = await backfillPatchAwards(ORG);
    expect(res.data!.awardsCreated).toBe(2);
    expect(res.data!.cutsUpdated).toBe(1);

    const cut = (await orgRef(ORG).collection("cutLayouts").doc("m1").get()).data()!;
    const worn = [...cut.surfaces.front, ...cut.surfaces.back].map(
      (p: { refId: string }) => p.refId,
    );
    expect(worn).toEqual(["worn-1"]);
  });

  it("never writes a cut for a member who only earned emblems", async () => {
    await addPatch("emblem-1", "drugSales", 100, { emblem: true });
    await addMember("m1", { drugSales: 561 });

    const res = await backfillPatchAwards(ORG);
    expect(res.data!.cutsUpdated).toBe(0);
    expect((await orgRef(ORG).collection("cutLayouts").doc("m1").get()).exists).toBe(false);
  });

  it("skips retired patches and members below the bar", async () => {
    await addPatch("live", "drugSales", 100, { emblem: true });
    await addPatch("retired", "drugSales", 100, { emblem: true, active: false });
    await addMember("m1", { drugSales: 561 });
    await addMember("m2", { drugSales: 40 });

    const res = await backfillPatchAwards(ORG);
    expect(res.data!.membersChecked).toBe(2);
    expect(await awardIds("m1")).toEqual(["live"]);
    expect(await awardIds("m2")).toEqual([]);
  });

  it("never takes an award back when a threshold is raised past it", async () => {
    await addPatch("t1", "drugSales", 100, { emblem: true });
    await addMember("m1", { drugSales: 561 });
    await backfillPatchAwards(ORG);

    await addPatch("t1", "drugSales", 5_000, { emblem: true }); // retuned upward
    const res = await backfillPatchAwards(ORG);

    expect(res.data!.awardsCreated).toBe(0);
    expect(await awardIds("m1")).toEqual(["t1"]); // still held
  });
});
