/**
 * Saving where a member's render stands on their stage. The pose is written by
 * pointer maths on the client, so the server has to be strict about what lands
 * in Firestore — a NaN or a wild drag would put the figure off-screen for every
 * member viewing the page, with no obvious way to get it back.
 *
 * Requires emulators running; isolated project.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "character-pose-test-isolated";

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
  // The character actions moved to the self-or-role gate when members gained
  // self-service over their own render; without it here every case in this
  // file fails on the mock rather than on the behaviour it is testing.
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
const { saveCharacterPose, removeCharacterRender, uploadCharacterRender } = await import(
  "@/actions/character"
);
const { clampPose } = await import("@/lib/schemas/character");
const { CHARACTER_POSE_LIMITS, DEFAULT_CHARACTER_POSE } = await import(
  "@/lib/constants"
);

const ORG = "character-pose-test-org";
const org = orgRef(ORG);
const L = CHARACTER_POSE_LIMITS;

async function poseOf() {
  const snap = await org.collection("members").doc("m1").get();
  return snap.data()?.characterPose;
}

beforeEach(async () => {
  await adminDb.recursiveDelete(org);
  await org.set({ name: "Pose Test", slug: ORG, memberCount: 1 });
  await org.collection("members").doc("m1").set({
    uid: null,
    displayName: "Test Member",
    roadName: "Testy",
    rankId: "patched",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    stats: {},
    patchCount: 0,
    createdAt: Timestamp.now(),
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(org);
});

describe("character screen permissions", () => {
  it("saving a pose demands admin, not officer", async () => {
    gate.demanded.length = 0;
    await saveCharacterPose({
      orgId: ORG,
      memberId: "m1",
      pose: { x: 10, y: 10, scale: 60 },
    });
    expect(gate.demanded).toEqual(["admin"]);
  });

  it("removing a render demands admin, not officer", async () => {
    gate.demanded.length = 0;
    await removeCharacterRender({ orgId: ORG, memberId: "m1" });
    expect(gate.demanded).toEqual(["admin"]);
  });

  it("uploading a render demands admin, not officer", async () => {
    gate.demanded.length = 0;
    const form = new FormData();
    form.set("orgId", ORG);
    form.set("memberId", "m1");
    form.set("file", new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }));
    await uploadCharacterRender(form);
    // Reached the gate before failing on the bogus image bytes.
    expect(gate.demanded).toEqual(["admin"]);
  });
});

describe("saveCharacterPose", () => {
  it("stores a pose on the member", async () => {
    const res = await saveCharacterPose({
      orgId: ORG,
      memberId: "m1",
      pose: { x: 20, y: 8, scale: 80 },
    });
    expect(res.ok).toBe(true);
    expect(await poseOf()).toEqual({ x: 20, y: 8, scale: 80 });
  });

  it("clamps an overshooting drag to the edge instead of rejecting it", async () => {
    await saveCharacterPose({
      orgId: ORG,
      memberId: "m1",
      pose: { x: 9999, y: -9999, scale: 9999 },
    });
    expect(await poseOf()).toEqual({
      x: L.x.max,
      y: L.y.min,
      scale: L.scale.max,
    });
  });

  it("rejects non-finite values rather than writing them", async () => {
    for (const bad of [NaN, Infinity]) {
      const res = await saveCharacterPose({
        orgId: ORG,
        memberId: "m1",
        pose: { x: bad, y: 10, scale: 60 },
      });
      expect(res.ok).toBe(false);
    }
    expect(await poseOf()).toBeUndefined();
  });

  it("clears the pose so the default applies again", async () => {
    await saveCharacterPose({
      orgId: ORG,
      memberId: "m1",
      pose: { x: 40, y: 20, scale: 90 },
    });
    const res = await saveCharacterPose({ orgId: ORG, memberId: "m1", pose: null });
    expect(res.ok).toBe(true);
    expect(await poseOf()).toBeUndefined();
  });

  it("reports a missing member rather than throwing", async () => {
    const res = await saveCharacterPose({
      orgId: ORG,
      memberId: "nobody",
      pose: DEFAULT_CHARACTER_POSE,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});

describe("clampPose", () => {
  it("rounds to one decimal so drags don't store noise", () => {
    expect(clampPose({ x: 12.3456, y: 7.891, scale: 66.04 })).toEqual({
      x: 12.3,
      y: 7.9,
      scale: 66,
    });
  });

  it("leaves the shipped default untouched", () => {
    expect(clampPose(DEFAULT_CHARACTER_POSE)).toEqual(DEFAULT_CHARACTER_POSE);
  });
});
