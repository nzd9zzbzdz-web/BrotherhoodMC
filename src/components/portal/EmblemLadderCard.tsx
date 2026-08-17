"use client";

import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { RARITY_COLOR, rarityColor } from "@/lib/rarity";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * One emblem ladder on a member's profile, and the close-up behind it.
 *
 * The rungs on the card are thumbnail-sized by necessity — five to a row,
 * eleven rows deep. Clicking anywhere on the card opens the level they're
 * actually on, blown up big enough to read the artwork; clicking a single rung
 * opens that one instead, and the arrows walk the ladder without closing.
 *
 * Everything it needs is precomputed and serializable (`EmblemLadderView`) —
 * the composer's `format` closures and Firestore Timestamps stay on the server.
 */


const ROMAN = ["I", "II", "III", "IV", "V"];

export interface EmblemRungView {
  id: string;
  name: string;
  description: string;
  rarity?: string;
  /** Streamed by the art route; null when the club uploaded none. */
  artUrl: string | null;
  earned: boolean;
  /** The rung being chased — the only locked one that shows progress. */
  isNext: boolean;
  awardedLabel: string | null; // "March 2, 2026"
  thresholdLabel: string; // "1,000" / "$50K" / "180 mo"
}

export interface EmblemLadderView {
  statKey: string;
  label: string; // "Drug Sales"
  currentLabel: string; // the stat as it reads on the record
  earnedCount: number;
  pct: number;
  remainingLabel: string | null;
  /** Rung the card opens on: the level reached, or the one being chased. */
  activeIndex: number;
  rungs: EmblemRungView[];
}

function color(rung: EmblemRungView): string {
  return rarityColor(rung.rarity) ?? RARITY_COLOR.common;
}

