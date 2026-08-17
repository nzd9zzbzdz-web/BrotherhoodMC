"use server";

import { revalidatePath } from "next/cache";
import { revalidateOrgTags } from "@/lib/cache";
import sharp from "sharp";
import { FieldValue, adminDb, orgRef } from "@/lib/firebase/admin";
import { requireOrgRole } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import {
  GALLERY_CAPTION_MAX,
  deleteGalleryPhotoSchema,
  reviewGalleryPhotoSchema,
  setGalleryVisibilitySchema,
  updateGalleryCaptionSchema,
} from "@/lib/schemas/gallery";
import type { ActionResult } from "./activities";
import type { GalleryPhoto } from "@/lib/types";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // raw upload cap (phone photos are big)
const MAX_STORED_BYTES = 700 * 1024; // base64 inflates 4/3 — keeps the doc under 1MB
const DAILY_UPLOAD_CAP = 30;

/**
 * Encode ladder: widest/best first, stepping down until the webp fits a
 * Firestore document. 1600px is a generous full-bleed gallery image; by the
 * bottom rung we'd rather ship a softer photo than refuse the upload.
 */
const ENCODE_STEPS = [
  [1600, 82],
  [1400, 76],
  [1100, 70],
  [900, 62],
] as const;

/**
 * Any member uploads a photo to the club gallery.
 *
 * A member's shot lands PENDING: visible to them on the wall right away (the
 * portal is behind the login), invisible to the rest of the club until an
 * officer clears it. Officers and admins skip their own queue — they're the
 * ones who'd be reviewing it — and may publish to the public site in the same
 * action rather than approving their own upload in a second round trip.
 *
 * Nothing else auto-publishes. Approval puts a photo on the CLUB's wall;
 * reaching the foundation shopfront is always a separate deliberate call
 * (`setGalleryVisibility`), because the two audiences are not the same one.
 */
export async function uploadGalleryPhoto(
  formData: FormData,
): Promise<ActionResult<{ photoId: string; pending: boolean; published: boolean }>> {
  const orgId = formData.get("orgId");
  const file = formData.get("file");
  const rawCaption = formData.get("caption");

  if (typeof orgId !== "string" || !(file instanceof File)) {
    return { ok: false, error: "Invalid upload" };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "File must be an image" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Photo too large (max 10MB)" };
  }
  const caption =
    typeof rawCaption === "string" ? rawCaption.trim().slice(0, GALLERY_CAPTION_MAX) : "";

  try {
    const access = await requireOrgRole(orgId, "member");
    if (!access.memberId) {
      return { ok: false, error: "This account isn't linked to a member record" };
    }
    const canReview =
      access.isSuper || access.role === "admin" || access.role === "officer";
    // Only a reviewer can ask for the shopfront, and only by ticking the box —
    // an officer posting a club photo shouldn't put it on the charity site by
    // accident just because they had the power to.
    const publish = canReview && formData.get("publish") === "1";

    const input = Buffer.from(await file.arrayBuffer());

    // `.rotate()` with no argument applies the EXIF orientation — without it,
    // every photo shot in portrait on a phone lands on its side.
    let stored: Buffer | null = null;
    let width = 0;
    let height = 0;
    for (const [w, quality] of ENCODE_STEPS) {
      const { data, info } = await sharp(input)
        .rotate()
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality })
        .toBuffer({ resolveWithObject: true });
      if (data.length <= MAX_STORED_BYTES) {
        stored = data;
        width = info.width;
        height = info.height;
        break;
      }
    }
    if (!stored) {
      return { ok: false, error: "Photo too complex to store. Try a smaller crop" };
    }

    // Blur placeholder computed once, here, and kept on the metadata doc — the
    // disk gallery re-derives this with sharp on every cold start.
    const blur = await sharp(stored)
      .resize(24, null, { fit: "inside" })
      .webp({ quality: 30 })
      .toBuffer();

    // Rate cap and the photo write share ONE transaction: the slot is spent
    // only if a photo is actually created. Same shape as submitActivity.
    const day = new Date().toISOString().slice(0, 10);
    const capRef = adminDb.doc(
      `organizations/${orgId}/rateLimits/${access.user.uid}_gallery_${day}`,
    );
    const photoRef = orgRef(orgId).collection("gallery").doc();
    const artRef = orgRef(orgId).collection("galleryArt").doc(photoRef.id);

    const created = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(capRef);
      const count = (snap.data()?.count ?? 0) as number;
      if (count >= DAILY_UPLOAD_CAP) return false;
      tx.set(capRef, { count: count + 1 }, { merge: true });
      tx.set(photoRef, {
        uploadedByMemberId: access.memberId,
        // Firestore rejects an explicit undefined, so an absent caption has to
        // be an absent KEY — the wall falls back to the uploader's name.
        ...(caption ? { caption } : {}),
        status: canReview ? "approved" : "pending",
        visibility: publish ? "public" : "portal",
        width,
        height,
        blurDataURL: `data:image/webp;base64,${blur.toString("base64")}`,
        bytes: stored.length,
        ...(canReview
          ? { reviewedBy: access.user.uid, reviewedAt: FieldValue.serverTimestamp() }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });
      // Metadata and bytes commit together — a photo doc whose image never
      // landed would render as a permanent broken frame on the wall.
      tx.set(artRef, {
        dataUrl: `data:image/webp;base64,${stored.toString("base64")}`,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!created) return { ok: false, error: "Daily upload limit reached" };

    await writeAuditLog(orgId, {
      actorUid: access.user.uid,
      action: canReview ? "gallery.upload" : "gallery.upload.pending",
      targetPath: photoRef.path,
      detail: `${width}×${height}, ${Math.round(stored.length / 1024)}KB${
        publish ? ", published" : ""
      }`,
    });

    revalidateGallerySurfaces(orgId, publish);
    return {
      ok: true,
      data: { photoId: photoRef.id, pending: !canReview, published: publish },
    };
  } catch (e) {
    return failure(e);
  }
}

