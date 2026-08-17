"use server";

import { revalidatePath } from "next/cache";
import { revalidateOrgTags } from "@/lib/cache";
import { requireOrgRole } from "@/lib/auth/session";
import {
  SubmissionError,
  approveActivityTx,
  denyActivityCore,
  submitActivityCore,
  EngineError,
  type EngineResult,
} from "@/lib/activities-core";
import { describeActivity } from "@/lib/activity-entries";
import { notifyTicketSubmitted } from "@/lib/discord/notify";
import { getMember, listActivityTypes } from "@/lib/queries";
import {
  reviewActivitySchema,
  submitActivitySchema,
  type ReviewActivityInput,
  type SubmitActivityInput,
} from "@/lib/schemas/activity";

// The web transport for tickets: zod parse → requireOrgRole → core → cache
// revalidation. All Firestore work lives in src/lib/activities-core.ts so a
// future non-web caller reuses it without a session cookie.

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Member submits an activity for officer review. */
export async function submitActivity(
  raw: SubmitActivityInput,
): Promise<ActionResult<{ activityId: string }>> {
  const parsed = submitActivitySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const input = parsed.data;

  try {
    const access = await requireOrgRole(input.orgId, "member");
    if (!access.memberId) return { ok: false, error: "No member record" };

    // The actor comes from the caller's OWN claims, never the payload.
    const { activityId, entries } = await submitActivityCore(
      { uid: access.user.uid, memberId: access.memberId },
      input,
    );

    // Officer-channel heads-up (no-op unless the Discord bot is configured);
    // notify never throws, so it cannot fail the submission it rides behind.
    const [member, types] = await Promise.all([
      getMember(input.orgId, access.memberId),
      listActivityTypes(input.orgId),
    ]);
    const typeById = new Map(types.map((t) => [t.id, t.name]));
    await notifyTicketSubmitted(input.orgId, {
      activityId,
      orgId: input.orgId,
      memberLabel: member
        ? `"${member.roadName}" ${member.displayName}`
        : "A member",
      summary: describeActivity({ entries }, (id) => typeById.get(id)),
      description: input.description,
    });

    revalidatePath(`/[orgSlug]/portal/activities`, "page");
    return { ok: true, data: { activityId } };
  } catch (e) {
    return failure(e);
  }
}

/** Officer approves or denies a pending activity. Approval runs the patch engine. */
export async function reviewActivity(
  raw: ReviewActivityInput,
): Promise<ActionResult<EngineResult | undefined>> {
  const parsed = reviewActivitySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, activityId, decision, reviewNote } = parsed.data;

  try {
    const access = await requireOrgRole(orgId, "officer");

    if (decision === "approved") {
      const result = await approveActivityTx(orgId, activityId, access.user.uid, reviewNote);
      // The engine moves member stats and may award patches — both are cached
      // reads behind the roster, wall, profile and dashboard.
      revalidateOrgTags(orgId, "members", "awards");
      revalidatePath(`/[orgSlug]/portal/activities/review`, "page");
      return { ok: true, data: result };
    }

    await denyActivityCore(orgId, activityId, access.user.uid, reviewNote);

    revalidatePath(`/[orgSlug]/portal/activities/review`, "page");
    return { ok: true, data: undefined };
  } catch (e) {
    return failure(e);
  }
}

function failure(e: unknown): { ok: false; error: string } {
  if (e instanceof SubmissionError) {
    switch (e.code) {
      case "unknown_type":
        return { ok: false, error: "Unknown activity type" };
      case "type_disabled":
        return { ok: false, error: `${e.detail ?? "This activity type"} is disabled` };
      case "daily_limit":
        return { ok: false, error: "Daily submission limit reached" };
    }
  }
  if (e instanceof EngineError) {
    const messages: Record<string, string> = {
      activity_not_found: "Activity not found",
      not_pending: "This activity was already reviewed",
      member_not_found: "Member record not found",
    };
    return { ok: false, error: messages[e.code] ?? e.code };
  }
  if (e instanceof Error && e.name === "AuthError") {
    return { ok: false, error: e.message === "unauthenticated" ? "Sign in required" : "Not permitted" };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong" };
}
