import Link from "next/link";
import { Crown } from "lucide-react";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import {
  DEFAULT_PLATE_LAYOUT,
  PLATE_CROP,
  seatBounds,
  type PlateBox,
  type PlateLayout,
  type PlateSeat,
} from "@/lib/plate-layout";
import { cn } from "@/lib/utils";
import type { RosterMember } from "./types";

/* ── Plate geometry ───────────────────────────────────────────────────
   The rings, nameplates, connectors and stat bar are PAINTED INTO the
   plate art; this component only lays live text and faces over them.
   Where everything sits comes from a PlateLayout (src/lib/plate-layout.ts):
   the measured template by default, or the club's own dragged positions
   from Admin -> Branding when its art is painted differently. Everything
   is a fraction of the displayed art, so the block scales as one piece
   with its container.                                                  */

const pc = (f: number) => `${f * 100}%`;
/** Fraction of plate width → container units, so type scales with the art. */
const cq = (f: number) => `${f * 100}cqw`;

/** A layout box as absolute percentages of the plate. */
function boxStyle(b: PlateBox) {
  return { left: pc(b.x), top: pc(b.y), width: pc(b.w), height: pc(b.h) };
}

/* ── Shared bits ──────────────────────────────────────────────────── */

/**
 * A member's render, head-cropped. The stored art is full-body, so it is
 * scaled up and pinned to the top — same trick as the roster card.
 */
function Face({
  member,
  className,
  style,
  initialsSize = "0.875rem",
}: {
  member: RosterMember;
  className?: string;
  style?: React.CSSProperties;
  /** Sized by the caller: `cqw` is meaningless outside the plate's container. */
  initialsSize?: string;
}) {
  return (
    // No background of its own: on the plate the painted ring already has a
    // dark interior, and tinting it reads as a purple lens over the leather.
    <span
      className={cn("relative block overflow-hidden rounded-full", className)}
      style={style}
    >
      {member.hasRender ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full scale-[2.6] object-contain object-top"
          style={{ transformOrigin: "top center" }}
        />
      ) : (
        <span
          className="grid size-full place-items-center uppercase text-muted-foreground"
          style={{ fontFamily: "var(--font-display)", fontSize: initialsSize }}
          aria-hidden
        >
          {member.roadName.slice(0, 2)}
        </span>
      )}
    </span>
  );
}

/**
 * Ranks the club wears short. Keyed on the name with everything but letters
 * stripped, so "Sergeant-at-Arms", "Sergeant at Arms" and "Sgt. at Arms" all
 * land on the same badge — the rank doc is admin-editable and the punctuation
 * drifts. Anything unlisted is shown as written.
 */
const RANK_BADGES: Record<string, string> = {
  sergeantatarms: "SAA",
};

function rankBadge(name: string): string {
  return RANK_BADGES[name.toLowerCase().replace(/[^a-z]/g, "")] ?? name;
}

const SUMMARY_LABELS = ["Riding", "Officers", "Prospecting"] as const;

function summaryValues(counts: Counts) {
  return [counts.riding, counts.officers, counts.prospecting];
}

/* ── The engraved plate (lg and up, exactly the painted table) ─────── */

/**
 * One seat: a link whose bounding box spans the ring, the nameplate and the
 * rank plate, with all three placed inside it in the box's OWN percentage
 * space so the whole seat scales as one piece.
 */
