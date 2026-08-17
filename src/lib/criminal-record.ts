import {
  ACTIVITY_TYPE_SEEDS,
  CRIMINAL_ACTIVITY_TYPE_SEEDS,
  CRIMINAL_RECORD_ROWS,
} from "@/lib/constants";
import type { Member, RapSheetEntry, StatKey } from "@/lib/types";

/**
 * Shared by the admin "sync default types" action and
 * `scripts/migrate-criminal-record.ts`. Deliberately free of `server-only` and
 * of firebase-admin so both a Server Action and a plain tsx script can use it —
 * the seed lists drifted between a script and the app once before.
 */

export interface ActivityTypeSeed {
  id: string;
  name: string;
  statKey: StatKey;
  requiresProof: boolean;
  allowQuantity: boolean;
  icon: string;
}

/** Every activity type the app ships with, in canonical order. */
export function defaultActivityTypes(): ActivityTypeSeed[] {
  return [
    ...ACTIVITY_TYPE_SEEDS.map((t) => ({
      ...t,
      // Matches the id the seeder derives from the name.
      id: t.name.toLowerCase().replace(/[^a-z]+/g, "-"),
    })),
    ...CRIMINAL_ACTIVITY_TYPE_SEEDS,
  ];
}

/** "96 mo" → 96 · "$2.4M" → 2400000 · "187" → 187 · unparseable → null. */
export function parseRapValue(raw: string): number | null {
  const text = raw.trim();
  const money = /^\$\s*([\d,.]+)\s*([KM])?$/i.exec(text);
  if (money) {
    const n = Number(money[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    const suffix = money[2]?.toUpperCase();
    return Math.round(n * (suffix === "M" ? 1_000_000 : suffix === "K" ? 1_000 : 1));
  }
  const plain = /^([\d,.]+)/.exec(text);
  if (!plain) return null;
  const n = Number(plain[1].replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

const STAT_BY_ROW_LABEL = new Map(
  CRIMINAL_RECORD_ROWS.map((r) => [r.label.toLowerCase(), r.statKey]),
);

/**
 * Stat updates implied by a member's legacy hand-authored rap sheet. Returns
 * only rows that parse to a non-zero number AND whose stat is still empty —
 * an approved log always beats a typed-in value, so re-running is a no-op.
 */
export function rapSheetToStats(member: Member): Partial<Record<StatKey, number>> {
  const updates: Partial<Record<StatKey, number>> = {};
  for (const entry of (member.rapSheet ?? []) as RapSheetEntry[]) {
    const statKey = STAT_BY_ROW_LABEL.get(entry.label?.trim().toLowerCase() ?? "");
    if (!statKey) continue;
    if ((member.stats?.[statKey] ?? 0) > 0) continue;
    const value = parseRapValue(String(entry.value ?? ""));
    if (value === null || value === 0) continue;
    updates[statKey] = value;
  }
  return updates;
}
