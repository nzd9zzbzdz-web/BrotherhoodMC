import { Gem, Lock } from "lucide-react";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import {
  EmblemLadderCard,
  type EmblemLadderView,
} from "@/components/portal/EmblemLadderCard";
import { patchArtUrl, remainingLabel, type Ladder } from "@/lib/patch-ladders";

/**
 * The Emblems tab on a member's profile: one ladder per criminal-record stat,
 * five rungs each, showing the level they reached and what the next one costs.
 *
 * Emblems are not patches — nothing here goes on the cut. This is the
 * achievement system, so it reads like levelling one: rungs light up in the
 * rarity colour as they land, the next one sits dashed and waiting, the rest
 * stay dark. Clicking a card opens the level they're on at full size.
 *
 * Every rung is a threshold on a stat members log and officers approve, so
 * nothing is hand-maintained — the ladders move when the record does.
 *
 * This half stays on the server: it flattens `Ladder` (Timestamps, `format`
 * closures, whole Patch docs) into the plain data the card can be handed.
 */

const AWARDED_FMT: Intl.DateTimeFormatOptions = {
  month: "long",
  day: "numeric",
  year: "numeric",
};

function toView(
  ladder: Ladder,
  orgId: string,
  artVersions: Map<string, number>,
): EmblemLadderView {
  // The level they're on — or, on an untouched ladder, the one they're chasing.
  const active = ladder.top ?? ladder.next;

  return {
    statKey: ladder.statKey,
    label: ladder.label,
    currentLabel: ladder.format(ladder.current),
    earnedCount: ladder.earnedCount,
    pct: ladder.pct,
    remainingLabel: remainingLabel(ladder),
    activeIndex: active ? active.tier - 1 : 0,
    rungs: ladder.tiers.map((tier) => ({
      id: tier.patch.id,
      name: tier.patch.name,
      description: tier.patch.description,
      rarity: tier.patch.rarity,
      artUrl: patchArtUrl(orgId, tier.patch.id, artVersions),
      earned: tier.earned,
      isNext: ladder.next?.patch.id === tier.patch.id,
      awardedLabel: tier.awardedAt
        ? tier.awardedAt.toLocaleDateString("en-US", AWARDED_FMT)
        : null,
      thresholdLabel: ladder.format(tier.threshold),
    })),
  };
}

export function EmblemLadders({
  ladders,
  roadName,
  isSelf,
  orgId,
  artVersions,
}: {
  ladders: Ladder[];
  roadName: string;
  isSelf: boolean;
  orgId: string;
  /**
   * patch id → art version, for building image URLs. Versions, not blobs: a
   * member with every emblem would otherwise carry 55 base64 images in the HTML.
   * A missing entry means no art, and the rung falls back to a lettered badge.
   */
  artVersions: Map<string, number>;
}) {
  const earned = ladders.reduce((n, l) => n + l.earnedCount, 0);
  const total = ladders.reduce((n, l) => n + l.tiers.length, 0);

  return (
    <section
      aria-label="Emblems"
      // glass-card, not glass-panel: this section scrolls with the page, so
      // its blur would re-sample on every frame for nothing.
      className="texture-noise glass-card rounded-xl p-6 md:p-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <DisplayHeading as="h2" className="text-2xl text-foreground md:text-3xl">
            Emblems
          </DisplayHeading>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSelf
              ? "Every level you've climbed, and what the next one costs."
              : `Every level ${roadName ? `"${roadName}"` : "this member"} has climbed.`}
          </p>
        </div>
        <p className="font-stat flex items-center gap-2 text-sm text-foreground">
          <Gem className="size-4 text-primary" aria-hidden />
          <span className="text-primary">{earned}</span> of {total} earned
        </p>
      </div>

      {ladders.length === 0 ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="size-4" aria-hidden />
          No emblems configured yet.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 lg:grid-cols-2">
          {ladders.map((ladder) => (
            <EmblemLadderCard
              key={ladder.statKey}
              ladder={toView(ladder, orgId, artVersions)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
