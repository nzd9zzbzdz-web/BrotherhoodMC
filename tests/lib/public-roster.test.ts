/**
 * The public/private gate for the club roster. Pure — no emulator needed.
 *
 * This decides whose face and road name leave the members-only side of the
 * product, and the render route asks the same function, so a mistake here
 * leaks a member's art to the open internet. Worth pinning every branch.
 */
import { describe, expect, it } from "vitest";
import {
  bySeniority,
  isPubliclyVisible,
  tenureLabel,
  type PublicRosterMember,
} from "@/lib/public-roster";
import type { MemberStatus, Rank } from "@/lib/types";

const officer = { isOfficer: true } as Rank;
const notOfficer = { isOfficer: false } as Rank;

const visible = (status: MemberStatus, rank?: Rank) =>
  isPubliclyVisible({ status }, rank);

describe("isPubliclyVisible", () => {
  it("shows officers and patched members", () => {
    expect(visible("patched", officer)).toBe(true);
    expect(visible("patched", notOfficer)).toBe(true);
  });

  it("hides prospects and hangarounds", () => {
    expect(visible("prospect", notOfficer)).toBe(false);
    expect(visible("hangaround", notOfficer)).toBe(false);
  });

  it("drops anyone who left, whatever rank they held", () => {
    // An exiled President must not keep a public card.
    expect(visible("retired", officer)).toBe(false);
    expect(visible("exiled", officer)).toBe(false);
    expect(visible("retired", notOfficer)).toBe(false);
    expect(visible("exiled", notOfficer)).toBe(false);
  });

  it("hides a member whose rank is missing rather than assuming the best", () => {
    // A dangling rankId shouldn't quietly publish someone.
    expect(visible("prospect", undefined)).toBe(false);
    expect(visible("hangaround", undefined)).toBe(false);
    // Patched still stands on its own — the status is the claim, not the rank.
    expect(visible("patched", undefined)).toBe(true);
  });
});

describe("bySeniority", () => {
  it("puts the longest-riding first", () => {
    const m = (id: string, joinedAtMs: number) =>
      ({ id, joinedAtMs }) as unknown as PublicRosterMember;
    const sorted = [m("new", 300), m("oldest", 100), m("mid", 200)].sort(bySeniority);
    expect(sorted.map((x) => x.id)).toEqual(["oldest", "mid", "new"]);
  });
});

describe("tenureLabel", () => {
  // Local-time constructors, not UTC strings: the function reads local getters
  // because both of its inputs are local (a Timestamp.toDate() and new Date()).
  // Mixing the two makes the day-of-month comparison drift by a timezone.
  const local = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);
  const now = local(2026, 8, 4);
  const on = (y: number, m: number, d: number) => tenureLabel(local(y, m, d), now);

  it("counts whole years once past the anniversary", () => {
    expect(on(2023, 8, 4)).toBe("3 years riding");
    expect(on(2025, 8, 4)).toBe("1 year riding");
  });

  it("does not round a year up early", () => {
    // One day short of the anniversary is still 11 months.
    expect(on(2025, 8, 5)).toBe("11 months riding");
  });

  it("falls back to months under a year", () => {
    expect(on(2026, 6, 4)).toBe("2 months riding");
    expect(on(2026, 7, 4)).toBe("1 month riding");
  });

  it("has a phrase for someone who just joined", () => {
    expect(on(2026, 8, 1)).toBe("New to the colors");
  });

  it("never says a negative or throws on a bad date", () => {
    // A join date typo'd into the future must not read "-3 months riding".
    expect(on(2027, 1, 1)).toBe("New to the colors");
    expect(tenureLabel(null, now)).toBe("Riding with the club");
    expect(tenureLabel(new Date("nonsense"), now)).toBe("Riding with the club");
  });
});
