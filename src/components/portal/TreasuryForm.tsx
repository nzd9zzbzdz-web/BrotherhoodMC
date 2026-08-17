"use client";

import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitTreasuryTx } from "@/actions/treasury";
import {
  MAX_TREASURY_AMOUNT,
  TREASURY_BOOKS,
  TREASURY_BOOK_BLURB,
  TREASURY_BOOK_LABEL,
} from "@/lib/constants";
import type { TreasuryBook, TreasuryTxKind } from "@/lib/types";

const KIND_LABEL: Record<TreasuryTxKind, string> = {
  dues: "Dues payment",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
};

/**
 * File a money movement for review. Anyone in the club can pay dues, log a
 * deposit, or ask for a withdrawal; nothing lands on the books until a
 * treasury reviewer approves it.
 *
 * Every movement names a book. It is a pair of buttons rather than a second
 * dropdown because the choice has to be readable without opening anything:
 * money filed against the wrong book is money the club believes it can
 * account for and cannot, and only an admin correction takes it back.
 *
 * Reviewers get one extra control: filing FOR another member, which is how
 * cash dues handed over at church get onto that member's record. The action
 * re-checks the permission server-side; the select only decides what renders.
 */
export function TreasuryForm({
  orgId,
  selfMemberId,
  canReview,
  members,
}: {
  orgId: string;
  selfMemberId: string;
  canReview: boolean;
  /** Riding members for the reviewer's "for member" select. */
  members: { id: string; label: string }[];
}) {
  const [kind, setKind] = useState<TreasuryTxKind>("dues");
  const [book, setBook] = useState<TreasuryBook>("clean");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState(selfMemberId);
  const [pending, startTransition] = useTransition();

  /** null when the box is empty or not a whole positive dollar figure. */
  function parsed(raw: string): number | null {
    const text = raw.replace(/[,$\s]/g, "");
    if (!/^\d+$/.test(text)) return null;
    const n = Number(text);
    return Number.isSafeInteger(n) && n >= 1 && n <= MAX_TREASURY_AMOUNT ? n : null;
  }

  const amountValue = parsed(amount);
  const noteNeeded = kind !== "dues" && note.trim().length < 3;

  function submit() {
    if (amountValue === null) return;
    startTransition(async () => {
      const result = await submitTreasuryTx({
        orgId,
        kind,
        book,
        amount: amountValue,
        note: note.trim(),
        // Dues only: the For-member select exists for cash dues, and a pick
        // made there must never ride along after the kind changes.
        ...(kind === "dues" && subject !== selfMemberId
          ? { subjectMemberId: subject }
          : {}),
      });
      if (!result.ok) {
        toast.error(result.error ?? "Could not file it");
        return;
      }
      const label = TREASURY_BOOK_LABEL[book].toLowerCase();
      toast.success(
        kind === "withdrawal"
          ? `Withdrawal request filed against the ${label} book`
          : kind === "deposit"
            ? `Deposit logged on the ${label} book`
            : `Dues payment filed on the ${label} book`,
      );
      setAmount("");
      setNote("");
      setSubject(selfMemberId);
      // The book is NOT reset: someone filing dirty money usually has more of
      // it to file, and the buttons say which one is armed at all times.
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="treasury-kind">Movement</Label>
        <Select
          value={kind}
          onValueChange={(v) => {
            setKind(v as TreasuryTxKind);
            // The For-member pick belongs to the dues flow it was made in.
            setSubject(selfMemberId);
          }}
        >
          <SelectTrigger id="treasury-kind" className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(KIND_LABEL) as TreasuryTxKind[]).map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <span className="text-sm font-medium">Book</span>
        <div role="group" aria-label="Book" className="mt-1 grid grid-cols-2 gap-2">
          {TREASURY_BOOKS.map((b) => {
            const active = book === b;
            return (
              <button
                key={b}
                type="button"
                aria-pressed={active}
                onClick={() => setBook(b)}
                className={`rounded-md border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                <span className="block text-sm font-semibold">
                  {TREASURY_BOOK_LABEL[b]}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {TREASURY_BOOK_BLURB[b]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {canReview && kind === "dues" && (
        <div>
          <Label htmlFor="treasury-subject">For member</Label>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger id="treasury-subject" className="mt-1 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            For cash handed over in person: file it against the member who paid.
          </p>
        </div>
      )}

      <div>
        <Label htmlFor="treasury-amount">
          Amount <span aria-hidden="true" className="text-destructive">*</span>
        </Label>
        <Input
          id="treasury-amount"
          value={amount}
          inputMode="numeric"
          autoComplete="off"
          placeholder="500"
          aria-invalid={amount.trim() !== "" && amountValue === null}
          onChange={(e) => setAmount(e.target.value)}
          className="font-stat mt-1"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Whole dollars. The movement direction comes from the type, so no
          minus signs.
        </p>
      </div>

      <div>
        <Label htmlFor="treasury-note">
          Note{" "}
          {kind !== "dues" && (
            <span aria-hidden="true" className="text-destructive">*</span>
          )}
        </Label>
        <Textarea
          id="treasury-note"
          value={note}
          maxLength={300}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            kind === "withdrawal"
              ? "Ammo for the war chest run"
              : kind === "deposit"
                ? "Cut from the docks job"
                : "Optional. Anything the Treasurer should know"
          }
          className="mt-1"
        />
        {kind !== "dues" && (
          <p className="mt-1 text-xs text-muted-foreground">
            {kind === "withdrawal"
              ? "Say what the money is for."
              : "Say where the money came from."}
          </p>
        )}
      </div>

      <Button
        onClick={submit}
        disabled={pending || amountValue === null || noteNeeded}
        className="w-full"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Send className="size-4" aria-hidden />
        )}
        File for review
      </Button>
      <p className="text-xs text-muted-foreground">
        Nothing touches either book until an admin or the Treasurer approves
        it, and a withdrawal has to be covered by the book it names.
      </p>
    </div>
  );
}
