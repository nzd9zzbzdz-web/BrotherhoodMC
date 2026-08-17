"use server";

import { revalidatePath } from "next/cache";
import { revalidateOrgTags } from "@/lib/cache";
import { requireOrgRole } from "@/lib/auth/session";
import {
  TreasuryError,
  approveTreasuryTxCore,
  canReviewTreasury,
  denyTreasuryTxCore,
  insufficientFundsMessage,
  memberRankFresh,
  submitTreasuryTxCore,
  type TreasuryApproval,
} from "@/lib/treasury-core";
import { notifyTreasurySubmitted, updateBankPanel } from "@/lib/discord/notify";
import { getMember } from "@/lib/queries";
import {
  reviewTreasuryTxSchema,
  submitTreasuryTxSchema,
  type ReviewTreasuryTxInput,
  type SubmitTreasuryTxInput,
} from "@/lib/schemas/treasury";
import type { ActionResult } from "./activities";

// The web transport for the club bank: zod parse → requireOrgRole → core →
// cache revalidation. All Firestore work lives in src/lib/treasury-core.ts so
// the Discord handlers drive the same pipeline without a session cookie.

/** Is this caller allowed to rule on money? Portal admins and the member in
 *  the Treasurer seat — the rank comes off their own member doc, read FRESH
 *  because a cached permission is a stale permission. */
async function callerCanReview(
  orgId: string,
  role: "admin" | "officer" | "member",
  memberId: string | null,
): Promise<boolean> {
  if (canReviewTreasury(role, undefined)) return true;
  if (!memberId) return false;
  return canReviewTreasury(role, await memberRankFresh(orgId, memberId));
}

/** Any member files a money movement for review. */
export async function submitTreasuryTx(
  raw: SubmitTreasuryTxInput,
): Promise<ActionResult<{ txId: string }>> {
  const parsed = submitTreasuryTxSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const input = parsed.data;

  try {
    const access = await requireOrgRole(input.orgId, "member");
    if (!access.memberId) return { ok: false, error: "No member record" };

    // Filing FOR someone else (cash dues handed over in person) is reviewer
    // ground: anyone else's ticket is their own, whatever the payload says.
    // Dues ONLY: deposits and withdrawals are club money moved by whoever
    // moved it, and attributing one to another member has no honest use.
    let subjectMemberId = access.memberId;
    if (input.subjectMemberId && input.subjectMemberId !== access.memberId) {
      if (input.kind !== "dues") {
        return { ok: false, error: "Only dues can be filed for someone else" };
      }
      const mayReview = await callerCanReview(
        input.orgId,
        access.role,
        access.memberId,
      );
      if (!mayReview) {
        return { ok: false, error: "Only a treasury reviewer can file for someone else" };
      }
      const subject = await getMember(input.orgId, input.subjectMemberId);
      if (!subject) return { ok: false, error: "That member does not exist" };
      subjectMemberId = subject.id;
    }

    const { txId } = await submitTreasuryTxCore(
      { uid: access.user.uid, memberId: access.memberId },
      {
        orgId: input.orgId,
        kind: input.kind,
        amount: input.amount,
        book: input.book,
        note: input.note.trim(),
        subjectMemberId,
      },
    );

    // Officer-channel heads-up; never fails the filing behind it.
    const subject = await getMember(input.orgId, subjectMemberId);
    await notifyTreasurySubmitted(input.orgId, {
      txId,
      orgId: input.orgId,
      kind: input.kind,
      book: input.book,
      amount: input.amount,
      memberLabel: subject
        ? `"${subject.roadName}" ${subject.displayName}`
        : "A member",
      note: input.note.trim(),
    });

    revalidatePath(`/[orgSlug]/portal/treasury`, "page");
    return { ok: true, data: { txId } };
  } catch (e) {
    return failure(e);
  }
}

/** A treasury reviewer approves or denies a pending movement. */
export async function reviewTreasuryTx(
  raw: ReviewTreasuryTxInput,
): Promise<ActionResult<TreasuryApproval | undefined>> {
  const parsed = reviewTreasuryTxSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, txId, decision, reviewNote } = parsed.data;

  try {
    const access = await requireOrgRole(orgId, "member");
    const mayReview = await callerCanReview(orgId, access.role, access.memberId);
    if (!mayReview) {
      return {
        ok: false,
        error: "Only an admin or the Treasurer can rule on the bank",
      };
    }

    if (decision === "approved") {
      const result = await approveTreasuryTxCore(
        orgId,
        txId,
        access.user.uid,
        reviewNote,
      );
      // The balance moved and, for dues, the member doc took a stamp — both
      // are cached reads behind the bank page, /bank, and the Dues Roll.
      revalidateOrgTags(orgId, "treasury", "members");
      // Discord's pinned card shows the balance, so a website approval has to
      // correct it too. Best-effort; never fails the approval behind it.
      await updateBankPanel(orgId);
      revalidatePath(`/[orgSlug]/portal/treasury`, "page");
      return { ok: true, data: result };
    }

    await denyTreasuryTxCore(orgId, txId, access.user.uid, reviewNote);
    // Settled movements land on the cached ledger even when denied.
    revalidateOrgTags(orgId, "treasury");
    revalidatePath(`/[orgSlug]/portal/treasury`, "page");
    return { ok: true, data: undefined };
  } catch (e) {
    return failure(e);
  }
}

function failure(e: unknown): { ok: false; error: string } {
  if (e instanceof TreasuryError) {
    switch (e.code) {
      case "daily_limit":
        return { ok: false, error: "Daily submission limit reached" };
      case "tx_not_found":
        return { ok: false, error: "That transaction no longer exists" };
      case "not_pending":
        return { ok: false, error: "This transaction was already reviewed" };
      case "insufficient_funds":
        return { ok: false, error: insufficientFundsMessage(e) };
    }
  }
  if (e instanceof Error && e.name === "AuthError") {
    return { ok: false, error: e.message === "unauthenticated" ? "Sign in required" : "Not permitted" };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong" };
}
