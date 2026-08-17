import type { Branding, BrandingAssetKey } from "@/lib/types";

/**
 * The catalog of every image an admin can swap from Admin → Branding.
 *
 * One table, imported by the upload action, the serving route and the admin
 * UI, so the shape an image is stored at and the slot it lands in can never
 * disagree. Making an image swappable means adding a key to
 * `BRANDING_ASSET_KEYS` and a row here, and nothing else: the editor renders a
 * card per row, the action validates against the row, and components resolve
 * through `resolveBranding`.
 */
export interface BrandingArtSpec {
  label: string;
  blurb: string;
  /**
   * Which branding doc carries the pointer. "both" writes to the public AND
   * portal docs — the club patch and the member silhouette appear on either
   * side of the login and would look absurd differing between them.
   */
  surface: "public" | "portal" | "both";
  /** How the card is grouped in the editor. */
  group: "Identity" | "Scene art" | "Emblems";
  /**
   * The pre-catalog `Branding` field this slot also fills. Present only for
   * the five paths that existed before `assets` did; still written on upload
   * so any reader not yet moved onto `resolveBranding` keeps working.
   */
  legacyField?: keyof Pick<
    Branding,
    | "rosterBackdropPath"
    | "portalRosterBackdropPath"
    | "characterStagePath"
    | "logoPath"
    | "heroImagePath"
  >;
  /**
   * Pages whose render this art changes. The upload/reset actions revalidate
   * every entry — kept here rather than in the action so a new row can't ship
   * with art that only appears after a redeploy.
   */
  revalidates: readonly { readonly path: string; readonly type: "page" | "layout" }[];
  /** Stored dimensions — the frame the art is fitted to. */
  width: number;
  height: number;
  /**
   * `cover` crops to fill the frame: right for backdrops, where letterboxing a
   * scene into bars looks broken. `contain` fits the whole image inside the
   * frame ON A TRANSPARENT GROUND: mandatory for patches, wordmarks and
   * emblems, which are cut-out artwork that must never lose an edge and must
   * never gain a black rectangle.
   */
  fit: "cover" | "contain";
  /** Which part survives a `cover` crop when the source is a different shape. */
  position: "top" | "centre";
  /** Guidance shown on the asset card. */
  ratioHint: string;
}

/** Every page that draws the club patch or the member silhouette. */
const EVERYWHERE = [
  { path: "/[orgSlug]", type: "layout" },
  { path: "/[orgSlug]/portal", type: "layout" },
] as const;

