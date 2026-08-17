import type {
  CutRenderModel,
  CutSurface,
  Patch,
  RankVisual,
  ResolvedPlacement,
  VestConfig,
} from "../types";
import { defaultSlotForCategory, tierToRarity } from "./config";

export interface AwardedInput {
  patchId: string;
  awardedAt?: string | null; // ISO
  awardedBy?: string | null;
  reason?: string | null;
  slotOverride?: string | null;
}

export interface RenderModelInput {
  vestConfigs: Partial<Record<CutSurface, VestConfig>>;
  rankVisual: RankVisual | null;
  patches: Patch[];
  awarded: AwardedInput[];
}

interface SlotRef {
  surface: CutSurface;
  u: number;
  v: number;
  maxScale: number;
}

/**
 * Pure resolver: (awards + rank visual + vest config) → CutRenderModel.
 * Renderer-agnostic and tenant-agnostic — the 2D DOM renderer and the future
 * 3D renderer both consume its output. No I/O, no framework: unit-testable.
 */
export function buildRenderModel(input: RenderModelInput): CutRenderModel {
  const { vestConfigs, rankVisual, patches, awarded } = input;

  // Slot name → position, across both surfaces (a slot lives on exactly one).
  const slotLookup = new Map<string, SlotRef>();
  (["front", "back"] as const).forEach((surface) => {
    vestConfigs[surface]?.slots.forEach((s) => {
      slotLookup.set(s.slot, { surface, u: s.u, v: s.v, maxScale: s.maxScale });
    });
  });

  const patchMap = new Map(patches.map((p) => [p.id, p]));
  const front: ResolvedPlacement[] = [];
  const back: ResolvedPlacement[] = [];
  const push = (surface: CutSurface, pl: ResolvedPlacement) =>
    (surface === "front" ? front : back).push(pl);

  // Rank grants render beneath patches (low z).
  (rankVisual?.grants ?? []).forEach((g, i) => {
    push(g.surface, {
      key: `rank:${g.kind}:${i}`,
      type: g.kind,
      surface: g.surface,
      u: g.u,
      v: g.v,
      scale: g.scale,
      z: 1 + i,
      label: g.text ?? "",
      art: g.assetPath ?? null,
    });
  });

  // Awarded patches — deterministic order so stacking is stable across renders.
  const occupancy = new Map<string, number>();
  const sorted = [...awarded].sort(
    (a, b) =>
      (a.awardedAt ?? "").localeCompare(b.awardedAt ?? "") ||
      a.patchId.localeCompare(b.patchId),
  );

  sorted.forEach((aw, idx) => {
    const patch = patchMap.get(aw.patchId);
    if (!patch || patch.active === false) return;

    const slotName =
      aw.slotOverride ?? patch.defaultSlot ?? defaultSlotForCategory(patch.category);
    const slot = slotLookup.get(slotName);

    let surface: CutSurface;
    let u: number;
    let v: number;
    let scale: number;
    if (slot) {
      const occ = occupancy.get(slotName) ?? 0;
      occupancy.set(slotName, occ + 1);
      surface = slot.surface;
      u = slot.u;
      v = Math.min(0.92, slot.v + occ * 0.07); // overflow-nudge stacked patches
      scale = Math.min(0.8, slot.maxScale);
    } else {
      // Legacy fallback: patch carries its own u/v.
      const dp = patch.defaultPlacement;
      surface = dp.surface;
      u = dp.u;
      v = dp.v;
      scale = dp.scale;
    }

    push(surface, {
      key: `patch:${patch.id}`,
      type: "patch",
      surface,
      u,
      v,
      scale,
      z: 10 + idx,
      label: patch.name,
      art: patch.imagePath ?? null,
      rarity: patch.rarity ?? tierToRarity(patch.tier),
      category: patch.category,
      patchId: patch.id,
      description: patch.description,
      awardedAt: aw.awardedAt ?? null,
      awardedBy: aw.awardedBy ?? null,
      reason: aw.reason ?? null,
    });
  });

  front.sort((a, b) => a.z - b.z);
  back.sort((a, b) => a.z - b.z);
  return { front, back };
}
