/**
 * The Discord link Server Actions: gate demanded, code format, unlink write.
 * The full handshake lives in tests/discord/link.test.ts; this file pins the
 * transport wrapper. Requires emulators running; isolated project.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "discord-action-test-isolated";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

const gate = vi.hoisted(() => ({ demanded: [] as string[] }));
vi.mock("@/lib/auth/session", () => ({
  requireOrgRole: async (_orgId: string, minRole = "member") => {
    gate.demanded.push(minRole);
    return {
      user: { uid: "u-act" },
      role: "member" as const,
      memberId: "m-act",
      isSuper: false,
    };
  },
}));

const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { createDiscordLinkCode, unlinkDiscord } = await import("@/actions/discord");

const ORG = "discord-action-test-org";

beforeEach(async () => {
  gate.demanded.length = 0;
  await adminDb.recursiveDelete(orgRef(ORG));
  const codes = await adminDb.collection("discordLinkCodes").get();
  await Promise.all(codes.docs.map((d) => d.ref.delete()));
  await adminDb.collection("users").doc("u-act").set({
    email: "act@test.rp",
    displayName: "Action Tester",
    memberships: { [ORG]: { memberId: "m-act", role: "member" } },
    createdAt: Timestamp.now(),
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await adminDb.collection("users").doc("u-act").delete();
});

describe("createDiscordLinkCode", () => {
  it("mints a formatted code behind the member gate", async () => {
    const res = await createDiscordLinkCode(ORG);
    expect(res.ok).toBe(true);
    expect(res.data?.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(gate.demanded).toContain("member");

    const doc = await adminDb
      .collection("discordLinkCodes")
      .doc(res.data!.code.replace("-", ""))
      .get();
    expect(doc.exists).toBe(true);
    expect(doc.data()?.uid).toBe("u-act");
    expect(doc.data()?.orgId).toBe(ORG);
  });

  it("rejects garbage input before touching auth", async () => {
    const res = await createDiscordLinkCode("");
    expect(res.ok).toBe(false);
    expect(gate.demanded).toHaveLength(0);
  });
});

describe("unlinkDiscord", () => {
  it("clears the link and writes the audit entry", async () => {
    await adminDb.collection("users").doc("u-act").update({
      discordId: "D-act",
      discordUsername: "act_rides",
    });

    const res = await unlinkDiscord(ORG);
    expect(res.ok).toBe(true);

    const user = await adminDb.collection("users").doc("u-act").get();
    expect(user.data()?.discordId).toBeUndefined();
    expect(user.data()?.discordUsername).toBeUndefined();

    const audits = await orgRef(ORG)
      .collection("auditLogs")
      .where("action", "==", "discord.unlink")
      .get();
    expect(audits.size).toBe(1);
  });
});
