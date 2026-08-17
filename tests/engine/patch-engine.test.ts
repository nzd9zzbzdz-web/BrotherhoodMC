/**
 * Patch engine tests against the Firestore emulator (Admin SDK).
 * Requires emulators running. Uses an isolated org so app data is untouched.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Isolated project id — the emulator keys datastores by project, so engine
// tests can never touch the app's seeded demo data.
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "engine-test-isolated";

// Import AFTER env vars so the Admin SDK connects to the emulator.
const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { approveActivityTx, manualAwardTx, EngineError } = await import(
  "@/lib/patch-engine"
);

const ORG = "engine-test-org";

async function resetOrg() {
  await adminDb.recursiveDelete(orgRef(ORG));
  const org = orgRef(ORG);
  await org.set({ name: "Engine Test", slug: ORG, memberCount: 1 });
  await org.collection("patches").doc("test-patch").set({
    name: "Test Patch",
    category: "activity",
    description: "10 club runs",
    tier: 1,
    requirement: { statKey: "clubRuns", threshold: 10 },
    manual: false,
    active: true,
    defaultPlacement: { surface: "front", u: 0.3, v: 0.4, scale: 0.8, rotationDeg: 0 },
  });
  await org.collection("patches").doc("manual-patch").set({
    name: "Manual Patch",
    category: "legendary",
    description: "Manual only",
    tier: 4,
    requirement: null,
    manual: true,
    active: true,
    defaultPlacement: { surface: "back", u: 0.5, v: 0.5, scale: 1, rotationDeg: 0 },
  });
  // A three-rung emblem ladder on one stat — enough to prove emblems are
  // awarded but never worn, without restating all five tiers the real
  // criminal-record ladders ship with.
  const ladder = [
    { id: "rung-1", threshold: 5 },
    { id: "rung-2", threshold: 10 },
    { id: "rung-3", threshold: 50 },
  ];
  for (const [i, rung] of ladder.entries()) {
    await org.collection("patches").doc(rung.id).set({
      name: `Rung ${i + 1}`,
      category: "activity",
      description: `${rung.threshold} heists`,
      tier: i + 1,
      requirement: { statKey: "heistsCompleted", threshold: rung.threshold },
      manual: false,
      active: true,
      emblem: true,
      defaultPlacement: { surface: "back", u: 0.7, v: 0.72, scale: 0.8, rotationDeg: 0 },
    });
  }
  await org.collection("members").doc("m1").set({
    uid: "test-uid",
    displayName: "Test Member",
    roadName: "Testy",
    rankId: "prospect",
    status: "prospect",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    stats: { clubRuns: 9 },
    patchCount: 0,
    createdAt: Timestamp.now(),
  });
  // Deliberately the pre-multi-select shape (top-level typeId/statKey/quantity,
  // no entries array) — every test that approves a1 is back-compat coverage.
  await org.collection("activities").doc("a1").set({
    memberId: "m1",
    typeId: "club-ride",
    statKey: "clubRuns",
    date: Timestamp.now(),
    description: "test ride",
    quantity: 1,
    witnesses: [],
    status: "pending",
    createdAt: Timestamp.now(),
  });
}

beforeAll(resetOrg);
beforeEach(resetOrg);

afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
});

describe("approveActivityTx", () => {
  it("increments the stat and flips status to approved", async () => {
    const result = await approveActivityTx(ORG, "a1", "reviewer-uid");
    expect(result.stats).toEqual([{ statKey: "clubRuns", newValue: 10 }]);

    const activity = await orgRef(ORG).collection("activities").doc("a1").get();
    expect(activity.data()?.status).toBe("approved");
    const member = await orgRef(ORG).collection("members").doc("m1").get();
    expect(member.data()?.stats.clubRuns).toBe(10);
  });

  it("awards the patch exactly when the threshold is crossed", async () => {
    const result = await approveActivityTx(ORG, "a1", "reviewer-uid");
    expect(result.awardedPatchIds).toEqual(["test-patch"]);

    const award = await orgRef(ORG)
      .collection("awardedPatches")
      .doc("m1_test-patch")
      .get();
    expect(award.exists).toBe(true);
    expect(award.data()?.awardedBy).toBe("system");

    const member = await orgRef(ORG).collection("members").doc("m1").get();
    expect(member.data()?.patchCount).toBe(1);
  });

  it("places the awarded patch on the member's cut", async () => {
    await approveActivityTx(ORG, "a1", "reviewer-uid");
    const cut = await orgRef(ORG).collection("cutLayouts").doc("m1").get();
    const front = cut.data()?.surfaces.front ?? [];
    expect(front.some((p: { refId: string }) => p.refId === "test-patch")).toBe(true);
  });

  it("rejects re-approval of an already-reviewed activity", async () => {
    await approveActivityTx(ORG, "a1", "reviewer-uid");
    await expect(approveActivityTx(ORG, "a1", "reviewer-uid")).rejects.toThrowError(
      EngineError,
    );
  });

  it("does not award below the threshold", async () => {
    await orgRef(ORG).collection("members").doc("m1").update({ "stats.clubRuns": 3 });
    const result = await approveActivityTx(ORG, "a1", "reviewer-uid");
    expect(result.stats).toEqual([{ statKey: "clubRuns", newValue: 4 }]);
    expect(result.awardedPatchIds).toEqual([]);
  });

  it("applies every entry of a multi-type ticket in one approval", async () => {
    await orgRef(ORG).collection("activities").doc("multi").set({
      memberId: "m1",
      entries: [
        { typeId: "club-ride", statKey: "clubRuns", quantity: 1 },
        { typeId: "heist-completed", statKey: "heistsCompleted", quantity: 12 },
      ],
      date: Timestamp.now(),
      description: "big night",
      witnesses: [],
      status: "pending",
      createdAt: Timestamp.now(),
    });
    const result = await approveActivityTx(ORG, "multi", "reviewer-uid");

    const byKey = Object.fromEntries(result.stats.map((s) => [s.statKey, s.newValue]));
    expect(byKey).toEqual({ clubRuns: 10, heistsCompleted: 12 });
    // Awards span both stats: the worn clubRuns patch plus two emblem rungs.
    expect(result.awardedPatchIds.sort()).toEqual(["rung-1", "rung-2", "test-patch"]);

    const member = await orgRef(ORG).collection("members").doc("m1").get();
    expect(member.data()?.stats).toEqual({ clubRuns: 10, heistsCompleted: 12 });
    expect(member.data()?.patchCount).toBe(3);
  });

  it("aggregates entries that feed the same stat", async () => {
    await orgRef(ORG).collection("activities").doc("same-stat").set({
      memberId: "m1",
      entries: [
        { typeId: "heist-completed", statKey: "heistsCompleted", quantity: 3 },
        { typeId: "bank-job", statKey: "heistsCompleted", quantity: 4 },
      ],
      date: Timestamp.now(),
      description: "double header",
      witnesses: [],
      status: "pending",
      createdAt: Timestamp.now(),
    });
    const result = await approveActivityTx(ORG, "same-stat", "reviewer-uid");
    expect(result.stats).toEqual([{ statKey: "heistsCompleted", newValue: 7 }]);
    expect(result.awardedPatchIds).toEqual(["rung-1"]); // 7 clears only the 5 rung
  });

  it("never double-awards (composite id idempotency)", async () => {
    // Pre-award the patch, then cross the threshold again via approval.
    await orgRef(ORG).collection("awardedPatches").doc("m1_test-patch").set({
      memberId: "m1",
      patchId: "test-patch",
      awardedAt: Timestamp.now(),
      awardedBy: "system",
    });
    const result = await approveActivityTx(ORG, "a1", "reviewer-uid");
    expect(result.awardedPatchIds).toEqual([]); // already held ⇒ no re-award

    const member = await orgRef(ORG).collection("members").doc("m1").get();
    expect(member.data()?.patchCount).toBe(0); // count not double-bumped
  });
});

describe("emblems", () => {
  /** refIds of patches currently placed on a surface of m1's cut. */
  async function wornOn(surface: "front" | "back"): Promise<string[]> {
    const cut = await orgRef(ORG).collection("cutLayouts").doc("m1").get();
    return (cut.data()?.surfaces?.[surface] ?? [])
      .filter((p: { kind: string }) => p.kind === "patch")
      .map((p: { refId: string }) => p.refId);
  }

  async function logHeists(id: string, quantity: number) {
    await orgRef(ORG).collection("activities").doc(id).set({
      memberId: "m1",
      typeId: "heist-completed",
      statKey: "heistsCompleted",
      date: Timestamp.now(),
      description: "test heist",
      quantity,
      witnesses: [],
      status: "pending",
      createdAt: Timestamp.now(),
    });
    return approveActivityTx(ORG, id, "reviewer-uid");
  }

  it("awards every rung crossed and wears none of them", async () => {
    const result = await logHeists("h1", 12); // clears rungs 1 and 2 at once
    expect(result.awardedPatchIds.sort()).toEqual(["rung-1", "rung-2"]);

    // Both awards are real — they just never reach the vest.
    for (const id of ["rung-1", "rung-2"]) {
      const award = await orgRef(ORG).collection("awardedPatches").doc(`m1_${id}`).get();
      expect(award.exists).toBe(true);
    }
    expect(await wornOn("back")).toEqual([]);
    const member = await orgRef(ORG).collection("members").doc("m1").get();
    expect(member.data()?.patchCount).toBe(2); // still counted as earned
  });

  it("never creates a cut for a member who has only earned emblems", async () => {
    await logHeists("h1", 12);
    const cut = await orgRef(ORG).collection("cutLayouts").doc("m1").get();
    expect(cut.exists).toBe(false);
  });

  it("still places patches that are not emblems", async () => {
    await approveActivityTx(ORG, "a1", "reviewer-uid"); // clubRuns patch, front
    await logHeists("h1", 12);
    expect(await wornOn("front")).toEqual(["test-patch"]);
    expect(await wornOn("back")).toEqual([]);
  });

  it("does not wear a hand-granted emblem either", async () => {
    const awarded = await manualAwardTx(ORG, "m1", "rung-3", "prez-uid", "Earned it.");
    expect(awarded).toBe(true);

    const award = await orgRef(ORG).collection("awardedPatches").doc("m1_rung-3").get();
    expect(award.data()?.reason).toBe("Earned it.");
    expect(await wornOn("back")).toEqual([]);
  });
});

describe("manualAwardTx", () => {
  it("awards a manual patch with reason", async () => {
    const awarded = await manualAwardTx(ORG, "m1", "manual-patch", "prez-uid", "Held the line.");
    expect(awarded).toBe(true);

    const award = await orgRef(ORG)
      .collection("awardedPatches")
      .doc("m1_manual-patch")
      .get();
    expect(award.data()?.awardedBy).toBe("prez-uid");
    expect(award.data()?.reason).toBe("Held the line.");
  });

  it("returns false when the member already holds it", async () => {
    await manualAwardTx(ORG, "m1", "manual-patch", "prez-uid", "First.");
    const second = await manualAwardTx(ORG, "m1", "manual-patch", "prez-uid", "Again?");
    expect(second).toBe(false);
  });
});
