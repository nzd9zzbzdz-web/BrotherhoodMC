/**
 * Vest Designer save action against the Firestore emulator. Mocks the thin
 * edges (next/cache, the admin auth gate) and exercises the real validation +
 * write path. Requires emulators running; isolated project.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "vest-test-isolated";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  // Actions clear cached reads via updateTag (see src/lib/cache.ts). No Server
  // Action context here, and NODE_ENV!=="production" means nothing is cached
  // in tests anyway — the stub just has to exist.
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("@/lib/auth/session", () => ({
  requireOrgRole: async () => ({ user: { uid: "admin-1" }, role: "admin", memberId: "m", isSuper: false }),
}));

const { adminDb, orgRef } = await import("@/lib/firebase/admin");
const { saveVestConfig } = await import("@/actions/vest");

import type { PatchCategory } from "@/lib/types";

const ORG = "vest-test-org";
const goodSlots: {
  slot: string;
  u: number;
  v: number;
  maxScale: number;
  accepts: PatchCategory[];
  capacity: number;
}[] = [
  { slot: "LEFT_CHEST", u: 0.3, v: 0.3, maxScale: 0.7, accepts: ["activity"], capacity: 3 },
  { slot: "RIGHT_CHEST", u: 0.7, v: 0.3, maxScale: 0.7, accepts: ["service"], capacity: 3 },
];

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
});
afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
});

describe("saveVestConfig", () => {
  it("writes a valid slot map to the surface doc", async () => {
    const res = await saveVestConfig({ orgId: ORG, surface: "front", slots: goodSlots });
    expect(res.ok).toBe(true);
    const doc = await orgRef(ORG).collection("vestConfigs").doc("front").get();
    expect(doc.data()?.slots).toHaveLength(2);
    expect(doc.data()?.slots[0].slot).toBe("LEFT_CHEST");
  });

  it("rejects coordinates outside [0,1]", async () => {
    const res = await saveVestConfig({
      orgId: ORG,
      surface: "front",
      slots: [{ ...goodSlots[0], u: 1.4 }],
    });
    expect(res.ok).toBe(false);
  });

  it("rejects invalid slot names", async () => {
    const res = await saveVestConfig({
      orgId: ORG,
      surface: "front",
      slots: [{ ...goodSlots[0], slot: "left chest!" }],
    });
    expect(res.ok).toBe(false);
  });

  it("rejects duplicate slot names on a surface", async () => {
    const res = await saveVestConfig({
      orgId: ORG,
      surface: "back",
      slots: [goodSlots[0], { ...goodSlots[1], slot: "LEFT_CHEST" }],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/duplicate/i);
  });
});
