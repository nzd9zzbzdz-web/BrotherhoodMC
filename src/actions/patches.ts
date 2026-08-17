"use server";

import { revalidatePath } from "next/cache";
import { revalidateOrgTags } from "@/lib/cache";
import { FieldValue, orgRef } from "@/lib/firebase/admin";
import { requireOrgRole } from "@/lib/auth/session";
import { manualAwardTx, EngineError } from "@/lib/patch-engine";
import {
  manualAwardSchema,
  patchSchema,
  type ManualAwardInput,
  type PatchInput,
} from "@/lib/schemas/patch";
import type { ActionResult } from "./activities";

/** Org-admin: create or update a patch definition. */
export async function upsertPatch(
  raw: PatchInput & { patchId?: string },
): Promise<ActionResult<{ patchId: string }>> {
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const input = parsed.data;

  try {
    const access = await requireOrgRole(input.orgId, "admin");
    const col = orgRef(input.orgId).collection("patches");
    const data = {
      name: input.name,
      category: input.category,
      description: input.description,
      tier: input.tier,
      requirement: input.requirement,
      manual: input.requirement === null,
      active: input.active,
      defaultPlacement: input.defaultPlacement,
    };
    let patchId = raw.patchId;
    if (patchId) {
      await col.doc(patchId).set(data, { merge: true });
    } else {
      patchId = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      await col.doc(patchId).create(data);
    }
    await orgRef(input.orgId).collection("auditLogs").add({
      actorUid: access.user.uid,
      action: raw.patchId ? "patch.update" : "patch.create",
      targetPath: col.doc(patchId).path,
      at: FieldValue.serverTimestamp(),
    });
    revalidateOrgTags(input.orgId, "patches");
    revalidatePath(`/[orgSlug]/portal/admin/patches`, "page");
    return { ok: true, data: { patchId } };
  } catch (e) {
    return failure(e);
  }
}

/** Officer+: manually award a patch (President's Citation, War Veteran, ...). */
export async function manualAward(
  raw: ManualAwardInput,
): Promise<ActionResult<{ awarded: boolean }>> {
  const parsed = manualAwardSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, memberId, patchId, reason } = parsed.data;

  try {
    const access = await requireOrgRole(orgId, "officer");
    const awarded = await manualAwardTx(orgId, memberId, patchId, access.user.uid, reason);
    // An award touches the wall, the admin table, the member's profile, and
    // (for worn patches) their cut.
    revalidateOrgTags(orgId, "awards");
    revalidatePath(`/[orgSlug]/portal/patch-wall`, "page");
    revalidatePath(`/[orgSlug]/portal/admin/patches`, "page");
    revalidatePath(`/[orgSlug]/portal/brotherhood/[memberId]`, "page");
    revalidatePath(`/[orgSlug]/portal/my-cut`, "page");
    return awarded
      ? { ok: true, data: { awarded: true } }
      : { ok: false, error: "Member already holds this patch" };
  } catch (e) {
    return failure(e);
  }
}

function failure(e: unknown): { ok: false; error: string } {
  if (e instanceof EngineError) {
    const messages: Record<string, string> = {
      patch_not_found: "Patch not found",
      member_not_found: "Member not found",
    };
    return { ok: false, error: messages[e.code] ?? e.code };
  }
  if (e instanceof Error && e.name === "AuthError") {
    return { ok: false, error: e.message === "unauthenticated" ? "Sign in required" : "Not permitted" };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong" };
}
