"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Paperclip, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { reviewActivity } from "@/actions/activities";

export interface ReviewItem {
  id: string;
  memberName: string;
  memberFullName: string;
  /** One ticket can carry several activity types. */
  entries: { typeName: string; quantity: number }[];
  date: string;
  description: string;
  witnesses: string[];
  hasProof: boolean;
}

function entriesLabel(item: ReviewItem): string {
  return item.entries
    .map((e) =>
      e.quantity > 1
        ? `${e.typeName} ×${e.quantity.toLocaleString("en-US")}`
        : e.typeName,
    )
    .join(" · ");
}

export function ReviewQueue({
  orgId,
  items,
}: {
  orgId: string;
  items: ReviewItem[];
}) {
  const [denyTarget, setDenyTarget] = useState<ReviewItem | null>(null);
  const [denyNote, setDenyNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function approve(item: ReviewItem) {
    setBusyId(item.id);
    startTransition(async () => {
      const result = await reviewActivity({
        orgId,
        activityId: item.id,
        decision: "approved",
      });
      if (result.ok) {
        const awards = result.data?.awardedPatchIds ?? [];
        // The action revalidated this page — its response already removed the
        // item from the queue; a refresh here would just re-render it again.
        toast.success(
          awards.length
            ? `Approved. ${awards.length} patch${awards.length === 1 ? "" : "es"} awarded!`
            : "Approved. Stats updated",
        );
      } else {
        toast.error(result.error ?? "Approval failed");
      }
      setBusyId(null);
    });
  }

  function deny() {
    if (!denyTarget) return;
    const target = denyTarget;
    setBusyId(target.id);
    startTransition(async () => {
      const result = await reviewActivity({
        orgId,
        activityId: target.id,
        decision: "denied",
        reviewNote: denyNote.trim() || undefined,
      });
      if (result.ok) {
        toast.success("Denied");
        setDenyTarget(null);
        setDenyNote("");
      } else {
        toast.error(result.error ?? "Denial failed");
      }
      setBusyId(null);
    });
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Check className="mx-auto size-10 text-primary" aria-hidden />
          <p className="mt-3 font-medium">The queue is clear</p>
          <p className="mt-1 text-sm text-muted-foreground">
            New submissions land here for your review.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <ul className="space-y-4">
        {items.map((item) => (
          <li key={item.id}>
            <Card>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">
                      &ldquo;{item.memberName}&rdquo;
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        {item.memberFullName}
                      </span>
                    </p>
                    <p className="text-sm text-primary">{entriesLabel(item)}</p>
                  </div>
                  <time className="text-sm text-muted-foreground">
                    {item.date &&
                      new Date(item.date).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                  </time>
                </div>

                <p className="text-sm leading-relaxed text-foreground">
                  {item.description}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  {item.hasProof && (
                    <Badge variant="outline" className="gap-1">
                      <Paperclip className="size-3" aria-hidden />
                      Proof attached
                    </Badge>
                  )}
                  {item.witnesses.length > 0 && (
                    <Badge variant="outline" className="gap-1">
                      <Users className="size-3" aria-hidden />
                      {item.witnesses.map((w) => `"${w}"`).join(", ")}
                    </Badge>
                  )}
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={() => approve(item)}
                    disabled={pending && busyId === item.id}
                    className="min-w-28"
                  >
                    {pending && busyId === item.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Check className="size-4" aria-hidden />
                    )}
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setDenyTarget(item)}
                    disabled={pending && busyId === item.id}
                  >
                    <X className="size-4" aria-hidden />
                    Deny
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <Dialog
        open={denyTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDenyTarget(null);
            setDenyNote("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny this submission?</DialogTitle>
            <DialogDescription>
              {denyTarget &&
                `"${denyTarget.memberName}" · ${entriesLabel(denyTarget)}. Tell them why so they can fix it.`}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="deny-note">Reason (optional)</Label>
            <Textarea
              id="deny-note"
              value={denyNote}
              onChange={(e) => setDenyNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="No proof attached, wrong date, didn't happen…"
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDenyTarget(null);
                setDenyNote("");
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={deny} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Deny submission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
