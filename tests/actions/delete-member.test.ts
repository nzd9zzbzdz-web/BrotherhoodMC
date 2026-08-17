/**
 * Hard-deleting a member. This is irreversible and touches auth, so the guards
 * matter as much as the cascade: a mistyped confirmation, an admin deleting
 * themselves, or removing the last admin all have to fail closed.
 *
 * Requires emulators running; isolated project.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "delete-member-test-isolated";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  // Actions clear cached reads via updateTag (see src/lib/cache.ts). No Server
  // Action context here, and NODE_ENV!=="production" means nothing is cached
  // in tests anyway — the stub just has to exist.
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));
// The acting admin is "admin-1" / member m-admin throughout.
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
const { deleteMember } = await import("@/actions/members");

const ORG = "delete-member-test-org";
const org = orgRef(ORG);

async function member(id: string, roadName: string, extra: Record<string, unknown> = {}) {
  await org.collection("members").doc(id).set({
    uid: null,
    displayName: `${roadName} Legal`,
    roadName,
    rankId: "patched",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    stats: { clubRuns: 3 },
    patchCount: 1,
    createdAt: Timestamp.now(),
    ...extra,
  });
}

beforeEach(async () => {
  await adminDb.recursiveDelete(org);
  await adminDb.collection("users").doc("victim-uid").delete();
  await adminDb.collection("users").doc("admin-1").delete();
  await org.set({ name: "Delete Test", slug: ORG, memberCount: 2, lastMemberNumber: 2 });
  await member("m-admin", "Chief", { uid: "admin-1" });
  await member("m-victim", "Ghost", { uid: "victim-uid" });

  // Data hanging off the victim, plus a control record that must survive.
  await org.collection("awardedPatches").doc("m-victim_road-warrior").set({
    memberId: "m-victim",
    patchId: "road-warrior",
    awardedAt: Timestamp.now(),
    awardedBy: "system",
  });
  await org.collection("awardedPatches").doc("m-admin_road-warrior").set({
    memberId: "m-admin",
    patchId: "road-warrior",
    awardedAt: Timestamp.now(),
    awardedBy: "system",
  });
  await org.collection("activities").doc("a-victim").set({
    memberId: "m-victim",
    typeId: "club-ride",
    statKey: "clubRuns",
    date: Timestamp.now(),
    description: "a ride",
    quantity: 1,
    witnesses: [],
    status: "approved",
    createdAt: Timestamp.now(),
  });
  await org.collection("cutLayouts").doc("m-victim").set({
    surfaces: { front: [], back: [] },
    updatedAt: Timestamp.now(),
  });
  await org.collection("members").doc("m-victim").collection("notes").doc("n1").set({
    body: "officer only",
    at: Timestamp.now(),
  });

  await adminDb.collection("users").doc("victim-uid").set({
    memberships: { [ORG]: { role: "member", memberId: "m-victim" } },
  });
  await adminDb.collection("users").doc("admin-1").set({
    memberships: { [ORG]: { role: "admin", memberId: "m-admin" } },
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(org);
  await adminDb.collection("users").doc("victim-uid").delete();
  await adminDb.collection("users").doc("admin-1").delete();
});

const ok = () =>
  deleteMember({ orgId: ORG, memberId: "m-victim", confirmRoadName: "Ghost" });

describe("deleteMember guards", () => {
  it("refuses when the typed road name doesn't match", async () => {
    const res = await deleteMember({
      orgId: ORG,
      memberId: "m-victim",
      confirmRoadName: "Gost",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/doesn't match/i);
    expect((await org.collection("members").doc("m-victim").get()).exists).toBe(true);
  });

  it("accepts a case-insensitive confirmation", async () => {
    const res = await deleteMember({
      orgId: ORG,
      memberId: "m-victim",
      confirmRoadName: "  ghost ",
    });
    expect(res.ok).toBe(true);
  });

  it("refuses to delete the acting admin's own record", async () => {
    const res = await deleteMember({
      orgId: ORG,
      memberId: "m-admin",
      confirmRoadName: "Chief",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/your own/i);
    expect((await org.collection("members").doc("m-admin").get()).exists).toBe(true);
  });

  it("refuses to remove the last admin", async () => {
    // Promote the victim to admin and demote nobody: two admins, then one.
    await adminDb.collection("users").doc("victim-uid").set({
      memberships: { [ORG]: { role: "admin", memberId: "m-victim" } },
    });
    await adminDb.collection("users").doc("admin-1").delete(); // only victim is admin now

    const res = await ok();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/last admin/i);
    expect((await org.collection("members").doc("m-victim").get()).exists).toBe(true);
  });

  it("reports a missing member rather than throwing", async () => {
    const res = await deleteMember({
      orgId: ORG,
      memberId: "nobody",
      confirmRoadName: "x",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});

describe("deleteMember cascade", () => {
  it("removes the member and everything keyed to them", async () => {
    expect((await ok()).ok).toBe(true);

    expect((await org.collection("members").doc("m-victim").get()).exists).toBe(false);
    expect(
      (await org.collection("awardedPatches").doc("m-victim_road-warrior").get()).exists,
    ).toBe(false);
    expect((await org.collection("activities").doc("a-victim").get()).exists).toBe(false);
    expect((await org.collection("cutLayouts").doc("m-victim").get()).exists).toBe(false);
    // recursiveDelete takes the subcollections with it.
    const notes = await org
      .collection("members")
      .doc("m-victim")
      .collection("notes")
      .get();
    expect(notes.empty).toBe(true);
  });

  it("leaves other members' records untouched", async () => {
    await ok();
    expect(
      (await org.collection("awardedPatches").doc("m-admin_road-warrior").get()).exists,
    ).toBe(true);
    expect((await org.collection("members").doc("m-admin").get()).exists).toBe(true);
  });

  it("strips the org membership so the account loses portal access", async () => {
    await ok();
    const user = await adminDb.collection("users").doc("victim-uid").get();
    expect(user.data()?.memberships?.[ORG]).toBeUndefined();
  });

  it("clears sponsor pointers instead of leaving them dangling", async () => {
    await member("m-rookie", "Rookie", { sponsorMemberId: "m-victim" });
    await ok();
    const rookie = await org.collection("members").doc("m-rookie").get();
    expect(rookie.exists).toBe(true);
    expect(rookie.data()?.sponsorMemberId).toBeUndefined();
  });

  it("decrements the head count but never recycles the member number", async () => {
    await ok();
    const orgDoc = await org.get();
    expect(orgDoc.data()?.memberCount).toBe(1);
    // lastMemberNumber is monotonic — a new member gets 3, not the freed 1.
    expect(orgDoc.data()?.lastMemberNumber).toBe(2);
  });

  it("writes an audit entry that outlives the member", async () => {
    await ok();
    const logs = await org
      .collection("auditLogs")
      .where("action", "==", "member.delete")
      .get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().detail).toContain("Ghost");
  });
});
