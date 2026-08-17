import { notFound } from "next/navigation";
import { PAGE_W } from "@/lib/page-width";
import { UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { requireOrgRole } from "@/lib/auth/session";
import { getOrgBySlug } from "@/lib/tenant";
import { orgRef } from "@/lib/firebase/admin";
import { listMembers } from "@/lib/queries";
import type { ProspectProfile } from "@/lib/types";
import type { Timestamp } from "firebase-admin/firestore";

export default async function ProspectsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  await requireOrgRole(org.id, "member");

  const [profilesSnap, members] = await Promise.all([
    orgRef(org.id).collection("prospectProfiles").get(),
    listMembers(org.id),
  ]);
  const memberById = new Map(members.map((m) => [m.id, m]));

  const prospects = profilesSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<ProspectProfile, "id">) }))
    .filter((p) => p.status === "active" || p.status === "vote_pending")
    .map((profile) => {
      const member = memberById.get(profile.id);
      const sponsor = profile.sponsorMemberId
        ? memberById.get(profile.sponsorMemberId)
        : null;
      const requirements = profile.requirements.map((req) => {
        const current =
          req.statKey !== null
            ? (member?.stats?.[req.statKey] ?? 0)
            : (req.manualProgress ?? 0);
        return {
          ...req,
          current: Math.min(current, req.target),
          pct: Math.min(100, Math.round((current / req.target) * 100)),
        };
      });
      const overall = requirements.length
        ? Math.round(
            requirements.reduce((sum, r) => sum + r.pct, 0) / requirements.length,
          )
        : 0;
      return { profile, member, sponsor, requirements, overall };
    });

  return (
    <div className={`${PAGE_W.content} space-y-8`}>
      <div>
        <DisplayHeading className="text-3xl text-foreground md:text-4xl">Prospects</DisplayHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          Earning their patch, one requirement at a time.
        </p>
      </div>

      {prospects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <UserPlus className="mx-auto size-10 text-muted-foreground" aria-hidden />
            <p className="mt-3 font-medium">No active prospects</p>
            <p className="mt-1 text-sm text-muted-foreground">
              When someone starts prospecting, their progress shows up here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {prospects.map(({ profile, member, sponsor, requirements, overall }) => (
            <Card key={profile.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>
                    &ldquo;{member?.roadName ?? "Unknown"}&rdquo;
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {member?.displayName}
                    </span>
                  </span>
                  <Badge
                    variant={profile.status === "vote_pending" ? "default" : "secondary"}
                  >
                    {profile.status === "vote_pending" ? "Vote pending" : "Active"}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Since{" "}
                  {(profile.startDate as Timestamp)
                    ?.toDate?.()
                    .toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                  {sponsor && <> · Sponsored by &ldquo;{sponsor.roadName}&rdquo;</>}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {requirements.map((req) => (
                  <div key={req.key}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-foreground">{req.label}</span>
                      <span className="font-stat text-muted-foreground">
                        {req.current} / {req.target}
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-valuenow={req.pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${req.label} progress`}
                      className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className="h-full rounded-full bg-primary/80"
                        style={{ width: `${req.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
                <p className="font-stat pt-1 text-right text-sm">
                  <span className="text-primary">{overall}%</span>
                  <span className="text-muted-foreground"> to the patch</span>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Officer tools (task assignment, notes, and patch votes) arrive with the
        prospect management milestone.
      </p>
    </div>
  );
}
