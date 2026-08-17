/**
 * Club bank core tests against the Firestore emulator (Admin SDK).
 * Requires emulators running. Uses an isolated org so app data is untouched.
 *
 * The guarantees worth pinning: the balance moves only on approval and always
 * inside the same transaction as the status flip, withdrawals can never
 * overdraw the account, dues stamp the payer's record, racing reviewers settle
 * to exactly one ruling, and the review gate admits exactly admins plus the
 * Treasurer seat.
 *
 * Since the books split in two, add: a movement only ever moves the book it
 * names, neither book can cover the other's withdrawal, and a row or an
 * account written before the split reads as clean without a migration. Most
 * of the older cases below still seed rows with NO book field, which is
 * exactly what makes them the regression test for that last one.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "treasury-core-test-isolated";

// Import AFTER env vars so the Admin SDK connects to the emulator.
const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const {
  DAILY_TREASURY_CAP,
  TreasuryError,
  accountBooks,
  approveTreasuryTxCore,
  bookOf,
  canReviewTreasury,
  denyTreasuryTxCore,
  insufficientFundsMessage,
  isDuesCurrent,
  submitTreasuryTxCore,
  txDelta,
} = await import("@/lib/treasury-core");

const ORG = "treasury-core-test-org";
const ACTOR = { uid: "u1", memberId: "m1" };

function capRef() {
  const day = new Date().toISOString().slice(0, 10);
  return adminDb.doc(`organizations/${ORG}/rateLimits/${ACTOR.uid}_treasury_${day}`);
}

function accountRef() {
  return orgRef(ORG).collection("treasury").doc("account");
}

/** Both books as the account document actually holds them, legacy field and
 *  all, so these assertions cannot be satisfied by the reader alone. */
async function books(): Promise<{ clean: number; dirty: number }> {
  const data = (await accountRef().get()).data();
  return accountBooks(data);
}

/** The clean book, which is what every pre-split assertion here means by
 *  "the balance". */
async function balance(): Promise<number> {
  return (await books()).clean;
}

function movement(overrides: Record<string, unknown> = {}) {
  return {
    orgId: ORG,
    kind: "dues" as const,
    amount: 500,
    book: "clean" as const,
    note: "",
    subjectMemberId: "m1",
    ...overrides,
  };
}

/** Seed a pending transaction directly, so review tests control their input. */
async function seedTx(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await orgRef(ORG).collection("treasuryTransactions").doc(id).set({
    kind: "dues",
    amount: 500,
    memberId: "m1",
    submittedByUid: "u1",
    note: "",
    status: "pending",
    createdAt: Timestamp.now(),
    ...fields,
  });
}

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  const org = orgRef(ORG);
  await org.set({ name: "Treasury Test", slug: ORG, memberCount: 1 });
  await org.collection("members").doc("m1").set({
    uid: ACTOR.uid,
    displayName: "Test Member",
    roadName: "Testy",
    rankId: "patched-member",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    stats: {},
    patchCount: 0,
    createdAt: Timestamp.now(),
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
});

describe("submitTreasuryTxCore", () => {
  it("creates a pending movement and burns one daily slot", async () => {
    const { txId } = await submitTreasuryTxCore(ACTOR, movement({ note: "monthly" }));

    const doc = await orgRef(ORG).collection("treasuryTransactions").doc(txId).get();
    expect(doc.data()).toMatchObject({
      kind: "dues",
      amount: 500,
      book: "clean",
      memberId: "m1",
      submittedByUid: "u1",
      note: "monthly",
      status: "pending",
    });
    expect(doc.data()?.createdAt).toBeTruthy();
    expect((await capRef().get()).data()?.count).toBe(1);
    // Filing alone never touches the balance.
    expect(await balance()).toBe(0);
  });

  it("records the book the filer named", async () => {
    const { txId } = await submitTreasuryTxCore(
      ACTOR,
      movement({ kind: "deposit", book: "dirty", note: "docks job" }),
    );
    const doc = await orgRef(ORG).collection("treasuryTransactions").doc(txId).get();
    expect(doc.data()?.book).toBe("dirty");
  });

  it("records the subject member, not the actor, when they differ", async () => {
    const { txId } = await submitTreasuryTxCore(
      ACTOR,
      movement({ subjectMemberId: "m2" }),
    );
    const doc = await orgRef(ORG).collection("treasuryTransactions").doc(txId).get();
    expect(doc.data()?.memberId).toBe("m2");
    expect(doc.data()?.submittedByUid).toBe("u1");
  });

  it("stops the filing over the daily cap without burning the slot", async () => {
    await capRef().set({ count: DAILY_TREASURY_CAP });

    await expect(submitTreasuryTxCore(ACTOR, movement())).rejects.toMatchObject({
      name: "TreasuryError",
      code: "daily_limit",
    });
    expect((await orgRef(ORG).collection("treasuryTransactions").get()).size).toBe(0);
    expect((await capRef().get()).data()?.count).toBe(DAILY_TREASURY_CAP);
  });
});

