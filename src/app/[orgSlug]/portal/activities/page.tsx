import { notFound } from "next/navigation";
import { PAGE_W } from "@/lib/page-width";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { ActivityForm } from "@/components/portal/ActivityForm";
import { requireOrgRole } from "@/lib/auth/session";
import { getOrgBySlug } from "@/lib/tenant";
import { describeActivity } from "@/lib/activity-entries";
import {
  listActivities,
  listActivityTypes,
  listMembers,
} from "@/lib/queries";
import type { Timestamp } from "firebase-admin/firestore";

export default async function ActivitiesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  const access = await requireOrgRole(org.id, "member");

  const [types, members, mySubmissions] = await Promise.all([
    listActivityTypes(org.id),
    listMembers(org.id),
    access.memberId
      ? listActivities(org.id, { memberId: access.memberId, limit: 20 })
      : [],
  ]);
  const typeById = new Map(types.map((t) => [t.id, t]));

  return (
    <div className={`${PAGE_W.content} space-y-8`}>
      <div>
        <DisplayHeading className="text-3xl text-foreground md:text-4xl">Activities</DisplayHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          Log your work for the club. An officer reviews every submission.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Submit Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {access.memberId ? (
              <ActivityForm
                orgId={org.id}
                memberId={access.memberId}
                types={types
                  .filter((t) => t.active)
                  .map((t) => ({
                    id: t.id,
                    name: t.name,
                    requiresProof: t.requiresProof,
                    allowQuantity: t.allowQuantity,
                  }))}
                witnesses={members
                  .filter((m) => m.id !== access.memberId && m.status !== "exiled")
                  .map((m) => ({ id: m.id, label: `"${m.roadName}" · ${m.displayName}` }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Super admin accounts don&apos;t submit activities.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>My Submissions</CardTitle>
          </CardHeader>
          <CardContent>
            {mySubmissions.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm font-medium">No submissions yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your logged activities and their review status appear here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {mySubmissions.map((activity) => {
                  const date = (activity.date as Timestamp)?.toDate?.();
                  return (
                    <li key={activity.id} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">
                          {describeActivity(activity, (id) => typeById.get(id)?.name)}
                        </p>
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
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                        {activity.description}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {date?.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                        {activity.reviewNote && ` · Officer note: ${activity.reviewNote}`}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