function PlateSlot({
  orgSlug,
  member,
  seat,
  president,
}: {
  orgSlug: string;
  /** Whoever holds this seat, or undefined while the club has not filled it. */
  member?: RosterMember;
  seat: PlateSeat;
  president?: boolean;
}) {
  const { face, name, rank } = seat;
  const b = seatBounds(seat);
  // Slot-local percentages: a plate fraction as a fraction of THIS box.
  const lx = (v: number) => `${((v - b.x) / b.w) * 100}%`;
  const ly = (v: number) => `${((v - b.y) / b.h) * 100}%`;
  const lw = (v: number) => `${(v / b.w) * 100}%`;
  const lh = (v: number) => `${(v / b.h) * 100}%`;
  const localBox = (v: PlateBox) => ({
    left: lx(v.x),
    top: ly(v.y),
    width: lw(v.w),
    height: lh(v.h),
  });

  // An empty seat still labels its nameplate. The ring is painted into the
  // art whether or not anyone stands in it, so a bare one reads as a picture
  // that failed to load; "Vacant" reads as a chair waiting to be filled, and
  // tells an admin setting the club up which seats are still open.
  if (!member) {
    return (
      <div className="absolute" style={boxStyle(b)} aria-hidden>
        <span
          className="absolute flex items-center justify-center overflow-hidden px-[6%]"
          style={localBox(name)}
        >
          <span
            className="max-w-full truncate leading-none text-muted-foreground/45"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: cq(name.size),
              textShadow: "0 2px 6px rgba(0,0,0,0.9)",
            }}
          >
            Vacant
          </span>
        </span>
      </div>
    );
  }

  return (
    <Link
      href={`/${orgSlug}/portal/brotherhood/${member.id}`}
      className="group absolute"
      style={boxStyle(b)}
    >
      <Face
        member={member}
        initialsSize={cq(face.d / 4)}
        className="absolute -translate-x-1/2 -translate-y-1/2 transition-[filter] duration-200 group-hover:brightness-110"
        style={{
          left: lx(face.x),
          top: ly(face.y),
          width: lw(face.d),
          aspectRatio: "1",
          boxShadow: `0 0 ${cq(0.0156)} rgba(0,0,0,0.85)`,
          // Renders are lit for the character stage, not for black leather —
          // without a pool behind them a dark figure vanishes into the ring.
          // Neutral (--foreground), so it reads as light rather than a tint.
          background:
            "radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--foreground) 18%, transparent), transparent 72%)",
        }}
      />

      {/* Road name, centred on the painted nameplate. */}
      <span
        className="absolute flex items-center justify-center overflow-hidden px-[6%]"
        style={localBox(name)}
      >
        <span
          className={cn(
            "max-w-full truncate leading-none transition-colors",
            president ? "text-primary" : "text-foreground group-hover:text-primary",
          )}
          style={{
            fontFamily: "var(--font-display)",
            fontSize: cq(name.size),
            textShadow: "0 2px 6px rgba(0,0,0,0.9)",
          }}
        >
          {member.roadName}
        </span>
      </span>

      {/* Club rank, centred on the narrower plate below it. */}
      <span
        className="absolute flex items-center justify-center overflow-hidden"
        style={localBox(rank)}
      >
        <span
          title={member.rankName}
          className={cn(
            "max-w-full truncate uppercase leading-none text-muted-foreground",
            president ? "tracking-[0.16em]" : "tracking-[0.05em]",
          )}
          style={{ fontSize: cq(rank.size) }}
        >
          {rankBadge(member.rankName)}
        </span>
      </span>
    </Link>
  );
}

