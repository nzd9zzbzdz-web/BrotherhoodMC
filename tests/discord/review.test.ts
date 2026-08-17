/**
 * Officer review buttons, live: the permission chain, the real approval and
 * denial through the shared core, duplicate-click protection, and two
 * officers racing on one ticket. Against the Firestore emulator; isolated
 * project and org.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "discord-review-test-isolated";
process.env.DISCORD_ORG_ID = "discord-review-test-org";

// Import AFTER env vars so the Admin SDK connects to the emulator.
const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { handleComponent } = await import("@/lib/discord/interactions");

const ORG = "discord-review-test-org";

function click(customId: string, user?: { id: string }, messageContent?: string) {
  return {
    type: 3,
    data: { custom_id: customId },
    member: user ? { user } : undefined,
    ...(messageContent ? { message: { content: messageContent } } : {}),
  };
}

async function wipe(collection: string) {
  const snap = await adminDb.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await wipe("users");

  const org = orgRef(ORG);
  await org.set({ name: "Review Test MC", slug: ORG, status: "active", memberCount: 2 });

  await org.collection("members").doc("m1").set({
    uid: "u1",
    displayName: "Marcus Vane",
    roadName: "Reaper",
    rankId: "president",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    stats: { drugSales: 5 },
    patchCount: 0,
    createdAt: Timestamp.now(),
  });
  await org.collection("members").doc("m2").set({
    uid: "u2",
    displayName: "Dana Cross",
    roadName: "Six",
    rankId: "road-captain",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 2,
    stats: {},
    patchCount: 0,
    createdAt: Timestamp.now(),
  });

  // Crossing 20 drug sales earns this patch; the pending ticket does exactly that.
  await org.collection("patches").doc("street-dealer").set({
    name: "Street Dealer",
    category: "activity",
    description: "20 drug sales",
    tier: 1,
    requirement: { statKey: "drugSales", threshold: 20 },
    manual: false,
    active: true,
    defaultPlacement: { surface: "front", u: 0.3, v: 0.4, scale: 0.8, rotationDeg: 0 },
  });

  // D1 is a plain member; D2 is an officer.
  await adminDb.collection("users").doc("u1").set({
    email: "reaper@test.rp",
    displayName: "Marcus Vane",
    memberships: { [ORG]: { memberId: "m1", role: "member" } },
    discordId: "D1",
    createdAt: Timestamp.now(),
  });
  await adminDb.collection("users").doc("u2").set({
    email: "six@test.rp",
    displayName: "Dana Cross",
    memberships: { [ORG]: { memberId: "m2", role: "officer" } },
    discordId: "D2",
    createdAt: Timestamp.now(),
  });

  await org.collection("activities").doc("a1").set({
    memberId: "m1",
    entries: [{ typeId: "drug-sale", statKey: "drugSales", quantity: 20 }],
    date: Timestamp.now(),
    description: "moved product across the docks",
    witnesses: [],
    status: "pending",
    createdAt: Timestamp.now(),
  });
  await org.collection("activities").doc("a2").set({
    memberId: "m1",
    entries: [{ typeId: "drug-sale", statKey: "drugSales", quantity: 1 }],
    date: Timestamp.now(),
    description: "already handled elsewhere",
    witnesses: [],
    status: "approved",
    reviewedBy: "someone",
    createdAt: Timestamp.now(),
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await wipe("users");
});

describe("permission chain", () => {
  it("ignores buttons it did not create", async () => {
    const res = await handleComponent(click("music:play", { id: "D2" }));
    expect(res.data?.content).toBe("Unsupported button.");
    const malformed = await handleComponent(click("review:destroy:a1", { id: "D2" }));
    expect(malformed.data?.content).toBe("Unsupported button.");
  });

  it("turns away an unlinked clicker without writing", async () => {
    const res = await handleComponent(click("review:approve:a1", { id: "D404" }));
    expect(res.data?.content).toContain("/link");
    const activity = await orgRef(ORG).collection("activities").doc("a1").get();
    expect(activity.data()?.status).toBe("pending");
  });

  it("turns away a linked member who is not an officer, without writing", async () => {
    const res = await handleComponent(click("review:approve:a1", { id: "D1" }));
    expect(res.data?.content).toContain("Officers only");
    const activity = await orgRef(ORG).collection("activities").doc("a1").get();
    expect(activity.data()?.status).toBe("pending");
    const member = await orgRef(ORG).collection("members").doc("m1").get();
    expect(member.data()?.stats).toEqual({ drugSales: 5 });
  });
});

describe("live approval", () => {
  it("approves through the engine and stamps the channel message", async () => {
    const res = await handleComponent(
      click("review:approve:a1", { id: "D2" }, "**New ticket** from Reaper"),
    );

    // The channel message is updated in place and its buttons retired.
    expect(res.type).toBe(7);
    expect(res.data?.content).toContain("**New ticket** from Reaper");
    expect(res.data?.content).toContain('✅ **Approved** by "Six" Dana Cross');
    expect(res.data?.content).toContain("Awarded: Street Dealer");
    expect(res.data?.components).toEqual([]);

    const activity = await orgRef(ORG).collection("activities").doc("a1").get();
    expect(activity.data()?.status).toBe("approved");
    expect(activity.data()?.reviewedBy).toBe("u2");

    const member = await orgRef(ORG).collection("members").doc("m1").get();
    expect(member.data()?.stats.drugSales).toBe(25);
    expect(member.data()?.patchCount).toBe(1);

    const award = await orgRef(ORG)
      .collection("awardedPatches")
      .doc("m1_street-dealer")
      .get();
    expect(award.exists).toBe(true);
    expect(award.data()?.awardedBy).toBe("system");

    const audits = await orgRef(ORG)
      .collection("auditLogs")
      .where("action", "==", "activity.approve")
      .get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0].data().actorUid).toBe("u2");
  });

  it("lets an admin through the same gate", async () => {
    await adminDb.collection("users").doc("u2").update({
      [`memberships.${ORG}.role`]: "admin",
    });
    const res = await handleComponent(click("review:approve:a1", { id: "D2" }));
    expect(res.type).toBe(7);
    expect(res.data?.content).toContain("Approved");
  });
});

describe("live denial", () => {
  it("denies without touching stats and stamps the message", async () => {
    const res = await handleComponent(click("review:deny:a1", { id: "D2" }));
    expect(res.type).toBe(7);
    expect(res.data?.content).toContain('⛔ **Denied** by "Six" Dana Cross');
    expect(res.data?.components).toEqual([]);

    const activity = await orgRef(ORG).collection("activities").doc("a1").get();
    expect(activity.data()?.status).toBe("denied");
    expect(activity.data()?.reviewedBy).toBe("u2");

    const member = await orgRef(ORG).collection("members").doc("m1").get();
    expect(member.data()?.stats).toEqual({ drugSales: 5 });
    expect(member.data()?.patchCount).toBe(0);

    const audits = await orgRef(ORG)
      .collection("auditLogs")
      .where("action", "==", "activity.deny")
      .get();
    expect(audits.size).toBe(1);
  });
});

describe("duplicate protection", () => {
  it("reports a ticket that was already reviewed", async () => {
    const res = await handleComponent(click("review:approve:a2", { id: "D2" }));
    expect(res.data?.content).toContain("already approved");
  });

  it("refuses the second decision on the same ticket", async () => {
    await handleComponent(click("review:approve:a1", { id: "D2" }));
    const second = await handleComponent(click("review:deny:a1", { id: "D2" }));
    expect(second.type).toBe(4);
    expect(second.data?.content).toContain("already approved");

    const member = await orgRef(ORG).collection("members").doc("m1").get();
    expect(member.data()?.stats.drugSales).toBe(25); // applied exactly once
  });

  it("reports a ticket that no longer exists", async () => {
    const res = await handleComponent(click("review:approve:ghost", { id: "D2" }));
    expect(res.data?.content).toContain("no longer exists");
  });

  it("settles two simultaneous officer clicks with exactly one approval", async () => {
    const [a, b] = await Promise.all([
      handleComponent(click("review:approve:a1", { id: "D2" })),
      handleComponent(click("review:approve:a1", { id: "D2" })),
    ]);

    // One click lands the decision; the other learns it came second.
    const updates = [a, b].filter((r) => r.type === 7);
    const refusals = [a, b].filter((r) => r.type === 4);
    expect(updates).toHaveLength(1);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].data?.content).toMatch(/already/);

    // The stat moved once, the patch was awarded once, the count bumped once.
    const member = await orgRef(ORG).collection("members").doc("m1").get();
    expect(member.data()?.stats.drugSales).toBe(25);
    expect(member.data()?.patchCount).toBe(1);
    const audits = await orgRef(ORG)
      .collection("auditLogs")
      .where("action", "==", "activity.approve")
      .get();
    expect(audits.size).toBe(1);
  });
});
