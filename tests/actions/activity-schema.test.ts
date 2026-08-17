/**
 * Submit-schema bounds. Quantity carries raw amounts — dollars of dirty money,
 * months served — not a count of submissions, so the cap is generous. A ticket
 * carries one or more entries, each its own type + quantity.
 */
import { describe, expect, it } from "vitest";
import { submitActivitySchema } from "@/lib/schemas/activity";
import { MAX_ACTIVITY_QUANTITY } from "@/lib/constants";

const base = {
  orgId: "silent-souls",
  date: new Date("2026-08-03"),
  description: "Cooked Brick of Coke",
  witnesses: [],
};

function withEntries(entries: { typeId: string; quantity?: number }[]) {
  return { ...base, entries };
}

describe("submitActivitySchema entries", () => {
  it("accepts a single-type ticket", () => {
    const res = submitActivitySchema.safeParse(
      withEntries([{ typeId: "drugs-cooked", quantity: 100 }]),
    );
    expect(res.success).toBe(true);
  });

  it("accepts several types on one ticket", () => {
    const res = submitActivitySchema.safeParse(
      withEntries([
        { typeId: "drug-sale", quantity: 20 },
        { typeId: "drugs-cooked", quantity: 50 },
        { typeId: "dirty-money-earned", quantity: 250_000 },
      ]),
    );
    expect(res.success).toBe(true);
  });

  it("rejects an empty ticket with a message that says so", () => {
    const res = submitActivitySchema.safeParse(withEntries([]));
    expect(res.success).toBe(false);
    expect(res.error!.issues[0].message).toContain("at least one");
  });

  it("rejects the same type listed twice", () => {
    const res = submitActivitySchema.safeParse(
      withEntries([
        { typeId: "drug-sale", quantity: 5 },
        { typeId: "drug-sale", quantity: 10 },
      ]),
    );
    expect(res.success).toBe(false);
  });

  it("still rejects zero, negatives and fractions", () => {
    for (const quantity of [0, -5, 1.5]) {
      const res = submitActivitySchema.safeParse(
        withEntries([{ typeId: "drugs-cooked", quantity }]),
      );
      expect(res.success).toBe(false);
    }
  });

  it("rejects above the cap with a message that names the limit", () => {
    const res = submitActivitySchema.safeParse(
      withEntries([{ typeId: "drugs-cooked", quantity: MAX_ACTIVITY_QUANTITY + 1 }]),
    );
    expect(res.success).toBe(false);
    // The member has to be told what the limit is, not just "Invalid input".
    expect(res.error!.issues[0].message).toContain("10,000,000");
  });

  it("proof is optional — no entry combination requires proofPath", () => {
    const res = submitActivitySchema.safeParse(
      withEntries([{ typeId: "heist-completed", quantity: 1 }]),
    );
    expect(res.success).toBe(true);
  });
});
