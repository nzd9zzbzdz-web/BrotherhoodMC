import { clubPreset } from "@/lib/clubs";
import type { Branding, BrandingAssetKey } from "@/lib/types";

/**
 * What a club falls back to before anyone has saved anything in
 * Admin -> Branding.
 *
 * These used to be flat constants holding the Ravens' palette and artwork, on
 * the reasoning that a running site needs a fallback and the Ravens were the
 * only club. That is exactly what made the platform single-tenant in practice:
 * nothing leaked between Firestore documents, but every unset field leaked the
 * Ravens through the fallback. A second club that had not uploaded a logo
 * rendered the Ravens' patch.
 *
 * So the defaults are now a function of the ORG SLUG, resolved through
 * `src/lib/clubs`. `silent-souls` gets the Ravens preset (byte-identical to
 * what shipped before); any other slug gets the blank platform preset. There
 * is no code path by which one club can render another club's identity.
 *
 * No "server-only" marker: the admin editor and its live preview are client
 * components and need these to show what "Reset to default" will do.
 */

/** The shipped shadow figure. Genuinely club-neutral: it depicts a person. */
export const CHARACTER_SILHOUETTE_FILE = "/brand/members/silhouette.webp";

/** Where each swappable image ships from for this club. */
export function defaultAssetsFor(slug: string | null | undefined): Record<BrandingAssetKey, string> {
  const preset = clubPreset(slug);
  // The plate rides its own nullable preset field ("no plate" is a real
  // answer); in the asset map that answer is spelled "".
  return { ...preset.assets, plateArt: preset.plateArt ?? "" };
}

/** A complete branding document for one surface of one club. */
export function defaultBrandingFor(
  slug: string | null | undefined,
  surface: "public" | "portal",
): Branding {
  const preset = clubPreset(slug);
  const { identity } = preset;
  return {
    colors: preset.colors[surface],
    fonts:
      surface === "public"
        ? { display: preset.fonts.display, body: preset.fonts.body }
        : preset.fonts,
    // BOTH surfaces default to the club's own name. `publicName` is the
    // charity cover story and belongs to the ORG record (the donate page reads
    // it from there); the shopfront's masthead has always said "Ravens of
    // Death MC" like the portal does, and a club that wants otherwise sets it
    // on the public tab.
    orgDisplayName: identity.displayName,
    shortName: identity.shortName,
    location: identity.location,
    addressLine: identity.addressLine,
    tagline: surface === "public" ? identity.publicTagline : identity.portalTagline,
    mission: identity.mission,
    chainTitle: identity.chainTitle,
    chainBlurb: identity.chainBlurb,
    anthemVideoId: identity.anthemVideoId,
  };
}
