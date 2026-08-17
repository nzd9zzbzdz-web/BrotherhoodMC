"use client";

import { useState } from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { MEDAL_COLOR, RARITY_COLOR, rarityColor } from "@/lib/rarity";
import { Reveal } from "@/components/motion/Reveal";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LeaderboardCategory, LeaderboardRow } from "@/lib/leaderboard";

/**
 * The Standings tab: the riding club ranked on one criminal-record stat, with
 * a category picker at the top. All categories arrive precomputed from the
 * server, so switching is instant — no refetch, no spinner.
 *
 * Reads like a podium: the top three take medal colors, everyone below rides
 * in plain steel. The member whose profile this is gets the lit row, so the
 * page answers "where do I stand" at a glance.
 */


function Rank({ rank }: { rank: number }) {
  const medal = MEDAL_COLOR[rank];
  return (
    <span
      className={
        "font-stat flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold " +
        (medal ? "" : "border-border text-muted-foreground")
      }
      style={
        medal
          ? {
              borderColor: medal,
              color: medal,
              boxShadow: `0 0 10px ${medal}44`,
            }
          : undefined
      }
    >
      {rank}
    </span>
  );
}

function Row({
  row,
  orgSlug,
  isSubject,
  isViewer,
}: {
  row: LeaderboardRow;
  orgSlug: string;
  isSubject: boolean;
  isViewer: boolean;
}) {
  const emblemColor = row.topEmblem
    ? (rarityColor(row.topEmblem.rarity) ?? RARITY_COLOR.common)
    : null;

  // The podium: first through third wear their medal on the row itself — a
  // tinted left edge bleeding into a soft bloom, so the top of the board reads
  // as a podium at a glance instead of three rows that happen to be first.
  // Painted as an inset shadow rather than a border so no row shifts a pixel,
  // and left OFF the lit subject row: two competing tints on one row is noise.
  const medal = MEDAL_COLOR[row.rank];
  const podium =
    medal && !isSubject
      ? {
          boxShadow: `inset 3px 0 0 ${medal}, inset 16px 0 22px -18px ${medal}, 0 14px 32px -24px rgb(0 0 0 / 0.9)`,
        }
      : undefined;

  return (
    <>
      <Link
        href={`/${orgSlug}/portal/brotherhood/${row.memberId}`}
        aria-current={isSubject ? "true" : undefined}
        style={podium}
        className={
          "glass-card glass-hover flex items-center gap-3 rounded-lg p-3 sm:gap-4 " +
          (isSubject ? "border-primary/60 bg-primary/10" : "")
        }
      >
        <Rank rank={row.rank} />

        {/* Full-body render cropped to the head — same art the roster uses,
            worn as an avatar here. */}
        <span className="size-10 shrink-0 overflow-hidden rounded-full border border-border bg-background">
          {/* eslint-disable-next-line @next/next/no-img-element -- render route / static art, already sized */}
          <img
            src={row.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className={
              "size-full object-cover object-top " +
              (row.hasRender ? "" : "opacity-30 grayscale")
            }
          />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold text-foreground">
              &ldquo;{row.roadName}&rdquo;
            </span>
            {isViewer && (
              <span className="shrink-0 rounded border border-primary/50 bg-primary/10 px-1 py-px text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-primary">
                You
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {row.displayName}
          </span>
        </span>

        {/* The level they hold: emblem art when the club uploaded it, then the
            name in its rarity color. Hidden on small screens — rank, name and
            number are the load-bearing columns. */}
        <span className="hidden min-w-0 items-center gap-2 sm:flex sm:w-40">
          {row.topEmblem ? (
            <>
              {row.topEmblem.artUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- served by the art route, already sized
                <img
                  src={row.topEmblem.artUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-8 shrink-0 object-contain"
                  style={{ filter: `drop-shadow(0 0 6px ${emblemColor}55)` }}
                />
              )}
              <span className="min-w-0">
                <span
                  className="block truncate text-xs font-semibold"
                  style={{ color: emblemColor ?? undefined }}
                >
                  {row.topEmblem.name}
                </span>
                <span className="font-stat block text-[0.65rem] text-muted-foreground">
                  {row.level}/{row.levelTotal}
                </span>
              </span>
            </>
          ) : (
            <span className="text-xs italic text-muted-foreground/60">
              No level yet
            </span>
          )}
        </span>

        <span className="shrink-0 text-right">
          <span className="font-stat block text-base font-semibold text-primary">
            {row.valueLabel}
          </span>
          {row.nextName && (
            <span className="block text-[0.65rem] text-muted-foreground">
              <span className="font-stat">{row.pct}%</span> to {row.nextName}
            </span>
          )}
        </span>
      </Link>
    </>
  );
}

export function Leaderboard({
  categories,
  orgSlug,
  subjectMemberId,
  viewerMemberId,
}: {
  categories: LeaderboardCategory[];
  orgSlug: string;
  /** The member whose profile this tab sits on — their row is lit. */
  subjectMemberId: string;
  /** The signed-in viewer — their row gets a "You" chip. */
  viewerMemberId: string | null;
}) {
  const [statKey, setStatKey] = useState<string>(categories[0]?.statKey ?? "");
  const category =
    categories.find((c) => c.statKey === statKey) ?? categories[0] ?? null;

  return (
    <section
      aria-label="Standings"
      className="texture-noise glass-card rounded-xl p-6 md:p-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <DisplayHeading as="h2" className="text-2xl text-foreground md:text-3xl">
            Standings
          </DisplayHeading>
          <p className="mt-1 text-sm text-muted-foreground">
            The whole club, ranked. Pick the count that matters to you.
          </p>
        </div>

        <Select value={category?.statKey ?? ""} onValueChange={setStatKey}>
          <SelectTrigger
            aria-label="Leaderboard category"
            className=""          >
            <Trophy className="size-4 text-muted-foreground" aria-hidden />
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.statKey} value={c.statKey}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!category || category.rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Nobody on the board yet.
        </p>
      ) : (
        // Rows drop in from the top down, so the board reads as a podium
        // filling rather than a list appearing. Stagger caps at the tenth row:
        // past that the delay stops meaning anything and just feels slow.
        <ol className="mt-6 space-y-2">
          {category.rows.map((row, i) => (
            <Reveal key={row.memberId} as="li" delay={Math.min(i, 9) * 0.045}>
              <Row
                row={row}
                orgSlug={orgSlug}
                isSubject={row.memberId === subjectMemberId}
                isViewer={viewerMemberId !== null && row.memberId === viewerMemberId}
              />
            </Reveal>
          ))}
        </ol>
      )}
    </section>
  );
}
