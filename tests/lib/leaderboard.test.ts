/**
 * The Standings composer — pure over members, awards and patches, so no
 * emulator. What matters here is the ranking math (competition ranks, tie
 * order), who competes at all, and that the output stays flat enough to hand
 * to a client component.
 */
import { describe, expect, it } from "vitest";
import { composeLeaderboard } from "@/lib/leaderboard";
import type { AwardedPatch, Member, MemberStatus, Patch, StatKey } from "@/lib/types";

function patch(id: string, statKey: StatKey, threshold: number): Patch {
  return {
    id,
    name: id,
    category: "activity",
    description: `${threshold} of ${statKey}`,
    tier: 1,
    rarity: "rare",
    requirement: { statKey, threshold },
    manual: false,
    active: true,
    emblem: true,
    defaultPlacement: { surface: "back", u: 0.5, v: 0.5, scale: 0.8, rotationDeg: 0 },
  };
}

function member(
  id: string,
  memberNumber: number,
  stats: Partial<Record<StatKey, number>>,
  status: MemberStatus = "patched",
): Member {
  return {
    id,
    uid: null,
    displayName: `Name ${id}`,
    roadName: `Road ${id}`,
    rankId: "r1",
    status,
    joinDate: new Date("2026-01-01"),
    memberNumber,
    stats: stats as Member["stats"],
    patchCount: 0,
    createdAt: new Date("2026-01-01"),
  };
}

function award(memberId: string, patchId: string): AwardedPatch {
  return {
    id: `${memberId}_${patchId}`,
    memberId,
    patchId,
    awardedAt: new Date("2026-03-01"),
    awardedBy: "system",
  };
}

const PATCHES = [
  patch("d1", "drugSales", 1_000),
  patch("d2", "drugSales", 5_000),
  patch("h1", "heistsCompleted", 3),
];

const noImages = (id: string) => ({ url: `/img/${id}`, hasRender: false });

function compose(
  members: Member[],
  awards: AwardedPatch[] = [],
  artUrlFor: (id: string) => string | null = () => null,
) {
  const byMember = new Map<string, AwardedPatch[]>();
  for (const a of awards) {
    const list = byMember.get(a.memberId);
    if (list) list.push(a);
    else byMember.set(a.memberId, [a]);
  }
  return composeLeaderboard({
    members,
    awardsByMember: byMember,
    patches: PATCHES,
    artUrlFor,
    imageFor: noImages,
  });
}

describe("composeLeaderboard", () => {
  it("ranks by the stat, highest first", () => {
    const boards = compose([
      member("a", 1, { drugSales: 100 }),
      member("b", 2, { drugSales: 900 }),
      member("c", 3, { drugSales: 500 }),
    ]);
    const drugs = boards.find((b) => b.statKey === "drugSales")!;
    expect(drugs.rows.map((r) => [r.memberId, r.rank])).toEqual([
      ["b", 1],
      ["c", 2],
      ["a", 3],
    ]);
  });

  it("gives tied values the same rank and skips the next (1,2,2,4)", () => {
    const boards = compose([
      member("a", 1, { drugSales: 500 }),
      member("b", 2, { drugSales: 900 }),
      member("c", 3, { drugSales: 500 }),
      member("d", 4, { drugSales: 10 }),
    ]);
    const drugs = boards.find((b) => b.statKey === "drugSales")!;
    expect(drugs.rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    // Ties display in seniority order — lower member number first.
    expect(drugs.rows.map((r) => r.memberId)).toEqual(["b", "a", "c", "d"]);
  });

  it("keeps zero-stat members on the board, tied at the bottom", () => {
    const boards = compose([
      member("a", 1, { drugSales: 100 }),
      member("b", 2, {}),
      member("c", 3, {}),
    ]);
    const drugs = boards.find((b) => b.statKey === "drugSales")!;
    expect(drugs.rows).toHaveLength(3);
    expect(drugs.rows.map((r) => r.rank)).toEqual([1, 2, 2]);
  });

  it("leaves retired and exiled members off every board", () => {
    const boards = compose([
      member("a", 1, { drugSales: 100 }),
      member("ghost", 2, { drugSales: 9_999 }, "retired"),
      member("out", 3, { drugSales: 8_888 }, "exiled"),
    ]);
    const drugs = boards.find((b) => b.statKey === "drugSales")!;
    expect(drugs.rows.map((r) => r.memberId)).toEqual(["a"]);
    expect(drugs.rows[0].rank).toBe(1);
  });

  it("reports the level held from awards, not from the raw stat", () => {
    // A manual award can leapfrog the stat; the board shows what was awarded,
    // same as the Emblems tab.
    const boards = compose(
      [member("a", 1, { drugSales: 10 })],
      [award("a", "d1"), award("a", "d2")],
      (id) => (id === "d2" ? "/api/art/d2?v=3" : null),
    );
    const row = boards.find((b) => b.statKey === "drugSales")!.rows[0];
    expect(row.topEmblem).toEqual({ name: "d2", rarity: "rare", artUrl: "/api/art/d2?v=3" });
    expect(row.level).toBe(2);
    expect(row.levelTotal).toBe(2);
    expect(row.nextName).toBeNull();
    expect(row.pct).toBe(100);
  });

  it("shows the chase: next rung name and segment progress", () => {
    const boards = compose(
      [member("a", 1, { drugSales: 3_000 })],
      [award("a", "d1")],
    );
    const row = boards.find((b) => b.statKey === "drugSales")!.rows[0];
    expect(row.topEmblem?.name).toBe("d1");
    expect(row.nextName).toBe("d2");
    // 3,000 into the 1,000→5,000 segment = 50%.
    expect(row.pct).toBe(50);
  });

  it("builds one category per ladder stat and none for unladdered stats", () => {
    const boards = compose([
      member("a", 1, { drugSales: 1, heistsCompleted: 2, crimesCommitted: 50 }),
    ]);
    expect(boards.map((b) => b.statKey).sort()).toEqual([
      "drugSales",
      "heistsCompleted",
    ]);
  });

  it("emits only serializable data — no Dates, Maps, or functions", () => {
    const boards = compose(
      [member("a", 1, { drugSales: 3_000 }), member("b", 2, {})],
      [award("a", "d1")],
    );
    // JSON round-trip is the boundary a client component enforces.
    expect(JSON.parse(JSON.stringify(boards))).toEqual(boards);
  });
});
