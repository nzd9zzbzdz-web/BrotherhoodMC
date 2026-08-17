/**
 * Org identity + branding for the seed/bootstrap scripts.
 *
 * The VALUES live in `src/lib/clubs/<slug>.ts` — one preset per club, selected
 * by org slug — because the running site needs them too: `resolveBranding`
 * folds a preset under whatever Firestore holds, so a club with a half-filled
 * branding document still renders, and a club with NO preset renders the blank
 * platform one rather than somebody else's.
 *
 * This file is the scripts' door onto that registry. Do NOT re-declare these
 * values in a script: they drifted before and silently rewrote the old club's
 * name/palette back over a rebrand. Do not re-declare them here either — edit
 * the preset.
 *
 * `ORG_ID` selects which club is being seeded, so `ORG_ID=blue-wolves npx tsx
 * scripts/bootstrap.ts` bootstraps that club against its own preset.
 */
import { clubPreset } from "../../src/lib/clubs";
import type { Branding } from "../../src/lib/types";

const SLUG = process.env.ORG_ID ?? "brotherhood";
const preset = clubPreset(SLUG);

export const ORG_SLUG = SLUG;
export const ORG_DISPLAY_NAME = preset.identity.displayName;
export const ORG_LEGAL_NAME = preset.identity.legalName;
export const ORG_PUBLIC_NAME = preset.identity.publicName;
export const ORG_SHORT_NAME = preset.identity.shortName;
export const ORG_LOCATION = preset.identity.location;
export const ORG_ADDRESS_LINE = preset.identity.addressLine;

const identity = {
  orgDisplayName: preset.identity.displayName,
  shortName: preset.identity.shortName,
  location: preset.identity.location,
  addressLine: preset.identity.addressLine,
  anthemVideoId: preset.identity.anthemVideoId,
};

export const portalBranding: Branding = {
  colors: preset.colors.portal,
  fonts: preset.fonts,
  ...identity,
  tagline: preset.identity.portalTagline,
  // Seeded explicitly so a fresh club's stage is set in the document as well as
  // in the preset. Any shipped asset path could be written this way; this one
  // is, because the character screen predates the asset catalog.
  characterStagePath: preset.assets.characterStage,
};

export const publicBranding: Branding = {
  colors: preset.colors.public,
  fonts: { display: preset.fonts.display, body: preset.fonts.body },
  ...identity,
  tagline: preset.identity.publicTagline,
  mission: preset.identity.mission,
  logoPath: preset.assets.logo,
  heroImagePath: preset.assets.heroImage,
  // The About page's long-form history. Written here so a seed or an
  // apply-branding run puts it in Firestore, where an admin can edit it; the
  // page also falls back to the preset, so a club renders its story either way.
  story: preset.copy.story,
  storyTitles: preset.copy.storyTitles,
  creed: preset.copy.creed,
};
