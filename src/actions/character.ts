"use server";

import { revalidatePath } from "next/cache";
import { revalidateOrgTags } from "@/lib/cache";
import sharp from "sharp";
import { FieldValue, orgRef } from "@/lib/firebase/admin";
import { requireOrgRole, requireSelfOrRole } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import {
  keyOutLightBackground,
  needsBackgroundKeying,
} from "@/lib/character-key";
import {
  clampEmblemPlacements,
  clampPose,
  saveCharacterEmblemsSchema,
  saveCharacterPoseSchema,
} from "@/lib/schemas/character";
import type { ActionResult } from "./activities";
import type { CharacterPose, StageEmblemPlacement } from "@/lib/types";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // raw upload cap
const MAX_STORED_BYTES = 700 * 1024; // keep the Firestore doc well under 1MB

/**
 * Set a member's character render from an uploaded image — their own, or
 * anyone's if you're an admin.
 *
 * A render is the one member-supplied IMAGE that reaches the public site, so
 * self-uploads land unapproved: the member sees it on their profile at once
 * (the portal is behind the login), while the public roster keeps the
 * silhouette until an officer approves it. Officers and admins clear their own
 * uploads on the way in — they're the ones who'd be reviewing it anyway.
 *
 * Light/checkerboard backgrounds are keyed out automatically; the result is
 * stored as a webp data URL in members/{id}/assets/character (small, read
 * only by the profile page — no Storage bucket required).
 */
