import Link from "next/link";
import { PAGE_W } from "@/lib/page-width";
import { notFound } from "next/navigation";
import { ArrowRight, Award, Crown, Gem, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Reveal } from "@/components/motion/Reveal";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { requireOrgRole } from "@/lib/auth/session";
import { getOrgBySlug } from "@/lib/tenant";
import {
  getMember,
  listAwardsByPatch,
  listMemberAwards,
  listMembers,
  listPatchArtVersions,
  listPatches,
} from "@/lib/queries";
import { composeLadders, patchArtUrl, remainingLabel } from "@/lib/patch-ladders";
import { CRIMINAL_RECORD_ROWS, STAT_LABELS } from "@/lib/constants";
import { RARITY_COLOR, rarityColor } from "@/lib/rarity";
import type { Patch } from "@/lib/types";

/** Stats a member can actually see — the Criminal Record panel on their profile. */
const TRACKED_STATS = new Set(CRIMINAL_RECORD_ROWS.map((r) => r.statKey));

const CATEGORY_LABELS: Record<Patch["category"], string> = {
  activity: "Activity",
  service: "Service",
  leadership: "Leadership",
  recognition: "Recognition",
  legendary: "Legendary",
};


/**
 * A patch's artwork beside its name. Renders nothing when an admin hasn't
 * uploaded any, so a wall of art-less patches looks exactly as it did before
 * rather than a grid of empty frames.
 */
function PatchArt({
  art,
  name,
  locked,
}: {
  art: string | null;
  name: string;
  locked?: boolean;
}) {
  if (!art) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by the art route, already sized
    <img
      src={art}
      alt={`${name} patch`}
      loading="lazy"
      decoding="async"
      className="size-12 shrink-0 object-contain"
      style={locked ? { filter: "grayscale(1) brightness(0.7)", opacity: 0.6 } : undefined}
    />
  );
}

function RarityChip({ rarity }: { rarity?: string }) {
  if (!rarity) return null;
  const c = rarityColor(rarity) ?? RARITY_COLOR.common;
  return (
    <span
      className="inline-flex items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-wider"
      style={{ color: c }}
    >
      <span className="size-1.5 rounded-full" style={{ background: c }} />
      {rarity}
    </span>
  );
}

