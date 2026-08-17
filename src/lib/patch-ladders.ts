import { CRIMINAL_RECORD_ROWS, PATCH_LADDERS, STAT_LABELS } from "@/lib/constants";
import type { AwardedPatch, Patch, StatKey } from "@/lib/types";

/**
 * View model for the Patches tab on a member's profile: every criminal-record
 * emblem grouped into a ladder per stat, so progression reads as levels — the
 * feel of levelling an emblem in a game rather than a flat wall of names.
 *
 * Emblems only (`patch.emblem === true`). Patches worn on the cut have their
 * own home on the Patch Wall; this tab is the achievement system.
 *
 * The ladders are built from the org's OWN patch docs, not from PATCH_LADDERS —
 * an admin who retunes a threshold or renames a tier should see that on the
 * profile, and an org-authored emblem on the same stat slots into the ladder
 * for free. PATCH_LADDERS only decides the order the ladders appear in.
 *
 * Free of `server-only` and firebase-admin so the profile page, the patch wall
 * and tests can all share one definition of "what level is this member at".
 */

export interface LadderTier {
  patch: Patch;
  tier: number; // 1-based position in THIS ladder, not patch.tier
  threshold: number;
  earned: boolean;
  awardedAt: Date | null;
}

export interface Ladder {
  statKey: StatKey;
  label: string;
  /** Raw stat rendered for display — dollars and months carry units. */
  format: (n: number) => string;
  current: number;
  tiers: LadderTier[];
  earnedCount: number;
  /** Highest tier earned, or null if the ladder hasn't started. */
  top: LadderTier | null;
  /** Next tier to chase, or null once the ladder is topped out. */
  next: LadderTier | null;
  /**
   * Progress across the CURRENT segment (previous threshold → next), not from
   * zero. Measuring from zero would show a member who just earned tier III at
   * 15,000 as "38% to 40,000" when they have barely started the climb.
   */
  pct: number;
}

/**
 * Ladder display order. The criminal record leads, in the same order as the
 * panel on the character stage; any other stat carrying patches (club runs,
 * church) falls in behind it rather than being dropped.
 */
const LADDER_ORDER: StatKey[] = PATCH_LADDERS.map((l) => l.statKey);

const FORMAT_BY_STAT = new Map<StatKey, (n: number) => string>(
  CRIMINAL_RECORD_ROWS.filter((r) => r.format).map((r) => [r.statKey, r.format!]),
);

const plain = (n: number) => n.toLocaleString("en-US");

export function composeLadders({
  patches,
  awards,
  stats,
}: {
  patches: Patch[];
  awards: AwardedPatch[];
  stats: Partial<Record<StatKey, number>> | undefined;
}): Ladder[] {
  const awardedAtById = new Map(
    awards.map((a) => [
      a.patchId,
      // Firestore Timestamp on the server, Date once serialized.
      (a.awardedAt as { toDate?: () => Date })?.toDate?.() ??
        (a.awardedAt instanceof Date ? a.awardedAt : null),
    ]),
  );

  const byStat = new Map<StatKey, Patch[]>();
  for (const patch of patches) {
    // Emblems only. Club patches (Road Warrior, Faithful) are threshold-driven
    // too, but they are worn on the cut and belong on the Patch Wall — mixing
    // them in would put two-rung ladders next to five-rung ones.
    if (patch.emblem !== true) continue;
    if (!patch.requirement) continue;
    // Retired emblems still show if the member earned one — the award is real
    // history — but an unearned retired tier is dead weight on the ladder.
    if (!patch.active && !awardedAtById.has(patch.id)) continue;
    const list = byStat.get(patch.requirement.statKey);
    if (list) list.push(patch);
    else byStat.set(patch.requirement.statKey, [patch]);
  }

  const ordered = [
    ...LADDER_ORDER.filter((k) => byStat.has(k)),
    ...[...byStat.keys()].filter((k) => !LADDER_ORDER.includes(k)),
  ].filter((k, i, all) => all.indexOf(k) === i);

  return ordered.map((statKey) => {
    const current = stats?.[statKey] ?? 0;
    const sorted = [...byStat.get(statKey)!].sort(
      (a, b) => a.requirement!.threshold - b.requirement!.threshold,
    );

    const tiers: LadderTier[] = sorted.map((patch, i) => ({
      patch,
      tier: i + 1,
      threshold: patch.requirement!.threshold,
      earned: awardedAtById.has(patch.id),
      awardedAt: awardedAtById.get(patch.id) ?? null,
    }));

    // The next tier is the first one not yet EARNED, not the first one above
    // the current stat — a manual award can leapfrog, and an officer editing a
    // threshold downward shouldn't strand the ladder.
    const next = tiers.find((t) => !t.earned) ?? null;
    const earnedTiers = tiers.filter((t) => t.earned);
    const top = earnedTiers.length ? earnedTiers[earnedTiers.length - 1] : null;

    const floor = next ? (tiers[next.tier - 2]?.threshold ?? 0) : 0;
    const span = next ? next.threshold - floor : 0;
    const pct = !next
      ? 100
      : span <= 0
        ? 0
        : Math.max(0, Math.min(100, Math.round(((current - floor) / span) * 100)));

    return {
      statKey,
      label: STAT_LABELS[statKey] ?? statKey,
      format: FORMAT_BY_STAT.get(statKey) ?? plain,
      current,
      tiers,
      earnedCount: earnedTiers.length,
      top,
      next,
      pct,
    };
  });
}

/**
 * Where a patch's artwork is served from. The `v` is the art's updatedAt, so a
 * re-upload lands at a new URL and the old one can be cached forever — see the
 * art route. Returns null when the patch has no art, and callers render their
 * lettered-badge fallback.
 */
export function patchArtUrl(
  orgId: string,
  patchId: string,
  versions: Map<string, number>,
): string | null {
  const v = versions.get(patchId);
  if (v === undefined) return null;
  return `/api/orgs/${orgId}/patches/${patchId}/art?v=${v}`;
}

/** "$24.8K" / "24,760" / "180 mo" — what's left before the next tier lands. */
export function remainingLabel(ladder: Ladder): string | null {
  if (!ladder.next) return null;
  return ladder.format(Math.max(0, ladder.next.threshold - ladder.current));
}
