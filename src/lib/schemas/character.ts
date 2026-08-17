import { z } from "zod";
import { CHARACTER_EMBLEM_LIMITS, CHARACTER_POSE_LIMITS } from "@/lib/constants";
import type { CharacterPose, StageEmblemPlacement } from "@/lib/types";

const L = CHARACTER_POSE_LIMITS;
const E = CHARACTER_EMBLEM_LIMITS;

// Finite numbers only — the client sends values derived from pointer maths, and
// a NaN sneaking into Firestore would render the figure nowhere at all.
export const characterPoseSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  scale: z.number().finite(),
});

export const saveCharacterPoseSchema = z.object({
  orgId: z.string().min(1),
  memberId: z.string().min(1),
  pose: characterPoseSchema.nullable(),
});

/** Keep a pose inside the editable frame; overshoot lands at the edge. */
export function clampPose(pose: CharacterPose): CharacterPose {
  const clamp = (n: number, { min, max }: { min: number; max: number }) =>
    Math.min(max, Math.max(min, Math.round(n * 10) / 10));
  return {
    x: clamp(pose.x, L.x),
    y: clamp(pose.y, L.y),
    scale: clamp(pose.scale, L.scale),
  };
}

// Same finite-only stance as the pose: every number here comes from pointer
// maths, and one NaN would place a tile nowhere for everyone who loads the page.
export const stageEmblemPlacementSchema = z.object({
  patchId: z.string().min(1).max(128),
  x: z.number().finite(),
  y: z.number().finite(),
  size: z.number().finite(),
});

export const saveCharacterEmblemsSchema = z.object({
  orgId: z.string().min(1),
  memberId: z.string().min(1),
  // null clears the arrangement (back to the automatic slots); an empty array
  // is a real arrangement that shows nothing.
  placements: z.array(stageEmblemPlacementSchema).max(E.count).nullable(),
});

/**
 * Clamp every tile onto the stage and drop repeat patchIds (first one wins).
 * Overshoot lands at the edge rather than rejecting the whole arrangement,
 * matching clampPose.
 */
export function clampEmblemPlacements(
  placements: StageEmblemPlacement[],
): StageEmblemPlacement[] {
  const clamp = (n: number, { min, max }: { min: number; max: number }) =>
    Math.min(max, Math.max(min, Math.round(n * 10) / 10));
  const seen = new Set<string>();
  const out: StageEmblemPlacement[] = [];
  for (const p of placements) {
    if (seen.has(p.patchId)) continue;
    seen.add(p.patchId);
    out.push({
      patchId: p.patchId,
      x: clamp(p.x, E.x),
      y: clamp(p.y, E.y),
      size: clamp(p.size, E.size),
    });
  }
  return out;
}
