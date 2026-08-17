import { CRIMINAL_RECORD_ROWS, STAT_LABELS } from "@/lib/constants";
import type { StatKey } from "@/lib/types";

/**
 * Group the admin patch table by ladder.
 *
 * Sixty-two patches sorted by name interleaves every ladder — Armorer, Arms
 * Dealer, Badge Hunter, Big Earner — so the five rungs of a trade are scattered
 * across the page and there is no way to see a ladder as a ladder. Grouping by
 * the stat they measure puts each one together, and ordering by threshold
 * inside the group makes the rows read bottom rung to top.
 *
 * Pure, so the ordering is testable without rendering a table.
 */

export interface GroupablePatch {
  id: string;
  name: string;
  active: boolean;
  requirement: { statKey: StatKey; threshold: number } | null;
}

export interface PatchGroup<T extends GroupablePatch> {
  key: string;
  label: string;
  /** Ladder position is meaningful here — render tier numerals. */
  laddered: boolean;
  patches: T[];
}

const MANUAL_KEY = "__manual";
const RETIRED_KEY = "__retired";

/** Criminal record first, in panel order — the same spine the profile uses. */
const CRIMINAL_ORDER = CRIMINAL_RECORD_ROWS.map((r) => r.statKey);

export function groupPatches<T extends GroupablePatch>(patches: T[]): PatchGroup<T>[] {
  const byStat = new Map<string, T[]>();
  const manual: T[] = [];
  const retired: T[] = [];

  for (const patch of patches) {
    // A disabled patch is history, not a rung — it would otherwise leave a dead
    // row in the middle of a live ladder, or a group of one for a stat nobody
    // logs any more.
    if (!patch.active) {
      retired.push(patch);
      continue;
    }
    if (!patch.requirement) {
      manual.push(patch);
      continue;
    }
    const list = byStat.get(patch.requirement.statKey);
    if (list) list.push(patch);
    else byStat.set(patch.requirement.statKey, [patch]);
  }

  const statKeys = [...byStat.keys()].sort((a, b) => {
    const ai = CRIMINAL_ORDER.indexOf(a as StatKey);
    const bi = CRIMINAL_ORDER.indexOf(b as StatKey);
    // Criminal stats lead in panel order; everything else falls in behind,
    // alphabetically by the label an admin actually reads.
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return (STAT_LABELS[a as StatKey] ?? a).localeCompare(STAT_LABELS[b as StatKey] ?? b);
  });

  const groups: PatchGroup<T>[] = statKeys.map((statKey) => ({
    key: statKey,
    label: STAT_LABELS[statKey as StatKey] ?? statKey,
    laddered: true,
    patches: [...byStat.get(statKey)!].sort(
      (a, b) =>
        a.requirement!.threshold - b.requirement!.threshold ||
        a.name.localeCompare(b.name),
    ),
  }));

  if (manual.length > 0) {
    groups.push({
      key: MANUAL_KEY,
      label: "Awarded by leadership",
      laddered: false,
      patches: manual.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  if (retired.length > 0) {
    groups.push({
      key: RETIRED_KEY,
      label: "Retired",
      laddered: false,
      patches: retired.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  return groups;
}

/** Case-insensitive match on name, description or the stat it measures. */
export function patchMatchesQuery(
  patch: GroupablePatch & { description?: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const statLabel = patch.requirement
    ? (STAT_LABELS[patch.requirement.statKey] ?? "")
    : "";
  return (
    patch.name.toLowerCase().includes(q) ||
    (patch.description ?? "").toLowerCase().includes(q) ||
    statLabel.toLowerCase().includes(q)
  );
}
