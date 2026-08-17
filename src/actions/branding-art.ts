"use server";

import { revalidatePath } from "next/cache";
import { revalidateOrgTags } from "@/lib/cache";
import sharp from "sharp";
import { FieldValue, orgRef } from "@/lib/firebase/admin";
import { requireOrgRole } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { BRANDING_ART, surfacesFor, type BrandingArtKey } from "@/lib/branding-art";
import type { ActionResult } from "./activities";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // raw upload cap
/**
 * Scene art, not a badge: these fill a card or a whole character screen, so
 * they get far more room than a patch's 64KB. Still well under Firestore's 1MB
 * document ceiling with headroom for the base64 inflation (~4/3).
 */
const MAX_STORED_BYTES = 600 * 1024;

/**
 * Branding scene art — the clubhouse behind the public roster cards and the
 * character-screen stage.
 *
 * Stored as a webp data URL in `organizations/{orgId}/brandingArt/{key}` and
 * streamed by /api/orgs/{orgId}/branding/{key}, the same no-Storage-bucket
 * approach as patch art and character renders. A SIBLING collection rather than
 * a field on the branding doc, for the reason patch art is one: the branding
 * doc is read by every layout render on both surfaces, and a 500KB data URL
 * riding along on all of them would be absurd.
 *
 * The upload also writes the served URL into the branding doc's path field, so
 * everything that already reads `rosterBackdropPath` / `characterStagePath`
 * picks it up with no further change. The `?v=` is the upload time, which makes
 * the response immutable and lands a re-upload at a fresh URL.
 */

function artRef(orgId: string, key: BrandingArtKey) {
  return orgRef(orgId).collection("brandingArt").doc(key);
}

function revalidateFor(orgId: string, key: BrandingArtKey) {
  // Where each slot is drawn is the table's business, not this action's — an
  // if/else here is what goes stale the day a third slot lands.
  revalidateOrgTags(orgId, "branding");
  revalidatePath(`/[orgSlug]/portal/admin/branding`, "page");
  for (const { path, type } of BRANDING_ART[key].revalidates) {
    revalidatePath(path, type);
  }
}

/** What the browser file picker offers, and what sharp is asked to decode. */
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"];

export async function uploadBrandingArt(formData: FormData): Promise<ActionResult> {
  const orgId = formData.get("orgId");
  const key = formData.get("key");
  const file = formData.get("file");

  if (typeof orgId !== "string" || typeof key !== "string" || !(file instanceof File)) {
    return { ok: false, error: "Invalid upload" };
  }
  const spec = BRANDING_ART[key as BrandingArtKey];
  if (!spec) return { ok: false, error: "Unknown image" };
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { ok: false, error: "Use a PNG, JPG, WEBP or AVIF image" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Image too large (max 12MB)" };
  }

  try {
    const access = await requireOrgRole(orgId, "admin");

    const input = Buffer.from(await file.arrayBuffer());

    // Refuse anything too small instead of upscaling it. `cover` art is stored
    // at exactly the slot shape (no `withoutEnlargement` — that silently
    // yields a wrong-aspect file when the source is shorter than the slot), so
    // a small upload would come back as a blurry stretch across the club's
    // public page. `contain` art is padded rather than stretched, so it only
    // needs to be big enough to stay sharp: half the frame is the floor.
    const minScale = spec.fit === "cover" ? 1 : 0.5;
    const minW = Math.round(spec.width * minScale);
    const minH = Math.round(spec.height * minScale);
    const meta = await sharp(input).rotate().metadata();
    if ((meta.width ?? 0) < minW || (meta.height ?? 0) < minH) {
      return {
        ok: false,
        error: `Image is too small. It needs to be at least ${minW}×${minH}px`,
      };
    }

    // `cover` crops to fill: right for backdrops, where letterboxing a scene
    // into bars looks broken. `contain` fits the whole image inside the frame
    // on a FULLY TRANSPARENT ground — patches, wordmarks and emblems are
    // cut-out artwork, and cropping one costs it an edge while flattening one
    // onto black costs it the cut-out.
    const base = sharp(input)
      .rotate()
      .resize(spec.width, spec.height, {
        fit: spec.fit,
        position: spec.position,
        ...(spec.fit === "contain"
          ? { background: { r: 0, g: 0, b: 0, alpha: 0 } }
          : {}),
      });

    let stored: Buffer | null = null;
    for (const quality of [82, 72, 62, 50]) {
      // `alphaQuality`/lossless are not needed — webp keeps the alpha channel
      // at any quality, and these are photographs and painted art, not icons.
      const candidate = await base.clone().webp({ quality }).toBuffer();
      if (candidate.length <= MAX_STORED_BYTES) {
        stored = candidate;
        break;
      }
    }
    if (!stored) {
      return { ok: false, error: "Image too complex to store. Try a smaller one" };
    }

    const updatedAtMs = Date.now();
    await artRef(orgId, key as BrandingArtKey).set({
      dataUrl: `data:image/webp;base64,${stored.toString("base64")}`,
      updatedBy: access.user.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Point the branding doc(s) at the served URL, so resolving a club's whole
    // imagery still costs the ONE document read every layout already makes.
    // Merge-only: this must never disturb the colors and fonts in the same
    // document. A "both" slot writes to public AND portal — the club patch
    // differing across the login would look like two clubs.
    const url = `/api/orgs/${orgId}/branding/${key}?v=${updatedAtMs}`;
    await Promise.all(
      surfacesFor(spec).map((surface) =>
        orgRef(orgId)
          .collection("branding")
          .doc(surface)
          .set(
            {
              // A NESTED map, not a dotted key: `set(..., {merge:true})` reads
              // dots as literal characters in a field name (only `update()`
              // treats them as paths), and merge already deep-merges maps, so
              // this lands on `assets.{key}` without touching its siblings.
              assets: { [key]: url },
              // The pre-catalog spelling, still written so any reader not yet
              // moved onto resolveBranding keeps seeing the upload.
              ...(spec.legacyField ? { [spec.legacyField]: url } : {}),
            },
            { merge: true },
          ),
      ),
    );

    await writeAuditLog(orgId, {
      actorUid: access.user.uid,
      action: "branding.art",
      targetPath: artRef(orgId, key as BrandingArtKey).path,
      detail: `${spec.label}: ${Math.round(stored.length / 1024)}KB`,
    });

    revalidateFor(orgId, key as BrandingArtKey);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Org-admin: drop the uploaded art and fall back to the shipped default. */
export async function resetBrandingArt(raw: {
  orgId: string;
  key: BrandingArtKey;
}): Promise<ActionResult> {
  const spec = BRANDING_ART[raw.key];
  if (!spec) return { ok: false, error: "Unknown image" };

  try {
    const access = await requireOrgRole(raw.orgId, "admin");
    await artRef(raw.orgId, raw.key).delete();
    // Clearing the FIELD is what restores the default — `resolveBranding`
    // falls back on absence, so the key has to go away, not go empty.
    await Promise.all(
      surfacesFor(spec).map((surface) =>
        orgRef(raw.orgId)
          .collection("branding")
          .doc(surface)
          .set(
            {
              assets: { [raw.key]: FieldValue.delete() },
              ...(spec.legacyField ? { [spec.legacyField]: FieldValue.delete() } : {}),
            },
            { merge: true },
          ),
      ),
    );

    await writeAuditLog(raw.orgId, {
      actorUid: access.user.uid,
      action: "branding.art.reset",
      targetPath: artRef(raw.orgId, raw.key).path,
      detail: spec.label,
    });

    revalidateFor(raw.orgId, raw.key);
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