describe("approveTreasuryTxCore", () => {
  it("moves the balance, stamps balanceAfter, and audits", async () => {
    await seedTx("t1", { kind: "deposit", amount: 2_000, note: "docks cut" });

    const result = await approveTreasuryTxCore(ORG, "t1", "reviewer-uid", "good");
    expect(result).toMatchObject({
      kind: "deposit",
      amount: 2_000,
      book: "clean",
      balance: 2_000,
      balances: { clean: 2_000, dirty: 0, total: 2_000 },
    });

    const doc = await orgRef(ORG).collection("treasuryTransactions").doc("t1").get();
    expect(doc.data()).toMatchObject({
      status: "approved",
      reviewedBy: "reviewer-uid",
      reviewNote: "good",
      balanceAfter: 2_000,
    });
    expect(await balance()).toBe(2_000);

    const audits = await orgRef(ORG)
      .collection("auditLogs")
      .where("action", "==", "treasury.approve")
      .get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0].data().detail).toContain("$2,000");
  });

  it("lazily creates the account on the first approval, with both books", async () => {
    expect((await accountRef().get()).exists).toBe(false);
    await seedTx("t1", { kind: "dues", amount: 250 });
    await approveTreasuryTxCore(ORG, "t1", "r");
    expect((await accountRef().get()).data()).toMatchObject({ clean: 250, dirty: 0 });
  });

  it("subtracts a withdrawal and runs the balance forward", async () => {
    await accountRef().set({ clean: 5_000, dirty: 0, updatedAt: Timestamp.now() });
    await seedTx("t1", { kind: "withdrawal", amount: 1_500, note: "ammo" });

    const result = await approveTreasuryTxCore(ORG, "t1", "r");
    expect(result.balance).toBe(3_500);
    expect(await balance()).toBe(3_500);
  });

  it("refuses a withdrawal the bank cannot cover, changing nothing", async () => {
    await accountRef().set({ clean: 1_000, dirty: 0, updatedAt: Timestamp.now() });
    await seedTx("t1", { kind: "withdrawal", amount: 1_001, note: "too much" });

    await expect(approveTreasuryTxCore(ORG, "t1", "r")).rejects.toMatchObject({
      name: "TreasuryError",
      code: "insufficient_funds",
      detail: "1000",
      book: "clean",
    });

    const doc = await orgRef(ORG).collection("treasuryTransactions").doc("t1").get();
    expect(doc.data()?.status).toBe("pending"); // still open for a retry after a deposit
    expect(await balance()).toBe(1_000);
  });

  it("allows a withdrawal down to exactly zero", async () => {
    await accountRef().set({ clean: 1_000, dirty: 0, updatedAt: Timestamp.now() });
    await seedTx("t1", { kind: "withdrawal", amount: 1_000, note: "all of it" });
    const result = await approveTreasuryTxCore(ORG, "t1", "r");
    expect(result.balance).toBe(0);
  });

  it("moves ONLY the book the movement names", async () => {
    await accountRef().set({ clean: 1_000, dirty: 400, updatedAt: Timestamp.now() });
    await seedTx("t1", { kind: "deposit", amount: 600, book: "dirty", note: "docks" });

    const result = await approveTreasuryTxCore(ORG, "t1", "r");
    expect(result).toMatchObject({
      book: "dirty",
      balance: 1_000,
      balances: { clean: 1_000, dirty: 1_000, total: 2_000 },
    });
    expect(await books()).toEqual({ clean: 1_000, dirty: 1_000, total: 2_000 });
  });

  it("stamps balanceAfter with the BOOK's balance, never the total", async () => {
    await accountRef().set({ clean: 9_000, dirty: 100, updatedAt: Timestamp.now() });
    await seedTx("t1", { kind: "deposit", amount: 50, book: "dirty", note: "x" });
    await approveTreasuryTxCore(ORG, "t1", "r");

    const doc = await orgRef(ORG).collection("treasuryTransactions").doc("t1").get();
    expect(doc.data()?.balanceAfter).toBe(150);
  });

  it("never raids the other book to cover a withdrawal", async () => {
    // The whole point of two books: $10,000 clean does not make a $500 dirty
    // withdrawal affordable, and the refusal names the book that came short.
    await accountRef().set({ clean: 10_000, dirty: 200, updatedAt: Timestamp.now() });
    await seedTx("t1", { kind: "withdrawal", amount: 500, book: "dirty", note: "payoff" });

    await expect(approveTreasuryTxCore(ORG, "t1", "r")).rejects.toMatchObject({
      code: "insufficient_funds",
      detail: "200",
      book: "dirty",
    });
    expect(await books()).toEqual({ clean: 10_000, dirty: 200, total: 10_200 });
  });

  it("reads a pre-split account as clean money and leaves the old field alone", async () => {
    // The migration, such as it is: an account written before the books split
    // carries only `balance`. Every dollar of it is clean, and the first
    // approval materialises both fields without disturbing the old one.
    await accountRef().set({ balance: 7_500, updatedAt: Timestamp.now() });
    await seedTx("t1", { kind: "deposit", amount: 500, note: "cut" });

    const result = await approveTreasuryTxCore(ORG, "t1", "r");
    expect(result.balance).toBe(8_000);

    const data = (await accountRef().get()).data();
    expect(data).toMatchObject({ clean: 8_000, dirty: 0 });
    expect(data?.balance).toBe(7_500); // dead, kept so the split is reversible
  });

  it("stamps lastDuesPaidAt on the payer for dues only", async () => {
    await seedTx("dues1", { kind: "dues", amount: 500 });
    await approveTreasuryTxCore(ORG, "dues1", "r");
    const afterDues = await orgRef(ORG).collection("members").doc("m1").get();
    expect(afterDues.data()?.lastDuesPaidAt).toBeTruthy();

    // A deposit does not touch the member record.
    await orgRef(ORG)
      .collection("members")
      .doc("m1")
      .set({ lastDuesPaidAt: null }, { merge: true });
    await seedTx("dep1", { kind: "deposit", amount: 500, note: "cut" });
    await approveTreasuryTxCore(ORG, "dep1", "r");
    const afterDeposit = await orgRef(ORG).collection("members").doc("m1").get();
    expect(afterDeposit.data()?.lastDuesPaidAt).toBeNull();
  });

  it("survives dues from a member who no longer exists", async () => {
    await seedTx("t1", { kind: "dues", amount: 500, memberId: "ghost" });
    const result = await approveTreasuryTxCore(ORG, "t1", "r");
    expect(result.balance).toBe(500);
  });

  it("refuses a second ruling on the same movement", async () => {
    await seedTx("t1", { kind: "deposit", amount: 100, note: "x" });
    await approveTreasuryTxCore(ORG, "t1", "r");
    await expect(approveTreasuryTxCore(ORG, "t1", "r")).rejects.toMatchObject({
      code: "not_pending",
    });
    expect(await balance()).toBe(100); // applied exactly once
  });

  it("settles two racing reviewers with exactly one approval", async () => {
    await seedTx("t1", { kind: "deposit", amount: 100, note: "x" });
    const results = await Promise.allSettled([
      approveTreasuryTxCore(ORG, "t1", "r1"),
      approveTreasuryTxCore(ORG, "t1", "r2"),
    ]);
    const wins = results.filter((r) => r.status === "fulfilled");
    expect(wins).toHaveLength(1);
    expect(await balance()).toBe(100);
    const audits = await orgRef(ORG)
      .collection("auditLogs")
      .where("action", "==", "treasury.approve")
      .get();
    expect(audits.size).toBe(1);
  });

  it("throws tx_not_found for a ghost", async () => {
    await expect(approveTreasuryTxCore(ORG, "ghost", "r")).rejects.toBeInstanceOf(
      TreasuryError,
    );
  });
});

