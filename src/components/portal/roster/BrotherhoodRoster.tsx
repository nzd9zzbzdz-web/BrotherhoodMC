"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { RosterCard } from "./RosterCard";
import type { RosterMember, TierKey } from "./types";

const TIERS: { key: TierKey; label: string; blurb: string }[] = [
  { key: "officers", label: "Officers", blurb: "Those who carry the gavel." },
  { key: "patched", label: "Patched Members", blurb: "Full colors, earned." },
  { key: "prospects", label: "Prospects", blurb: "Earning their bottom rocker." },
  { key: "hangarounds", label: "Hangarounds", blurb: "Around, but not in yet." },
];

type SortKey = "rank" | "seniority" | "patches" | "name";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "rank", label: "Rank" },
  { key: "seniority", label: "Seniority" },
  { key: "patches", label: "Patches" },
  { key: "name", label: "Road name" },
];

// Sorts apply within a tier — the club hierarchy always frames the wall.
const COMPARATORS: Record<SortKey, (a: RosterMember, b: RosterMember) => number> = {
  rank: (a, b) => a.rankOrder - b.rankOrder || a.memberNumber - b.memberNumber,
  seniority: (a, b) =>
    (a.joinedAtMs || Number.MAX_SAFE_INTEGER) - (b.joinedAtMs || Number.MAX_SAFE_INTEGER),
  patches: (a, b) => b.patchCount - a.patchCount || a.rankOrder - b.rankOrder,
  name: (a, b) => a.roadName.localeCompare(b.roadName),
};

export function BrotherhoodRoster({
  orgSlug,
  members,
  pastColors,
  viewerCanManageArt,
  backdropPath,
}: {
  orgSlug: string;
  members: RosterMember[];
  pastColors: RosterMember[];
  viewerCanManageArt: boolean;
  /** Club backdrop drawn behind every figure on the wall. */
  backdropPath?: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("rank");

  const tiers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? members.filter(
          (m) =>
            m.roadName.toLowerCase().includes(q) ||
            m.displayName.toLowerCase().includes(q) ||
            m.rankName.toLowerCase().includes(q),
        )
      : members;

    return TIERS.map((tier) => ({
      ...tier,
      list: matches
        .filter((m) => m.tier === tier.key)
        .sort(COMPARATORS[sort]),
    })).filter((tier) => tier.list.length > 0);
  }, [members, query, sort]);

  const matchCount = tiers.reduce((n, t) => n + t.list.length, 0);

  return (
    <div className="space-y-8">
      {/* Framed to match the plate above: `etched-plate` draws the outer
          stroke, each control's own border is the inner one. The extra
          gap absorbs the 3px outline-offset so the strokes don't touch. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-4 px-1">
        <div className="etched-plate relative min-w-56 flex-1 rounded-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search road name, legal name, or rank"
            aria-label="Search the brotherhood"
            className="pl-9"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger
            className="etched-plate w-44"
            aria-label="Sort members"
          >
            {/* Explicit children: Radix resolves item text only after hydration,
                which would leave the trigger blank on first paint. */}
            <SelectValue>
              Sort by {SORTS.find((s) => s.key === sort)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                Sort by {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {matchCount === 0 && (
        <p className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Nobody under the colors matches &ldquo;{query}&rdquo;.
        </p>
      )}

      {tiers.map(({ key, label, blurb, list }) => (
        <section key={key} aria-labelledby={`tier-${key}`}>
          <div className="flex items-baseline gap-3 border-b border-border pb-2">
            <h2
              id={`tier-${key}`}
              className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground/70"
            >
              {label}
            </h2>
            <span className="font-stat text-xs text-muted-foreground">{list.length}</span>
            <span className="ml-auto hidden text-xs italic text-muted-foreground sm:block">
              {blurb}
            </span>
          </div>
          <div
            className={cn(
              "mt-4 grid gap-4",
              // Officers ride bigger: fewer columns, so their frames read first.
              // The column count deliberately stops climbing past `xl` — the
              // gallery width is spent on BIGGER cards, not more of them. A
              // sixth column on a wide monitor would hand the extra pixels
              // straight back and leave the renders the size they were.
              key === "officers"
                ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
            )}
          >
            {list.map((member) => (
              <RosterCard
                key={member.id}
                orgSlug={orgSlug}
                member={member}
                viewerCanManageArt={viewerCanManageArt}
                backdropPath={backdropPath}
              />
            ))}
          </div>
        </section>
      ))}

      {pastColors.length > 0 && <PastColors orgSlug={orgSlug} members={pastColors} />}
    </div>
  );
}

/** Riders who hung it up or got stripped — off the wall, still on the books. */
function PastColors({
  orgSlug,
  members,
}: {
  orgSlug: string;
  members: RosterMember[];
}) {
  return (
    <details className="group rounded-xl border border-border/60 bg-card/40 px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>
        Past Colors
        <span className="font-stat text-xs normal-case tracking-normal">
          {members.length}
        </span>
      </summary>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => {
          const exiled = m.status === "exiled";
          return (
            <li key={m.id}>
              <Link
                href={`/${orgSlug}/portal/brotherhood/${m.id}`}
                className="flex items-baseline gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary/60"
              >
                <span
                  className={cn(
                    "truncate text-base",
                    exiled ? "text-muted-foreground line-through" : "text-muted-foreground",
                  )}
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {m.roadName}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[0.55rem] uppercase tracking-[0.14em]",
                    exiled ? "text-destructive" : "text-muted-foreground/70",
                  )}
                >
                  {exiled ? "Out bad" : "Retired"}
                </span>
                <span className="ml-auto shrink-0 text-[0.65rem] text-muted-foreground/60">
                  {m.rankName} · {m.joinedLabel}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
