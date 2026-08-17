"use server";

import { revalidatePath } from "next/cache";
import { revalidateOrgTags } from "@/lib/cache";
import { FieldValue, adminAuth, adminDb, orgRef } from "@/lib/firebase/admin";
import { requireOrgRole } from "@/lib/auth/session";
import { syncUserClaims } from "@/lib/auth/claims";
import {
  approveApplicationSchema,
  rejectApplicationSchema,
  submitApplicationSchema,
  type ApproveApplicationInput,
  type RejectApplicationInput,
  type SubmitApplicationInput,
} from "@/lib/schemas/application";
import type { ActionResult } from "./activities";

/** A user-facing error whose message is safe to surface directly. */
class AppError extends Error {}

/**
 * PUBLIC: a prospective recruit submits an application.
 *
 * Security: identity is taken ONLY from the caller's verified ID token — never
 * from client-posted uid/email. The application is keyed by uid (one per
 * account) and grants NO access on its own; membership is created only when an
 * officer approves. Anyone can reach this, but an unapproved account can't pass
 * the portal guard or any requireOrgRole gate.
 */
export async function submitApplication(
  raw: SubmitApplicationInput,
): Promise<ActionResult> {
  const parsed = submitApplicationSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, idToken, roadName, handle, message } = parsed.data;

  try {
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    const uid = decoded.uid;
    const email = decoded.email;
    if (!email) return { ok: false, error: "Your account has no email address" };

    const org = orgRef(orgId);
    const orgSnap = await org.get();
    if (!orgSnap.exists || orgSnap.data()?.status !== "active") {
      return { ok: false, error: "This club isn't accepting applications right now" };
    }

    // Already a member of this org? Nothing to apply for.
    const userSnap = await adminDb.collection("users").doc(uid).get();
    if (userSnap.data()?.memberships?.[orgId]) {
      return { ok: false, error: "You're already a member. Just sign in." };
    }

    const appRef = org.collection("applications").doc(uid);
    await adminDb.runTransaction(async (tx) => {
      const existing = await tx.get(appRef);
      const data = existing.data();
      // One live application per account. A rejected applicant may re-apply.
      if (data && data.status !== "rejected") {
        throw new AppError(
          data.status === "approved"
            ? "You're already a member. Just sign in."
            : "You've already applied. Hang tight for a decision.",
        );
      }
      tx.set(appRef, {
        roadName,
        handle,
        email,
        ...(message ? { message } : {}),
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    return failure(e);
  }
}

/**
 * Officer+: approve an application → create the member record, grant the
 * membership, sync claims (revoking tokens so the new access goes live).
 * Elevated roles (officer/admin) require an admin approver.
 */
export async function approveApplication(
  raw: ApproveApplicationInput,
): Promise<ActionResult> {
  const parsed = approveApplicationSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, applicationId, role } = parsed.data;
  const uid = applicationId; // applications are keyed by applicant uid

  try {
    const access = await requireOrgRole(orgId, "officer");
    if (role !== "member" && access.role !== "admin" && !access.isSuper) {
      return { ok: false, error: "Only an admin can approve someone as officer or admin" };
    }

    const org = orgRef(orgId);
    const appRef = org.collection("applications").doc(applicationId);

    // Most-junior rank is the default landing spot for a new recruit.
    const ranksSnap = await org.collection("ranks").orderBy("order", "desc").limit(1).get();
    const defaultRankId = ranksSnap.docs[0]?.id;
    if (!defaultRankId) return { ok: false, error: "No ranks configured for this club" };

    await adminDb.runTransaction(async (tx) => {
      // ── reads ──
      const appSnap = await tx.get(appRef);
      const app = appSnap.data();
      if (!app) throw new AppError("Application not found");
      if (app.status !== "pending") throw new AppError("This application was already handled");

      const userRef = adminDb.collection("users").doc(uid);
      const userSnap = await tx.get(userRef);
      const existingMembership = userSnap.data()?.memberships?.[orgId] as
        | { memberId: string; role: string }
        | undefined;

      const orgDataSnap = await tx.get(org);
      const orgData = orgDataSnap.data() ?? {};

      // ── writes ──
      let memberId = existingMembership?.memberId;
      if (!existingMembership) {
        const lastMemberNumber = (orgData.lastMemberNumber ?? orgData.memberCount ?? 0) as number;
        const nextNumber = lastMemberNumber + 1;
        const memberRef = org.collection("members").doc();
        memberId = memberRef.id;
        tx.set(memberRef, {
          uid,
          displayName: app.handle,
          roadName: app.roadName,
          rankId: defaultRankId,
          status: "hangaround",
          joinDate: FieldValue.serverTimestamp(),
          memberNumber: nextNumber,
          stats: {},
          patchCount: 0,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.update(org, {
          memberCount: FieldValue.increment(1),
          lastMemberNumber: nextNumber,
        });
        tx.set(
          userRef,
          {
            email: app.email,
            displayName: app.handle,
            memberships: { [orgId]: { memberId, role } },
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      tx.update(appRef, {
        status: "approved",
        memberId,
        role,
        reviewedBy: access.user.uid,
        reviewedAt: FieldValue.serverTimestamp(),
      });
      tx.set(org.collection("auditLogs").doc(), {
        actorUid: access.user.uid,
        action: "application.approve",
        targetPath: appRef.path,
        detail: `${app.roadName} (${app.email}) as ${role}`,
        at: FieldValue.serverTimestamp(),
      });
    });

    // Rebuild claims + revoke stale tokens so the new membership is immediately live.
    await syncUserClaims(uid);

    // Approval creates the member record and grants the portal role.
    revalidateOrgTags(orgId, "members", "roles", "org");
    revalidatePath(`/[orgSlug]/portal/recruitment`, "page");
    revalidatePath(`/[orgSlug]/portal/brotherhood`, "page");
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    return failure(e);
  }
}

/** Officer+: decline an application. The account remains but gets no access. */
export async function rejectApplication(
  raw: RejectApplicationInput,
): Promise<ActionResult> {
  const parsed = rejectApplicationSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, applicationId, reason } = parsed.data;

  try {
    const access = await requireOrgRole(orgId, "officer");
    const appRef = orgRef(orgId).collection("applications").doc(applicationId);

    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(appRef);
      const app = snap.data();
      if (!app) throw new AppError("Application not found");
      if (app.status !== "pending") throw new AppError("This application was already handled");
      tx.update(appRef, {
        status: "rejected",
        reviewedBy: access.user.uid,
        reviewedAt: FieldValue.serverTimestamp(),
        ...(reason ? { reviewNote: reason } : {}),
      });
      tx.set(orgRef(orgId).collection("auditLogs").doc(), {
        actorUid: access.user.uid,
        action: "application.reject",
        targetPath: appRef.path,
        ...(reason ? { detail: reason } : {}),
        at: FieldValue.serverTimestamp(),
      });
    });

    revalidatePath(`/[orgSlug]/portal/recruitment`, "page");
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    return failure(e);
  }
}

function failure(e: unknown): { ok: false; error: string } {
  if (e instanceof Error && e.name === "AuthError") {
    return { ok: false, error: e.message === "unauthenticated" ? "Sign in required" : "Not permitted" };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong" };
}