describe("denyTreasuryTxCore", () => {
  it("flips to denied without touching the balance, and audits", async () => {
    await accountRef().set({ clean: 700, dirty: 0, updatedAt: Timestamp.now() });
    await seedTx("t1", { kind: "withdrawal", amount: 700, note: "nope" });

    await denyTreasuryTxCore(ORG, "t1", "reviewer-uid", "not club money");

    const doc = await orgRef(ORG).collection("treasuryTransactions").doc("t1").get();
    expect(doc.data()).toMatchObject({
      status: "denied",
      reviewedBy: "reviewer-uid",
      reviewNote: "not club money",
    });
    expect(doc.data()?.balanceAfter).toBeUndefined();
    expect(await balance()).toBe(700);

    const audits = await orgRef(ORG)
      .collection("auditLogs")
      .where("action", "==", "treasury.deny")
      .get();
    expect(audits.size).toBe(1);
  });

  it("refuses to deny what was already ruled on", async () => {
    await seedTx("t1", { kind: "deposit", amount: 100, note: "x" });
    await approveTreasuryTxCore(ORG, "t1", "r");
    await expect(denyTreasuryTxCore(ORG, "t1", "r")).rejects.toMatchObject({
      code: "not_pending",
    });
  });
});

describe("canReviewTreasury", () => {
  it("admits admins whatever their rank", () => {
    expect(canReviewTreasury("admin", undefined)).toBe(true);
    expect(canReviewTreasury("admin", "prospect")).toBe(true);
  });
  it("admits the Treasurer seat whatever their portal role", () => {
    expect(canReviewTreasury("member", "treasurer")).toBe(true);
    expect(canReviewTreasury("officer", "treasurer")).toBe(true);
  });
  it("turns away everyone else, officers included", () => {
    expect(canReviewTreasury("officer", "road-captain")).toBe(false);
    expect(canReviewTreasury("member", "patched-member")).toBe(false);
    expect(canReviewTreasury("member", undefined)).toBe(false);
  });
});

