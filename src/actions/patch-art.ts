"use server";

import { revalidatePath } from "next/cache";
import { revalidateOrgTags } from "@/lib/cache";
import sharp from "sharp";
import { FieldValue, orgRef } from "@/lib/firebase/admin";
import { requireOrgRole } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import type { ActionResult } from "./activities";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // raw upload cap
/**
 * A badge, not a photo. Patches draw at 36-48px on the ladder and the wall, so
 * 256² still has headroom for a 3x display and for the cut renderer later,
 * while keeping a sixty-patch page inside about a megabyte of images — fetched
 * in parallel by the browser and then cached forever against the version in
 * the URL. The old 512²/200KB was ~12MB of art for a club this size.
 */
const MAX_STORED_BYTES = 64 * 1024;
const ART_SIZE = 256;

/**
 * Patch and emblem artwork.
 *
 * Stored as a webp data URL in `organizations/{orgId}/patchArt/{patchId}` —
 * the same no-Storage-bucket approach as character renders, so it works on the
 * emulator and on Vercel without a bucket or CORS config.
 *
 * A SIBLING collection rather than a field on the patch doc: `listPatches` is
 * read by the profile, the patch wall, the cut and the admin table, and sixty
 * data URLs riding along on every one of those reads would be about a megabyte
 * of art nobody asked for. Pages that draw art pay one extra query; pages that
 * only need names and thresholds stay cheap.
 */

function artRef(orgId: string, patchId: string) {
  return orgRef(orgId).collection("patchArt").doc(patchId);
}

function revalidateArt(orgId: string) {
  revalidateOrgTags(orgId, "patchArt");
  revalidatePath(`/[orgSlug]/portal/admin/patches`, "page");
  revalidatePath(`/[orgSlug]/portal/patch-wall`, "page");
  revalidatePath(`/[orgSlug]/portal/brotherhood/[memberId]`, "page");
  revalidatePath(`/[orgSlug]/portal/my-cut`, "page");
}

/** Org-admin: set a patch's artwork from an uploaded image. */
export async function uploadPatchArt(formData: FormData): Promise<ActionResult> {
  const orgId = formData.get("orgId");
  const patchId = formData.get("patchId");
  const file = formData.get("file");

  if (typeof orgId !== "string" || typeof patchId !== "string" || !(file instanceof File)) {
    return { ok: false, error: "Invalid upload" };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "File must be an image" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Image too large (max 8MB)" };
  }

  try {
    const access = await requireOrgRole(orgId, "admin");
    const patchRef = orgRef(orgId).collection("patches").doc(patchId);
    if (!(await patchRef.get()).exists) {
      return { ok: false, error: "Patch not found" };
    }

    const input = Buffer.from(await file.arrayBuffer());

    // Fit inside a square without cropping and without a background — patch art
    // is usually a transparent PNG cut to the badge outline, and letterboxing it
    // onto white would put a box around every patch on the wall.
    const base = sharp(input)
      .rotate()
      .ensureAlpha()
      .resize(ART_SIZE, ART_SIZE, {
        fit: "contain",
        withoutEnlargement: true,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });

    let stored: Buffer | null = null;
    for (const quality of [88, 75, 60]) {
      const candidate = await base.clone().webp({ quality }).toBuffer();
      if (candidate.length <= MAX_STORED_BYTES) {
        stored = candidate;
        break;
      }
    }
    if (!stored) {
      return { ok: false, error: "Image too complex to store. Try a simpler graphic" };
    }

    await artRef(orgId, patchId).set({
      dataUrl: `data:image/webp;base64,${stored.toString("base64")}`,
      updatedBy: access.user.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await writeAuditLog(orgId, {
      actorUid: access.user.uid,
      action: "patch.art",
      targetPath: patchRef.path,
      detail: `${Math.round(stored.length / 1024)}KB artwork uploaded`,
    });

    revalidateArt(orgId);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Org-admin: drop a patch's artwork (falls back to the lettered badge). */
export async function removePatchArt(raw: {
  orgId: string;
  patchId: string;
}): Promise<ActionResult> {
  try {
    const access = await requireOrgRole(raw.orgId, "admin");
    await artRef(raw.orgId, raw.patchId).delete();
    await writeAuditLog(raw.orgId, {
      actorUid: access.user.uid,
      action: "patch.art.remove",
      targetPath: artRef(raw.orgId, raw.patchId).path,
    });
    revalidateArt(raw.orgId);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

function failure(e: unknown): { ok: false; error: string } {
  if (e instanceof Error && e.name === "AuthError") {
    return {
      ok: false,
      error: e.message === "unauthenticated" ? "Sign in required" : "Admins only",
    };
  }
  console.error(e);
  return {
    ok: false,
    error: e instanceof Error ? e.message : "Something went wrong",
  };
}
