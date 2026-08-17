import type { Branding, BrandingAssetKey, BrandingColors } from "@/lib/types";

/**
 * Everything a club brings with it that lives in the REPO rather than in
 * Firestore: its palette, its shipped artwork, and its long-form copy.
 *
 * This exists because "shared defaults" and "multi-tenant" are incompatible.
 * The Ravens' palette and artwork used to BE the platform default, so any club
 * that had not yet uploaded a logo rendered the Ravens' patch, and any club
 * that had not written its own history rendered the Ravens' history. Nothing
 * leaked between Firestore documents, but everything leaked through the
 * fallbacks.
 *
 * So a preset is keyed by ORG SLUG. `silent-souls` is the Ravens; anything
 * without a preset gets `PLATFORM_PRESET`, which is deliberately blank. A new
 * club can therefore never inherit another club's identity by omission — the
 * worst it can do is look unfinished, which is the honest state of a club
 * nobody has branded yet.
 *
 * A preset is only the STARTING POINT. Everything here is overridden by the
 * org's branding documents the moment an admin saves anything in
 * Admin -> Branding, and by uploaded artwork the moment they replace a slot.
 */
export interface ClubPreset {
  /** Org slug this preset belongs to. `_platform` for the blank fallback. */
  slug: string;

  identity: {
    /** "Ravens of Death MC" — what the portal calls the club. */
    displayName: string;
    /** "Ravens of Death Community Foundation" — the shopfront's name. */
    publicName: string;
    /** Long form, used by the bootstrap script for the org record. */
    legalName: string;
    /** "RODMC" */
    shortName: string;
    /** "San Andreas" */
    location: string;
    /** "The Clubhouse, Sandy Shores" */
    addressLine: string;
    /** Portal tagline: usually the territory. */
    portalTagline: string;
    /** Public tagline: usually the creed line under the hero. */
    publicTagline: string;
    mission: string;
    /** Heading on the Brotherhood page's chain-of-command section. */
    chainTitle: string;
    /** The line under it. Empty renders nothing. */
    chainBlurb: string;
    /** YouTube id for the floating anthem player. */
    anthemVideoId: string;
  };

  colors: {
    portal: BrandingColors;
    public: BrandingColors;
  };

  fonts: Branding["fonts"];

  /**
   * Where each swappable image ships from, before any admin upload. `plateArt`
   * is the one slot NOT listed here: its shipped default is nullable and rides
   * its own field below; `defaultAssetsFor` folds the two together.
   */
  assets: Record<Exclude<BrandingAssetKey, "plateArt">, string>;

  /**
   * The engraved Chain of Command plate ART, or null when the club has none.
   *
   * Null is a real answer, not a missing one: the rings, nameplates and stat
   * bar are painted INTO the art and <ChainOfCommand> lays live text over them
   * from coordinates measured against that specific image. A club without its
   * own plate gets the stacked panel instead, which lays out for any headcount
   * and needs no art at all. Handing it another club's plate would put this
   * club's officers under someone else's name. A club can also UPLOAD a plate
   * painted to the template from Admin -> Branding, which overrides this like
   * any other asset slot.
   */
  plateArt: string | null;

  /**
   * The home page hero clip, or null to fall back to the poster image. Video
   * has no upload path (sharp decodes images), so this is repo-only.
   */
  heroVideo: string | null;

  /** Long-form copy for the public site. Empty arrays render nothing. */
  copy: {
    /** About page history, one entry per paragraph. */
    story: string[];
    /** Chapter headings for `story`, matched BY INDEX. */
    storyTitles: string[];
    /** The closing lines under the story, set in the display face. */
    creed: string[];
    /** The four value cards on the About page. */
    values: [string, string][];
    /** The four pillars on the home page. `body` may use {club}. */
    pillars: { title: string; body: string; href: "about" | "brotherhood" | "join"; cta: string }[];
    /** Closing line above the home page's one call to action. */
    closingHeading: string;
    closingBody: string;
  };

  /** The Contact page's cover-story details. */
  contact: {
    venue: string;
    addressLines: string[];
    hours: string[];
    /** Absent ⇒ derived from the org slug, as it was before. */
    email?: string;
  };
}
