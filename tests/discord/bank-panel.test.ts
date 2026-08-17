/**
 * The in-channel Club Bank card: its payload shape, the dropdown that opens
 * each form, and the form submission filing a real pending movement.
 *
 * The card carries a live balance, so the shape tests pin that the number is
 * actually rendered (a card that silently drops it would read as $0 to the
 * whole channel). Against the Firestore emulator; isolated project and org.
 *
 * The dropdown carries the BOOK as well as the kind, and the form id carries
 * it onward. Cards posted before the books split are still live messages in
 * real channels, so the two-part id they emit has to keep working: the
 * `form()` helper below leaves the book off unless a case asks for it, which
 * makes most of this file that regression test.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "discord-bankpanel-test-isolated";
process.env.DISCORD_ORG_ID = "discord-bankpanel-test-org";

const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { handleComponent, handleModalSubmit } = await import(
  "@/lib/discord/interactions"
);
const {
  buildBankPanelMessage,
  buildBankModal,
  isTxKind,
  parseBankChoice,
  BANK_ACTIONS,
} = await import("@/lib/discord/bank-panel");

const ORG = "discord-bankpanel-test-org";

function select(orgId: string, value: string, user: { id: string }) {
  return {
    type: 3,
    data: { custom_id: `bank:${orgId}`, values: [value] },
    member: { user },
  };
}

/**
 * A modal submit in the current Label-wrapped shape. `book` is optional on
 * purpose: leaving it out produces the pre-split two-part id, which is what a
 * card posted before the books split still sends.
 */
function form(
  orgId: string,
  kind: string,
  fields: Record<string, string>,
  user: { id: string },
  book?: string,
) {
  return {
    type: 5,
    data: {
      custom_id: `bankform:${orgId}:${kind}${book ? `:${book}` : ""}`,
      components: Object.entries(fields).map(([custom_id, value]) => ({
        type: 18,
        component: { type: 4, custom_id, value },
      })),
    },
    member: { user },
  };
}

