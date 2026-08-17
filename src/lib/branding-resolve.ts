import { BRANDING_ART } from "@/lib/branding-art";
import { defaultAssetsFor, defaultBrandingFor } from "@/lib/branding-defaults";
import { clubPreset } from "@/lib/clubs";
import { BRANDING_ASSET_KEYS } from "@/lib/types";
import type { PlateLayout } from "@/lib/plate-layout";
import type { WatermarkStyle } from "@/lib/watermark";
import type { EmblemStyle } from "@/lib/emblem-style";
import type {
  Branding,
  BrandingAssetKey,
  BrandingColors,
  BrandingAssets,
} from "@/lib/types";

/**
 * Branding with every hole filled.
 *
 * Firestore holds only what a club has actually chosen, so a raw `Branding` is
 * full of optionals and every consumer ends up writing its own `?? something`.
 * That is exactly how a hex value or an image path ends up hardcoded in a
 * component. `resolveBranding` does the folding ONCE, at the layout, and hands
 * down a value where `colors.glow` and `assets.clubPatch` are simply strings.
 *
 * Pure and client-safe: the admin editor resolves an unsaved draft through the
 * same function to paint its live preview, which is what makes the preview
 * trustworthy rather than an approximation.
 */
/**
 * What resolution needs to know about the tenant: which club it is, and what
 * the organization record calls it. An `Organization` satisfies this, which is
 * why every call site can pass the one it already loaded.
 */
export interface BrandingOrg {
  slug: string;
  name?: string;
}

export interface ResolvedBranding {
  surface: "public" | "portal";
  /** Every token present — no optional colours downstream. */
  colors: Required<BrandingColors>;
  fonts: { display: string; body: string; mono: string };
  /** Club name as shown, e.g. "Ravens of Death MC". */
  name: string;
  /** Initials for tight spots, e.g. "RODMC". Never empty. */
  shortName: string;
  /** Chapter or territory, e.g. "San Andreas". May be empty. */
  location: string;
  /** The line above it in the footer. May be empty. */
  addressLine: string;
  tagline: string;
  mission: string;
  /** Heading on the Brotherhood page's chain-of-command section. Never empty. */
  chainTitle: string;
  /** The line under it. May be empty. */
  chainBlurb: string;
  /**
   * Where the boxes sit on the plate, when the club has dragged them off the
   * template to match its own art. Null means the template layout; kept null
   * rather than folded in so "has this club customized it" stays answerable
   * and the cached value stays small.
   */
  plateLayout: PlateLayout | null;
  /**
   * How the home page watermark sits and glows, when the club has moved it
   * off the shipped treatment. Null means `DEFAULT_WATERMARK_STYLE`, kept
   * null for the same reasons as `plateLayout` above.
   */
  watermarkStyle: WatermarkStyle | null;
  /**
   * How the four public emblems read, when the club has tuned them. Null
   * means `DEFAULT_EMBLEM_STYLE`, kept null for the same reasons.
   */
  emblemStyle: EmblemStyle | null;
  anthemVideoId: string;
  /**
   * Every catalog slot resolved to a usable URL. `plateArt` is the one slot
   * that may resolve to "" — the club has no plate and the page uses its
   * art-free layout.
   */
  assets: Record<BrandingAssetKey, string>;
  /** Which slots are running on an upload rather than the shipped default. */
  customAssets: Set<BrandingAssetKey>;
}

/**
 * "Ravens of Death MC" → "RODMC". Only used when a club has not set its own
 * short name; the point is that the slot is never blank on screen.
 */
export function initialsOf(name: string): string {
  const letters = name
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return letters || name.slice(0, 4).toUpperCase();
}

/**
 * Where a slot's image comes from, in order: what the club uploaded, then the
 * pre-catalog path field it used to be stored in, then the shipped file.
 *
 * The legacy step matters for live clubs: `characterStagePath` is written by
 * the seeder and by uploads made before this catalog existed, and dropping it
 * would blank a stage that is currently on screen.
 */
function assetUrl(
  branding: Branding | null,
  key: BrandingAssetKey,
  shipped: Record<BrandingAssetKey, string>,
): string {
  const uploaded = branding?.assets?.[key];
  if (uploaded) return uploaded;
  const legacy = BRANDING_ART[key].legacyField;
  if (legacy) {
    const value = branding?.[legacy];
    if (typeof value === "string" && value) return value;
  }
  return shipped[key];
}

/**
 * Fold a club's stored branding over the shipped defaults for one surface.
 *
 * `null` is a valid input and yields the default club exactly — that is the
 * property that lets a fresh deploy render before anyone has opened Admin.
 */
