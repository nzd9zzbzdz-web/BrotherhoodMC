import { notFound } from "next/navigation";
import { PAGE_W } from "@/lib/page-width";
import { Shirt } from "lucide-react";
import { getOrgBySlug } from "@/lib/tenant";
import { requireOrgRole } from "@/lib/auth/session";
import { getMemberCut } from "@/lib/cut/getCut";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { CutViewer } from "@/components/portal/cut/CutViewer";
import { ComingSoon } from "@/components/portal/ComingSoon";

export default async function MyCutPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();

  const access = await requireOrgRole(org.id, "member");
  if (!access.memberId) {
    return (
      <ComingSoon
        icon={Shirt}
        title="My Cut"
        blurb="No cut on file."
        detail="This account isn't linked to a club member record, so there's no vest to show."
      />
    );
  }

  const cut = await getMemberCut(org.id, access.memberId);
  if (!cut) notFound();
  const { summary } = cut;

  const joined = summary.joinDate
    ? new Date(summary.joinDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "-";

  const facts: { label: string; value: string }[] = [
    { label: "Rank", value: summary.rankName || "-" },
    { label: "Standing", value: summary.status },
    { label: "Patches", value: String(summary.patchCount) },
    { label: "Since", value: joined },
  ];

  return (
    <div className={`${PAGE_W.content} space-y-6`}>
      <div>
        <DisplayHeading className="text-3xl text-foreground">My Cut</DisplayHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          &ldquo;{summary.roadName}&rdquo;
          {summary.displayName && (
            <span className="text-muted-foreground/70"> · {summary.displayName}</span>
          )}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label} className="rounded-lg border border-border bg-card px-3 py-2">
            <dt className="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
              {f.label}
            </dt>
            <dd className="mt-0.5 font-semibold capitalize text-foreground">{f.value}</dd>
          </div>
        ))}
      </dl>

      <CutViewer model={cut.model} summary={summary} aspectRatio={cut.aspectRatio} />
    </div>
  );
}
