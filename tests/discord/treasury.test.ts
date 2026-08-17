/**
 * The club bank over Discord: /bank, the money-ticket commands, and the
 * treasury Approve/Deny buttons with their narrower permission gate (admins
 * and the Treasurer seat, NOT every officer). Against the Firestore emulator;
 * isolated project and org.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "discord-treasury-test-isolated";
process.env.DISCORD_ORG_ID = "discord-treasury-test-org";

// Import AFTER env vars so the Admin SDK connects to the emulator.
const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { handleDiscordCommand, handleComponent } = await import(
  "@/lib/discord/interactions"
);

const ORG = "discord-treasury-test-org";

function command(
  name: string,
  options: { name: string; type: number; value: string | number }[],
  user: { id: string },
) {
  return { type: 2, data: { name, options }, member: { user } };
}

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

/** The clean book. Pre-split cases here seed only `balance`, which is exactly
 *  the shape a club that banked money before the split still has. */
async function balance(): Promise<number> {
  const snap = await orgRef(ORG).collection("treasury").doc("account").get();
  const data = snap.data();
  return Number(data?.clean ?? data?.balance ?? 0);
}

async function dirtyBalance(): Promise<number> {
  const snap = await orgRef(ORG).collection("treasury").doc("account").get();
  return Number(snap.data()?.dirty ?? 0);
}

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await wipe("users");

  const org = orgRef(ORG);
  await org.set({ name: "Treasury Test MC", slug: ORG, status: "active", memberCount: 3 });

  // m1: plain member · m2: OFFICER but not treasurer · m3: member in the
  // Treasurer seat. The officer is the interesting case: activity review
  // admits them, the bank must not.
  await org.collection("members").doc("m1").set({
    uid: "u1",
    displayName: "Marcus Vane",
    roadName: "Reaper",
    rankId: "patched-member",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    stats: {},
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
  await org.collection("members").doc("m3").set({
    uid: "u3",
    displayName: "Vera Ledger",
    roadName: "Ledger",
    rankId: "treasurer",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 3,
    stats: {},
    patchCount: 0,
    createdAt: Timestamp.now(),
  });

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
  await adminDb.collection("users").doc("u3").set({
    email: "ledger@test.rp",
    displayName: "Vera Ledger",
    memberships: { [ORG]: { memberId: "m3", role: "member" } },
    discordId: "D3",
    createdAt: Timestamp.now(),
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await wipe("users");
});

describe("money-ticket commands", () => {
  it("/dues files a pending movement for the caller", async () => {
    const res = await handleDiscordCommand(
      command(
        "dues",
        [
          { name: "amount", type: 4, value: 500 },
          { name: "book", type: 3, value: "clean" },
        ],
        { id: "D1" },
      ),
    );
    expect(res.data?.content).toContain("Dues payment filed");
    expect(res.data?.content).toContain("$500");
    expect(res.data?.content).toContain("clean book");

    const txs = await orgRef(ORG).collection("treasuryTransactions").get();
    expect(txs.size).toBe(1);
    expect(txs.docs[0].data()).toMatchObject({
      kind: "dues",
      amount: 500,
      book: "clean",
      memberId: "m1",
      submittedByUid: "u1",
      status: "pending",
    });
    expect(await balance()).toBe(0); // filing never moves money
  });

  it("/dues takes dirty money when the caller says so", async () => {
    const res = await handleDiscordCommand(
      command(
        "dues",
        [
          { name: "amount", type: 4, value: 500 },
          { name: "book", type: 3, value: "dirty" },
        ],
        { id: "D1" },
      ),
    );
    expect(res.data?.content).toContain("dirty book");
    const txs = await orgRef(ORG).collection("treasuryTransactions").get();
    expect(txs.docs[0].data()?.book).toBe("dirty");
  });

  it("files clean when the book option is missing entirely", async () => {
    // `book` is a required option, so Discord should never send this. The
    // handler still has to land somewhere sane rather than throw.
    const res = await handleDiscordCommand(
      command("dues", [{ name: "amount", type: 4, value: 500 }], { id: "D1" }),
    );
    expect(res.data?.content).toContain("Dues payment filed");
    const txs = await orgRef(ORG).collection("treasuryTransactions").get();
    expect(txs.docs[0].data()?.book).toBe("clean");
  });

  it("/withdraw requires a real note", async () => {
    const res = await handleDiscordCommand(
      command(
        "withdraw",
        [
          { name: "amount", type: 4, value: 100 },
          { name: "note", type: 3, value: "  " },
        ],
        { id: "D1" },
      ),
    );
    expect(res.data?.content).toContain("what the money is for");
    expect((await orgRef(ORG).collection("treasuryTransactions").get()).size).toBe(0);
  });

  it("/deposit files with its note", async () => {
    const res = await handleDiscordCommand(
      command(
        "deposit",
        [
          { name: "amount", type: 4, value: 2000 },
          { name: "book", type: 3, value: "dirty" },
          { name: "note", type: 3, value: "docks cut" },
        ],
        { id: "D2" },
      ),
    );
    expect(res.data?.content).toContain("Deposit logged");
    const txs = await orgRef(ORG).collection("treasuryTransactions").get();
    expect(txs.docs[0].data()).toMatchObject({
      kind: "deposit",
      amount: 2000,
      book: "dirty",
      note: "docks cut",
      memberId: "m2",
    });
  });

  it("turns away an unlinked caller", async () => {
    const res = await handleDiscordCommand(
      command("dues", [{ name: "amount", type: 4, value: 500 }], { id: "D404" }),
    );
    expect(res.data?.content).toContain("/link");
  });
});

describe("/bank", () => {
  it("shows both books, dues status, and recent movements", async () => {
    // Seeded in the PRE-SPLIT shape: /bank has to read it as clean money.
    await orgRef(ORG)
      .collection("treasury")
      .doc("account")
      .set({ balance: 12_500, updatedAt: Timestamp.now() });
    await orgRef(ORG).collection("treasuryTransactions").doc("t1").set({
      kind: "deposit",
      amount: 2_000,
      memberId: "m2",
      submittedByUid: "u2",
      note: "docks cut",
      status: "approved",
      createdAt: Timestamp.now(),
      reviewedBy: "u3",
      reviewedAt: Timestamp.now(),
      balanceAfter: 12_500,
    });
    await orgRef(ORG).collection("members").doc("m1").update({
      lastDuesPaidAt: Timestamp.now(),
    });

    const res = await handleDiscordCommand(command("bank", [], { id: "D1" }));
    const content = res.data?.content ?? "";
    expect(content).toContain("Clean: **$12,500**");
    expect(content).toContain("Dirty: **$0**");
    expect(content).toContain("Both books: $12,500");
    expect(content).toContain("Dues this month: 1 of 3 paid");
    expect(content).toContain("+$2,000");
    expect(content).toContain('"Six"');
    expect(content).toContain("docks cut");
    expect(res.data?.flags).toBe(64); // ephemeral: the bank is club business
  });

  it("tags each ledger row with the book it moved", async () => {
    await orgRef(ORG)
      .collection("treasury")
      .doc("account")
      .set({ clean: 100, dirty: 900, updatedAt: Timestamp.now() });
    await orgRef(ORG).collection("treasuryTransactions").doc("t1").set({
      kind: "deposit",
      amount: 900,
      book: "dirty",
      memberId: "m2",
      submittedByUid: "u2",
      note: "docks cut",
      status: "approved",
      createdAt: Timestamp.now(),
      reviewedBy: "u3",
      reviewedAt: Timestamp.now(),
      balanceAfter: 900,
    });

    const content =
      (await handleDiscordCommand(command("bank", [], { id: "D1" }))).data?.content ?? "";
    expect(content).toContain("Clean: **$100** · Dirty: **$900**");
    expect(content).toContain("+$900 dirty");
  });
});

describe("treasury buttons", () => {
  beforeEach(async () => {
    await orgRef(ORG)
      .collection("treasury")
      .doc("account")
      .set({ balance: 1_000, updatedAt: Timestamp.now() });
    await orgRef(ORG).collection("treasuryTransactions").doc("t1").set({
      kind: "dues",
      amount: 500,
      memberId: "m1",
      submittedByUid: "u1",
      note: "",
      status: "pending",
      createdAt: Timestamp.now(),
    });
  });

  it("turns away a plain member without writing", async () => {
    const res = await handleComponent(click(`treasury:approve:${ORG}:t1`, { id: "D1" }));
    expect(res.data?.content).toContain("admin or the Treasurer");
    const tx = await orgRef(ORG).collection("treasuryTransactions").doc("t1").get();
    expect(tx.data()?.status).toBe("pending");
    expect(await balance()).toBe(1_000);
  });

  it("turns away an OFFICER: the bank gate is narrower than the ticket gate", async () => {
    const res = await handleComponent(click(`treasury:approve:${ORG}:t1`, { id: "D2" }));
    expect(res.data?.content).toContain("admin or the Treasurer");
    expect(await balance()).toBe(1_000);
  });

  it("lets the Treasurer seat approve: balance moves, message stamped", async () => {
    const res = await handleComponent(
      click(`treasury:approve:${ORG}:t1`, { id: "D3" }, "**Dues payment** of $500"),
    );

    expect(res.type).toBe(7); // message updated in place
    expect(res.data?.content).toContain("**Dues payment** of $500");
    expect(res.data?.content).toContain('✅ **Approved** by "Ledger" Vera Ledger');
    expect(res.data?.content).toContain("clean book $1,500");
    expect(res.data?.components).toEqual([]);

    expect(await balance()).toBe(1_500);
    const tx = await orgRef(ORG).collection("treasuryTransactions").doc("t1").get();
    expect(tx.data()).toMatchObject({ status: "approved", reviewedBy: "u3", balanceAfter: 1_500 });

    // Dues stamp the payer.
    const member = await orgRef(ORG).collection("members").doc("m1").get();
    expect(member.data()?.lastDuesPaidAt).toBeTruthy();
  });

  it("lets an admin through the same gate", async () => {
    await adminDb.collection("users").doc("u2").update({
      [`memberships.${ORG}.role`]: "admin",
    });
    const res = await handleComponent(click(`treasury:approve:${ORG}:t1`, { id: "D2" }));
    expect(res.type).toBe(7);
    expect(await balance()).toBe(1_500);
  });

  it("denies without touching the balance", async () => {
    const res = await handleComponent(click(`treasury:deny:${ORG}:t1`, { id: "D3" }));
    expect(res.type).toBe(7);
    expect(res.data?.content).toContain('⛔ **Denied** by "Ledger" Vera Ledger');
    expect(await balance()).toBe(1_000);
    const tx = await orgRef(ORG).collection("treasuryTransactions").doc("t1").get();
    expect(tx.data()?.status).toBe("denied");
  });

  it("refuses a withdrawal the bank cannot cover", async () => {
    await orgRef(ORG).collection("treasuryTransactions").doc("t2").set({
      kind: "withdrawal",
      amount: 5_000,
      memberId: "m1",
      submittedByUid: "u1",
      note: "war chest",
      status: "pending",
      createdAt: Timestamp.now(),
    });
    const res = await handleComponent(click(`treasury:approve:${ORG}:t2`, { id: "D3" }));
    expect(res.data?.content).toContain("The clean book holds $1,000");
    const tx = await orgRef(ORG).collection("treasuryTransactions").doc("t2").get();
    expect(tx.data()?.status).toBe("pending"); // approvable later, after a deposit
    expect(await balance()).toBe(1_000);
  });

  it("approves a dirty movement onto the dirty book alone", async () => {
    await orgRef(ORG).collection("treasuryTransactions").doc("t3").set({
      kind: "deposit",
      amount: 750,
      book: "dirty",
      memberId: "m1",
      submittedByUid: "u1",
      note: "docks job",
      status: "pending",
      createdAt: Timestamp.now(),
    });
    const res = await handleComponent(click(`treasury:approve:${ORG}:t3`, { id: "D3" }));
    expect(res.data?.content).toContain("dirty book $750");
    // The clean book was seeded at $1,000 and must not have moved.
    expect(await balance()).toBe(1_000);
    expect(await dirtyBalance()).toBe(750);
  });

  it("refuses a dirty withdrawal the clean book could have covered", async () => {
    await orgRef(ORG).collection("treasuryTransactions").doc("t4").set({
      kind: "withdrawal",
      amount: 200,
      book: "dirty",
      memberId: "m1",
      submittedByUid: "u1",
      note: "payoff",
      status: "pending",
      createdAt: Timestamp.now(),
    });
    const res = await handleComponent(click(`treasury:approve:${ORG}:t4`, { id: "D3" }));
    expect(res.data?.content).toContain("The dirty book holds $0");
    expect(await balance()).toBe(1_000); // untouched, not raided
  });

  it("reports a movement that was already ruled on", async () => {
    await handleComponent(click(`treasury:approve:${ORG}:t1`, { id: "D3" }));
    const second = await handleComponent(click(`treasury:deny:${ORG}:t1`, { id: "D3" }));
    expect(second.type).toBe(4);
    expect(second.data?.content).toContain("already");
    expect(await balance()).toBe(1_500); // applied exactly once
  });

  it("ignores malformed treasury buttons", async () => {
    const res = await handleComponent(click("treasury:destroy:t1", { id: "D3" }));
    expect(res.data?.content).toBe("Unsupported button.");
  });
});