// Typed as the Record rather than `as const satisfies` it: the literal types
// would split the table into a union whose members disagree about whether
// `legacyField` exists, and every reader would have to narrow before asking.
export const BRANDING_ART: Record<BrandingAssetKey, BrandingArtSpec> = {
  // ── Identity ────────────────────────────────────────────────────────
  clubPatch: {
    label: "Club patch",
    blurb:
      "The colours themselves. Pinned to the public header, signed into the footer, and shown at size on the About page.",
    surface: "both",
    group: "Identity",
    // Drawn as tall as 15rem in the header, so stored at roughly 2x that.
    width: 720,
    height: 1080,
    fit: "contain",
    position: "centre",
    ratioHint:
      "Portrait 2:3 with a transparent background (e.g. 1440×2160 PNG). Transparency is preserved.",
    revalidates: EVERYWHERE,
  },
  logo: {
    label: "Wordmark",
    blurb: "The club's name set as artwork. Used where a banner is wanted over the patch.",
    surface: "public",
    group: "Identity",
    legacyField: "logoPath",
    width: 1200,
    height: 400,
    fit: "contain",
    position: "centre",
    ratioHint: "Wide 3:1 with a transparent background (e.g. 1800×600 PNG).",
    revalidates: [{ path: "/[orgSlug]", type: "layout" }],
  },
  defaultAvatar: {
    label: "Default member figure",
    blurb:
      "Stands in for any member with no approved character render, on the roster wall and the character screen.",
    surface: "both",
    group: "Identity",
    width: 600,
    height: 900,
    fit: "contain",
    position: "centre",
    ratioHint: "Portrait 2:3, transparent background, figure standing on the bottom edge.",
    revalidates: EVERYWHERE,
  },

  // ── Scene art ───────────────────────────────────────────────────────
  rosterBackdrop: {
    label: "Roster backdrop",
    blurb:
      "Behind every rider on the public Brotherhood grid, and in the popup when a card is opened.",
    surface: "public",
    group: "Scene art",
    legacyField: "rosterBackdropPath",
    // Matches the 3:4 card. Stored at 2x the ~300px the card draws at.
    width: 600,
    height: 800,
    fit: "cover",
    // Centre, not a smart crop: "attention" chases the busiest region, which
    // on clubhouse art is the wall patch — exactly the thing that should sit
    // behind the rider rather than beside them. Predictable beats clever here.
    position: "centre",
    ratioHint: "Portrait, 3:4 (e.g. 900×1200). Anything else is cropped to fit.",
    revalidates: [{ path: "/[orgSlug]", type: "page" }],
  },
  portalRosterBackdrop: {
    label: "Portal roster backdrop",
    blurb: "Behind every rider on the portal Brotherhood wall, inside the login.",
    surface: "portal",
    group: "Scene art",
    legacyField: "portalRosterBackdropPath",
    // Same 3:4 card as the public grid — the two walls draw the same shape.
    width: 600,
    height: 800,
    fit: "cover",
    position: "centre",
    // Ships pointing at the same clubhouse art as the public wall, so the
    // portal cards read as a room from day one. Upload here to diverge.
    ratioHint: "Portrait, 3:4 (e.g. 900×1200). Anything else is cropped to fit.",
    revalidates: [
      { path: "/[orgSlug]/portal", type: "layout" },
      { path: "/[orgSlug]/portal/brotherhood", type: "page" },
    ],
  },
  characterStage: {
    label: "Character stage",
    blurb: "The backdrop behind every member's character screen in the portal.",
    surface: "portal",
    group: "Scene art",
    legacyField: "characterStagePath",
    // The stage renders at 3:2 (see CharacterStage).
    width: 1600,
    height: 1067,
    fit: "cover",
    // The stage art is composed top-heavy (lamps, wall patch), and the
    // component anchors to the top for the same reason.
    position: "top",
    ratioHint: "Landscape, 3:2 (e.g. 1800×1200). Anything else is cropped to fit.",
    revalidates: [
      { path: "/[orgSlug]/portal", type: "layout" },
      { path: "/[orgSlug]/portal/brotherhood/[memberId]", type: "page" },
    ],
  },
  heroImage: {
    label: "Hero poster",
    blurb:
      "The still frame behind the home page headline, shown while the hero clip loads and whenever the gallery is empty.",
    surface: "public",
    group: "Scene art",
    legacyField: "heroImagePath",
    width: 1920,
    height: 820,
    fit: "cover",
    position: "centre",
    ratioHint: "Wide landscape, roughly 21:9 (e.g. 2400×1026).",
    revalidates: [{ path: "/[orgSlug]", type: "page" }],
  },
  plateArt: {
    label: "Chain of command plate",
    blurb:
      "The engraved plate at the head of the portal Brotherhood page. The rings, nameplates and stat bar must be PAINTED INTO the art; the page lays the president, five officers and the headcounts over them at fixed positions.",
    surface: "portal",
    group: "Scene art",
    // The exact window of the plate template the page is measured against
    // (ChainOfCommand's CROP). Stored 1:1 so painted positions stay registered.
    width: 1473,
    height: 695,
    fit: "cover",
    position: "centre",
    ratioHint:
      "Exactly 1473×695, painted to the plate template: one large ring top centre (president), five rings across the lower half, a nameplate under each, and a stat bar along the bottom. Rings with nobody in them yet are labeled as open seats, so the plate is drawn from the day it is uploaded. A club with more than five officers besides the president gets the art-free layout instead, so that nobody drops off the chain of command.",
    revalidates: [{ path: "/[orgSlug]/portal/brotherhood", type: "page" }],
  },
  watermark: {
    label: "Home page watermark",
    blurb:
      "The oversized illustration bleeding off the left of the home page's four pillars. Its size, position and colour are tuned on the Public site tab above.",
    surface: "public",
    group: "Scene art",
    width: 1200,
    height: 1200,
    fit: "contain",
    position: "centre",
    // The home page composites this with mix-blend-mode:lighten, which needs a
    // near-black canvas to disappear into the section behind it.
    ratioHint:
      "Square, on a NEAR-BLACK background (not transparent). It is blended so the dark canvas vanishes and only the bright artwork shows.",
    revalidates: [{ path: "/[orgSlug]", type: "page" }],
  },

  // ── Emblems ─────────────────────────────────────────────────────────
  // The four badges above the home page pillars, reused as a rule between
  // acts on the About page. Numbered rather than named ("skull", "winged")
  // because the next club's four badges are not this club's four badges.
  ...emblemRow("emblemOne", "First emblem"),
  ...emblemRow("emblemTwo", "Second emblem"),
  ...emblemRow("emblemThree", "Third emblem"),
  ...emblemRow("emblemFour", "Fourth emblem"),
};

/** The four emblem slots are identical but for their label and default. */
function emblemRow<K extends string>(key: K, label: string): Record<K, BrandingArtSpec> {
  const spec: BrandingArtSpec = {
    label,
    blurb:
      "One of the four badges above the home page pillars and between the About page acts.",
    surface: "public",
    group: "Emblems",
    width: 320,
    height: 320,
    fit: "contain",
    position: "centre",
    ratioHint: "Square with a transparent background (e.g. 512×512 PNG).",
    revalidates: [
      { path: "/[orgSlug]", type: "page" },
      { path: "/[orgSlug]/about", type: "page" },
    ],
  };
  return { [key]: spec } as Record<K, BrandingArtSpec>;
}

export type BrandingArtKey = BrandingAssetKey;

export const BRANDING_ART_KEYS = Object.keys(BRANDING_ART) as BrandingArtKey[];

/** The editor's section order. Cards are grouped under these headings. */
export const BRANDING_ART_GROUPS = ["Identity", "Scene art", "Emblems"] as const;

/** Which branding docs an upload to this slot has to touch. */
export function surfacesFor(spec: BrandingArtSpec): ("public" | "portal")[] {
  return spec.surface === "both" ? ["public", "portal"] : [spec.surface];
}
