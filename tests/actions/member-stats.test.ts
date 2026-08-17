/**
 * Hand-corrected stats — the only path that moves a stat DOWN.
 *
 * The guarantees worth pinning are the ones that keep a correction from
 * quietly rewriting a member's standing: the numbers land as typed, the awards
 * hanging off them are re-judged in both directions, a patch taken back comes
 * off the cut, an emblem never touches it, and leadership's manual awards are
 * untouchable.
 *
 * Requires emulators running; isolated project.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "member-stats-test-isolated";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
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
const { saveMemberStats } = await import("@/actions/member-stats");

const ORG = "member-stats-test-org";

async function addPatch(
  id: string,
  threshold: number | null,
  opts: { emblem?: boolean; statKey?: string; active?: boolean } = {},
) {
  await orgRef(ORG).collection("patches").doc(id).set({
    name: id,
    category: "activity",
    description: id,
    tier: 1,
    requirement:
      threshold === null
        ? null
        : { statKey: opts.statKey ?? "heistsCompleted", threshold },
    manual: threshold === null,
    active: opts.active ?? true,
    ...(opts.emblem ? { emblem: true } : {}),
    defaultPlacement: { surface: "back", u: 0.3, v: 0.6, scale: 0.8, rotationDeg: 0 },
  });
}

async function addMember(stats: Record<string, number>, patchCount = 0) {
  await orgRef(ORG).collection("members").doc("m1").set({
    uid: null,
    displayName: "Test Member",
    roadName: "Tester",
    rankId: "patched",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    patchCount,
    stats,
    createdAt: Timestamp.now(),
  });
}

async function award(patchId: string, by: string) {
  await orgRef(ORG).collection("awardedPatches").doc(`m1_${patchId}`).set({
    memberId: "m1",
    patchId,
    awardedAt: Timestamp.now(),
    awardedBy: by,
  });
}

async function readMember() {
  return (await orgRef(ORG).collection("members").doc("m1").get()).data()!;
}

async function heldPatches(): Promise<string[]> {
  const snap = await orgRef(ORG)
    .collection("awardedPatches")
    .where("memberId", "==", "m1")
    .get();
  return snap.docs.map((d) => (d.data() as { patchId: string }).patchId).sort();
}

async function cutRefIds(): Promise<string[]> {
  const snap = await orgRef(ORG).collection("cutLayouts").doc("m1").get();
  if (!snap.exists) return [];
  const layout = snap.data() as {
    surfaces: { front: { refId: string }[]; back: { refId: string }[] };
  };
  return [...layout.surfaces.front, ...layout.surfaces.back]
    .map((p) => p.refId)
    .sort();
}

const correction = (stats: { statKey: string; value: number }[]) =>
  ({
    orgId: ORG,
    memberId: "m1",
    stats,
    reason: "Ticket approved with the wrong amount.",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await orgRef(ORG).set({ name: "Stats Test", slug: ORG, memberCount: 0 });
});
afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
});

describe("saveMemberStats", () => {
  it("writes the corrected value and reports what moved", async () => {
    await addMember({ heistsCompleted: 500, drugSales: 12 });

    const res = await saveMemberStats(
      correction([{ statKey: "heistsCompleted", value: 5 }]),
    );

    expect(res.ok).toBe(true);
    expect(res.data!.changed).toEqual([
      { statKey: "heistsCompleted", label: "Heists Completed", from: 500, to: 5 },
    ]);
    const member = await readMember();
    expect(member.stats.heistsCompleted).toBe(5);
    // Untouched stats survive a dotted-path update.
    expect(member.stats.drugSales).toBe(12);
  });

  it("refuses a correction that changes nothing", async () => {
    await addMember({ heistsCompleted: 5 });

    const res = await saveMemberStats(
      correction([{ statKey: "heistsCompleted", value: 5 }]),
    );

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already on the record/i);
  });

  it("requires a reason", async () => {
    await addMember({ heistsCompleted: 500 });

    const res = await saveMemberStats({
      orgId: ORG,
      memberId: "m1",
      stats: [{ statKey: "heistsCompleted", value: 5 }],
      reason: "",
    });

    expect(res.ok).toBe(false);
    expect((await readMember()).stats.heistsCompleted).toBe(500);
  });

  it("rejects a negative or fractional value", async () => {
    await addMember({ heistsCompleted: 500 });

    expect(
      (await saveMemberStats(correction([{ statKey: "heistsCompleted", value: -1 }])))
        .ok,
    ).toBe(false);
    expect(
      (await saveMemberStats(correction([{ statKey: "heistsCompleted", value: 2.5 }])))
        .ok,
    ).toBe(false);
    expect((await readMember()).stats.heistsCompleted).toBe(500);
  });

  it("takes back a system award the corrected record no longer reaches", async () => {
    await addPatch("big-scores", 100, { emblem: true });
    await addMember({ heistsCompleted: 500 }, 1);
    await award("big-scores", "system");

    const res = await saveMemberStats(
      correction([{ statKey: "heistsCompleted", value: 5 }]),
    );

    expect(res.data!.revoked).toEqual(["big-scores"]);
    expect(await heldPatches()).toEqual([]);
    expect((await readMember()).patchCount).toBe(0);
  });

  it("never takes back a manual award, however far the record falls", async () => {
    await addPatch("citation", 100);
    await addMember({ heistsCompleted: 500 }, 1);
    await award("citation", "prez-uid");

    const res = await saveMemberStats(
      correction([{ statKey: "heistsCompleted", value: 0 }]),
    );

    expect(res.data!.revoked).toEqual([]);
    expect(await heldPatches()).toEqual(["citation"]);
    expect((await readMember()).patchCount).toBe(1);
  });

  it("awards what the corrected record now earns", async () => {
    // The mirror case: a ticket approved with too FEW, corrected upward.
    await addPatch("first-score", 5);
    await addMember({ heistsCompleted: 1 }, 0);

    const res = await saveMemberStats(
      correction([{ statKey: "heistsCompleted", value: 9 }]),
    );

    expect(res.data!.granted).toEqual(["first-score"]);
    expect(await heldPatches()).toEqual(["first-score"]);
    expect((await readMember()).patchCount).toBe(1);
    // Worn, so it takes a place on the cut.
    expect(await cutRefIds()).toEqual(["first-score"]);
  });

  it("does not hand out an inactive patch, but can still take one back", async () => {
    await addPatch("retired-patch", 100, { active: false });
    await addPatch("retired-held", 100, { active: false, statKey: "drugSales" });
    await addMember({ heistsCompleted: 0, drugSales: 500 }, 1);
    await award("retired-held", "system");

    const res = await saveMemberStats(
      correction([
        { statKey: "heistsCompleted", value: 900 },
        { statKey: "drugSales", value: 5 },
      ]),
    );

    expect(res.data!.granted).toEqual([]);
    expect(res.data!.revoked).toEqual(["retired-held"]);
    expect(await heldPatches()).toEqual([]);
  });

  it("keeps a revoked patch off the cut and leaves the rest of it intact", async () => {
    await addPatch("worn", 100);
    await addMember({ heistsCompleted: 500 }, 1);
    await award("worn", "system");
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

    await saveMemberStats(correction([{ statKey: "heistsCompleted", value: 5 }]));

    expect(await cutRefIds()).toEqual(["rank"]); // rank tab survives
  });

  it("never places an emblem on the cut", async () => {
    await addPatch("rung-one", 5, { emblem: true });
    await addMember({ heistsCompleted: 0 }, 0);

    const res = await saveMemberStats(
      correction([{ statKey: "heistsCompleted", value: 40 }]),
    );

    expect(res.data!.granted).toEqual(["rung-one"]);
    expect(await heldPatches()).toEqual(["rung-one"]);
    // No cut document at all: an emblem-only correction never opens it.
    expect(await cutRefIds()).toEqual([]);
  });

  it("judges every patch against the whole corrected sheet, not just the moved rows", async () => {
    // Two stats corrected in one save, one up and one down.
    await addPatch("heist-rung", 10, { statKey: "heistsCompleted" });
    await addPatch("sales-rung", 1_000, { statKey: "drugSales", emblem: true });
    await addMember({ heistsCompleted: 2, drugSales: 5_000 }, 1);
    await award("sales-rung", "system");

    const res = await saveMemberStats(
      correction([
        { statKey: "heistsCompleted", value: 40 },
        { statKey: "drugSales", value: 50 },
      ]),
    );

    expect(res.data!.granted).toEqual(["heist-rung"]);
    expect(res.data!.revoked).toEqual(["sales-rung"]);
    expect(await heldPatches()).toEqual(["heist-rung"]);
    expect((await readMember()).patchCount).toBe(1);
  });

  it("logs the before and after with the reason", async () => {
    await addMember({ heistsCompleted: 500 });

    await saveMemberStats(correction([{ statKey: "heistsCompleted", value: 5 }]));

    const logs = await orgRef(ORG)
      .collection("auditLogs")
      .where("action", "==", "member.stats")
      .get();
    expect(logs.size).toBe(1);
    const detail = logs.docs[0].data().detail as string;
    expect(detail).toContain("Heists Completed 500");
    expect(detail).toContain("5");
    expect(detail).toContain("Ticket approved with the wrong amount.");
  });
});