async function wipe(collection: string) {
  const snap = await adminDb.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await wipe("users");

  await orgRef(ORG).set({ name: "Bank Card MC", slug: ORG, status: "active", memberCount: 1 });
  await orgRef(ORG).collection("members").doc("m1").set({
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
  await adminDb.collection("users").doc("u1").set({
    email: "reaper@test.rp",
    displayName: "Marcus Vane",
    memberships: { [ORG]: { memberId: "m1", role: "member" } },
    discordId: "D1",
    createdAt: Timestamp.now(),
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await wipe("users");
});

describe("card payload", () => {
  it("renders both live balances and every dropdown option", () => {
    const msg = buildBankPanelMessage({
      orgId: ORG,
      orgName: "Bank Card MC",
      balances: { clean: 12_500, dirty: 4_000, total: 16_500 },
      accentColor: 0x8b0000,
    });
    const json = JSON.stringify(msg);

    expect(msg.flags).toBe(32768); // Components V2
    // Both books on the card: one number would be the old bug wearing a new
    // label, and the channel would never know which half it was reading.
    expect(json).toContain("$12,500");
    expect(json).toContain("$4,000");
    expect(json).toContain("Club Bank");
    expect(json).toContain("Bank Card MC");

    const container = (msg.components as Record<string, unknown>[])[0];
    expect(container.accent_color).toBe(0x8b0000);

    const row = (container.components as Record<string, unknown>[]).find(
      (c) => c.type === 1,
    )!;
    const menu = (row.components as Record<string, unknown>[])[0];
    expect(menu.custom_id).toBe(`bank:${ORG}`);
    expect((menu.options as { value: string }[]).map((o) => o.value)).toEqual([
      "dues:clean",
      "dues:dirty",
      "deposit:clean",
      "deposit:dirty",
      "withdrawal:clean",
      "withdrawal:dirty",
      "balance",
    ]);
    // Discord caps a select at 25 options; the split doubled six of them.
    expect((menu.options as unknown[]).length).toBeLessThanOrEqual(25);
  });

  it("omits the accent when the club has no plain hex colour", () => {
    const msg = buildBankPanelMessage({
      orgId: ORG,
      orgName: "X",
      balances: { clean: 0, dirty: 0, total: 0 },
      accentColor: null,
    });
    const container = (msg.components as Record<string, unknown>[])[0];
    expect("accent_color" in container).toBe(false);
  });

  it("requires a note on money in and out, but not on dues", () => {
    const noteOf = (kind: "dues" | "deposit" | "withdrawal") => {
      const modal = buildBankModal(ORG, kind, "clean");
      const labels = modal.components as Record<string, unknown>[];
      const note = labels.find(
        (l) => (l.component as { custom_id: string }).custom_id === "note",
      )!;
      return note.component as { required: boolean };
    };
    expect(noteOf("dues").required).toBe(false);
    expect(noteOf("deposit").required).toBe(true);
    expect(noteOf("withdrawal").required).toBe(true);
  });

  it("carries the book in the form id and names it in the dialog", () => {
    const dirty = buildBankModal(ORG, "deposit", "dirty");
    expect(dirty.custom_id).toBe(`bankform:${ORG}:deposit:dirty`);
    // The dropdown is off screen by now, so the dialog has to say it again.
    expect(dirty.title).toContain("Dirty");
    expect(JSON.stringify(dirty)).toContain("dirty book");

    expect(buildBankModal(ORG, "dues", "clean").custom_id).toBe(
      `bankform:${ORG}:dues:clean`,
    );
  });

  it("parseBankChoice reads every dropdown value, and legacy bare kinds", () => {
    expect(
      BANK_ACTIONS.map((a) => a.value).map(parseBankChoice),
    ).toEqual([
      { kind: "dues", book: "clean" },
      { kind: "dues", book: "dirty" },
      { kind: "deposit", book: "clean" },
      { kind: "deposit", book: "dirty" },
      { kind: "withdrawal", book: "clean" },
      { kind: "withdrawal", book: "dirty" },
      null, // "balance" is a readout, not a movement
    ]);
    // A card posted before the split sends the bare kind.
    expect(parseBankChoice("deposit")).toEqual({ kind: "deposit", book: "clean" });
    // Anything else is refused rather than guessed at.
    expect(parseBankChoice("sideways:dirty")).toBeNull();
    expect(parseBankChoice("deposit:sideways")).toEqual({
      kind: "deposit",
      book: "clean",
    });
  });

  it("isTxKind accepts only the three real kinds", () => {
    expect(isTxKind("dues")).toBe(true);
    expect(isTxKind("deposit")).toBe(true);
    expect(isTxKind("withdrawal")).toBe(true);
    expect(isTxKind("balance")).toBe(false);
    // The dropdown's values are kind:book pairs now, not bare kinds.
    expect(isTxKind("dues:clean")).toBe(false);
  });
});

describe("dropdown", () => {
  it("opens the form for a movement, book and all", async () => {
    const res = await handleComponent(select(ORG, "withdrawal:dirty", { id: "D1" }));
    expect(res.type).toBe(9); // modal
    expect(res.data?.custom_id).toBe(`bankform:${ORG}:withdrawal:dirty`);
  });

  it("still opens a form from a card posted before the books split", async () => {
    const res = await handleComponent(select(ORG, "withdrawal", { id: "D1" }));
    expect(res.type).toBe(9);
    expect(res.data?.custom_id).toBe(`bankform:${ORG}:withdrawal:clean`);
  });

  it("reads both books back for the balance option", async () => {
    await orgRef(ORG)
      .collection("treasury")
      .doc("account")
      .set({ clean: 900, dirty: 350, updatedAt: Timestamp.now() });
    const res = await handleComponent(select(ORG, "balance", { id: "D1" }));
    expect(res.type).toBe(4);
    expect(res.data?.content).toContain("$900");
    expect(res.data?.content).toContain("$350");
    expect(res.data?.flags).toBe(64); // ephemeral
  });

  it("reads a pre-split account as clean money", async () => {
    await orgRef(ORG)
      .collection("treasury")
      .doc("account")
      .set({ balance: 900, updatedAt: Timestamp.now() });
    const res = await handleComponent(select(ORG, "balance", { id: "D1" }));
    expect(res.data?.content).toContain("Clean: **$900**");
    expect(res.data?.content).toContain("Dirty: **$0**");
  });

  it("turns away an unlinked clicker", async () => {
    const res = await handleComponent(select(ORG, "dues:clean", { id: "D404" }));
    expect(res.data?.content).toContain("/link");
  });
});

describe("form submission", () => {
  it("files a pending movement for the submitter", async () => {
    const res = await handleModalSubmit(
      form(ORG, "deposit", { amount: "2,000", note: "docks cut" }, { id: "D1" }, "dirty"),
    );
    expect(res.data?.content).toContain("$2,000");
    expect(res.data?.content).toContain("dirty book");

    const txs = await orgRef(ORG).collection("treasuryTransactions").get();
    expect(txs.size).toBe(1);
    expect(txs.docs[0].data()).toMatchObject({
      kind: "deposit",
      amount: 2000, // commas and $ stripped
      book: "dirty",
      memberId: "m1",
      submittedByUid: "u1",
      note: "docks cut",
      status: "pending",
    });
    // Filing never moves the balance.
    const account = await orgRef(ORG).collection("treasury").doc("account").get();
    expect(account.exists).toBe(false);
  });

  it("rejects a non-numeric amount without writing", async () => {
    const res = await handleModalSubmit(
      form(ORG, "dues", { amount: "five hundred", note: "" }, { id: "D1" }),
    );
    expect(res.data?.content).toContain("whole number");
    expect((await orgRef(ORG).collection("treasuryTransactions").get()).size).toBe(0);
  });

  it("enforces the note rule the website enforces", async () => {
    const res = await handleModalSubmit(
      form(ORG, "withdrawal", { amount: "100", note: "" }, { id: "D1" }),
    );
    expect(res.data?.content).toContain("what the money is for");
    expect((await orgRef(ORG).collection("treasuryTransactions").get()).size).toBe(0);
  });

  it("takes dues with no note at all", async () => {
    const res = await handleModalSubmit(
      form(ORG, "dues", { amount: "500" }, { id: "D1" }),
    );
    expect(res.data?.content).toContain("Dues payment");
    const txs = await orgRef(ORG).collection("treasuryTransactions").get();
    expect(txs.docs[0].data()).toMatchObject({ kind: "dues", amount: 500, note: "" });
  });

  it("files against the clean book when a pre-split form id arrives", async () => {
    // No book in the id, because the card that sent it predates the split.
    await handleModalSubmit(
      form(ORG, "deposit", { amount: "100", note: "old card" }, { id: "D1" }),
    );
    const txs = await orgRef(ORG).collection("treasuryTransactions").get();
    expect(txs.docs[0].data()?.book).toBe("clean");
  });

  it("files against the clean book when the id names a book that is not one", async () => {
    await handleModalSubmit(
      form(ORG, "deposit", { amount: "100", note: "nonsense" }, { id: "D1" }, "offshore"),
    );
    const txs = await orgRef(ORG).collection("treasuryTransactions").get();
    expect(txs.docs[0].data()?.book).toBe("clean");
  });

  it("refuses a malformed form id", async () => {
    const res = await handleModalSubmit(
      form(ORG, "sideways", { amount: "1" }, { id: "D1" }),
    );
    expect(res.data?.content).toBe("Unsupported form.");
  });
});
