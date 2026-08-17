"use client";

import { useState, useTransition } from "react";
import { Loader2, ScrollText, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { saveMemberStats } from "@/actions/member-stats";
import { MAX_STAT_VALUE } from "@/lib/constants";
import type { StatKey } from "@/lib/types";

export interface StatEditRow {
  statKey: StatKey;
  label: string;
  value: number;
  /** How the record draws it today, when that isn't the raw number ($2.4M, 96 mo). */
  display?: string;
}

export interface StatEditGroup {
  title: string;
  rows: StatEditRow[];
}

/**
 * Admin: fix a number the ticket pipeline got wrong.
 *
 * Approvals are one-way. An officer who approves a heist logged as 500 instead
 * of 5 has no way to walk it back, and that number is what the criminal record,
 * the emblem ladders and the standings all read. This is the only place a stat
 * moves by hand.
 *
 * Absolute values, prefilled with what the record says now: the admin is
 * reading the wrong number off the character screen and typing the right one.
 * Only the rows they actually change are sent.
 */
export function MemberStatsEditor({
  orgId,
  memberId,
  roadName,
  groups,
}: {
  orgId: string;
  memberId: string;
  roadName: string;
  groups: StatEditGroup[];
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const rows = groups.flatMap((g) => g.rows);

  function start() {
    setDrafts(Object.fromEntries(rows.map((r) => [r.statKey, String(r.value)])));
    setReason("");
    setOpen(true);
  }

  /** null when the box is empty or not a whole number in range. */
  function parsed(raw: string): number | null {
    const text = raw.trim();
    if (!/^\d+$/.test(text)) return null;
    const n = Number(text);
    return Number.isSafeInteger(n) && n <= MAX_STAT_VALUE ? n : null;
  }

  const invalid = rows.filter((r) => parsed(drafts[r.statKey] ?? "") === null);
  const changed = rows.filter((r) => {
    const n = parsed(drafts[r.statKey] ?? "");
    return n !== null && n !== r.value;
  });

  function submit() {
    startTransition(async () => {
      const result = await saveMemberStats({
        orgId,
        memberId,
        stats: changed.map((r) => ({
          statKey: r.statKey,
          value: parsed(drafts[r.statKey] ?? "")!,
        })),
        reason: reason.trim(),
      });
      if (!result.ok) {
        toast.error(result.error ?? "Could not save the correction");
        return;
      }
      const { changed: applied, granted, revoked } = result.data!;
      const extra = [
        granted.length ? `${granted.length} earned` : "",
        revoked.length ? `${revoked.length} taken back` : "",
      ].filter(Boolean);
      toast.success(
        `${applied.length} stat${applied.length === 1 ? "" : "s"} corrected` +
          (extra.length ? ` (${extra.join(", ")})` : ""),
      );
      setOpen(false);
    });
  }

  return (
    <section aria-label={`Correct the record for "${roadName}"`} className="glass-card rounded-xl p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <ScrollText className="size-5 text-muted-foreground" aria-hidden />
            Record Correction
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every number on this page comes from a ticket an officer approved.
            Fix one here when a ticket went through with the wrong amount.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={start}>
          Correct the record
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Correct &ldquo;{roadName}&rdquo;</DialogTitle>
            <DialogDescription>
              Type what the record should say. Only the numbers you change are
              written, and the change is logged with your name against it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {groups.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </h3>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {group.rows.map((row) => {
                    const raw = drafts[row.statKey] ?? "";
                    const n = parsed(raw);
                    const bad = n === null;
                    const moved = !bad && n !== row.value;
                    return (
                      <div key={row.statKey}>
                        <Label htmlFor={`stat-${row.statKey}`} className="text-sm">
                          {row.label}
                        </Label>
                        <Input
                          id={`stat-${row.statKey}`}
                          value={raw}
                          inputMode="numeric"
                          autoComplete="off"
                          aria-invalid={bad}
                          onChange={(e) =>
                            setDrafts({ ...drafts, [row.statKey]: e.target.value })
                          }
                          className={`font-stat mt-1 ${bad ? "border-destructive" : ""}`}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          {bad
                            ? "Whole numbers only, zero or higher"
                            : moved
                              ? `On the record now: ${row.display ?? row.value.toLocaleString("en-US")}`
                              : (row.display ?? row.value.toLocaleString("en-US"))}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <div>
              <Label htmlFor="stat-reason">
                Reason <span aria-hidden="true" className="text-destructive">*</span>
              </Label>
              <Textarea
                id="stat-reason"
                value={reason}
                maxLength={300}
                rows={2}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Approved a heist ticket at 500 instead of 5."
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Goes in the audit log next to the before and after values.
              </p>
            </div>

            <p className="flex items-start gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
              <TriangleAlert className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
              <span>
                Patches and emblems are re-checked against the corrected record.
                Lowering a number can take back a rung it no longer reaches, and
                a patch taken back also comes off the cut. Anything leadership
                handed over by hand is never touched.
              </span>
            </p>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {invalid.length > 0
                ? `${invalid.length} value${invalid.length === 1 ? "" : "s"} to fix first`
                : `${changed.length} change${changed.length === 1 ? "" : "s"} pending`}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={
                  pending ||
                  invalid.length > 0 ||
                  changed.length === 0 ||
                  reason.trim().length < 3
                }
              >
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Save correction
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
