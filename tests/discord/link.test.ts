/**
 * Discord account linking against the Firestore emulator: code minting, the
 * /link handshake, automatic /mystats identification, and /unlink. Isolated
 * project id, so wiping the root users and discordLinkCodes collections here
 * can never touch app data.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "discord-link-test-isolated";
process.env.DISCORD_ORG_ID = "discord-link-test-org";

// Import AFTER env vars so the Admin SDK connects to the emulator.
const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { handleDiscordCommand } = await import("@/lib/discord/interactions");
const { createLinkCode, formatCode } = await import("@/lib/discord/link");

const ORG = "discord-link-test-org";

function cmd(
  name: string,
  options?: { name: string; type: number; value?: string | number | boolean }[],
  user?: { id: string; username?: string },
) {
  return { type: 2, data: { name, options }, member: user ? { user } : undefined };
}

function linkCmd(code: string, user: { id: string; username?: string }) {
  return cmd("link", [{ name: "code", type: 3, value: code }], user);
}

async function wipe(collection: string) {
  const snap = await adminDb.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await wipe("users");
  await wipe("discordLinkCodes");

  const org = orgRef(ORG);
  await org.set({ name: "Link Test MC", slug: ORG, status: "active", memberCount: 1 });
  await org.collection("ranks").doc("president").set({
    name: "President",
    order: 1,
    isOfficer: true,
  });
  await org.collection("members").doc("m1").set({
    uid: "u1",
    displayName: "Marcus Vane",
    roadName: "Reaper",
    rankId: "president",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    stats: { crimesCommitted: 187 },
    patchCount: 3,
    createdAt: Timestamp.now(),
  });
  await adminDb.collection("users").doc("u1").set({
    email: "reaper@test.rp",
    displayName: "Marcus Vane",
    memberships: { [ORG]: { memberId: "m1", role: "member" } },
    createdAt: Timestamp.now(),
  });
  // A second portal account with no membership, for the collision cases.
  await adminDb.collection("users").doc("u2").set({
    email: "other@test.rp",
    displayName: "Somebody Else",
    memberships: {},
    createdAt: Timestamp.now(),
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await wipe("users");
  await wipe("discordLinkCodes");
});

describe("createLinkCode", () => {
  it("mints a code and replaces any previous one", async () => {
    await createLinkCode("u1", ORG);
    const second = await createLinkCode("u1", ORG);

    const codes = await adminDb
      .collection("discordLinkCodes")
      .where("uid", "==", "u1")
      .get();
    expect(codes.size).toBe(1);
    expect(codes.docs[0].id).toBe(second.code);
    expect(second.code).toHaveLength(8);
    expect(second.expiresAtMs).toBeGreaterThan(Date.now());
  });
});

describe("/link", () => {
  it("links through the full handshake, forgiving case and dashes", async () => {
    const { code } = await createLinkCode("u1", ORG);
    const res = await handleDiscordCommand(
      linkCmd(formatCode(code).toLowerCase(), { id: "D1", username: "reaper_rides" }),
    );

    expect(res.data?.content).toContain('"Reaper"');
    expect(res.data?.content).toContain("Link Test MC");

    const user = await adminDb.collection("users").doc("u1").get();
    expect(user.data()?.discordId).toBe("D1");
    expect(user.data()?.discordUsername).toBe("reaper_rides");
    // The code is spent.
    const codeDoc = await adminDb.collection("discordLinkCodes").doc(code).get();
    expect(codeDoc.exists).toBe(false);

    const audits = await orgRef(ORG)
      .collection("auditLogs")
      .where("action", "==", "discord.link")
      .get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0].data().actorUid).toBe("u1");
  });

  it("rejects a spent code", async () => {
    const { code } = await createLinkCode("u1", ORG);
    await handleDiscordCommand(linkCmd(code, { id: "D1" }));
    const res = await handleDiscordCommand(linkCmd(code, { id: "D9" }));
    expect(res.data?.content).toContain("not valid");
  });

  it("rejects an expired code and deletes it", async () => {
    await adminDb.collection("discordLinkCodes").doc("EXPIRED2").set({
      uid: "u1",
      orgId: ORG,
      expiresAt: Timestamp.fromMillis(Date.now() - 1000),
      createdAt: Timestamp.now(),
    });
    const res = await handleDiscordCommand(linkCmd("EXPIRED2", { id: "D1" }));
    expect(res.data?.content).toContain("not valid");
    const doc = await adminDb.collection("discordLinkCodes").doc("EXPIRED2").get();
    expect(doc.exists).toBe(false);
  });

  it("refuses to move a Discord account that is linked elsewhere", async () => {
    await adminDb.collection("users").doc("u2").update({ discordId: "D1" });
    const { code } = await createLinkCode("u1", ORG);
    const res = await handleDiscordCommand(linkCmd(code, { id: "D1" }));

    expect(res.data?.content).toContain("already linked");
    const user = await adminDb.collection("users").doc("u1").get();
    expect(user.data()?.discordId).toBeUndefined();
  });

  it("lets an account relink its own Discord and refresh the username", async () => {
    const first = await createLinkCode("u1", ORG);
    await handleDiscordCommand(linkCmd(first.code, { id: "D1", username: "old_name" }));

    const second = await createLinkCode("u1", ORG);
    const res = await handleDiscordCommand(
      linkCmd(second.code, { id: "D1", username: "new_name" }),
    );
    expect(res.data?.content).toContain("Linked");

    const user = await adminDb.collection("users").doc("u1").get();
    expect(user.data()?.discordId).toBe("D1");
    expect(user.data()?.discordUsername).toBe("new_name");
  });

  it("asks for a code when none is given", async () => {
    const res = await handleDiscordCommand(cmd("link", [], { id: "D1" }));
    expect(res.data?.content).toContain("code");
  });
});

describe("/mystats via the link", () => {
  it("identifies a linked member automatically", async () => {
    const { code } = await createLinkCode("u1", ORG);
    await handleDiscordCommand(linkCmd(code, { id: "D1" }));

    const res = await handleDiscordCommand(cmd("mystats", undefined, { id: "D1" }));
    const content = res.data?.content ?? "";
    expect(content).toContain('"Reaper" Marcus Vane');
    expect(content).toContain("Crimes Committed: 187");
    expect(res.data?.flags).toBe(64);
  });

  it("points an unlinked account at /link", async () => {
    const res = await handleDiscordCommand(cmd("mystats", undefined, { id: "D404" }));
    expect(res.data?.content).toContain("/link");
  });

  it("tells a linked account without a member record what is missing", async () => {
    await adminDb.collection("users").doc("u2").update({ discordId: "D3" });
    const res = await handleDiscordCommand(cmd("mystats", undefined, { id: "D3" }));
    expect(res.data?.content).toContain("no member record");
  });
});

describe("/unlink", () => {
  it("severs the link and is honest the second time", async () => {
    const { code } = await createLinkCode("u1", ORG);
    await handleDiscordCommand(linkCmd(code, { id: "D1" }));

    const first = await handleDiscordCommand(cmd("unlink", undefined, { id: "D1" }));
    expect(first.data?.content).toContain("Unlinked");
    const user = await adminDb.collection("users").doc("u1").get();
    expect(user.data()?.discordId).toBeUndefined();
    expect(user.data()?.discordUsername).toBeUndefined();

    const second = await handleDiscordCommand(cmd("unlink", undefined, { id: "D1" }));
    expect(second.data?.content).toContain("not linked");
  });
});
