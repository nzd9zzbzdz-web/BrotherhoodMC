import "server-only";
import { FieldValue, adminDb, orgRef } from "@/lib/firebase/admin";
import { EngineError } from "@/lib/patch-engine";
import type { SubmitActivityInput } from "@/lib/schemas/activity";
import type { ActivityEntry, ActivityType } from "@/lib/types";

/**
 * Transport-neutral ticket operations. The Server Actions in
 * src/actions/activities.ts are thin wrappers over this module: they own zod
 * parsing, requireOrgRole, cache revalidation and user-facing error strings;
 * everything Firestore-shaped lives here so a future non-web caller (a Discord
 * bot, a CLI) can drive the same pipeline without a session cookie.
 *
 * Together with approveActivityTx (re-exported below) this is the complete
 * ticket lifecycle: submit → approve | deny.
 *
 * Callers pass an ALREADY-PARSED SubmitActivityInput (submitActivitySchema) and
 * an actor resolved from their own authentication, never from the payload —
 * that contract is what keeps a caller from filing tickets as someone else.
 */

export const DAILY_SUBMISSION_CAP = 20;

/** Who is submitting: uid keys the rate limit, memberId owns the ticket. */
export interface SubmissionActor {
  uid: string;
  memberId: string;
}

/** Submission rejected for a domain reason (not auth, not infrastructure). */
export class SubmissionError extends Error {
  constructor(
    public readonly code: "unknown_type" | "type_disabled" | "daily_limit",
    /** For type_disabled: the activity type's display name. */
    public readonly detail?: string,
  ) {
    super(code);
    this.name = "SubmissionError";
  }
}

/**
 * Create a pending activity ticket. Validates every activity type BEFORE
 * touching the rate-limit counter, so an invalid submission never burns a
 * daily slot; the counter bump and the activity write share one transaction,
 * so a slot is consumed only if the ticket is actually created.
 */
export async function submitActivityCore(
  actor: SubmissionActor,
  input: SubmitActivityInput,
): Promise<{ activityId: string; entries: ActivityEntry[] }> {
  const { orgId } = input;

  // Proof is never required — requiresProof is only a "recommended" hint.
  const typeSnaps = await adminDb.getAll(
    ...input.entries.map((e) =>
      orgRef(orgId).collection("activityTypes").doc(e.typeId),
    ),
  );
  const entries: ActivityEntry[] = [];
  for (const [i, snap] of typeSnaps.entries()) {
    if (!snap.exists) throw new SubmissionError("unknown_type");
    const type = snap.data() as ActivityType;
    if (!type.active) throw new SubmissionError("type_disabled", type.name);
    entries.push({
      typeId: input.entries[i].typeId,
      statKey: type.statKey, // denormalized at submit time
      quantity: type.allowQuantity ? input.entries[i].quantity : 1,
    });
  }

  const day = new Date().toISOString().slice(0, 10);
  const capRef = adminDb.doc(
    `organizations/${orgId}/rateLimits/${actor.uid}_submit_${day}`,
  );
  const activityRef = orgRef(orgId).collection("activities").doc();

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(capRef);
    const count = (snap.data()?.count ?? 0) as number;
    // Throwing aborts the transaction, so the counter is not bumped either.
    if (count >= DAILY_SUBMISSION_CAP) throw new SubmissionError("daily_limit");
    tx.set(capRef, { count: count + 1 }, { merge: true });
    tx.set(activityRef, {
      memberId: actor.memberId,
      entries,
      date: input.date,
      description: input.description,
      witnesses: input.witnesses,
      ...(input.proofPath ? { proofPath: input.proofPath } : {}),
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  // The denormalized entries ride back so transports can describe the ticket
  // (officer-channel notifications) without re-reading what they just wrote.
  return { activityId: activityRef.id, entries };
}

/**
 * Deny a pending activity: single status flip + audit log. Never touches
 * stats. Throws EngineError("activity_not_found" | "not_pending") — the same
 * family approval throws, so review transports handle one error shape.
 */
export async function denyActivityCore(
  orgId: string,
  activityId: string,
  reviewerUid: string,
  reviewNote?: string,
): Promise<void> {
  const ref = orgRef(orgId).collection("activities").doc(activityId);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new EngineError("activity_not_found");
    if (snap.data()?.status !== "pending") throw new EngineError("not_pending");
    tx.update(ref, {
      status: "denied",
      reviewedBy: reviewerUid,
      reviewedAt: FieldValue.serverTimestamp(),
      ...(reviewNote ? { reviewNote } : {}),
    });
    tx.set(orgRef(orgId).collection("auditLogs").doc(), {
      actorUid: reviewerUid,
      action: "activity.deny",
      targetPath: ref.path,
      ...(reviewNote ? { detail: reviewNote } : {}),
      at: FieldValue.serverTimestamp(),
    });
  });
}

// Approval already lives in the engine in exactly this transport-neutral
// shape; re-export it so this module is the one door onto ticket operations.
export { approveActivityTx, EngineError, type EngineResult } from "@/lib/patch-engine";
