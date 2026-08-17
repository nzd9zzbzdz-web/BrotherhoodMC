import type { Rarity } from "@/lib/types";

/**
 * Patch rarity tints, and the podium metals that borrow the same language.
 *
 * NOT club branding, which is why these are constants rather than fields on
 * the branding document: common/rare/epic/legendary is a game convention every
 * player already reads at a glance, and recolouring it per club would cost
 * that recognition for nothing. A blue club still wants gold to mean
 * legendary.
 *
 * They are here rather than in four component files because they WERE in four
 * component files — the same four hex values copied into the patch wall, the
 * cut viewer, the emblem ladders and the leaderboard, which is one edit away
 * from four tiers disagreeing about what "epic" looks like.
 */
export const RARITY_COLOR: Record<Rarity, string> = {
  common: "#A8A29E",
  rare: "#5F9BD5",
  epic: "#B084E0",
  legendary: "#E0B84A",
};

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

/** Gold, silver, bronze — same visual language as the rarity tints. */
export const MEDAL_COLOR: Record<number, string> = {
  1: RARITY_COLOR.legendary,
  2: RARITY_COLOR.common,
  3: "#C08552",
};

/** Rarity tint for anything that stores rarity as a loose string. */
export function rarityColor(rarity: string | undefined): string | undefined {
  return RARITY_COLOR[rarity as Rarity];
}