export default async function PatchWallPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  const access = await requireOrgRole(org.id, "member");

  const [patches, members, artVersions] = await Promise.all([
    listPatches(org.id),
    listMembers(org.id),
    listPatchArtVersions(org.id),
  ]);
  const member = access.memberId ? await getMember(org.id, access.memberId) : null;
  const myAwards = access.memberId
    ? await listMemberAwards(org.id, access.memberId)
    : [];
  const earnedIds = new Set(myAwards.map((a) => a.patchId));

  // Hall of Legends: every legendary award across the club. One grouped read of
  // awardedPatches rather than a `where patchId ==` query per legendary patch.
  const legendaryPatches = patches.filter((p) => p.category === "legendary");
  const awardsByPatch = await listAwardsByPatch(org.id);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const legends = legendaryPatches.flatMap((patch) =>
    (awardsByPatch.get(patch.id) ?? []).map((award) => ({
      patch,
      holder: memberById.get(award.memberId),
      reason: award.reason,
    })),
  );

  // This page is about the cut. Criminal-record emblems are earned the same way
  // but never worn, and they outnumber patches seven to one — they'd swamp the
  // wall. They get a summary here and their own levelled tab on the profile.
  //
  // A patch is also hidden when its stat isn't on the Criminal Record panel.
  // Club Runs and Church Attendance are still loggable, but a member has no
  // way to see either number, so "Club Runs: 0 / 50" on the wall is progress
  // toward a bar they can't watch. Manual awards have no stat and always show.
  const active = patches.filter(
    (p) =>
      p.active &&
      p.emblem !== true &&
      (!p.requirement || TRACKED_STATS.has(p.requirement.statKey)),
  );
  const earned = active.filter((p) => earnedIds.has(p.id));

  const emblemLadders = composeLadders({
    patches,
    awards: myAwards,
    stats: member?.stats,
  });
  const emblemsEarned = emblemLadders.reduce((n, l) => n + l.earnedCount, 0);
  const emblemsTotal = emblemLadders.reduce((n, l) => n + l.tiers.length, 0);
  const nextEmblems = emblemLadders
    .filter((l) => l.next)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);

  const locked = active
    .filter((p) => !earnedIds.has(p.id) && p.category !== "legendary")
    .map((patch) => {
      const req = patch.requirement;
      const current = req ? (member?.stats?.[req.statKey] ?? 0) : 0;
      const pct = req
        ? Math.min(100, Math.round((current / req.threshold) * 100))
        : null; // manual-only
      return { patch, current, pct };
    })
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));

  return (
    <div className={`${PAGE_W.gallery} space-y-8`}>
      <div className="texture-noise glass-card rounded-xl p-6 md:p-8">
        <DisplayHeading className="text-3xl text-foreground md:text-4xl">Patch Wall</DisplayHeading>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Every patch tells a story. Earn yours on the road, in church, and when
          the club calls.
        </p>
        {member && (
          <p className="font-stat mt-4 text-sm text-foreground">
            <span className="text-primary">{earned.length}</span> of {active.length}{" "}
            patches earned
          </p>
        )}
      </div>

      {/* Earned */}
      <section aria-labelledby="earned-heading">
        <h2
          id="earned-heading"
          className="flex items-center gap-2 text-lg font-semibold text-foreground"
        >
          <Award className="size-5 text-muted-foreground" aria-hidden />
          Earned
        </h2>
        {earned.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing on your wall yet. Get riding.
          </p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {earned.map((patch, i) => (
              // glass-card supplies the 1px frame, in the neutral border
              // token — an earned patch is called out by `glow-gold` and by
              // its own name, not by re-tinting the box it sits in.
              // The patches light up in sequence — the wall filling in, which
              // is the one thing on this page worth animating.
              <Reveal
                as="li"
                key={patch.id}
                delay={Math.min(i, 8) * 0.05}
                className="glass-card glow-gold rounded-lg p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-3">
                    <PatchArt art={patchArtUrl(org.id, patch.id, artVersions)} name={patch.name} />
                    <p
                      className="text-xl text-primary"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      {patch.name}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="outline" className="border-primary/40 text-primary">
                      {CATEGORY_LABELS[patch.category]}
                    </Badge>
                    <RarityChip rarity={patch.rarity} />
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{patch.description}</p>
              </Reveal>
            ))}
          </ul>
        )}
      </section>

      {/* Locked with progress */}
      <section aria-labelledby="locked-heading">
        <h2
          id="locked-heading"
          className="flex items-center gap-2 text-lg font-semibold text-foreground"
        >
          <Lock className="size-5 text-muted-foreground" aria-hidden />
          Still to Earn
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {locked.map(({ patch, current, pct }) => (
            <li
              key={patch.id}
              className="glass-card rounded-lg p-5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <PatchArt art={patchArtUrl(org.id, patch.id, artVersions)} name={patch.name} locked />
                  <p className="text-lg font-semibold text-muted-foreground">
                    {patch.name}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {CATEGORY_LABELS[patch.category]}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{patch.description}</p>
              {pct !== null && patch.requirement ? (
                <>
                  <div
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${patch.name} progress`}
                    className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="font-stat mt-2 text-xs text-muted-foreground">
                    {STAT_LABELS[patch.requirement.statKey]}: {current} /{" "}
                    {patch.requirement.threshold}
                    <span className="ml-2 text-primary">{pct}%</span>
                  </p>
                </>
              ) : (
                <p className="mt-3 text-xs italic text-muted-foreground">
                  Awarded by leadership. Earn it when it counts.
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Emblems — earned like patches, never worn. Summary only; the levelled
          ladders live on the member's own profile. */}
      {emblemsTotal > 0 && (
        <section aria-labelledby="emblems-heading">
          <div className="glass-card rounded-xl p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2
                  id="emblems-heading"
                  className="flex items-center gap-2 text-lg font-semibold text-foreground"
                >
                  <Gem className="size-5 text-muted-foreground" aria-hidden />
                  Emblems
                </h2>
                <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                  The criminal record, levelled. Not worn on the cut. These are
                  yours alone, five ranks deep on every count.
                </p>
              </div>
              <p className="font-stat text-sm text-foreground">
                <span className="text-primary">{emblemsEarned}</span> of{" "}
                {emblemsTotal} earned
              </p>
            </div>

            {nextEmblems.length > 0 && (
              <ul className="mt-5 grid gap-3 sm:grid-cols-3">
                {nextEmblems.map((ladder) => (
                  <li key={ladder.statKey}>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      {ladder.label}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-primary">
                      {ladder.next!.patch.name}
                    </p>
                    <div
                      role="progressbar"
                      aria-valuenow={ladder.pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${ladder.label} progress`}
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${ladder.pct}%` }}
                      />
                    </div>
                    <p className="font-stat mt-1 text-xs text-muted-foreground">
                      {remainingLabel(ladder)} to go
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {access.memberId && (
              <Link
                href={`/${orgSlug}/portal/brotherhood/${access.memberId}`}
                className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline"
              >
                See your whole climb
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            )}
          </div>
        </section>
      )}

      {/* Hall of Legends */}
      <section aria-labelledby="legends-heading">
        {/* The gradient utility replaces only glass-card's background-image, so
            it composes under the sheen (inset highlight + frame) — the
            legendary fade survives the glass treatment. */}
        <div className="texture-noise glass-card rounded-xl bg-gradient-to-b from-card to-background p-6">
          <h2
            id="legends-heading"
            className="flex items-center gap-2 text-2xl text-foreground"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <Crown className="size-6" aria-hidden />
            Hall of Legends
          </h2>
          {legends.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No legends yet. Some patches can&apos;t be chased. They find you.
            </p>
          ) : (
            <ul className="mt-4 grid gap-4 md:grid-cols-2">
              {legends.map(({ patch, holder, reason }, i) => (
                <li
                  key={`${patch.id}-${i}`}
                  className="glass-card rounded-lg p-5"
                >
                  <p
                    className="text-xl text-primary"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {patch.name}
                  </p>
                  <p className="mt-1 font-semibold text-foreground">
                    &ldquo;{holder?.roadName ?? "Unknown"}&rdquo;
                    {holder && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        {holder.displayName}
                      </span>
                    )}
                  </p>
                  {reason && (
                    <p className="mt-2 text-sm italic text-muted-foreground">
                      &ldquo;{reason}&rdquo;
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
