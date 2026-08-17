import { notFound } from "next/navigation";
import { PAGE_W } from "@/lib/page-width";
import { Leaderboard } from "@/components/portal/Leaderboard";
import { requireOrgRole } from "@/lib/auth/session";
import { loadLeaderboard } from "@/lib/leaderboard-data";
import { getOrgBySlug } from "@/lib/tenant";

/**
 * Standings — the emblem leaderboards on their own page, reachable from the
 * sidebar instead of only through a tab on somebody's profile.
 *
 * Same boards, same component: the difference is who the lit row belongs to.
 * On a profile it's that member; here it's you, so the page opens on "where do
 * I stand". The card carries its own heading, so there's no page header above
 * it to say Standings twice.
 */
export default async function StandingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  const access = await requireOrgRole(org.id, "member");

  const categories = await loadLeaderboard(org.id);

  return (
    <div className={`${PAGE_W.content} space-y-8`}>
      <Leaderboard
        categories={categories}
        orgSlug={orgSlug}
        // A super admin has no member record — no row lights, nothing breaks.
        subjectMemberId={access.memberId ?? ""}
        viewerMemberId={access.memberId ?? null}
      />
    </div>
  );
}
