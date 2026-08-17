import Link from "next/link";
import { PAGE_W } from "@/lib/page-width";
import { notFound } from "next/navigation";
import {
  Activity as ActivityIcon,
  Award,
  ClipboardCheck,
  Map as MapIcon,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/motion/CountUp";
import { Reveal } from "@/components/motion/Reveal";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { ClubMap, type ClubMapMarker, type ClubMapTerritory } from "@/components/portal/map/ClubMap";
import { DiscordLinkCard } from "@/components/portal/DiscordLinkCard";
import { requireOrgRole } from "@/lib/auth/session";
import { getDiscordLink } from "@/lib/discord/link";
import { getOrgBySlug } from "@/lib/tenant";
import { describeActivity } from "@/lib/activity-entries";
import {
  countPending,
  getMember,
  listActivities,
  listActivityTypes,
  listMapMarkers,
  listMapTerritories,
  listMemberAwards,
  listMembers,
  listPatches,
} from "@/lib/queries";
import { PROFILE_STAT_ORDER } from "@/lib/constants";
import type { Timestamp } from "firebase-admin/firestore";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  const access = await requireOrgRole(org.id, "member");

  const member = access.memberId ? await getMember(org.id, access.memberId) : null;
  const [patches, types, recent, pendingCount, allMarkers, allTerritories] =
    await Promise.all([
      listPatches(org.id),
      listActivityTypes(org.id),
      listActivities(org.id, { limit: 8 }),
      access.role !== "member" ? countPending(org.id) : Promise.resolve(0),
      listMapMarkers(org.id),
      listMapTerritories(org.id),
    ]);
  // Shares the map page's cache entry and trims here — the embed showed a
  // narrower slice, but querying for it separately meant paying for the pins
  // twice for anyone who opened both pages.
  const mapMarkers: ClubMapMarker[] = allMarkers.slice(0, 200).map((m) => ({
    id: m.id,
    label: m.label,
    style: m.style,
    description: m.description ?? "",
    u: m.u,
    v: m.v,
    droppedBy: null, // compact embed skips attribution
  }));
  const mapTerritories: ClubMapTerritory[] = allTerritories.slice(0, 50).map((t) => ({
    id: t.id,
    crewName: t.crewName,
    label: t.label ?? "",
    color: t.color ?? null,
    points: t.points ?? [],
  }));
  const awards = access.memberId
    ? await listMemberAwards(org.id, access.memberId)
    : [];
  const discordLink = access.memberId ? await getDiscordLink(access.user.uid) : null;
  const members = await listMembers(org.id);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const typeById = new Map(types.map((t) => [t.id, t]));

  // Next closest locked patch = the motivator card.
  const earned = new Set(awards.map((a) => a.patchId));
  const nextUp = member
    ? patches
        .filter((p) => p.requirement && !earned.has(p.id))
        .map((p) => ({
          patch: p,
          current: member.stats?.[p.requirement!.statKey] ?? 0,
          pct: Math.min(
            100,
            Math.round(
              ((member.stats?.[p.requirement!.statKey] ?? 0) /
                p.requirement!.threshold) *
                100,
            ),
          ),
        }))
        .sort((a, b) => b.pct - a.pct)[0]
    : null;

  return (
    <div className={`${PAGE_W.content} space-y-8`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <DisplayHeading className="text-3xl text-foreground md:text-4xl">
            {member ? `Welcome back, "${member.roadName}"` : "Welcome, Platform Owner"}
          </DisplayHeading>
          <p className="mt-1 text-sm text-muted-foreground">
            {member
              ? `Member #${member.memberNumber} · ${awards.length} patches earned`
              : org.name}
          </p>
        </div>
        {/* Ember tier: reviewing the queue is this page's one true action. */}
        {(access.role === "officer" || access.role === "admin") && pendingCount > 0 && (
          <Button asChild>
            <Link href={`/${orgSlug}/portal/activities/review`}>
              <ClipboardCheck className="size-4" aria-hidden />
              {pendingCount} awaiting review
            </Link>
          </Button>
        )}
      </div>

      {/* Stats */}
      {member && (
        <section aria-labelledby="stats-heading">
          <h2 id="stats-heading" className="sr-only">
            Your service record
          </h2>
          {/* The tiles arrive left-to-right and the numbers count in — the
              record assembling itself, not six boxes appearing. Stagger is
              index-scaled and capped by the row length, so the last tile is
              never waiting on a long delay. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {PROFILE_STAT_ORDER.map((stat, i) => (
              <Reveal key={stat.key} delay={i * 0.06}>
                <Card className="py-4">
                  <CardContent className="px-4">
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="font-stat mt-1 text-2xl font-semibold text-foreground">
                      <CountUp value={member.stats?.[stat.key] ?? 0} />
                    </p>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* Territory map — the club's eye on San Andreas (view-only embed) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MapIcon className="size-4 text-primary" aria-hidden />
            Territory Map
          </CardTitle>
          <Link
            href={`/${orgSlug}/portal/map`}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Open full map →
          </Link>
        </CardHeader>
        <CardContent>
          <ClubMap
            orgId={org.id}
            markers={mapMarkers}
            territories={mapTerritories}
            canEditPins={false}
            canManage={false}
            compact
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent activity */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ActivityIcon className="size-4 text-primary" aria-hidden />
              Recent Club Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm font-medium">Nothing logged yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Submit your first activity to start building your record.
                </p>
                <Button asChild variant="secondary" className="mt-4">
                  <Link href={`/${orgSlug}/portal/activities`}>Log an activity</Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((activity) => {
                  const who = memberById.get(activity.memberId);
                  const when = (activity.createdAt as Timestamp)?.toDate?.();
                  return (
                    <li key={activity.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">
                          <span className="font-semibold">
                            &ldquo;{who?.roadName ?? "Unknown"}&rdquo;
                          </span>{" "}
                          · {describeActivity(activity, (id) => typeById.get(id)?.name)}
                        </p>
                        {when && (
                          <p className="text-xs text-muted-foreground">
                            {when.toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant={
                          activity.status === "approved"
                            ? "default"
                            : activity.status === "denied"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {activity.status}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Next patch progress, with the Discord link beneath it */}
        <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="size-4 text-primary" aria-hidden />
              Next Patch
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nextUp ? (
              <div>
                <p className="font-semibold text-foreground">{nextUp.patch.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {nextUp.patch.description}
                </p>
                <div
                  role="progressbar"
                  aria-valuenow={nextUp.pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${nextUp.patch.name} progress`}
                  className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${nextUp.pct}%` }}
                  />
                </div>
                <p className="font-stat mt-2 text-sm text-muted-foreground">
                  {nextUp.current} / {nextUp.patch.requirement!.threshold}
                  <span className="ml-2 text-primary">{nextUp.pct}%</span>
                </p>
                <Link
                  href={`/${orgSlug}/portal/patch-wall`}
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  <TrendingUp className="size-4" aria-hidden />
                  View the Patch Wall
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {member
                  ? "You've earned everything on the board. Legend."
                  : "Patch progress appears for member accounts."}
              </p>
            )}
          </CardContent>
        </Card>

        {member && (
          <DiscordLinkCard
            orgId={org.id}
            linked={Boolean(discordLink)}
            username={discordLink?.username ?? null}
          />
        )}
        </div>
      </div>
    </div>
  );
}
