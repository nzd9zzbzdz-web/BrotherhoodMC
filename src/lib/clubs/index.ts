import { PLATFORM_PRESET } from "./platform";
import type { ClubPreset } from "./types";

export type { ClubPreset } from "./types";
export { PLATFORM_PRESET } from "./platform";

/**
 * Repo-side club presets, keyed by ORG SLUG.
 *
 * Adding a club to a shared deployment means adding one entry here plus a
 * `public/brand/<slug>/` folder, and nothing else. Adding NOTHING is also
 * valid: the club renders the blank platform preset and is branded entirely
 * from Admin -> Branding.
 *
 * This deployment ships EMPTY on purpose. Every club here is branded from the
 * admin screens, and an empty map is the one state that cannot put one club's
 * colours on another club's page. A preset is a shortcut for shipping a club's
 * identity in the repo, never a requirement for running one.
 *
 * The lookup is by slug rather than org id because the slug is the thing a
 * human types, the thing the URL carries, and the thing the asset folder is
 * named after.
 */
const PRESETS: Record<string, ClubPreset> = {};

/**
 * The preset for a slug, or the blank one.
 *
 * Never throws and never guesses: an unknown slug gets `PLATFORM_PRESET`, so
 * the failure mode of a missing preset is an unbranded site rather than
 * another club's branding.
 */
export function clubPreset(slug: string | null | undefined): ClubPreset {
  if (!slug) return PLATFORM_PRESET;
  return PRESETS[slug] ?? PLATFORM_PRESET;
}

/** Slugs with a preset in the repo. Used by the seed/bootstrap scripts. */
export const PRESET_SLUGS = Object.keys(PRESETS);