export function resolveBranding(
  branding: Branding | null | undefined,
  surface: "public" | "portal",
  org: BrandingOrg,
): ResolvedBranding {
  const { slug } = org;
  const base = defaultBrandingFor(slug, surface);
  const shipped = defaultAssetsFor(slug);
  const colors = { ...base.colors, ...branding?.colors };
  // Saved branding, then the ORG RECORD's own name, then the preset. The
  // middle step matters for a club that has been bootstrapped but not yet
  // branded: without it the site says "New Club" while the organization
  // document has said the club's real name all along.
  const name = branding?.orgDisplayName || org.name || base.orgDisplayName;

  const assets = {} as Record<BrandingAssetKey, string>;
  const customAssets = new Set<BrandingAssetKey>();
  for (const key of BRANDING_ASSET_KEYS) {
    assets[key] = assetUrl(branding ?? null, key, shipped);
    if (branding?.assets?.[key]) customAssets.add(key);
  }

  return {
    surface,
    colors: {
      ...colors,
      // The four that are optional on the stored shape resolve to the value
      // every surface mixed from before they existed, so an org that has never
      // set them is pixel-identical to how it looked then.
      sidebar: colors.sidebar ?? colors.card,
      sidebarBorder: colors.sidebarBorder ?? colors.border,
      glow: colors.glow ?? colors.primary,
      elevated: colors.elevated ?? colors.card,
    },
    fonts: {
      display: branding?.fonts?.display || base.fonts.display,
      body: branding?.fonts?.body || base.fonts.body,
      mono: branding?.fonts?.mono || base.fonts.mono || base.fonts.body,
    },
    name,
    shortName: branding?.shortName || base.shortName || initialsOf(name),
    location: branding?.location ?? base.location ?? "",
    addressLine: branding?.addressLine ?? base.addressLine ?? "",
    tagline: branding?.tagline ?? base.tagline ?? "",
    mission: branding?.mission ?? base.mission ?? "",
    // `||` like shortName: a blank heading is never what anyone wants on
    // screen, so blank means "back to the preset". The blurb keeps `??` — an
    // empty line is a legitimate choice.
    chainTitle: branding?.chainTitle || base.chainTitle || "Brotherhood",
    chainBlurb: branding?.chainBlurb ?? base.chainBlurb ?? "",
    plateLayout: branding?.plateLayout ?? null,
    watermarkStyle: branding?.watermarkStyle ?? null,
    emblemStyle: branding?.emblemStyle ?? null,
    anthemVideoId: branding?.anthemVideoId ?? base.anthemVideoId ?? "",
    assets,
    customAssets,
  };
}

/**
 * The editable slice of a branding doc — what the admin editor holds as draft
 * state and what Save writes back. Deliberately NOT the whole `Branding`:
 * `story`, `storyTitles` and `creed` are long-form club copy with their own
 * home, and `assets` is written by the upload action, not by the colour form.
 */
export interface BrandingDraft {
  orgDisplayName: string;
  shortName: string;
  location: string;
  addressLine: string;
  tagline: string;
  mission: string;
  /** Chain-of-command heading and blurb. Only ever DRAWN from the portal doc;
   *  the editor shows the fields on the portal tab and the save action writes
   *  them for that surface only. */
  chainTitle: string;
  chainBlurb: string;
  /** Same portal-only rule. Null means the template layout. */
  plateLayout: PlateLayout | null;
  /** The watermark treatment, drawn only on the PUBLIC home page; the editor
   *  shows it on the public tab and the save action writes it for that
   *  surface only. Null means the shipped treatment. */
  watermarkStyle: WatermarkStyle | null;
  /** Same public-only rule. Null means the shipped emblem treatment. */
  emblemStyle: EmblemStyle | null;
  anthemVideoId: string;
  colors: Required<BrandingColors>;
}

/**
 * Identity that is the same club whichever face you are looking at.
 *
 * Branding is stored per surface, which is right for the fields that
 * legitimately differ: the shopfront runs under a different NAME from the
 * clubhouse ("… Community Foundation" vs "… MC"), its tagline is the creed
 * while the portal's is the territory, and only the public site has a mission
 * statement. A club's initials, its chapter, its clubhouse address and its
 * anthem are not like that — there is one answer, and asking twice invites the
 * two documents to disagree.
 *
 * Worse than untidy: several of these are only DRAWN on the public site, so
 * editing them on the portal tab (which is the one the editor opens on) wrote
 * a value nothing would ever render. Both the save action and the editor treat
 * this list as shared and write it to both documents.
 */
export const SHARED_IDENTITY_KEYS = [
  "shortName",
  "location",
  "addressLine",
  "anthemVideoId",
] as const satisfies readonly (keyof BrandingDraft)[];

export type SharedIdentityKey = (typeof SHARED_IDENTITY_KEYS)[number];

/** The subset of a draft that both surfaces share. */
export function sharedIdentity(draft: BrandingDraft): Pick<BrandingDraft, SharedIdentityKey> {
  return {
    shortName: draft.shortName,
    location: draft.location,
    addressLine: draft.addressLine,
    anthemVideoId: draft.anthemVideoId,
  };
}

/** The draft an editor opens with for a surface. */
export function toDraft(resolved: ResolvedBranding): BrandingDraft {
  return {
    orgDisplayName: resolved.name,
    shortName: resolved.shortName,
    location: resolved.location,
    addressLine: resolved.addressLine,
    tagline: resolved.tagline,
    mission: resolved.mission,
    chainTitle: resolved.chainTitle,
    chainBlurb: resolved.chainBlurb,
    plateLayout: resolved.plateLayout,
    watermarkStyle: resolved.watermarkStyle,
    emblemStyle: resolved.emblemStyle,
    anthemVideoId: resolved.anthemVideoId,
    colors: resolved.colors,
  };
}

/** A draft resolved back into a full branding value, for the live preview. */
export function draftToResolved(
  draft: BrandingDraft,
  surface: "public" | "portal",
  assets: BrandingAssets,
  org: BrandingOrg,
): ResolvedBranding {
  return resolveBranding(
    {
      colors: draft.colors,
      fonts: clubPreset(org.slug).fonts,
      orgDisplayName: draft.orgDisplayName,
      shortName: draft.shortName,
      location: draft.location,
      addressLine: draft.addressLine,
      tagline: draft.tagline,
      mission: draft.mission,
      chainTitle: draft.chainTitle,
      chainBlurb: draft.chainBlurb,
      plateLayout: draft.plateLayout ?? undefined,
      watermarkStyle: draft.watermarkStyle ?? undefined,
      emblemStyle: draft.emblemStyle ?? undefined,
      anthemVideoId: draft.anthemVideoId,
      assets,
    },
    surface,
    org,
  );
}
