import { describe, expect, it } from "vitest";
import { buildRenderModel } from "@/lib/cut/buildRenderModel";
import type { Patch, RankVisual, VestConfig } from "@/lib/types";

const vestConfigs: Record<"front" | "back", VestConfig> = {
  front: {
    surface: "front",
    imagePath: null,
    aspectRatio: 0.88,
    slots: [{ slot: "LEFT_CHEST", u: 0.3, v: 0.3, maxScale: 0.7, accepts: ["activity"], capacity: 3 }],
  },
  back: {
    surface: "back",
    imagePath: null,
    aspectRatio: 0.88,
    slots: [
      { slot: "UPPER_BACK_LEFT", u: 0.24, v: 0.34, maxScale: 0.7, accepts: ["activity"], capacity: 2 },
      { slot: "BACK_HONOR", u: 0.5, v: 0.55, maxScale: 0.9, accepts: ["legendary"], capacity: 1 },
    ],
  },
};

function patch(id: string, over: Partial<Patch> = {}): Patch {
  return {
    id,
    name: id,
    category: "activity",
    description: "d",
    tier: 1,
    requirement: null,
    manual: false,
    active: true,
    defaultPlacement: { surface: "front", u: 0.5, v: 0.5, scale: 0.8, rotationDeg: 0 },
    ...over,
  };
}

const patchedColors: RankVisual = {
  showsColors: true,
  grants: [
    { kind: "topRocker", surface: "back", u: 0.5, v: 0.15, scale: 1, text: "CLUB" },
    { kind: "centerPatch", surface: "back", u: 0.5, v: 0.4, scale: 1, text: "" },
    { kind: "bottomRocker", surface: "back", u: 0.5, v: 0.68, scale: 1, text: "LOC" },
  ],
};

describe("buildRenderModel", () => {
  it("bare hangaround: no grants, no patches → empty cut", () => {
    const m = buildRenderModel({ vestConfigs, rankVisual: { showsColors: false, grants: [] }, patches: [], awarded: [] });
    expect(m.front).toHaveLength(0);
    expect(m.back).toHaveLength(0);
  });

  it("places the rank three-piece colours on the back", () => {
    const m = buildRenderModel({ vestConfigs, rankVisual: patchedColors, patches: [], awarded: [] });
    expect(m.back.map((p) => p.type)).toEqual(["topRocker", "centerPatch", "bottomRocker"]);
    expect(m.front).toHaveLength(0);
  });

  it("resolves an awarded patch to its default slot's u/v", () => {
    const p = patch("road-warrior", { defaultSlot: "UPPER_BACK_LEFT" });
    const m = buildRenderModel({ vestConfigs, rankVisual: null, patches: [p], awarded: [{ patchId: "road-warrior", awardedAt: "2026-01-01T00:00:00Z" }] });
    const pl = m.back.find((x) => x.patchId === "road-warrior")!;
    expect(pl.type).toBe("patch");
    expect(pl.u).toBe(0.24);
    expect(pl.v).toBe(0.34);
  });

  it("nudges patches stacked in the same slot so they don't fully overlap", () => {
    const m = buildRenderModel({
      vestConfigs,
      rankVisual: null,
      patches: [patch("a", { defaultSlot: "UPPER_BACK_LEFT" }), patch("b", { defaultSlot: "UPPER_BACK_LEFT" })],
      awarded: [
        { patchId: "a", awardedAt: "2026-01-01T00:00:00Z" },
        { patchId: "b", awardedAt: "2026-01-02T00:00:00Z" },
      ],
    });
    const va = m.back.find((x) => x.patchId === "a")!.v;
    const vb = m.back.find((x) => x.patchId === "b")!.v;
    expect(va).toBeCloseTo(0.34);
    expect(vb).toBeGreaterThan(va);
  });

  it("slotOverride wins over the patch's default slot", () => {
    const p = patch("x", { defaultSlot: "UPPER_BACK_LEFT" });
    const m = buildRenderModel({ vestConfigs, rankVisual: null, patches: [p], awarded: [{ patchId: "x", slotOverride: "BACK_HONOR", awardedAt: "2026-01-01T00:00:00Z" }] });
    const pl = m.back.find((x) => x.patchId === "x")!;
    expect(pl.u).toBe(0.5);
    expect(pl.v).toBe(0.55);
  });

  it("falls back to legacy defaultPlacement when the slot is unknown", () => {
    const p = patch("y", { defaultSlot: "NONEXISTENT", defaultPlacement: { surface: "front", u: 0.11, v: 0.22, scale: 0.6, rotationDeg: 0 } });
    const m = buildRenderModel({ vestConfigs, rankVisual: null, patches: [p], awarded: [{ patchId: "y", awardedAt: "2026-01-01T00:00:00Z" }] });
    const pl = m.front.find((x) => x.patchId === "y")!;
    expect(pl.u).toBe(0.11);
    expect(pl.v).toBe(0.22);
  });

  it("skips inactive patches and unknown patch ids", () => {
    const m = buildRenderModel({
      vestConfigs,
      rankVisual: null,
      patches: [patch("z", { active: false, defaultSlot: "UPPER_BACK_LEFT" })],
      awarded: [{ patchId: "z" }, { patchId: "ghost" }],
    });
    expect(m.back).toHaveLength(0);
    expect(m.front).toHaveLength(0);
  });

  it("derives rarity from tier when the patch carries none", () => {
    const p = patch("leg", { tier: 4, category: "legendary", defaultSlot: "BACK_HONOR" });
    const m = buildRenderModel({ vestConfigs, rankVisual: null, patches: [p], awarded: [{ patchId: "leg" }] });
    expect(m.back.find((x) => x.patchId === "leg")!.rarity).toBe("legendary");
  });
});
