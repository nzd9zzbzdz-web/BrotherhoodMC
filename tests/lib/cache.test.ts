import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { decodeFromCache, encodeForCache, orgTags } from "@/lib/cache";

/**
 * The data cache stores JSON. Firestore hands us `Timestamp` class instances,
 * and ~40 call sites across the app call `.toMillis()` on them — so the round
 * trip through the cache has to hand back a real Timestamp, not a plain bag of
 * seconds. Same for the Maps and Sets several queries return. These tests are
 * the contract; break one and pages throw at runtime rather than at build.
 */

/** What the encoder actually has to survive: a JSON round trip in between. */
function roundTrip<T>(value: T): unknown {
  return decodeFromCache(JSON.parse(JSON.stringify(encodeForCache(value))));
}

describe("cache serialization", () => {
  it("returns a real Timestamp, not a plain object", () => {
    const ts = Timestamp.fromDate(new Date("2026-03-14T09:26:53.589Z"));
    const out = roundTrip({ joinDate: ts }) as { joinDate: Timestamp };

    expect(out.joinDate).toBeInstanceOf(Timestamp);
    // The whole point: this is what every page does with the value.
    expect(out.joinDate.toMillis()).toBe(ts.toMillis());
    expect(out.joinDate.nanoseconds).toBe(ts.nanoseconds);
  });

  it("keeps Timestamps nested inside arrays and objects", () => {
    const ts = Timestamp.fromDate(new Date("2026-01-02T03:04:05.000Z"));
    const out = roundTrip({
      members: [{ id: "m1", stats: { runs: 3 }, joinDate: ts }],
    }) as { members: { joinDate: Timestamp; stats: { runs: number } }[] };

    expect(out.members[0].joinDate).toBeInstanceOf(Timestamp);
    expect(out.members[0].joinDate.toMillis()).toBe(ts.toMillis());
    expect(out.members[0].stats.runs).toBe(3);
  });

  it("round-trips Maps, which JSON alone turns into {}", () => {
    const source = new Map([
      ["road-warrior", 1739000000000],
      ["iron-rider", 1739000009999],
    ]);
    const out = roundTrip(source) as Map<string, number>;

    expect(out).toBeInstanceOf(Map);
    expect(out.get("road-warrior")).toBe(1739000000000);
    expect([...out.keys()]).toEqual(["road-warrior", "iron-rider"]);
  });

  it("round-trips a Map of arrays of docs (awards grouped by member)", () => {
    const ts = Timestamp.fromDate(new Date("2026-05-05T00:00:00.000Z"));
    const source = new Map([["m1", [{ id: "m1_road-warrior", awardedAt: ts }]]]);
    const out = roundTrip(source) as Map<string, { awardedAt: Timestamp }[]>;

    expect(out.get("m1")?.[0].awardedAt).toBeInstanceOf(Timestamp);
    expect(out.get("m1")?.[0].awardedAt.toMillis()).toBe(ts.toMillis());
  });

  it("round-trips Sets (branding art keys)", () => {
    const out = roundTrip(new Set(["rosterBackdrop", "characterStage"]));
    expect(out).toBeInstanceOf(Set);
    expect((out as Set<string>).has("characterStage")).toBe(true);
  });

  it("round-trips Dates as Dates", () => {
    const d = new Date("2026-07-15T12:00:00.000Z");
    const out = roundTrip({ at: d }) as { at: Date };
    expect(out.at).toBeInstanceOf(Date);
    expect(out.at.getTime()).toBe(d.getTime());
  });

  it("preserves null and drops undefined, matching Firestore's own rule", () => {
    // `lastActivityAt?` and friends are optional; absent and undefined mean the
    // same thing to every reader, and Firestore refuses to store undefined.
    const out = roundTrip({ a: null, b: undefined, c: 0, d: "" }) as Record<
      string,
      unknown
    >;
    expect(out.a).toBeNull();
    expect("b" in out).toBe(false);
    expect(out.c).toBe(0);
    expect(out.d).toBe("");
  });

  it("passes ordinary values through untouched", () => {
    const out = roundTrip({ n: 42, s: "Reaper", b: true, arr: [1, "2", false] });
    expect(out).toEqual({ n: 42, s: "Reaper", b: true, arr: [1, "2", false] });
  });

  it("handles null at the top level", () => {
    // getMember/getPatchArt/getBranding all return null on a miss, and a cached
    // null is a legitimate entry — not an excuse to re-read every request.
    expect(roundTrip(null)).toBeNull();
  });
});

describe("cache tags", () => {
  it("scopes every tag to its org", () => {
    // The multi-tenant property: no tag may be shared between two orgs, or one
    // club's mutation would flush (or worse, serve) another's data.
    const mine = Object.values(orgTags).map((t) => t("org-a"));
    const theirs = Object.values(orgTags).map((t) => t("org-b"));

    expect(mine.every((t) => t.includes("org-a"))).toBe(true);
    expect(mine.some((t) => theirs.includes(t))).toBe(false);
  });

  it("gives each collection a distinct tag", () => {
    const tags = Object.values(orgTags).map((t) => t("org-a"));
    expect(new Set(tags).size).toBe(tags.length);
  });
});