function ChainPlate({
  orgSlug,
  plateArt,
  layout,
  title,
  blurb,
  president,
  officers,
  counts,
}: {
  orgSlug: string;
  plateArt: string;
  layout: PlateLayout;
  title: string;
  blurb: string;
  /** Undefined between presidents, or before the club has any members. */
  president?: RosterMember;
  officers: RosterMember[];
  counts: Counts;
}) {
  return (
    <div className="@container relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={plateArt}
        alt=""
        width={PLATE_CROP.w}
        height={PLATE_CROP.h}
        className="block w-full"
        style={{ height: "auto" }}
      />

      {/* Heading sits in the leather the art left clear for it. */}
      <div className="absolute flex flex-col justify-start" style={boxStyle(layout.heading)}>
        <DisplayHeading
          className="leading-[0.95] text-primary"
          style={{
            fontSize: cq(layout.heading.size),
            textShadow:
              "0 0 0.9em color-mix(in srgb, var(--primary) 40%, transparent), 0 3px 8px rgba(0,0,0,0.95)",
          }}
        >
          {title}
        </DisplayHeading>
        {blurb && (
          <p
            className="mt-[4%] uppercase leading-[1.7] tracking-[0.14em] text-muted-foreground"
            style={{ fontSize: cq(layout.heading.blurbSize) }}
          >
            {blurb}
          </p>
        )}
      </div>

      <PlateSlot orgSlug={orgSlug} member={president} seat={layout.president} president />
      {/* Over the painted RINGS, not over the officers: the art has five and
          the club may have fewer, and a ring is a fixed place on the plate
          whether or not it is occupied. */}
      {layout.officers.map((seat, i) => (
        <PlateSlot key={i} orgSlug={orgSlug} member={officers[i]} seat={seat} />
      ))}

      {/* Headcount, seated to the right of the painted icons. */}
      <dl>
        {summaryValues(counts).map((value, i) => {
          const stat = layout.stats[i];
          if (!stat) return null;
          return (
            <div
              key={SUMMARY_LABELS[i]}
              className="absolute flex items-center gap-[0.5cqw]"
              style={boxStyle(stat)}
            >
              <dd
                className="font-stat leading-none text-foreground"
                style={{ fontSize: cq(stat.size) }}
              >
                {value}
              </dd>
              <dt
                className="uppercase leading-none tracking-[0.14em] text-muted-foreground"
                style={{ fontSize: cq(stat.labelSize) }}
              >
                {SUMMARY_LABELS[i]}
              </dt>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/* ── Stacked fallback (narrow screens, or a table that isn't 5-wide) ── */

function StackChip({
  orgSlug,
  member,
  president,
}: {
  orgSlug: string;
  member: RosterMember;
  president?: boolean;
}) {
  return (
    <Link
      href={`/${orgSlug}/portal/brotherhood/${member.id}`}
      className="group flex w-24 flex-col items-center gap-1.5 text-center sm:w-28"
    >
      <Face
        member={member}
        className={cn(
          "border bg-secondary/60 transition-all duration-200 group-hover:-translate-y-0.5",
          president
            ? "size-16 border-primary/70 ring-2 ring-primary/25"
            : "size-12 border-border group-hover:border-primary/60",
        )}
      />
      <span
        className={cn(
          "w-full truncate leading-tight transition-colors",
          president ? "text-base text-primary" : "text-sm text-foreground group-hover:text-primary",
        )}
        style={{ fontFamily: "var(--font-display)" }}
      >
        {member.roadName}
      </span>
      <span
        title={member.rankName}
        className="w-full truncate text-[0.55rem] uppercase tracking-[0.12em] text-muted-foreground"
      >
        {rankBadge(member.rankName)}
      </span>
    </Link>
  );
}

function ChainStack({
  orgSlug,
  title,
  blurb,
  president,
  officers,
  counts,
}: {
  orgSlug: string;
  title: string;
  blurb: string;
  president?: RosterMember;
  officers: RosterMember[];
  counts: Counts;
}) {
  return (
    <div className="texture-noise glass-card rounded-xl p-6 md:p-8">
      {/* Ember on purpose, and the only page heading in the portal that keeps
          it — this is the club's front door. It matches the painted plate's
          heading above, which is the same title in the other rendering; the
          two must not disagree just because a club has five officers or three. */}
      <DisplayHeading className="text-3xl text-primary md:text-4xl">{title}</DisplayHeading>
      {blurb && <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>}

      <div className="mt-8 flex flex-col items-center">
        {president && (
          <>
            <Crown className="mb-2 size-4 text-primary/70" aria-hidden />
            <StackChip orgSlug={orgSlug} member={president} president />
            {officers.length > 0 && <div className="mt-3 h-5 w-px bg-border" aria-hidden />}
          </>
        )}

        {officers.length > 0 && (
          <>
            <div
              className="h-px w-full max-w-3xl bg-gradient-to-r from-transparent via-border to-transparent"
              aria-hidden
            />
            <div className="flex flex-wrap items-start justify-center gap-x-2 gap-y-4 pt-4">
              {officers.map((officer) => (
                <div key={officer.id} className="flex flex-col items-center">
                  <div className="-mt-4 mb-2 h-4 w-px bg-border" aria-hidden />
                  <StackChip orgSlug={orgSlug} member={officer} />
                </div>
              ))}
            </div>
          </>
        )}

        <dl className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-border/60 pt-4 text-center">
          {summaryValues(counts).map((value, i) => (
            <div key={SUMMARY_LABELS[i]} className="flex items-baseline gap-1.5">
              <dd className="font-stat text-lg leading-none text-foreground">{value}</dd>
              <dt className="text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
                {SUMMARY_LABELS[i]}
              </dt>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/* ── Entry point ──────────────────────────────────────────────────── */

interface Counts {
  riding: number;
  officers: number;
  prospecting: number;
}

/**
 * The club's table, drawn: President at the head, the rest of the officers
 * ranked beneath.
 *
 * Two renderings of the same data. The engraved plate is pixel-locked to the
 * painted art, so it runs only when the club HAS plate art, when its table is
 * no bigger than the one the art depicts (a president plus five officers), and
 * when there's width enough for the faces to read. An under-filled table is
 * fine and draws the spare rings as open seats. A club with more officers than
 * rings gets the stacked panel instead, because on the plate the extra officer
 * would have nowhere to stand and would drop out of the chain of command
 * silently; so does a phone, and so does a club with no plate at all.
 */
export function ChainOfCommand({
  orgSlug,
  plateArt,
  plateLayout,
  title,
  blurb,
  officers,
  counts,
}: {
  orgSlug: string;
  /** This club's plate art, or null when it has none. */
  plateArt: string | null;
  /** The club's own box positions, or null for the measured template. */
  plateLayout?: PlateLayout | null;
  title: string;
  blurb: string;
  officers: RosterMember[];
  counts: Counts;
}) {
  const layout = plateLayout ?? DEFAULT_PLATE_LAYOUT;
  const president = officers.find((o) => o.isPresident);
  const rest = officers.filter((o) => o !== president);
  // The club must HAVE plate art (one with none gets the stacked panel rather
  // than another club's engraving), and its table must not be BIGGER than the
  // one the art depicts. Fewer is fine: the spare rings are painted into the
  // picture regardless and label themselves as open seats, which is what a
  // club looks like while it is still being set up. More is not, because the
  // sixth officer would have no ring to stand in and would simply vanish from
  // the chain of command; that club keeps the stacked panel, which lays out
  // for any headcount. Width is the last condition: the faces have to read.
  const fitsPlate = Boolean(plateArt) && rest.length <= layout.officers.length;

  return (
    <>
      {fitsPlate && plateArt && (
        <div className="hidden lg:block">
          <ChainPlate
            orgSlug={orgSlug}
            plateArt={plateArt}
            layout={layout}
            title={title}
            blurb={blurb}
            president={president}
            officers={rest}
            counts={counts}
          />
        </div>
      )}
      <div className={cn(fitsPlate && "lg:hidden")}>
        <ChainStack
          orgSlug={orgSlug}
          title={title}
          blurb={blurb}
          president={president}
          officers={rest}
          counts={counts}
        />
      </div>
    </>
  );
}
