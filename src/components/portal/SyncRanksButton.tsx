"use client";

import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncDefaultRanks } from "@/actions/ranks";

/**
 * Admin one-click: add any shipped ranks this org is missing and correct the
 * order/officer flag on the rest. Ranks are only written on a destructive
 * reseed, so a rank added — or moved out of the officer table — after the org
 * was created needs a way in.
 */
export function SyncRanksButton({ orgId }: { orgId: string }) {
  const [pending, startTransition] = useTransition();

  function handleSync() {
    startTransition(async () => {
      const result = await syncDefaultRanks(orgId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not sync ranks");
        return;
      }
      const d = result.data!;
      const parts: string[] = [];
      if (d.created.length > 0) parts.push(`Added ${d.created.join(", ")}`);
      if (d.updated.length > 0) parts.push(`updated ${d.updated.join(", ")}`);
      if (d.visualsWritten > 0) parts.push(`${d.visualsWritten} cut visual(s) written`);
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
      {pending ? "Syncing…" : "Sync default ranks"}
    </Button>
  );
}
