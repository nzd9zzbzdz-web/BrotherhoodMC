import { composeLadders, type Ladder } from "@/lib/patch-ladders";
import type { AwardedPatch, Member, Patch, StatKey } from "@/lib/types";

/**
 * Club standings: every member ranked on one criminal-record stat, one board
 * per emblem ladder. The Standings tab on a member's profile renders these
 * with a category picker.
 *
 * Pure resolver, same discipline as composeServiceRecord: no I/O, no
 * framework, and the output is plain serializable data — it crosses to a
 * client component, so no Timestamps, no Maps, no closures. Formatting
 * happens HERE for the same reason: the ladder's `format` functions can't
 * cross the boundary.
 *
 * It leans on composeLadders per member rather than re-deriving levels, so
 * "what level is this member at" keeps its single definition — manual awards
 * that leapfrog a threshold, retired-but-earned tiers, and segment progress
 * all behave exactly as they do on the Emblems tab.
 */

export interface LeaderboardRow {
  memberId: string;
  roadName: string;
  displayName: string;
  memberNumber: number;
  /** Competition ranking: ties share a rank, the next value skips (1,2,2,4). */
  rank: number;
  value: number;
  valueLabel: string;
  /** Highest emblem earned on this ladder — the level they hold. */
  topEmblem: { name: string; rarity?: string; artUrl: string | null } | null;
  /** Rungs climbed, e.g. 2 of 5. */
  level: number;
  levelTotal: number;
  /** Next rung being chased, null when the ladder is topped out. */
  nextName: string | null;
  /** Segment progress toward nextName, 0..100 (100 when topped out). */
  pct: number;
  imageUrl: string;
  hasRender: boolean;
}

export interface LeaderboardCategory {
  statKey: StatKey;
  label: string;
  rows: LeaderboardRow[];
}

export interface LeaderboardInput {
  members: Member[];
  /** memberId → their awards; the shape listAwardsByMember already returns. */
  awardsByMember: Map<string, AwardedPatch[]>;
  patches: Patch[];
  /** Patch id → served art URL, or null. Injected — the caller owns the org id. */
  artUrlFor: (patchId: string) => string | null;
  /** Member id → avatar URL + whether it's a real render (vs the silhouette). */
  imageFor: (memberId: string) => { url: string; hasRender: boolean };
}

/**
 * Retired and exiled members sit out — the roster draws the same line. A
 * leaderboard is competition among the riding club; past colors topping every
 * board forever would make the whole thing static.
 */
const OUT_OF_COMPETITION: Member["status"][] = ["retired", "exiled"];

export function composeLeaderboard(input: LeaderboardInput): LeaderboardCategory[] {
  const { members, awardsByMember, patches, artUrlFor, imageFor } = input;

  const riding = members.filter((m) => !OUT_OF_COMPETITION.includes(m.status));

  // One composeLadders run per member. Cheap (pure array work), and it means
  // every rule the Emblems tab follows holds here for free.
  const laddersByMember = new Map<string, Ladder[]>(
    riding.map((m) => [
      m.id,
      composeLadders({
        patches,
        awards: awardsByMember.get(m.id) ?? [],
        stats: m.stats,
      }),
    ]),
  );

  // Category list: union of every member's ladders, in the order composeLadders
  // already emits (criminal record first). Members can differ — a retired
  // emblem shows only for whoever earned it — so the union keeps a stat from
  // vanishing off the picker just because one member's ladder is richer.
  const categories: { statKey: StatKey; ladder: Ladder }[] = [];
  const seen = new Set<StatKey>();
  for (const ladders of laddersByMember.values()) {
    for (const ladder of ladders) {
      if (seen.has(ladder.statKey)) continue;
      seen.add(ladder.statKey);
      categories.push({ statKey: ladder.statKey, ladder });
    }
  }

  return categories.map(({ statKey, ladder: canonical }) => {
    const rows = riding
      .map((member) => {
        const ladder = laddersByMember
          .get(member.id)!
          .find((l) => l.statKey === statKey);
        const value = member.stats?.[statKey] ?? 0;
        const top = ladder?.top ?? null;
        const image = imageFor(member.id);

        return {
          memberId: member.id,
          roadName: member.roadName,
          displayName: member.displayName,
          memberNumber: member.memberNumber,
          rank: 0, // assigned after the sort
          value,
          valueLabel: (ladder ?? canonical).format(value),
          topEmblem: top
            ? {
                name: top.patch.name,
                rarity: top.patch.rarity,
                artUrl: artUrlFor(top.patch.id),
              }
            : null,
          level: ladder?.earnedCount ?? 0,
          levelTotal: ladder?.tiers.length ?? canonical.tiers.length,
          nextName: ladder?.next?.patch.name ?? null,
          pct: ladder?.pct ?? 0,
          imageUrl: image.url,
          hasRender: image.hasRender,
        };
      })
      // Value decides the board; seniority (member number) breaks the display
      // order of ties so the list is stable, but tied values share a rank.
      .sort((a, b) => b.value - a.value || a.memberNumber - b.memberNumber);

    rows.forEach((row, i) => {
      row.rank = i > 0 && rows[i - 1].value === row.value ? rows[i - 1].rank : i + 1;
    });

    return {
      statKey,
      label: canonical.label,
      rows,
    };
  });
}
