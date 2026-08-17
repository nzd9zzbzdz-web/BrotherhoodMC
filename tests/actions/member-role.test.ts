/**
 * Changing a member's portal role from the member admin. Roles live on
 * users/{uid}, not the member doc, and drive custom claims — so the risks are
 * an org locking itself out of its own admin area, and a demoted admin keeping
 * elevated claims on a live session.
 *
 * Requires emulators running; isolated project.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "member-role-test-isolated";

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
// Claim sync hits Auth; record that it ran for the right uid.
const claims = vi.hoisted(() => ({ synced: [] as string[] }));
vi.mock("@/lib/auth/claims", () => ({
  syncUserClaims: async (uid: string) => {
    claims.synced.push(uid);
  },
}));

const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { updateMember } = await import("@/actions/members");

const ORG = "member-role-test-org";
const org = orgRef(ORG);

async function roleOf(uid: string) {
  const snap = await adminDb.collection("users").doc(uid).get();
  return snap.data()?.memberships?.[ORG]?.role;
}

async function seedMember(id: string, roadName: string, uid: string | null) {
  await org.collection("members").doc(id).set({
    uid,
    displayName: `${roadName} Legal`,
    roadName,
    rankId: "patched",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    stats: {},
    patchCount: 0,
    createdAt: Timestamp.now(),
  });
}

beforeEach(async () => {
  claims.synced.length = 0;
  await adminDb.recursiveDelete(org);
  for (const uid of ["admin-1", "admin-2", "member-uid"]) {
    await adminDb.collection("users").doc(uid).delete();
  }
  await org.set({ name: "Role Test", slug: ORG, memberCount: 3 });

  await seedMember("m-admin", "Chief", "admin-1");
  await seedMember("m-second", "Deputy", "admin-2");
  await seedMember("m-plain", "Rookie", "member-uid");
  await seedMember("m-unlinked", "Ghost", null);

  await adminDb.collection("users").doc("admin-1").set({
    memberships: { [ORG]: { role: "admin", memberId: "m-admin" } },
  });
  await adminDb.collection("users").doc("admin-2").set({
    memberships: { [ORG]: { role: "admin", memberId: "m-second" } },
  });
  await adminDb.collection("users").doc("member-uid").set({
    memberships: { [ORG]: { role: "member", memberId: "m-plain" } },
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(org);
  for (const uid of ["admin-1", "admin-2", "member-uid"]) {
    await adminDb.collection("users").doc(uid).delete();
  }
});

describe("portal role changes", () => {
  it("promotes a member to admin and resyncs their claims", async () => {
    const res = await updateMember({ orgId: ORG, memberId: "m-plain", role: "admin" });
    expect(res.ok).toBe(true);
    expect(await roleOf("member-uid")).toBe("admin");
    // Without this the promoted user keeps stale claims until their session expires.
    expect(claims.synced).toContain("member-uid");
  });

  it("keeps the memberId when rewriting the membership", async () => {
    await updateMember({ orgId: ORG, memberId: "m-plain", role: "officer" });
    const user = await adminDb.collection("users").doc("member-uid").get();
    expect(user.data()?.memberships?.[ORG]).toEqual({
      role: "officer",
      memberId: "m-plain",
    });
  });

  it("demotes an admin while another remains", async () => {
    const res = await updateMember({ orgId: ORG, memberId: "m-second", role: "member" });
    expect(res.ok).toBe(true);
    expect(await roleOf("admin-2")).toBe("member");
  });

  it("refuses to demote the last admin", async () => {
    await updateMember({ orgId: ORG, memberId: "m-second", role: "member" });
    // admin-1 is now the only admin, and is the actor — use a third account.
    await adminDb.collection("users").doc("member-uid").set({
      memberships: { [ORG]: { role: "admin", memberId: "m-plain" } },
    });
    await adminDb.collection("users").doc("admin-1").delete();

    const res = await updateMember({ orgId: ORG, memberId: "m-plain", role: "member" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/last admin/i);
    expect(await roleOf("member-uid")).toBe("admin");
  });

  it("refuses to change the acting admin's own role", async () => {
    const res = await updateMember({ orgId: ORG, memberId: "m-admin", role: "member" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/your own/i);
    expect(await roleOf("admin-1")).toBe("admin");
  });

  it("refuses a role for a member with no account", async () => {
    const res = await updateMember({ orgId: ORG, memberId: "m-unlinked", role: "admin" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no portal account/i);
  });

  it("refuses to grant a role while exiling — access is being removed", async () => {
    const res = await updateMember({
      orgId: ORG,
      memberId: "m-plain",
      role: "admin",
      status: "exiled",
    });
    expect(res.ok).toBe(false);
    expect(await roleOf("member-uid")).toBe("member");
    // The status must not have been applied either.
    const member = await org.collection("members").doc("m-plain").get();
    expect(member.data()?.status).toBe("patched");
  });

  it("treats an unchanged role as a no-op rather than an error", async () => {
    const res = await updateMember({
      orgId: ORG,
      memberId: "m-plain",
      role: "member",
      roadName: "Rookie II",
    });
    expect(res.ok).toBe(true);
    expect(claims.synced).not.toContain("member-uid");
    const member = await org.collection("members").doc("m-plain").get();
    expect(member.data()?.roadName).toBe("Rookie II");
  });

  it("files the change on the member's service record", async () => {
    await updateMember({ orgId: ORG, memberId: "m-plain", role: "admin" });
    const record = await org
      .collection("members")
      .doc("m-plain")
      .collection("serviceRecord")
      .get();
    const entry = record.docs.map((d) => d.data()).find((d) => d.title?.includes("Portal role"));
    expect(entry?.detail).toContain("member");
  });
});
