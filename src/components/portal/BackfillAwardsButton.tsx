"use client";

import { useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { backfillPatchAwards } from "@/actions/patch-backfill";

/**
 * Admin one-click: hand out every patch and emblem members already qualify for.
 *
 * Needed because thresholds are only evaluated when an activity is approved —
 * install a new emblem or lower a threshold and nobody gets it until their next
 * approved log. Safe to press any time; it only ever adds.
 */
export function BackfillAwardsButton({ orgId }: { orgId: string }) {
  const [pending, startTransition] = useTransition();

  function handleBackfill() {
    startTransition(async () => {
      const result = await backfillPatchAwards(orgId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not backfill awards");
        return;
      }
      const d = result.data!;
      toast.success(
        d.awardsCreated === 0
          ? `Nothing to award. All ${d.membersChecked} member(s) are up to date`
          : `${d.awardsCreated} award(s) across ${d.membersAwarded} member(s)`,
      );
    });
  }

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={handleBackfill}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Sparkles className="size-4" aria-hidden />
      )}
      {pending ? "Awarding…" : "Backfill awards"}
    </Button>
  );
}