/** Card-sized rung. The button is the whole thing — art and name together. */
function Rung({
  rung,
  numeral,
  onOpen,
}: {
  rung: EmblemRungView;
  numeral: string;
  onOpen: () => void;
}) {
  const c = color(rung);

  return (
    <li className="flex min-w-0 flex-1">
      <button
        type="button"
        onClick={onOpen}
        // Above the card's own click surface, so a rung opens itself rather
        // than the level the member is on.
        className="relative z-10 flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-md p-1 text-center outline-none transition-[transform,background-color] hover:scale-105 hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary/70"
      >
        {rung.artUrl ? (
          // Artwork carries the state itself: earned emblems sit lit in their
          // rarity glow, locked ones go dark and desaturated the way a game
          // greys out an achievement you haven't unlocked.
          <span
            aria-hidden
            className={
              "flex size-9 items-center justify-center rounded-full " +
              (rung.earned ? "" : rung.isNext ? "opacity-60" : "opacity-30")
            }
            style={
              rung.earned
                ? { boxShadow: `0 0 12px ${c}55` }
                : { filter: "grayscale(1) brightness(0.7)" }
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- served by the art route, already sized */}
            <img
              src={rung.artUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-contain"
            />
          </span>
        ) : (
          <span
            aria-hidden
            className={
              "flex size-7 items-center justify-center rounded-full border text-[0.6rem] font-bold " +
              (rung.earned
                ? "border-transparent text-background"
                : rung.isNext
                  ? "border-dashed border-primary/60 bg-transparent text-primary"
                  : "border-border bg-transparent text-muted-foreground/50")
            }
            style={
              rung.earned ? { background: c, boxShadow: `0 0 10px ${c}66` } : undefined
            }
          >
            {rung.earned ? <Check className="size-3.5" strokeWidth={3} /> : numeral}
          </span>
        )}
        <span
          className={
            "text-[0.68rem] leading-tight " +
            (rung.earned
              ? "font-semibold text-foreground"
              : rung.isNext
                ? "text-primary"
                : "text-muted-foreground/60")
          }
          style={rung.earned ? { color: c } : undefined}
        >
          {rung.name}
        </span>
        <span className="sr-only">
          {rung.earned
            ? `Earned${rung.awardedLabel ? ` ${rung.awardedLabel}` : ""}.`
            : `Locked. ${rung.description}.`}{" "}
          Open close-up.
        </span>
      </button>
    </li>
  );
}

/** The close-up: the emblem at a size where the artwork is actually artwork. */
function EmblemCloseUp({
  ladder,
  index,
  onIndex,
}: {
  ladder: EmblemLadderView;
  index: number;
  onIndex: (next: number) => void;
}) {
  const rung = ladder.rungs[index];
  const c = color(rung);
  const numeral = ROMAN[index] ?? String(index + 1);

  return (
    <div>
      <p className="text-center text-[0.65rem] uppercase tracking-[0.28em] text-muted-foreground">
        {ladder.label} · Level {numeral} of {ladder.rungs.length}
      </p>

      <div className="mt-5 flex items-center justify-center gap-2">
        {/* Full glass is fine on these two — they float once inside a dialog,
            not in the ladder grid, so the blur budget allows it. */}
        <button
          type="button"
          aria-label="Previous level"
          disabled={index === 0}
          onClick={() => onIndex(index - 1)}
          className="glass glass-hover shrink-0 rounded-full p-2.5 text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/70 disabled:pointer-events-none disabled:opacity-25"
        >
          <ChevronLeft className="size-5" />
        </button>

        <div className="relative flex size-40 shrink-0 items-center justify-center sm:size-48">
          {/* Rarity light behind the emblem — off when it isn't earned yet. */}
          {rung.earned && (
            <span
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{ background: `radial-gradient(circle, ${c}33, transparent 68%)` }}
            />
          )}
          {rung.artUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- served by the art route
            <img
              src={rung.artUrl}
              alt={`${rung.name} emblem`}
              className="relative size-full object-contain"
              style={
                rung.earned
                  ? { filter: `drop-shadow(0 0 14px ${c}66)` }
                  : { filter: "grayscale(1) brightness(0.65)", opacity: 0.65 }
              }
            />
          ) : (
            <span
              aria-hidden
              className="relative flex size-28 items-center justify-center rounded-full border-2 text-3xl font-bold sm:size-32"
              style={
                rung.earned
                  ? { background: c, borderColor: "transparent", color: "var(--background)" }
                  : { borderColor: "var(--border)", color: "var(--muted-foreground)" }
              }
            >
              {numeral}
            </span>
          )}
        </div>

        <button
          type="button"
          aria-label="Next level"
          disabled={index === ladder.rungs.length - 1}
          onClick={() => onIndex(index + 1)}
          className="glass glass-hover shrink-0 rounded-full p-2.5 text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/70 disabled:pointer-events-none disabled:opacity-25"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      <div className="mt-5 text-center">
        {/* Radix owns the heading (it wires aria-labelledby), so the display
            font comes in as the var rather than via DisplayHeading. */}
        <DialogTitle
          className="text-3xl leading-tight tracking-wide"
          style={{
            fontFamily: "var(--font-display)",
            color: rung.earned ? c : "var(--muted-foreground)",
          }}
        >
          {rung.name}
        </DialogTitle>
        {rung.rarity && (
          <p
            className="mt-1 inline-flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em]"
            style={{ color: c }}
          >
            <span className="size-1.5 rounded-full" style={{ background: c }} />
            {rung.rarity}
          </p>
        )}
        <DialogDescription className="mx-auto mt-3 max-w-sm text-sm">
          {rung.description}
        </DialogDescription>
      </div>

      {/* Where they stand on this rung. The chased one shows the same segment
          progress as the card; the ones beyond it just name their price —
          a bar measured from zero would flatter a member who has barely
          started the climb. */}
      <div className="glass-card mt-5 rounded-lg px-4 py-3 text-center text-sm">
        {rung.earned ? (
          <p className="flex items-center justify-center gap-2 font-semibold" style={{ color: c }}>
            <Check className="size-4" strokeWidth={3} aria-hidden />
            Earned{rung.awardedLabel ? ` ${rung.awardedLabel}` : ""}
          </p>
        ) : rung.isNext ? (
          <>
            <div
              role="progressbar"
              aria-valuenow={ladder.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${ladder.label} progress toward ${rung.name}`}
              className="h-1.5 rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary/70"
                style={{
                  width: `${ladder.pct}%`,
                  boxShadow: "0 0 10px color-mix(in srgb, var(--primary) 45%, transparent)",
                }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-stat text-foreground">{ladder.remainingLabel}</span>{" "}
              more to go
              <span className="font-stat ml-2 text-primary">{ladder.pct}%</span>
            </p>
          </>
        ) : (
          <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden />
            Locked, needs{" "}
            <span className="font-stat text-foreground">{rung.thresholdLabel}</span>{" "}
            {ladder.label.toLowerCase()}
          </p>
        )}
      </div>

      {/* Jump straight to any level without closing. */}
      <ul className="mt-4 flex items-center justify-center gap-2">
        {ladder.rungs.map((r, i) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onIndex(i)}
              aria-label={r.name}
              aria-current={i === index}
              className={
                "size-2 rounded-full outline-none transition-transform focus-visible:ring-2 focus-visible:ring-primary/70 " +
                (i === index ? "scale-150" : "opacity-40 hover:opacity-80")
              }
              style={{ background: r.earned ? color(r) : "var(--muted-foreground)" }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EmblemLadderCard({ ladder }: { ladder: EmblemLadderView }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const maxed = ladder.remainingLabel === null;
  const next = ladder.rungs.find((r) => r.isNext) ?? null;

  // glass-card, not glass: these tile two-up in a grid, and a blur per
  // ladder would stack compositor passes. glass-hover because the whole
  // card is one big button — the lift + ember edge is the hover cue the
  // old border tint used to give.
  return (
    <li className="glass-card glass-hover relative rounded-lg p-4 sm:p-5">
      {/* Click surface for the whole card, behind the rungs. A stretched button
          rather than a click handler on the card so it keeps a focus ring and
          reaches the keyboard. */}
      <button
        type="button"
        onClick={() => setOpenIndex(ladder.activeIndex)}
        className="absolute inset-0 z-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
      >
        <span className="sr-only">
          {ladder.label}, open the level {ladder.rungs[ladder.activeIndex]?.name} close-up
        </span>
      </button>

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
          {ladder.label}
        </h3>
        <p className="font-stat text-sm text-muted-foreground">
          <span className="text-primary">{ladder.currentLabel}</span>
          <span className="ml-3 text-xs">
            {ladder.earnedCount}/{ladder.rungs.length}
          </span>
        </p>
      </div>

      <ul className="mt-4 flex items-start justify-between gap-1">
        {ladder.rungs.map((rung, i) => (
          <Rung
            key={rung.id}
            rung={rung}
            numeral={ROMAN[i] ?? String(i + 1)}
            onOpen={() => setOpenIndex(i)}
          />
        ))}
      </ul>

      <div
        role="progressbar"
        aria-valuenow={ladder.pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${ladder.label} progress toward ${next?.name ?? "complete"}`}
        // No overflow-hidden on the track: the fill rounds itself, and the
        // clip would eat the ember glow the fill now throws.
        className="mt-4 h-1.5 rounded-full bg-muted"
      >
        <div
          className={"h-full rounded-full " + (maxed ? "bg-primary" : "bg-primary/70")}
          style={{
            width: `${ladder.pct}%`,
            boxShadow: "0 0 10px color-mix(in srgb, var(--primary) 45%, transparent)",
          }}
        />
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {maxed ? (
          <span className="font-semibold text-primary">Ladder topped out.</span>
        ) : (
          <>
            <span className="font-stat text-foreground">{ladder.remainingLabel}</span> more
            to <span className="font-semibold text-primary">{next?.name}</span>
            <span className="ml-2 font-stat">{ladder.pct}%</span>
          </>
        )}
      </p>

      <Dialog
        open={openIndex !== null}
        onOpenChange={(open) => !open && setOpenIndex(null)}
      >
        {/* The arrow keys live here, not on the close-up: Radix focuses the
            content itself on open, and a keydown there never reaches a handler
            further down the tree. */}
        <DialogContent
          className="sm:max-w-md"
          onKeyDown={(e) => {
            if (openIndex === null) return;
            const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
            if (!step) return;
            const next = openIndex + step;
            if (next < 0 || next >= ladder.rungs.length) return;
            e.preventDefault();
            setOpenIndex(next);
          }}
        >
          {openIndex !== null && (
            <EmblemCloseUp
              ladder={ladder}
              index={openIndex}
              onIndex={(i) => setOpenIndex(i)}
            />
          )}
        </DialogContent>
      </Dialog>
    </li>
  );
}