/**
 * Officer: clear a pending photo for the club wall, or reject it.
 *
 * Approval stops at the club. Putting the photo on the public site is a
 * separate call, so an officer waving through a warehouse job can't
 * accidentally hand it to the foundation's visitors.
 *
 * Reject DELETES, for the same reason a rejected character render does: a photo
 * the club won't show, left sitting on its uploader's wall forever, isn't a
 * decision. They can post a different one.
 */
export async function reviewGalleryPhoto(raw: {
  orgId: string;
  photoId: string;
  approve: boolean;
}): Promise<ActionResult> {
  const parsed = reviewGalleryPhotoSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, photoId, approve } = parsed.data;

  try {
    const access = await requireOrgRole(orgId, "officer");
    const photoRef = orgRef(orgId).collection("gallery").doc(photoId);
    const snap = await photoRef.get();
    if (!snap.exists) return { ok: false, error: "Photo not found" };

    if (approve) {
      await photoRef.update({
        status: "approved",
        reviewedBy: access.user.uid,
        reviewedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await deletePhotoDocs(orgId, photoId);
    }

    await writeAuditLog(orgId, {
      actorUid: access.user.uid,
      action: approve ? "gallery.approve" : "gallery.reject",
      targetPath: photoRef.path,
    });

    // A pending photo was never public, and rejection deletes one that wasn't
    // either — neither can change the shopfront, so its cache stands.
    revalidateGallerySurfaces(orgId, false);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/**
 * Officer: put an approved photo on the public site, or pull it back.
 *
 * The one action that crosses from the club to the shopfront, which is why it
 * is its own call with its own audit line rather than a flag on approval.
 */
export async function setGalleryVisibility(raw: {
  orgId: string;
  photoId: string;
  visibility: "portal" | "public";
}): Promise<ActionResult> {
  const parsed = setGalleryVisibilitySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, photoId, visibility } = parsed.data;

  try {
    const access = await requireOrgRole(orgId, "officer");
    const photoRef = orgRef(orgId).collection("gallery").doc(photoId);
    const snap = await photoRef.get();
    if (!snap.exists) return { ok: false, error: "Photo not found" };
    // Publishing something the club hasn't cleared would skip the queue by the
    // back door — the public site is downstream of approval, not parallel to it.
    if (visibility === "public" && snap.get("status") !== "approved") {
      return { ok: false, error: "Approve the photo for the club first" };
    }

    await photoRef.update({ visibility });
    await writeAuditLog(orgId, {
      actorUid: access.user.uid,
      action: visibility === "public" ? "gallery.publish" : "gallery.unpublish",
      targetPath: photoRef.path,
    });

    revalidateGallerySurfaces(orgId, true);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Retitle a photo — the uploader's own, or any of them as an officer. */
export async function updateGalleryCaption(raw: {
  orgId: string;
  photoId: string;
  caption: string;
}): Promise<ActionResult> {
  const parsed = updateGalleryCaptionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, photoId, caption } = parsed.data;

  try {
    const { access, photo, photoRef } = await requireUploaderOrOfficer(orgId, photoId);
    await photoRef.update({
      // Clearing a caption has to remove the field, not write "" — the wall
      // falls back to the uploader's name when there's no title.
      caption: caption ? caption : FieldValue.delete(),
    });
    await writeAuditLog(orgId, {
      actorUid: access.user.uid,
      action: "gallery.caption",
      targetPath: photoRef.path,
      detail: caption || "(cleared)",
    });

    revalidateGallerySurfaces(orgId, photo.visibility === "public");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Take a photo down — the uploader's own, or any of them as an officer. */
export async function deleteGalleryPhoto(raw: {
  orgId: string;
  photoId: string;
}): Promise<ActionResult> {
  const parsed = deleteGalleryPhotoSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, photoId } = parsed.data;

  try {
    const { access, photo, isSelf } = await requireUploaderOrOfficer(orgId, photoId);
    await deletePhotoDocs(orgId, photoId);
    await writeAuditLog(orgId, {
      actorUid: access.user.uid,
      action: `gallery.delete${isSelf ? ".self" : ""}`,
      targetPath: `organizations/${orgId}/gallery/${photoId}`,
    });

    revalidateGallerySurfaces(orgId, photo.visibility === "public");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/**
 * The uploader editing their own photo, or an officer editing anyone's.
 *
 * Ownership is tested against the caller's CLAIM and the photo's stored
 * uploader — never against anything the client posted. A member who swaps the
 * photoId for someone else's simply falls through to the officer check.
 */
async function requireUploaderOrOfficer(orgId: string, photoId: string) {
  const access = await requireOrgRole(orgId, "member");
  const photoRef = orgRef(orgId).collection("gallery").doc(photoId);
  const snap = await photoRef.get();
  if (!snap.exists) throw new Error("Photo not found");
  const photo = { id: snap.id, ...(snap.data() as Omit<GalleryPhoto, "id">) };

  const isSelf = Boolean(
    access.memberId && access.memberId === photo.uploadedByMemberId,
  );
  if (isSelf) return { access, photo, photoRef, isSelf: true };
  return {
    access: await requireOrgRole(orgId, "officer"),
    photo,
    photoRef,
    isSelf: false,
  };
}

/** Metadata and bytes go together — an orphan blob is invisible and unpurgeable. */
async function deletePhotoDocs(orgId: string, photoId: string) {
  const batch = adminDb.batch();
  batch.delete(orgRef(orgId).collection("gallery").doc(photoId));
  batch.delete(orgRef(orgId).collection("galleryArt").doc(photoId));
  await batch.commit();
}

/**
 * Every page a gallery photo appears on. The club wall always changes; the
 * public pages only when the change can actually reach them — revalidating the
 * shopfront over a pending upload would throw away a good cache entry for a
 * photo no visitor can see.
 */
function revalidateGallerySurfaces(orgId: string, touchesPublic: boolean) {
  revalidateOrgTags(orgId, "gallery");
  revalidatePath(`/[orgSlug]/portal/gallery`, "page");
  if (touchesPublic) {
    revalidatePath(`/[orgSlug]/gallery`, "page");
    revalidatePath(`/[orgSlug]`, "page"); // hero filmstrip
  }
}

function failure(e: unknown): { ok: false; error: string } {
  console.error(e);
  return {
    ok: false,
    error: e instanceof Error ? e.message : "Something went wrong",
  };
}
