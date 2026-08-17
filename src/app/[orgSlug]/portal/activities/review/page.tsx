import { notFound } from "next/navigation";
import { PAGE_W } from "@/lib/page-width";
import { ClipboardCheck, ImageUp } from "lucide-react";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { ReviewQueue } from "@/components/portal/ReviewQueue";
import {
  RenderReviewQueue,
  type PendingRender,
} from "@/components/portal/RenderReviewQueue";
import { requireOrgRole } from "@/lib/auth/session";
import { getOrgBySlug } from "@/lib/tenant";
import { activityEntries } from "@/lib/activity-entries";
import {
  listActivities,
  listActivityTypes,
  listMembers,
  listMembersWithRender,
} from "@/lib/queries";
import type { Timestamp } from "firebase-admin/firestore";

export default async function ReviewQueuePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  await requireOrgRole(org.id, "officer");

  const [pending, types, members] = await Promise.all([
    listActivities(org.id, { status: "pending", limit: 50 }),
    listActivityTypes(org.id),
    listMembers(org.id),
  ]);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const memberById = new Map(members.map((m) => [m.id, m]));

  // Member-uploaded character art waiting to be cleared for the public page.
  // Existence + flag only — the images themselves stream from the render route.
  const renders = await listMembersWithRender(
    org.id,
    members.map((m) => m.id),
  );
  const pendingRenders: PendingRender[] = members
    .filter((m) => renders.get(m.id)?.approved === false)
    .map((m) => ({
      memberId: m.id,
      roadName: m.roadName,
      displayName: m.displayName,
      imageUrl: `/api/orgs/${org.id}/members/${m.id}/render`,
    }));

  const items = pending.map((activity) => ({
    id: activity.id,
    memberName: memberById.get(activity.memberId)?.roadName ?? "Unknown",
    memberFullName: memberById.get(activity.memberId)?.displayName ?? "",
    entries: activityEntries(activity).map((e) => ({
      typeName: typeById.get(e.typeId)?.name ?? e.typeId,
      quantity: e.quantity,
    })),
    date: (activity.date as Timestamp)?.toDate?.().toISOString() ?? "",
    description: activity.description,
    witnesses: activity.witnesses
      .map((id) => memberById.get(id)?.roadName)
      .filter(Boolean) as string[],
    hasProof: Boolean(activity.proofPath),
  }));

  return (
    <div className={`${PAGE_W.content} space-y-8`}>
      <div>
        <DisplayHeading className="flex items-center gap-3 text-3xl text-foreground md:text-4xl">
          <ClipboardCheck className="size-7" aria-hidden />
          Review Queue
        </DisplayHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          {items.length === 0
            ? "All caught up."
            : `${items.length} submission${items.length === 1 ? "" : "s"} awaiting judgment. Approvals update stats and award patches automatically.`}
        </p>
      </div>

      <ReviewQueue orgId={org.id} items={items} />

      {/* Character art sits under the activity queue rather than on its own
          page: it's the same job (an officer clearing member submissions) and
          it arrives far too rarely to be worth a nav entry of its own. */}
      <section aria-labelledby="render-review-heading" className="space-y-4">
        <div>
          <h2
            id="render-review-heading"
            className="flex items-center gap-2 text-lg font-semibold text-foreground"
          >
            <ImageUp className="size-5 text-primary" aria-hidden />
            Character Art
            {pendingRenders.length > 0 && (
              <span className="font-stat rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                {pendingRenders.length}
              </span>
            )}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Members can upload their own render. It shows in the portal right
            away, but the public page keeps the silhouette until you clear it.
          </p>
        </div>

        <RenderReviewQueue orgId={org.id} orgSlug={orgSlug} items={pendingRenders} />
      </section>
    </div>
  );
}
