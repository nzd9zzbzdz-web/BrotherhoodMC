"use client";

import { useState, useTransition } from "react";
import { Loader2, ShieldMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  findStaleAwards,
  reconcilePatchAwards,
  type StaleAward,
} from "@/actions/patch-reconcile";

/**
 * Admin: revoke awards a member's stats no longer support — the cleanup after
 * a threshold is raised.
 *
 * Never fires straight from the button. Members can see their own patches, so
 * taking one back is visible and awkward to undo; the click loads a preview and
 * the admin confirms against the actual list.
 */
export function ReconcileAwardsButton({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [stale, setStale] = useState<StaleAward[] | null>(null);
  const [pending, startTransition] = useTransition();

  function handlePreview() {
    startTransition(async () => {
      const result = await findStaleAwards(orgId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not check awards");
        return;
      }
      if (result.data!.length === 0) {
        toast.success("Nothing to revoke. Every award matches the record");
        return;
      }
      setStale(result.data!);
      setOpen(true);
    });
  }

  function handleConfirm() {
    startTransition(async () => {
      const result = await reconcilePatchAwards(orgId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not revoke awards");
        return;
      }
      const d = result.data!;
      toast.success(
        `Revoked ${d.revoked} award(s) from ${d.membersAffected} member(s)`,
      );
      setOpen(false);
      setStale(null);
    });
  }

  const memberCount = new Set(stale?.map((s) => s.memberId)).size;

  return (
    <>
      <Button variant="outline" size="sm" disabled={pending} onClick={handlePreview}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <ShieldMinus className="size-4" aria-hidden />
        )}
        {pending ? "Checking…" : "Revoke stale"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revoke {stale?.length ?? 0} award(s)?</DialogTitle>
            <DialogDescription>
              These members hold a patch their record no longer reaches, usually
              because its threshold was raised. Manual awards from leadership are
              never revoked.
            </DialogDescription>
          </DialogHeader>

          <ul className="divide-y divide-border rounded-md border border-border">
            {stale?.map((s) => (
              <li
                key={`${s.memberId}_${s.patchId}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-semibold text-foreground">
                    &ldquo;{s.memberName}&rdquo;
                  </span>
                  <span className="ml-2 text-muted-foreground">{s.patchName}</span>
                </span>
                <span className="font-stat text-xs text-muted-foreground">
                  {s.statLabel} {s.current.toLocaleString("en-US")} /{" "}
                  {s.threshold.toLocaleString("en-US")}
                </span>
              </li>
            ))}
          </ul>

          <DialogFooter className="gap-2 sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Affects {memberCount} member{memberCount === 1 ? "" : "s"}. Revoked
              patches also come off their cut.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Revoke {stale?.length ?? 0}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
