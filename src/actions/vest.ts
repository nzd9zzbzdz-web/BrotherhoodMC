"use server";

import { revalidatePath } from "next/cache";
import { FieldValue, orgRef } from "@/lib/firebase/admin";
import { requireOrgRole } from "@/lib/auth/session";
import { saveVestConfigSchema, type SaveVestConfigInput } from "@/lib/schemas/vest";
import type { ActionResult } from "./activities";

/**
 * Admin: replace the slot map for one vest surface. Coordinates are clamped to
 * [0,1] and slot names are validated, so a forged payload can never escape the
 * vest or write cross-tenant. No code changes needed to lay out a new vest.
 */
export async function saveVestConfig(raw: SaveVestConfigInput): Promise<ActionResult> {
  const parsed = saveVestConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid layout" };
  }
  const { orgId, surface, slots } = parsed.data;

  // Reject duplicate slot names within a surface.
  const names = new Set<string>();
  for (const s of slots) {
    if (names.has(s.slot)) return { ok: false, error: `Duplicate slot: ${s.slot}` };
    names.add(s.slot);
  }

  try {
    const access = await requireOrgRole(orgId, "admin");
    await orgRef(orgId)
      .collection("vestConfigs")
      .doc(surface)
      .set({ surface, slots }, { merge: true });

    await orgRef(orgId).collection("auditLogs").add({
      actorUid: access.user.uid,
      action: "vest.saveSlots",
      targetPath: `organizations/${orgId}/vestConfigs/${surface}`,
      detail: `${surface}: ${slots.length} slots`,
      at: FieldValue.serverTimestamp(),
    });

    revalidatePath(`/[orgSlug]/portal/admin/vest`, "page");
    revalidatePath(`/[orgSlug]/portal/my-cut`, "page");
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && e.name === "AuthError") {
      return { ok: false, error: e.message === "unauthenticated" ? "Sign in required" : "Not permitted" };
    }
    console.error(e);
    return { ok: false, error: "Something went wrong" };
  }
}
