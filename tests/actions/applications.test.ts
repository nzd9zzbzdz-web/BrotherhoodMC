/**
 * Recruitment (open application) action tests against the Firestore emulator.
 * Exercises the REAL submitApplication / approveApplication / rejectApplication
 * transaction logic; only the thin edges are mocked:
 *   - next/cache revalidatePath (no request context in tests)
 *   - requireOrgRole (auth gate — covered by rules + session tests already)
 *   - syncUserClaims (claims plumbing — covered by member/invite flows already)
 * Requires emulators running. Uses an isolated project so app data is untouched.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "applications-test-isolated";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  // Actions clear cached reads via updateTag (see src/lib/cache.ts). No Server
  // Action context here, and NODE_ENV!=="production" means nothing is cached
  // in tests anyway — the stub just has to exist.
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

// Controllable auth gate — each test sets `mockAccess` to the approver it wants.
let mockAccess: {
  user: { uid: string };
  role: "admin" | "officer" | "member";
  memberId: string | null;
  isSuper: boolean;
} | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireOrgRole: async () => {
    if (!mockAccess) throw Object.assign(new Error("forbidden"), { name: "AuthError" });
    return mockAccess;
  },
}));

// Claims sync is exercised by member/invite tests; here we assert it's CALLED.
const syncUserClaims = vi.fn(async () => {});
vi.mock("@/lib/auth/claims", () => ({ syncUserClaims }));

// Import AFTER env + mocks so the Admin SDK connects to the emulator.
const { adminDb, adminAuth, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { submitApplication, approveApplication, rejectApplication } = await import(
  "@/actions/applications"
);

const ORG = "apps-test-org";

const APPLICANT_UIDS = [
  "applicant-1",
  "applicant-2",
  "applicant-3",
  "applicant-4",
  "applicant-5",
  "applicant-6",
];

async function resetOrg() {
  await adminDb.recursiveDelete(orgRef(ORG));
  // Approvals create TOP-LEVEL users/{uid} docs (outside the org subtree). The
  // long-lived emulator persists them across runs, so wipe the ones our tests
  // use — otherwise a leftover membership makes approve skip member creation.
  await Promise.all(
    APPLICANT_UIDS.map((uid) => adminDb.collection("users").doc(uid).delete()),
  );
  const org = orgRef(ORG);
  await org.set({
    name: "Apps Test",
    slug: ORG,
    status: "active",
    memberCount: 0,
    lastMemberNumber: 0,
  });
  await org.collection("ranks").doc("rank-hangaround").set({
    name: "Hangaround",
    order: 10,
    isOfficer: false,
  });
}

/** Mock verifyIdToken to authenticate a specific applicant identity. */
function asApplicant(uid: string, email: string) {
  vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValue({ uid, email } as never);
}

async function writePendingApplication(uid: string, email: string, roadName = "Ghost") {
  await orgRef(ORG).collection("applications").doc(uid).set({
    roadName,
    handle: `${roadName.toLowerCase()}#1`,
    email,
    status: "pending",
    createdAt: Timestamp.now(),
  });
}

beforeEach(async () => {
  mockAccess = null;
  syncUserClaims.mockClear();
  vi.restoreAllMocks();
  await resetOrg();
});

afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
});

describe("submitApplication", () => {
  it("creates a pending application from the caller's verified token", async () => {
    asApplicant("applicant-1", "ghost@example.com");
    const res = await submitApplication({
      orgId: ORG,
      idToken: "tok",
      roadName: "Ghost",
      handle: "ghost#1",
    });
    expect(res.ok).toBe(true);
    const snap = await orgRef(ORG).collection("applications").doc("applicant-1").get();
    expect(snap.exists).toBe(true);
    expect(snap.data()?.status).toBe("pending");
    expect(snap.data()?.email).toBe("ghost@example.com");
  });

  it("blocks a second live application from the same account", async () => {
    asApplicant("applicant-1", "ghost@example.com");
    await submitApplication({ orgId: ORG, idToken: "t", roadName: "Ghost", handle: "g#1" });
    const res = await submitApplication({ orgId: ORG, idToken: "t", roadName: "Ghost", handle: "g#1" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already applied/i);
  });

  it("refuses when the org isn't active", async () => {
    await orgRef(ORG).update({ status: "suspended" });
    asApplicant("applicant-2", "x@example.com");
    const res = await submitApplication({ orgId: ORG, idToken: "t", roadName: "X", handle: "x#1" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/isn't accepting/i);
  });
});

describe("approveApplication", () => {
  it("creates a member, grants membership, and syncs claims", async () => {
    await writePendingApplication("applicant-3", "recruit@example.com", "Reaper");
    mockAccess = { user: { uid: "admin-1" }, role: "admin", memberId: "m-admin", isSuper: false };

    const res = await approveApplication({ orgId: ORG, applicationId: "applicant-3", role: "member" });
    expect(res.ok).toBe(true);

    // Member created and linked to the applicant's uid.
    const members = await orgRef(ORG).collection("members").where("uid", "==", "applicant-3").get();
    expect(members.size).toBe(1);
    const member = members.docs[0].data();
    expect(member.rankId).toBe("rank-hangaround");
    expect(member.status).toBe("hangaround");
    expect(member.memberNumber).toBe(1);

    // Membership written + claims synced.
    const user = await adminDb.collection("users").doc("applicant-3").get();
    expect(user.data()?.memberships?.[ORG]?.role).toBe("member");
    expect(syncUserClaims).toHaveBeenCalledWith("applicant-3");

    // Application closed out; org counters advanced.
    const app = await orgRef(ORG).collection("applications").doc("applicant-3").get();
    expect(app.data()?.status).toBe("approved");
    const org = await orgRef(ORG).get();
    expect(org.data()?.memberCount).toBe(1);
    expect(org.data()?.lastMemberNumber).toBe(1);
  });

  it("won't let an officer grant an elevated role", async () => {
    await writePendingApplication("applicant-4", "x@example.com");
    mockAccess = { user: { uid: "off-1" }, role: "officer", memberId: "m-off", isSuper: false };
    const res = await approveApplication({ orgId: ORG, applicationId: "applicant-4", role: "officer" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/only an admin/i);
  });

  it("rejects a double-approval", async () => {
    await writePendingApplication("applicant-5", "x@example.com");
    mockAccess = { user: { uid: "admin-1" }, role: "admin", memberId: "m-admin", isSuper: false };
    const first = await approveApplication({ orgId: ORG, applicationId: "applicant-5", role: "member" });
    expect(first.ok).toBe(true);
    const second = await approveApplication({ orgId: ORG, applicationId: "applicant-5", role: "member" });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already handled/i);
  });
});

describe("rejectApplication", () => {
  it("declines a pending application without granting access", async () => {
    await writePendingApplication("applicant-6", "x@example.com");
    mockAccess = { user: { uid: "off-1" }, role: "officer", memberId: "m-off", isSuper: false };
    const res = await rejectApplication({ orgId: ORG, applicationId: "applicant-6", reason: "no fit" });
    expect(res.ok).toBe(true);
    const app = await orgRef(ORG).collection("applications").doc("applicant-6").get();
    expect(app.data()?.status).toBe("rejected");
    const members = await orgRef(ORG).collection("members").where("uid", "==", "applicant-6").get();
    expect(members.empty).toBe(true);
  });
});
