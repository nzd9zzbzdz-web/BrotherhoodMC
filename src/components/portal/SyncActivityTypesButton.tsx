"use client";

import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncDefaultActivityTypes } from "@/actions/activity-types";

/**
 * Admin one-click: add any shipped activity types this org is missing. Orgs
 * only get the seed list on a destructive reseed, so types added after the org
 * was created — the criminal-record ones, say — need a way in.
 */
export function SyncActivityTypesButton({ orgId }: { orgId: string }) {
  const [pending, startTransition] = useTransition();

  function handleSync() {
    startTransition(async () => {
      const result = await syncDefaultActivityTypes(orgId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not sync activity types");
        return;
      }
      const d = result.data!;
      const parts: string[] = [];
      if (d.created.length > 0) parts.push(`Added ${d.created.length} activity type(s)`);
      if (d.retired > 0) parts.push(`retired ${d.retired}`);
      if (d.patchesAdded.length > 0) parts.push(`${d.patchesAdded.length} new patch(es)`);
      if (d.patchesRetired > 0) parts.push(`${d.patchesRetired} patch(es) retired`);
      if (d.emblemsMarked > 0) parts.push(`${d.emblemsMarked} marked as emblems`);
      if (d.laddersRetuned > 0) parts.push(`${d.laddersRetuned} threshold(s) retuned`);
      if (d.cutsCleaned > 0) parts.push(`${d.cutsCleaned} cut(s) cleaned`);
      if (d.membersMigrated > 0) parts.push(`${d.membersMigrated} rap sheet(s) moved to stats`);
      toast.success(
        parts.length === 0 ? "Already up to date, nothing to change" : parts.join(" · "),
      );
    });
  }

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={handleSync}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="size-4" aria-hidden />
      )}
      {pending ? "Syncing…" : "Sync default types"}
    </Button>
  );
}
