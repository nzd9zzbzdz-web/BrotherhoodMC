/**
 * Ladder composition — a pure function over patches, awards and stats, so no
 * emulator. Guards the two things the Patches tab gets wrong most easily:
 * which rung is "next", and how full the bar toward it should be.
 */
import { describe, expect, it } from "vitest";
import { composeLadders, remainingLabel } from "@/lib/patch-ladders";
import {
  CRIMINAL_PATCH_SEEDS,
  CRIMINAL_RECORD_ROWS,
  PATCH_LADDERS,
} from "@/lib/constants";
import type { AwardedPatch, Patch, StatKey } from "@/lib/types";

function patch(id: string, statKey: StatKey, threshold: number, active = true): Patch {
  return {
    id,
    name: id,
    category: "activity",
    description: `${threshold} of ${statKey}`,
    tier: 1,
    requirement: { statKey, threshold },
    manual: false,
    active,
    emblem: true,
    defaultPlacement: { surface: "back", u: 0.5, v: 0.5, scale: 0.8, rotationDeg: 0 },
  };
}

function award(patchId: string): AwardedPatch {
  return {
    id: `m1_${patchId}`,
    memberId: "m1",
    patchId,
    awardedAt: new Date("2026-03-01"),
    awardedBy: "system",
  };
}

const LADDER = [
  patch("t1", "drugSales", 1_000),
  patch("t2", "drugSales", 5_000),
  patch("t3", "drugSales", 15_000),
];

describe("composeLadders", () => {
  it("orders rungs by threshold regardless of input order", () => {
    const [ladder] = composeLadders({
      patches: [LADDER[2], LADDER[0], LADDER[1]],
      awards: [],
      stats: {},
    });
    expect(ladder.tiers.map((t) => t.patch.id)).toEqual(["t1", "t2", "t3"]);
    expect(ladder.tiers.map((t) => t.tier)).toEqual([1, 2, 3]);
  });

  it("measures progress across the current segment, not from zero", () => {
    // 7,000 of the 5,000→15,000 segment is 2,000 in ⇒ 20%, not 47%.
    const [ladder] = composeLadders({
      patches: LADDER,
      awards: [award("t1"), award("t2")],
      stats: { drugSales: 7_000 },
    });
    expect(ladder.next?.patch.id).toBe("t3");
    expect(ladder.pct).toBe(20);
    expect(ladder.top?.patch.id).toBe("t2");
    expect(ladder.earnedCount).toBe(2);
  });

  it("reports a topped-out ladder as complete with no next rung", () => {
    const [ladder] = composeLadders({
      patches: LADDER,
      awards: LADDER.map((p) => award(p.id)),
      stats: { drugSales: 20_000 },
    });
    expect(ladder.next).toBeNull();
    expect(ladder.pct).toBe(100);
    expect(remainingLabel(ladder)).toBeNull();
  });

  it("treats the first unearned rung as next even when the stat has passed it", () => {
    // An officer editing a threshold downward must not strand the ladder.
    const [ladder] = composeLadders({
      patches: LADDER,
      awards: [],
      stats: { drugSales: 9_999 },
    });
    expect(ladder.next?.patch.id).toBe("t1");
    expect(ladder.pct).toBe(100);
  });

  it("hides a retired rung nobody earned but keeps an earned one", () => {
    const retired = patch("t4", "drugSales", 40_000, false);
    const without = composeLadders({
      patches: [...LADDER, retired],
      awards: [],
      stats: {},
    });
    expect(without[0].tiers.map((t) => t.patch.id)).not.toContain("t4");

    const with_ = composeLadders({
      patches: [...LADDER, retired],
      awards: [award("t4")],
      stats: {},
    });
    expect(with_[0].tiers.map((t) => t.patch.id)).toContain("t4");
  });

  it("formats dollar and month stats with their units", () => {
    const [money] = composeLadders({
      patches: [patch("m1", "dirtyMoneyEarned", 1_000_000)],
      awards: [],
      stats: { dirtyMoneyEarned: 250_000 },
    });
    expect(money.format(money.current)).toBe("$250K");
    expect(remainingLabel(money)).toBe("$750K");

    const [jail] = composeLadders({
      patches: [patch("j1", "jailTimeMonths", 300)],
      awards: [],
      stats: { jailTimeMonths: 120 },
    });
    expect(remainingLabel(jail)).toBe("180 mo");
  });

  it("skips manual-only patches — they have no ladder", () => {
    const manual: Patch = { ...patch("x", "drugSales", 1), requirement: null, manual: true };
    const ladders = composeLadders({ patches: [manual], awards: [], stats: {} });
    expect(ladders).toEqual([]);
  });

  it("skips patches worn on the cut — the tab is emblems only", () => {
    // Road Warrior and Faithful are threshold-driven too, but they belong on
    // the Patch Wall; a two-rung club ladder next to a five-rung emblem one
    // reads as a broken ladder.
    const worn: Patch = { ...patch("road-warrior", "clubRuns", 10), emblem: false };
    const ladders = composeLadders({
      patches: [...LADDER, worn],
      awards: [],
      stats: { clubRuns: 50 },
    });
    expect(ladders.map((l) => l.statKey)).toEqual(["drugSales"]);
  });
});

describe("PATCH_LADDERS seed data", () => {
  it("covers all 11 criminal record stats with 5 tiers each", () => {
    expect(PATCH_LADDERS).toHaveLength(11);
    for (const ladder of PATCH_LADDERS) {
      expect(ladder.tiers, ladder.statKey).toHaveLength(5);
    }
    expect(CRIMINAL_PATCH_SEEDS).toHaveLength(55);
  });

  it("gives every ladder strictly ascending thresholds", () => {
    for (const ladder of PATCH_LADDERS) {
      const thresholds = ladder.tiers.map((t) => t.threshold);
      expect(thresholds, ladder.statKey).toEqual([...thresholds].sort((a, b) => a - b));
      expect(new Set(thresholds).size, ladder.statKey).toBe(5);
    }
  });

  it("keeps patch ids unique across every ladder", () => {
    const ids = CRIMINAL_PATCH_SEEDS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks every ladder tier as an emblem", () => {
    // The whole point: fifty-five of these must never reach a cut.
    expect(CRIMINAL_PATCH_SEEDS.every((p) => p.emblem === true)).toBe(true);
  });

  it("covers exactly the criminal record rows, in panel order", () => {
    expect(PATCH_LADDERS.map((l) => l.statKey)).toEqual(
      CRIMINAL_RECORD_ROWS.map((r) => r.statKey),
    );
  });

  it("keeps the id of every patch that shipped before the ladders", () => {
    // Awards reference these ids, so renaming or dropping one orphans somebody's
    // record. Thresholds are NOT pinned — they're tuned to the club's pace, and
    // lowering one never revokes an award.
    const legacyIds = [
      "corner-boy",
      "the-cook",
      "gunsmith",
      "made-man",
      "earner",
      "the-launderer",
      "hardened",
      "most-wanted",
    ];
    for (const id of legacyIds) {
      expect(
        CRIMINAL_PATCH_SEEDS.find((p) => p.id === id),
        `${id} must survive a retune`,
      ).toBeDefined();
    }
  });
});
