/**
 * End-to-end for the profile's Service Record: a real rank change written by
 * updateMember, read back through listServiceRecord, composed for the panel.
 *
 * The composer is unit-tested separately; what this pins is the data path —
 * the subcollection ordering and that serverTimestamp() entries resolve to a
 * date by the time the profile reads them.
 *
 * Requires emulators running; isolated project.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "service-record-test-isolated";

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
    memberId: "m-admin",
    isSuper: false,
  }),
}));
vi.mock("@/lib/auth/claims", () => ({ syncUserClaims: async () => {} }));

const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { updateMember } = await import("@/actions/members");
const { listServiceRecord } = await import("@/lib/queries");
const { composeServiceRecord } = await import("@/lib/service-record");
const { DEFAULT_RANKS, rankDocId } = await import("@/lib/constants");
import type { Patch } from "@/lib/types";

const ORG = "service-record-test-org";
const org = orgRef(ORG);
const JOINED = new Date("2026-01-10T12:00:00Z");

beforeEach(async () => {
  await adminDb.recursiveDelete(org);
  await org.set({ name: "Record Test MC", slug: ORG, memberCount: 1 });

  for (const rank of DEFAULT_RANKS) {
    await org.collection("ranks").doc(rankDocId(rank.name)).set({
      name: rank.name,
      order: rank.order,
      isOfficer: rank.isOfficer,
    });
  }
  await org.collection("members").doc("m-rider").set({
    uid: null,
    displayName: "Rider Legal",
    roadName: "Rider",
    rankId: "patched-member",
    status: "patched",
    joinDate: Timestamp.fromDate(JOINED),
    memberNumber: 7,
    stats: {},
    patchCount: 0,
    createdAt: Timestamp.now(),
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(org);
});

describe("service record data path", () => {
  it("is empty for a member nothing has happened to yet", async () => {
    expect(await listServiceRecord(ORG, "m-rider")).toEqual([]);
  });

  it("surfaces a rank change the profile can render", async () => {
    const res = await updateMember({
      orgId: ORG,
      memberId: "m-rider",
      rankId: "head-enforcer",
    });
    expect(res.ok).toBe(true);

    const career = await listServiceRecord(ORG, "m-rider");
    expect(career).toHaveLength(1);
    expect(career[0].title).toBe("Rank changed to Head Enforcer");

    const items = composeServiceRecord({
      memberNumber: 7,
      joinDate: Timestamp.fromDate(JOINED),
      awards: [],
      patchById: new Map<string, Patch>(),
      career,
    });
    // Promotion on top, the join anchoring the bottom — and both dated.
    expect(items.map((i) => i.kind)).toEqual(["promotion", "joined"]);
    expect(items[0].dateISO).not.toBe("");
    expect(items[1].dateISO).toBe(JOINED.toISOString());
  });

  it("orders several changes newest first", async () => {
    await updateMember({ orgId: ORG, memberId: "m-rider", rankId: "enforcer" });
    await updateMember({ orgId: ORG, memberId: "m-rider", rankId: "head-enforcer" });
    await updateMember({
      orgId: ORG,
      memberId: "m-rider",
      rankId: "head-enforcer",
      status: "retired",
    });

    const career = await listServiceRecord(ORG, "m-rider");
    expect(career.map((c) => c.title)).toEqual([
      "Retired",
      "Rank changed to Head Enforcer",
      "Rank changed to Enforcer",
    ]);
    expect(career[0].kind).toBe("removal");
  });
});
