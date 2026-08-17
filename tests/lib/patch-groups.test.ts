/**
 * Admin patch table grouping. Pure — no emulator.
 *
 * The point of the grouping is that a ladder reads as a ladder, so what's worth
 * pinning is the ORDER: criminal stats in panel order, rungs by threshold, and
 * the two catch-all groups pushed to the bottom where they don't interrupt.
 */
import { describe, expect, it } from "vitest";
import { groupPatches, patchMatchesQuery } from "@/lib/patch-groups";
import { CRIMINAL_PATCH_SEEDS, CRIMINAL_RECORD_ROWS } from "@/lib/constants";
import type { StatKey } from "@/lib/types";

const p = (
  id: string,
  statKey: StatKey | null,
  threshold = 0,
  active = true,
  name = id,
) => ({
  id,
  name,
  active,
  requirement: statKey ? { statKey, threshold } : null,
});

describe("groupPatches", () => {
  it("orders rungs by threshold, not by name", () => {
    // Alphabetically this is Corner Boy, Dealer, Kingpin, Slinger — which says
    // nothing about which comes first.
    const [group] = groupPatches([
      p("kingpin", "drugSales", 10_000),
      p("corner-boy", "drugSales", 100),
      p("dealer", "drugSales", 1_000),
      p("slinger", "drugSales", 500),
    ]);
    expect(group.label).toBe("Drug Sales");
    expect(group.laddered).toBe(true);
    expect(group.patches.map((x) => x.id)).toEqual([
      "corner-boy",
      "slinger",
      "dealer",
      "kingpin",
    ]);
  });

  it("leads with the criminal record in panel order", () => {
    const groups = groupPatches([
      p("a", "jailTimeMonths", 300),
      p("b", "crimesCommitted", 10),
      p("c", "drugSales", 100),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      "crimesCommitted",
      "drugSales",
      "jailTimeMonths",
    ]);
  });

  it("puts non-criminal stats behind the criminal ones", () => {
    const groups = groupPatches([
      p("rw", "clubRuns", 10),
      p("f", "churchAttendance", 10),
      p("cb", "drugSales", 100),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      "drugSales", // criminal first
      "churchAttendance", // then alphabetical by label
      "clubRuns",
    ]);
  });

  it("collects manual awards and retired patches at the bottom", () => {
    const groups = groupPatches([
      p("citation", null),
      p("old", "communityOutreach", 15, false),
      p("cb", "drugSales", 100),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Drug Sales",
      "Awarded by leadership",
      "Retired",
    ]);
    // Neither is a ladder, so no tier numerals.
    expect(groups[1].laddered).toBe(false);
    expect(groups[2].laddered).toBe(false);
  });

  it("pulls a disabled patch out of its ladder rather than leaving a dead rung", () => {
    const groups = groupPatches([
      p("t1", "drugSales", 100),
      p("t2", "drugSales", 500, false),
      p("t3", "drugSales", 1_000),
    ]);
    expect(groups[0].patches.map((x) => x.id)).toEqual(["t1", "t3"]);
    expect(groups[1].patches.map((x) => x.id)).toEqual(["t2"]);
  });

  it("lays the shipped emblems out as eleven ladders of five", () => {
    const groups = groupPatches(
      CRIMINAL_PATCH_SEEDS.map((s) =>
        p(s.id, s.requirement.statKey, s.requirement.threshold, true, s.name),
      ),
    );
    expect(groups).toHaveLength(11);
    expect(groups.map((g) => g.key)).toEqual(CRIMINAL_RECORD_ROWS.map((r) => r.statKey));
    for (const g of groups) {
      expect(g.patches, g.label).toHaveLength(5);
      const thresholds = g.patches.map((x) => x.requirement!.threshold);
      expect(thresholds, g.label).toEqual([...thresholds].sort((a, b) => a - b));
    }
  });
});

describe("patchMatchesQuery", () => {
  const patch = { ...p("corner-boy", "drugSales", 100, true, "Corner Boy"), description: "Move 100 drug sales." };

  it("matches on name, description and stat label", () => {
    expect(patchMatchesQuery(patch, "corner")).toBe(true);
    expect(patchMatchesQuery(patch, "100 drug")).toBe(true);
    expect(patchMatchesQuery(patch, "Drug Sales")).toBe(true); // the stat, not the text
    expect(patchMatchesQuery(patch, "kingpin")).toBe(false);
  });

  it("ignores case and surrounding space, and an empty query keeps everything", () => {
    expect(patchMatchesQuery(patch, "  CORNER  ")).toBe(true);
    expect(patchMatchesQuery(patch, "")).toBe(true);
    expect(patchMatchesQuery(patch, "   ")).toBe(true);
  });
});
