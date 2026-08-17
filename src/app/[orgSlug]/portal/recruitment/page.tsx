import { notFound } from "next/navigation";
import { PAGE_W } from "@/lib/page-width";
import { getOrgBySlug } from "@/lib/tenant";
import { requireOrgRole } from "@/lib/auth/session";
import { orgRef } from "@/lib/firebase/admin";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { RecruitmentQueue, type ApplicationItem } from "@/components/portal/RecruitmentQueue";
import type { Application } from "@/lib/types";
import type { Timestamp } from "firebase-admin/firestore";

export default async function RecruitmentPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  const access = await requireOrgRole(org.id, "officer");

  const snap = await orgRef(org.id)
    .collection("applications")
    .where("status", "==", "pending")
    .get();

  const items: ApplicationItem[] = snap.docs
    .map((d) => {
      const a = d.data() as Omit<Application, "id">;
      return {
        id: d.id,
        roadName: a.roadName,
        handle: a.handle,
        email: a.email,
        message: a.message ?? "",
        submittedAt: (a.createdAt as Timestamp)?.toDate?.().toISOString() ?? "",
      };
    })
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)); // oldest first

  return (
    <div className={`${PAGE_W.form} space-y-8`}>
      <div>
        <DisplayHeading className="text-3xl text-foreground md:text-4xl">Recruitment</DisplayHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          People asking to prospect. Approve to bring them in, or decline.
        </p>
      </div>

      <RecruitmentQueue
        orgId={org.id}
        canElevate={access.role === "admin" || access.isSuper}
        items={items}
      />
    </div>
  );
}
