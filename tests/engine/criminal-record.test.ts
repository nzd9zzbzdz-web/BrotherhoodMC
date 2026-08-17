/**
 * The character screen's Criminal Record is derived from `member.stats`, so an
 * approved log has to be what moves it. These tests pin that wiring: the panel
 * rows must map to real stat keys, the seeded activity types must feed exactly
 * those keys, and approving a log must move the row a member sees.
 *
 * Requires emulators running. Uses an isolated project id.
 */
import { beforeEach, describe, expect, it } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "criminal-record-test-isolated";

const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { approveActivityTx } = await import("@/lib/patch-engine");
const {
  CRIMINAL_ACTIVITY_TYPE_SEEDS,
  CRIMINAL_RECORD_ROWS,
  STAT_LABELS,
  formatDirtyMoney,
} = await import("@/lib/constants");
const { STAT_KEYS } = await import("@/lib/types");

const ORG = "criminal-record-test-org";

async function resetOrg() {
  await adminDb.recursiveDelete(orgRef(ORG));
  const org = orgRef(ORG);
  await org.set({ name: "Criminal Record Test", slug: ORG, memberCount: 1 });
  await org.collection("members").doc("m1").set({
    uid: "test-uid",
    displayName: "Tasha Reyes",
    roadName: "Static",
    rankId: "patched",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    stats: { heistsCompleted: 4, dirtyMoneyEarned: 310_000 },
    patchCount: 0,
    createdAt: Timestamp.now(),
  });
}

/** Queue a pending log the way submitActivity writes one. */
async function submit(typeId: string, statKey: string, quantity: number) {
  const ref = orgRef(ORG).collection("activities").doc();
  await ref.set({
    memberId: "m1",
    typeId,
    statKey,
    date: Timestamp.now(),
    description: "Vangelico job",
    quantity,
    witnesses: [],
    status: "pending",
    createdAt: Timestamp.now(),
  });
  return ref.id;
}

async function statsOf(): Promise<Record<string, number>> {
  const snap = await orgRef(ORG).collection("members").doc("m1").get();
  return (snap.data()?.stats ?? {}) as Record<string, number>;
}

beforeEach(resetOrg);

describe("criminal record wiring", () => {
  it("every panel row maps to a real stat key with a label", () => {
    for (const row of CRIMINAL_RECORD_ROWS) {
      expect(STAT_KEYS).toContain(row.statKey);
      expect(STAT_LABELS[row.statKey]).toBeTruthy();
    }
  });

  it("every panel row is loggable by some seeded activity type", () => {
    const loggable = new Set(CRIMINAL_ACTIVITY_TYPE_SEEDS.map((t) => t.statKey));
    for (const row of CRIMINAL_RECORD_ROWS) {
      expect(loggable).toContain(row.statKey);
    }
  });

  it("approving a log moves the row on the member's profile", async () => {
    const id = await submit("heist-completed", "heistsCompleted", 1);
    const result = await approveActivityTx(ORG, id, "officer-uid");

    expect(result.stats).toEqual([{ statKey: "heistsCompleted", newValue: 5 }]);
    expect((await statsOf()).heistsCompleted).toBe(5);
  });

  it("quantity-bearing rows add the amount, not a submission count", async () => {
    const id = await submit("dirty-money-earned", "dirtyMoneyEarned", 45_000);
    await approveActivityTx(ORG, id, "officer-uid");

    // $310K on the books + a $45K cut = $355K, not "2 submissions".
    expect((await statsOf()).dirtyMoneyEarned).toBe(355_000);
  });

  it("a denied-then-reapproved log cannot double count", async () => {
    const id = await submit("heist-completed", "heistsCompleted", 1);
    await approveActivityTx(ORG, id, "officer-uid");
    await expect(approveActivityTx(ORG, id, "officer-uid")).rejects.toThrow();
    expect((await statsOf()).heistsCompleted).toBe(5);
  });
});

describe("dirty money formatting", () => {
  it("renders the panel string for each magnitude", () => {
    expect(formatDirtyMoney(0)).toBe("$0");
    expect(formatDirtyMoney(950)).toBe("$950");
    expect(formatDirtyMoney(18_000)).toBe("$18K");
    expect(formatDirtyMoney(310_000)).toBe("$310K");
    expect(formatDirtyMoney(1_100_000)).toBe("$1.1M");
    expect(formatDirtyMoney(2_400_000)).toBe("$2.4M");
  });
});
