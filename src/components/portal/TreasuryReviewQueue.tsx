"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { reviewTreasuryTx } from "@/actions/treasury";
import { TREASURY_BOOK_LABEL, formatMoney } from "@/lib/constants";
import type { TreasuryBook } from "@/lib/types";

export interface TreasuryReviewItem {
  id: string;
  kindLabel: string;
  /** Withdrawals point out of the bank; the queue shows it before approval. */
  outbound: boolean;
  amount: number;
  memberName: string;
  note: string;
  date: string;
  /** Which book approving this would move. */
  book: TreasuryBook;
}

/**
 * The treasury's pending queue, admin-and-Treasurer only (the page decides who
 * sees it; the action re-checks). Approval moves one book, so the card says
 * which way the money goes AND which book it comes out of before anyone
 * clicks: a withdrawal the clean book can cover and the dirty book cannot is
 * two different decisions wearing the same amount.
 */
export function TreasuryReviewQueue({
  orgId,
  items,
}: {
  orgId: string;
  items: TreasuryReviewItem[];
}) {
  const [denyTarget, setDenyTarget] = useState<TreasuryReviewItem | null>(null);
  const [denyNote, setDenyNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function approve(item: TreasuryReviewItem) {
    setBusyId(item.id);
    startTransition(async () => {
      const result = await reviewTreasuryTx({
        orgId,
        txId: item.id,
        decision: "approved",
      });
      if (result.ok) {
        toast.success(
          result.data
            ? `Approved. The ${TREASURY_BOOK_LABEL[result.data.book].toLowerCase()} book holds ${formatMoney(result.data.balance)}`
            : "Approved",
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
      const result = await reviewTreasuryTx({
        orgId,
        txId: target.id,
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
        <CardContent className="py-10 text-center">
          <Check className="mx-auto size-8 text-primary" aria-hidden />
          <p className="mt-3 font-medium">The books are settled</p>
          <p className="mt-1 text-sm text-muted-foreground">
            New money movements land here for your ruling.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <Card>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-foreground">
                    &ldquo;{item.memberName}&rdquo;
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {item.kindLabel}
                    </span>
                    <Badge variant="outline" className="ml-2 align-middle">
                      {TREASURY_BOOK_LABEL[item.book]}
                    </Badge>
                  </p>
                  <p className="font-stat text-lg font-semibold text-primary">
                    {item.outbound ? "-" : "+"}
                    {formatMoney(item.amount)}
                  </p>
                </div>
                {item.note && (
                  <p className="text-sm leading-relaxed text-foreground">{item.note}</p>
                )}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <time className="text-xs text-muted-foreground">{item.date}</time>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => approve(item)}
                      disabled={pending && busyId === item.id}
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
                      size="sm"
                      onClick={() => setDenyTarget(item)}
                      disabled={pending && busyId === item.id}
                    >
                      <X className="size-4" aria-hidden />
                      Deny
                    </Button>
                  </div>
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
            <DialogTitle>Deny this movement?</DialogTitle>
            <DialogDescription>
              {denyTarget &&
                `"${denyTarget.memberName}" · ${denyTarget.kindLabel} of ${formatMoney(denyTarget.amount)} on the ${TREASURY_BOOK_LABEL[denyTarget.book].toLowerCase()} book. Tell them why.`}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="treasury-deny-note">Reason (optional)</Label>
            <Textarea
              id="treasury-deny-note"
              value={denyNote}
              onChange={(e) => setDenyNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Wrong amount, already logged, not club money…"
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
              Deny movement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
