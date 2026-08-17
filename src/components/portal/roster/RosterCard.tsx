import Link from "next/link";
import {
  Award,
  Bike,
  Crown,
  HeartHandshake,
  ImageOff,
  Skull,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MemberStatus, PatchCategory } from "@/lib/types";
import type { RosterMember } from "./types";

const CATEGORY_ICON: Record<PatchCategory, typeof Award> = {
  activity: Bike,
  service: HeartHandshake,
  leadership: Crown,
  recognition: Star,
  legendary: Skull,
};

/** What the club calls each standing, on the card. */
const STATUS_LABEL: Partial<Record<MemberStatus, string>> = {
  patched: "Patched",
  prospect: "Prospect",
  hangaround: "Hangaround",
  retired: "Retired",
  exiled: "Exiled",
};

/**
 * A member's slot on the lineup wall: their character render standing in a lit
 * frame, colors and rank on the plate below. Members without a render get the
 * silhouette, deliberately fogged so an empty frame reads as "art pending"
 * rather than as the member's actual look.
 *
 * The figure is the subject and everything else defers to it. The clubhouse
 * behind them is dimmed to a suggestion, and the pool of light they stand in
 * is NEUTRAL — an ember wash on every card put the club's accent behind six
 * people who hadn't done anything to earn it, and left the renders fighting
 * their own background. Officers get that pool tinted, because officer is one
 * of the few things red still means here.
 *
 * Plate order is road name → rank → number → standing: what a brother is
 * called, what he holds, which number he wears, where he stands.
 */
