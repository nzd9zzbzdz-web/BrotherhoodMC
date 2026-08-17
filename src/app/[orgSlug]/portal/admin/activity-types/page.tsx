import { notFound } from "next/navigation";
import { PAGE_W } from "@/lib/page-width";
import { SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { SyncActivityTypesButton } from "@/components/portal/SyncActivityTypesButton";
import { requireOrgRole } from "@/lib/auth/session";
import { getOrgBySlug } from "@/lib/tenant";
import { listActivityTypes } from "@/lib/queries";
import { RETIRED_ACTIVITY_TYPE_IDS, STAT_LABELS } from "@/lib/constants";
import { defaultActivityTypes } from "@/lib/criminal-record";

export default async function ActivityTypesAdminPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  await requireOrgRole(org.id, "admin");

  const types = await listActivityTypes(org.id);
  const have = new Set(types.map((t) => t.id));
  const missingCount = defaultActivityTypes().filter((t) => !have.has(t.id)).length;
  // Retired club types that are still offered to members here.
  const staleCount = types.filter(
    (t) => t.active && RETIRED_ACTIVITY_TYPE_IDS.includes(t.id),
  ).length;
  const outOfDate = missingCount + staleCount;

  return (
    <div className={`${PAGE_W.form} space-y-8`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <DisplayHeading className="flex items-center gap-3 text-3xl text-foreground md:text-4xl">
            <SlidersHorizontal className="size-7" aria-hidden />
            Activity Types
          </DisplayHeading>
          <p className="mt-1 text-sm text-muted-foreground">
            What members can submit and which stat each type feeds. Editing tools
            arrive in a later milestone.
          </p>
        </div>
        <SyncActivityTypesButton orgId={org.id} />
      </div>

      {outOfDate > 0 && (
        <p className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 text-sm text-foreground">
          This club is out of date:{" "}
          {missingCount > 0 && (
            <>
              <span className="font-semibold">{missingCount}</span> shipped
              {missingCount === 1 ? " type is" : " types are"} missing (including
              the Criminal Record types that feed the character screen)
            </>
          )}
          {missingCount > 0 && staleCount > 0 && ", and "}
          {staleCount > 0 && (
            <>
              <span className="font-semibold">{staleCount}</span> retired club
              {staleCount === 1 ? " type is" : " types are"} still offered to
              members
            </>
          )}
          . <span className="font-semibold">Sync default types</span> fixes both
          and updates the patches that depend on them.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Feeds stat</TableHead>
              <TableHead>Proof</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((type) => (
              <TableRow key={type.id}>
                <TableCell className="font-semibold">{type.name}</TableCell>
                <TableCell className="text-sm">{STAT_LABELS[type.statKey]}</TableCell>
                <TableCell>
                  {type.requiresProof ? (
                    <Badge variant="outline">Recommended</Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">Optional</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={type.active ? "default" : "secondary"}>
                    {type.active ? "Active" : "Disabled"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
