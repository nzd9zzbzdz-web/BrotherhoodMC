import type {
  CutSurface,
  Grant,
  PatchCategory,
  PatchSlot,
  Rarity,
  RankVisual,
} from "../types";

/**
 * Default Digital Cut configuration a new org inherits. All positions are
 * normalized u/v (0..1) so they survive resolution changes and the future
 * 2D→3D migration (slot names double as 3D attachment points). Orgs override
 * any of this through the Vest Designer — nothing here is hardcoded into render
 * logic; it is seed data.
 */

// Legacy patches carry a numeric `tier` (1..4). Rarity is the presentation weight.
export function tierToRarity(tier: number): Rarity {
  if (tier >= 4) return "legendary";
  if (tier === 3) return "epic";
  if (tier === 2) return "rare";
  return "common";
}

export const DEFAULT_VEST_ASPECT = 0.88; // w/h of a typical cut render

// ── Slots (patch anchors) ──────────────────────────────────────────────
// Front carries chest/waist patches; back flanks the club colors.
export const DEFAULT_FRONT_SLOTS: PatchSlot[] = [
  { slot: "LEFT_CHEST", u: 0.3, v: 0.3, maxScale: 0.7, accepts: ["activity", "recognition"], capacity: 3 },
  { slot: "RIGHT_CHEST", u: 0.7, v: 0.3, maxScale: 0.7, accepts: ["service", "recognition"], capacity: 3 },
  { slot: "LEFT_WAIST", u: 0.3, v: 0.6, maxScale: 0.7, accepts: ["activity", "service"], capacity: 3 },
  { slot: "RIGHT_WAIST", u: 0.7, v: 0.6, maxScale: 0.7, accepts: ["service", "activity"], capacity: 3 },
  { slot: "FRONT_CENTER", u: 0.5, v: 0.72, maxScale: 0.8, accepts: ["recognition", "leadership"], capacity: 2 },
];

export const DEFAULT_BACK_SLOTS: PatchSlot[] = [
  { slot: "UPPER_BACK_LEFT", u: 0.24, v: 0.34, maxScale: 0.7, accepts: ["activity"], capacity: 2 },
  { slot: "UPPER_BACK_RIGHT", u: 0.76, v: 0.34, maxScale: 0.7, accepts: ["service"], capacity: 2 },
  { slot: "LOWER_BACK_LEFT", u: 0.24, v: 0.66, maxScale: 0.7, accepts: ["activity", "service"], capacity: 2 },
  { slot: "LOWER_BACK_RIGHT", u: 0.76, v: 0.66, maxScale: 0.7, accepts: ["service", "activity"], capacity: 2 },
  { slot: "BACK_HONOR", u: 0.5, v: 0.55, maxScale: 0.9, accepts: ["legendary"], capacity: 1 },
];

export function defaultSlotsFor(surface: CutSurface): PatchSlot[] {
  return surface === "front" ? DEFAULT_FRONT_SLOTS : DEFAULT_BACK_SLOTS;
}

// Where a patch lands by default, keyed by category. The render model nudges
// within a slot's capacity when several patches share it.
const CATEGORY_DEFAULT_SLOT: Record<PatchCategory, string> = {
  activity: "UPPER_BACK_LEFT",
  service: "UPPER_BACK_RIGHT",
  leadership: "FRONT_CENTER",
  recognition: "FRONT_CENTER",
  legendary: "BACK_HONOR",
};

export function defaultSlotForCategory(category: PatchCategory): string {
  return CATEGORY_DEFAULT_SLOT[category] ?? "UPPER_BACK_LEFT";
}

// ── Rank visuals (the three-piece colors + tabs) ───────────────────────
// Officer tabs sit on the front; the club colors (rockers + center) on the back.
const tab = (text: string): Grant => ({ kind: "rankTab", surface: "front", u: 0.5, v: 0.16, scale: 0.8, text });
const saaDiamond: Grant = { kind: "saaDiamond", surface: "front", u: 0.7, v: 0.3, scale: 0.6, text: "SAA" };

function clubColors(orgName: string, location: string): Grant[] {
  return [
    { kind: "topRocker", surface: "back", u: 0.5, v: 0.15, scale: 1, text: orgName },
    { kind: "centerPatch", surface: "back", u: 0.5, v: 0.4, scale: 1, text: "" },
    { kind: "bottomRocker", surface: "back", u: 0.5, v: 0.68, scale: 1, text: location },
  ];
}

/**
 * Default rank → visuals, keyed by rank NAME (matches DEFAULT_RANKS). Every
 * titled rank wears full colors plus a name tab — officer or not, since
 * Enforcer and Chaplain carry tabs without sitting at the officer table.
 * Sergeant-at-Arms also gets the diamond.
 */
export function defaultRankVisual(
  rankName: string,
  org: { orgName: string; location: string },
): RankVisual {
  const colors = clubColors(org.orgName, org.location);
  switch (rankName) {
    case "Hangaround":
      return { showsColors: false, grants: [] };
    case "Prospect":
      return {
        showsColors: false,
        grants: [{ kind: "prospectTab", surface: "back", u: 0.5, v: 0.68, scale: 1, text: "PROSPECT" }],
      };
    case "Patched Member":
      return { showsColors: true, grants: colors };
    case "Sergeant-at-Arms":
      return { showsColors: true, grants: [...colors, tab("SGT-AT-ARMS"), saaDiamond] };
    default:
      // Every other titled rank: colors + their name on a front tab.
      return { showsColors: true, grants: [...colors, tab(rankName.toUpperCase())] };
  }
}
