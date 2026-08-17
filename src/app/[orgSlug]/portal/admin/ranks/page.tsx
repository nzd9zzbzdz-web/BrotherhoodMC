import { notFound } from "next/navigation";
import { PAGE_W } from "@/lib/page-width";
import { Shield } from "lucide-react";
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
import { SyncRanksButton } from "@/components/portal/SyncRanksButton";
import { requireOrgRole } from "@/lib/auth/session";
import { getOrgBySlug } from "@/lib/tenant";
import { listMembers, listRanks } from "@/lib/queries";
import { DEFAULT_RANKS, rankDocId } from "@/lib/constants";

export default async function RanksAdminPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  await requireOrgRole(org.id, "admin");

  const [ranks, members] = await Promise.all([
    listRanks(org.id),
    listMembers(org.id),
  ]);
  const countByRank = new Map<string, number>();
  for (const member of members) {
    countByRank.set(member.rankId, (countByRank.get(member.rankId) ?? 0) + 1);
  }

  // Ranks only land on a destructive reseed, so a club created before a rank
  // shipped is missing it — and one that changed sides keeps a stale flag.
  const byId = new Map(ranks.map((r) => [r.id, r]));
  const missing = DEFAULT_RANKS.filter((r) => !byId.has(rankDocId(r.name)));
  const stale = DEFAULT_RANKS.filter((r) => {
    const current = byId.get(rankDocId(r.name));
    return current && current.isOfficer !== r.isOfficer;
  });
  const outOfDate = missing.length + stale.length;

  return (
    <div className={`${PAGE_W.form} space-y-8`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <DisplayHeading className="flex items-center gap-3 text-3xl text-foreground md:text-4xl">
            <Shield className="size-7" aria-hidden />
            Ranks
          </DisplayHeading>
          <p className="mt-1 text-sm text-muted-foreground">
            The chain of command. Assign ranks from the member admin page; rank
            editing tools arrive in a later milestone.
          </p>
        </div>
        <SyncRanksButton orgId={org.id} />
      </div>

      {outOfDate > 0 && (
        <p className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 text-sm text-foreground">
          This club is out of date:{" "}
          {missing.length > 0 && (
            <>
              <span className="font-semibold">{missing.map((r) => r.name).join(", ")}</span>{" "}
              {missing.length === 1 ? "is" : "are"} missing
            </>
          )}
          {missing.length > 0 && stale.length > 0 && ", and "}
          {stale.length > 0 && (
            <>
              <span className="font-semibold">{stale.map((r) => r.name).join(", ")}</span>{" "}
              {stale.length === 1 ? "sits" : "sit"} on the wrong side of the
              officer table
            </>
          )}
          . <span className="font-semibold">Sync default ranks</span> fixes it.
          Nothing already assigned to a member is removed.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Order</TableHead>
              <TableHead>Rank</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Members</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranks.map((rank) => (
              <TableRow key={rank.id}>
                <TableCell className="font-stat">{rank.order}</TableCell>
                <TableCell className="font-semibold">{rank.name}</TableCell>
                <TableCell>
                  <Badge variant={rank.isOfficer ? "default" : "secondary"}>
                    {rank.isOfficer ? "Officer" : "Member"}
                  </Badge>
                </TableCell>
                <TableCell className="font-stat text-right">
                  {countByRank.get(rank.id) ?? 0}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