describe("helpers", () => {
  it("txDelta: dues and deposits pay in, withdrawals pay out", () => {
    expect(txDelta("dues", 500)).toBe(500);
    expect(txDelta("deposit", 500)).toBe(500);
    expect(txDelta("withdrawal", 500)).toBe(-500);
  });

  it("bookOf: only an explicit dirty is dirty", () => {
    expect(bookOf({ book: "dirty" })).toBe("dirty");
    expect(bookOf({ book: "clean" })).toBe("clean");
    // A row filed before the split, and anything else that reaches it.
    expect(bookOf({})).toBe("clean");
    expect(bookOf({ book: undefined })).toBe("clean");
  });

  it("accountBooks: clean falls back to the pre-split field, never dirty", () => {
    expect(accountBooks({ clean: 10, dirty: 4 })).toEqual({
      clean: 10,
      dirty: 4,
      total: 14,
    });
    expect(accountBooks({ balance: 900 })).toEqual({
      clean: 900,
      dirty: 0,
      total: 900,
    });
    // Once both fields exist the legacy one is ignored outright.
    expect(accountBooks({ clean: 1, dirty: 2, balance: 999 })).toEqual({
      clean: 1,
      dirty: 2,
      total: 3,
    });
    expect(accountBooks(undefined)).toEqual({ clean: 0, dirty: 0, total: 0 });
  });

  it("insufficientFundsMessage: names the book that came short", () => {
    expect(
      insufficientFundsMessage(new TreasuryError("insufficient_funds", "200", "dirty")),
    ).toBe("The dirty book holds $200; it cannot cover this withdrawal");
    // A refusal raised without a book (older data, defensive callers) reads
    // clean, matching bookOf.
    expect(
      insufficientFundsMessage(new TreasuryError("insufficient_funds", "0")),
    ).toBe("The clean book holds $0; it cannot cover this withdrawal");
  });

  it("isDuesCurrent: paid this UTC calendar month, not a rolling window", () => {
    const now = new Date(Date.UTC(2026, 7, 13)); // Aug 13
    expect(isDuesCurrent({ lastDuesPaidAt: new Date(Date.UTC(2026, 7, 1)) }, now)).toBe(true);
    expect(
      isDuesCurrent({ lastDuesPaidAt: new Date(Date.UTC(2026, 6, 31, 23, 59)) }, now),
    ).toBe(false);
    expect(
      isDuesCurrent(
        { lastDuesPaidAt: Timestamp.fromDate(new Date(Date.UTC(2026, 7, 5))) },
        now,
      ),
    ).toBe(true);
    expect(isDuesCurrent({}, now)).toBe(false);
  });
});