export async function uploadCharacterRender(
  formData: FormData,
): Promise<ActionResult<{ pending: boolean }>> {
  const orgId = formData.get("orgId");
  const memberId = formData.get("memberId");
  const file = formData.get("file");

  if (typeof orgId !== "string" || typeof memberId !== "string" || !(file instanceof File)) {
    return { ok: false, error: "Invalid upload" };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "File must be an image" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Image too large (max 8MB)" };
  }

  try {
    const { access } = await requireSelfOrRole(orgId, memberId, "admin");
    // Anyone who could review this anyway is trusted on the way in; a plain
    // member's upload waits. isSuper is folded in — they outrank officers.
    const selfApproves =
      access.isSuper || access.role === "admin" || access.role === "officer";
    const memberRef = orgRef(orgId).collection("members").doc(memberId);
    if (!(await memberRef.get()).exists) {
      return { ok: false, error: "Member not found" };
    }

    const input = Buffer.from(await file.arrayBuffer());

    // Normalize orientation, cap size, then key the background if needed.
    const { data, info } = await sharp(input)
      .rotate()
      .ensureAlpha()
      .resize({ height: 1200, withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

    if (needsBackgroundKeying(pixels, info.width, info.height)) {
      keyOutLightBackground(pixels, info.width, info.height);
    }

    // Encode small enough for a Firestore doc; step down until it fits.
    let stored: Buffer | null = null;
    for (const [h, q] of [
      [info.height, 82],
      [900, 70],
      [700, 60],
    ] as const) {
      const candidate = await sharp(data, {
        raw: { width: info.width, height: info.height, channels: 4 },
      })
        .resize({ height: h, withoutEnlargement: true })
        .webp({ quality: q })
        .toBuffer();
      if (candidate.length <= MAX_STORED_BYTES) {
        stored = candidate;
        break;
      }
    }
    if (!stored) {
      return { ok: false, error: "Image too complex to store. Try a smaller crop" };
    }

    await memberRef.collection("assets").doc("character").set({
      dataUrl: `data:image/webp;base64,${stored.toString("base64")}`,
      approved: selfApproves,
      updatedBy: access.user.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await writeAuditLog(orgId, {
      actorUid: access.user.uid,
      action: selfApproves ? "member.characterArt" : "member.characterArt.pending",
      targetPath: memberRef.path,
      detail: `${Math.round(stored.length / 1024)}KB render uploaded`,
    });

    revalidateRenderSurfaces(orgId, selfApproves);
    return { ok: true, data: { pending: !selfApproves } };
  } catch (e) {
    return failure(e);
  }
}

/**
 * Officer/admin: approve a pending render, or reject it.
 *
 * Reject DELETES the art rather than flagging it. A rejected render is one an
 * officer doesn't want the club wearing, and leaving it on the member's own
 * profile forever — visible to everyone who opens their page — isn't a
 * decision, it's a half-measure. The member can upload a different one.
 */
export async function reviewCharacterRender(raw: {
  orgId: string;
  memberId: string;
  approve: boolean;
}): Promise<ActionResult> {
  try {
    const access = await requireOrgRole(raw.orgId, "officer");
    const assetRef = orgRef(raw.orgId)
      .collection("members")
      .doc(raw.memberId)
      .collection("assets")
      .doc("character");
    if (!(await assetRef.get()).exists) {
      return { ok: false, error: "No render to review" };
    }

    if (raw.approve) {
      await assetRef.update({ approved: true });
    } else {
      await assetRef.delete();
    }

    await writeAuditLog(raw.orgId, {
      actorUid: access.user.uid,
      action: raw.approve ? "member.characterArt.approve" : "member.characterArt.reject",
      targetPath: assetRef.path,
    });

    // Either way the PUBLIC roster changes: approve puts a face on the card,
    // reject takes one off a member's profile.
    revalidateRenderSurfaces(raw.orgId, true);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Remove a render — your own, or anyone's as an admin. */
export async function removeCharacterRender(raw: {
  orgId: string;
  memberId: string;
}): Promise<ActionResult> {
  try {
    const { access, isSelf } = await requireSelfOrRole(raw.orgId, raw.memberId, "admin");
    const assetRef = orgRef(raw.orgId)
      .collection("members")
      .doc(raw.memberId)
      .collection("assets")
      .doc("character");
    await assetRef.delete();
    await writeAuditLog(raw.orgId, {
      actorUid: access.user.uid,
      action: `member.characterArt.remove${isSelf ? ".self" : ""}`,
      targetPath: assetRef.path,
    });
    revalidateRenderSurfaces(raw.orgId, true);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/**
 * Every page a render appears on. The portal three always change; the public
 * home page only when the change can reach it (an unapproved upload cannot,
 * and revalidating it would throw away a good cache entry for nothing).
 */
function revalidateRenderSurfaces(orgId: string, touchesPublic: boolean) {
  // Renders live in members/*/assets, behind the members tag.
  revalidateOrgTags(orgId, "members");
  revalidatePath(`/[orgSlug]/portal/brotherhood/[memberId]`, "page");
  revalidatePath(`/[orgSlug]/portal/brotherhood`, "page");
  revalidatePath(`/[orgSlug]/portal/activities/review`, "page");
  if (touchesPublic) revalidatePath(`/[orgSlug]`, "page");
}

/**
 * Save where a member's render stands on their stage — the member themselves,
 * or an admin for anyone. Standing on your own mark is self-service: it's your
 * character, and a pose is trivially reversible.
 *
 * Pass `pose: null` to clear it and fall back to DEFAULT_CHARACTER_POSE. Values
 * are clamped server-side rather than rejected — a drag that overshoots should
 * land at the edge, not throw away the whole adjustment.
 */
export async function saveCharacterPose(raw: {
  orgId: string;
  memberId: string;
  pose: CharacterPose | null;
}): Promise<ActionResult> {
  const parsed = saveCharacterPoseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, memberId, pose } = parsed.data;

  try {
    const { access, isSelf } = await requireSelfOrRole(orgId, memberId, "admin");
    const memberRef = orgRef(orgId).collection("members").doc(memberId);
    if (!(await memberRef.get()).exists) {
      return { ok: false, error: "Member not found" };
    }

    await memberRef.update({
      characterPose: pose ? clampPose(pose) : FieldValue.delete(),
    });
    await writeAuditLog(orgId, {
      actorUid: access.user.uid,
      // Self-edits are tagged so the log still answers "who moved this" at a
      // glance now that it isn't always an admin.
      action: pose
        ? `member.characterPose${isSelf ? ".self" : ""}`
        : `member.characterPose.reset${isSelf ? ".self" : ""}`,
      targetPath: memberRef.path,
      // Omit the key entirely on reset — Firestore rejects an explicit
      // `undefined`, which would fail the write after the pose already changed.
      ...(pose
        ? {
            detail: `x=${pose.x.toFixed(1)} y=${pose.y.toFixed(1)} h=${pose.scale.toFixed(1)}`,
          }
        : {}),
    });

    revalidateOrgTags(orgId, "members");
    revalidatePath(`/[orgSlug]/portal/brotherhood/[memberId]`, "page");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/**
 * Save which awards a member shows on their character stage and where — the
 * member themselves, or an admin for anyone. Like the pose, this is
 * self-service: it's their screen, and an arrangement is trivially reversible.
 *
 * Pass `placements: null` to clear the arrangement and fall back to the
 * automatic rarest-four slots; an empty array means "show nothing". Coordinates
 * are clamped rather than rejected, but the patch ids are NOT taken on faith:
 * every placed id must have an award doc for this member, or the save is
 * refused. Without that check any member could pin patches they never earned.
 */
export async function saveCharacterEmblems(raw: {
  orgId: string;
  memberId: string;
  placements: StageEmblemPlacement[] | null;
}): Promise<ActionResult> {
  const parsed = saveCharacterEmblemsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, memberId, placements } = parsed.data;

  try {
    const { access, isSelf } = await requireSelfOrRole(orgId, memberId, "admin");
    const memberRef = orgRef(orgId).collection("members").doc(memberId);
    if (!(await memberRef.get()).exists) {
      return { ok: false, error: "Member not found" };
    }

    const cleaned = placements ? clampEmblemPlacements(placements) : null;
    if (cleaned && cleaned.length > 0) {
      // Award docs use the composite id `${memberId}_${patchId}`, so earned-ness
      // is a direct doc lookup per tile, no query needed.
      const awardSnaps = await Promise.all(
        cleaned.map((p) =>
          orgRef(orgId)
            .collection("awardedPatches")
            .doc(`${memberId}_${p.patchId}`)
            .get(),
        ),
      );
      if (awardSnaps.some((s) => !s.exists)) {
        return {
          ok: false,
          error: "Only awards this member has earned can go on the stage",
        };
      }
    }

    await memberRef.update({
      characterEmblems: cleaned ?? FieldValue.delete(),
    });
    await writeAuditLog(orgId, {
      actorUid: access.user.uid,
      action: cleaned
        ? `member.stageEmblems${isSelf ? ".self" : ""}`
        : `member.stageEmblems.reset${isSelf ? ".self" : ""}`,
      targetPath: memberRef.path,
      // Omit the key entirely on reset — Firestore rejects an explicit
      // `undefined`, which would fail the write after the layout already changed.
      ...(cleaned ? { detail: `${cleaned.length} emblems placed` } : {}),
    });

    revalidateOrgTags(orgId, "members");
    revalidatePath(`/[orgSlug]/portal/brotherhood/[memberId]`, "page");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

function failure(e: unknown): { ok: false; error: string } {
  console.error(e);
  return {
    ok: false,
    error: e instanceof Error ? e.message : "Something went wrong",
  };
}
