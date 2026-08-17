import { notFound } from "next/navigation";
import { PAGE_W } from "@/lib/page-width";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { MemberAdmin } from "@/components/portal/MemberAdmin";
import { requireOrgRole } from "@/lib/auth/session";
import { getOrgBySlug } from "@/lib/tenant";
import { listMembers, listOrgRoles, listRanks } from "@/lib/queries";
import type { Timestamp } from "firebase-admin/firestore";

export default async function OrgAdminPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  await requireOrgRole(org.id, "admin");

  const [members, ranks, rolesByUid] = await Promise.all([
    listMembers(org.id),
    listRanks(org.id),
    listOrgRoles(org.id),
  ]);

  return (
    <div className={`${PAGE_W.content} space-y-8`}>
      <div>
        <DisplayHeading className="text-3xl text-foreground md:text-4xl">Member Administration</DisplayHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          Create records, set ranks and portal roles, and invite members.
        </p>
      </div>

      <MemberAdmin
        orgId={org.id}
        members={members.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          roadName: m.roadName,
          rankId: m.rankId,
          status: m.status,
          memberNumber: m.memberNumber,
          hasAccount: Boolean(m.uid),
          role: m.uid ? (rolesByUid.get(m.uid) ?? "member") : null,
          joinDate: (m.joinDate as Timestamp)?.toDate?.().toISOString().slice(0, 10) ?? "",
          bio: m.bio ?? "",
          publicLabel: m.publicLabel ?? "",
        }))}
        ranks={ranks.map((r) => ({ id: r.id, name: r.name, isOfficer: r.isOfficer }))}
      />
    </div>
  );
}