export function RosterCard({
  orgSlug,
  member,
  viewerCanManageArt,
  backdropPath,
}: {
  orgSlug: string;
  member: RosterMember;
  viewerCanManageArt: boolean;
  /** Club backdrop behind the figure (branding.portalRosterBackdropPath). */
  backdropPath?: string;
}) {
  const { hasRender, isOfficer, isPresident } = member;
  const status = STATUS_LABEL[member.status];

  return (
    <Link
      href={`/${orgSlug}/portal/brotherhood/${member.id}`}
      className={cn(
        "group relative flex aspect-[3/4] flex-col overflow-hidden rounded-xl border bg-card transition-all duration-300",
        "hover:-translate-y-1 focus-visible:-translate-y-1 focus-visible:outline-none",
        // Resting borders are structural, so they take the neutral token.
        // Hover and officer standing are the two things that light up.
        isOfficer
          ? "border-primary/30 hover:border-primary/70 hover:shadow-[0_18px_45px_-18px_var(--primary)]"
          : "border-border hover:border-primary/40 hover:shadow-[0_14px_35px_-20px_var(--primary)]",
        isPresident && "ring-1 ring-primary/40",
      )}
    >
      {/* Clubhouse backdrop, dimmed AND desaturated. Opacity alone wasn't the
          fix: the art is a red-lit room, so at any weight where it still read
          as a room it also washed the whole card crimson — which is most of
          why six cards in a row felt like one red wall. Pulling the saturation
          out leaves the depth and the architecture and takes the color, so the
          only red left on a card is what the member earned. It reads as "a
          room", not as a photograph competing with the rider. */}
      {backdropPath && (
        // eslint-disable-next-line @next/next/no-img-element -- static art, sized by CSS
        <img
          src={backdropPath}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover opacity-35 saturate-[0.25] transition-transform duration-500 group-hover:scale-[1.03] group-hover:saturate-[0.5]"
        />
      )}

      {/* The pool of light the figure stands in. Neutral by default; ember
          only for officers, and even then at half what every card used to
          carry. Hover lifts it for everyone — that's a state, so it's allowed
          to be warm. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 transition-opacity duration-300",
          isOfficer
            ? "bg-[radial-gradient(120%_75%_at_50%_16%,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_68%)]"
            : "bg-[radial-gradient(120%_75%_at_50%_16%,color-mix(in_oklab,var(--foreground)_10%,transparent),transparent_68%)]",
          "opacity-80 group-hover:opacity-100",
        )}
      />

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={member.imageUrl}
        alt={hasRender ? `${member.roadName} character render` : ""}
        loading="lazy"
        decoding="async"
        className={cn(
          // Taller than the old 86%: with the ground quieter there is room to
          // let the rider actually fill the frame.
          "absolute inset-x-0 bottom-0 mx-auto h-[95%] w-full object-contain object-bottom transition-transform duration-500 group-hover:scale-[1.03]",
          hasRender
            ? "drop-shadow-[0_18px_22px_rgba(0,0,0,0.6)]"
            : "opacity-25 grayscale",
        )}
      />

      {/* Scrim under the plate. Shallower than before and weighted to the very
          bottom, so it carries the type without fogging the rider's chest. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[rgba(0,0,0,0.95)] via-[rgba(0,0,0,0.62)] to-transparent"
      />

      {/* Top corner is now markers only — the member number moved down to the
          plate where it belongs in the reading order. */}
      {(isPresident || (!hasRender && viewerCanManageArt)) && (
        <div className="relative flex items-start justify-between p-3">
          {isPresident ? (
            <Crown className="size-4 text-primary drop-shadow" aria-label="President" />
          ) : (
            <span />
          )}
          {!hasRender && viewerCanManageArt && (
            <span className="inline-flex items-center gap-1 rounded bg-black/45 px-1.5 py-0.5 text-[0.55rem] uppercase tracking-[0.12em] text-white/55 backdrop-blur-sm">
              <ImageOff className="size-2.5" aria-hidden />
              No render
            </span>
          )}
        </div>
      )}

      {/* Nameplate */}
      <div className="relative mt-auto p-3 pt-0">
        <p
          className={cn(
            "truncate text-xl leading-tight drop-shadow",
            isOfficer ? "text-primary" : "text-white",
          )}
          style={{ fontFamily: "var(--font-display)" }}
        >
          &ldquo;{member.roadName}&rdquo;
        </p>

        <p className="mt-0.5 truncate text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-white/75">
          {member.rankName}
        </p>

        <div className="mt-1 flex items-center gap-2 text-[0.62rem] text-white/50">
          <span className="font-stat tracking-widest">No. {member.memberNumber}</span>
          {status && (
            <>
              <span aria-hidden>·</span>
              <span className="uppercase tracking-[0.12em]">{status}</span>
            </>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between border-t border-white/12 pt-2 text-[0.65rem] text-white/55">
          <span className="inline-flex items-center gap-1">
            <Award className="size-3 text-white/40" aria-hidden />
            <span className="font-stat text-white/80">{member.patchCount}</span>
          </span>
          <span>Since {member.joinedLabel}</span>
        </div>
      </div>

      {/* Quick peek — additive only; everything above stays readable without it */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-3 border-t border-primary/25 bg-[rgba(0,0,0,0.9)] p-3 opacity-0 backdrop-blur-sm transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
      >
        <p className="mb-2 truncate text-[0.68rem] text-white/70">{member.displayName}</p>
        {member.rapStatus && (
          <p className="mb-2 text-[0.55rem] uppercase tracking-[0.16em] text-white/45">
            Record · <span className="text-white/70">{member.rapStatus}</span>
          </p>
        )}
        {member.topPatches.length > 0 ? (
          <ul className="space-y-1">
            {member.topPatches.map((p) => {
              const Icon = CATEGORY_ICON[p.category];
              return (
                <li
                  key={p.name}
                  className="flex items-center gap-1.5 text-[0.68rem] text-white/80"
                >
                  {p.artUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- streamed by the art route, already sized
                    <img
                      src={p.artUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="size-6 shrink-0 object-contain"
                    />
                  ) : (
                    <Icon className="size-3 shrink-0 text-white/45" aria-hidden />
                  )}
                  <span className="truncate">{p.name}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[0.68rem] italic text-white/45">No patches earned yet.</p>
        )}
      </div>
    </Link>
  );
}
