import type { AwardedPatch, Patch, ServiceRecordEntry } from "@/lib/types";

/**
 * Pure resolver: (join date + patch awards + stored career log) → the rows the
 * Service Record panel renders, newest first.
 *
 * The club records a member's history in three places and never joined them up:
 * the `serviceRecord` subcollection (rank/role changes, written by the member
 * actions), `awardedPatches`, and the join date on the member doc. This merges
 * them as a derived view rather than backfilling a fourth collection — so it
 * works for members who joined years ago and can never drift from the awards.
 *
 * No I/O, no framework: unit-testable, same as buildRenderModel.
 */

export type ServiceRecordKind = "joined" | "patch" | "promotion" | "removal";

export interface ServiceRecordItem {
  id: string;
  kind: ServiceRecordKind;
  title: string;
  detail?: string;
  dateLabel: string;
  dateISO: string;
  /** Patch rows only, and only when the org uploaded artwork for that patch. */
  artUrl?: string;
}

export interface ServiceRecordInput {
  memberNumber: number;
  joinDate?: unknown; // Timestamp | Date
  awards: AwardedPatch[];
  patchById: Map<string, Patch>;
  career: ServiceRecordEntry[];
  /**
   * Patch id → artwork URL. Injected rather than looked up here so this stays
   * pure: the caller owns the org id and the art versions map. Omitted (or
   * returning null) leaves the row on its category icon.
   */
  artUrlFor?: (patchId: string) => string | null;
}

const DATE_FMT: Intl.DateTimeFormatOptions = {
  month: "long",
  day: "numeric",
  year: "numeric",
};

/** Same-timestamp ordering, top to bottom. Joining is always the floor. */
const TIE_ORDER: Record<ServiceRecordKind, number> = {
  removal: 0,
  promotion: 1,
  patch: 2,
  joined: 3,
};

/** Firestore Timestamp or Date → Date. Anything else (a pending server
 *  timestamp reads back null) drops the row rather than dating it to 1970. */
function toDate(value: unknown): Date | null {
  const ts = value as { toDate?: () => Date } | Date | undefined;
  if (ts instanceof Date) return ts;
  if (typeof ts?.toDate === "function") return ts.toDate();
  return null;
}

function row(
  id: string,
  kind: ServiceRecordKind,
  title: string,
  detail: string | undefined,
  at: unknown,
  artUrl?: string | null,
): (ServiceRecordItem & { atMs: number }) | null {
  const date = toDate(at);
  if (!date) return null;
  return {
    id,
    kind,
    title,
    detail: detail || undefined,
    dateLabel: date.toLocaleDateString("en-US", DATE_FMT),
    dateISO: date.toISOString(),
    ...(artUrl ? { artUrl } : {}),
    atMs: date.getTime(),
  };
}

/**
 * Emblems ship as five-rung ladders across eleven stats, so a working member
 * earns dozens — listing every rung turns a career timeline into an achievement
 * feed and buries joining, being patched in, and promotions.
 *
 * Only the top rung of each emblem ladder earns a row: the level reached, not
 * every step toward it. No history is lost — the Emblems tab on the profile
 * shows every rung with the date it landed.
 *
 * Patches are left alone. There are few of them, they're worn on the cut, and
 * each one is its own milestone — Road Warrior doesn't stop counting because
 * Iron Rider followed it.
 */
function milestoneAwards(
  awards: AwardedPatch[],
  patchById: Map<string, Patch>,
): AwardedPatch[] {
  const topByStat = new Map<string, AwardedPatch>();
  const standalone: AwardedPatch[] = [];

  for (const award of awards) {
    const patch = patchById.get(award.patchId);
    if (patch?.emblem !== true || !patch.requirement) {
      standalone.push(award);
      continue;
    }
    const { statKey, threshold } = patch.requirement;
    const held = topByStat.get(statKey);
    const heldThreshold = held
      ? (patchById.get(held.patchId)?.requirement?.threshold ?? 0)
      : -1;
    if (threshold > heldThreshold) topByStat.set(statKey, award);
  }

  return [...standalone, ...topByStat.values()];
}

export function composeServiceRecord(input: ServiceRecordInput): ServiceRecordItem[] {
  const { memberNumber, joinDate, awards, patchById, career, artUrlFor } = input;

  const rows = [
    row("joined", "joined", "Joined the club", `Member #${memberNumber}.`, joinDate),
    ...milestoneAwards(awards, patchById).map((award) => {
      const patch = patchById.get(award.patchId);
      return row(
        `award-${award.id}`,
        "patch",
        `Earned the "${patch?.name ?? award.patchId}" patch`,
        award.reason || patch?.description,
        award.awardedAt,
        artUrlFor?.(award.patchId),
      );
    }),
    ...career.map((item) => row(item.id, item.kind, item.title, item.detail, item.at)),
  ].filter((r): r is ServiceRecordItem & { atMs: number } => r !== null);

  // Newest first, and on a tie the join sinks to the bottom: same-day rows are
  // common (a patch awarded the day someone is patched in, or demo data dated
  // to the join), and "Joined the club" sitting on top of its own consequences
  // reads as if they joined last.
  rows.sort((a, b) => b.atMs - a.atMs || TIE_ORDER[a.kind] - TIE_ORDER[b.kind]);

  return rows.map(({ atMs: _atMs, ...item }) => item);
}
