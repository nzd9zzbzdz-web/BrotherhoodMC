import type { Timestamp } from "firebase/firestore";
import type { PlateLayout } from "@/lib/plate-layout";
import type { WatermarkStyle } from "@/lib/watermark";
import type { EmblemStyle } from "@/lib/emblem-style";

// ── Roles & stats ──────────────────────────────────────────────────────

export type SystemRole = "admin" | "officer" | "member";

export const STAT_KEYS = [
  "churchAttendance",
  "clubRuns",
  "clubEvents",
  "communityOutreach",
  "operations",
  "securityDetail",
  "territoryPatrol",
  "territoryDefense",
  "prospectTasks",
  "recruitment",
  "charityEvents",
  "mentoring",
  "specialAssignments",
  // Criminal record — the rows on the character screen. Logged and approved
  // like any other activity, so the panel is always live rather than typed in.
  "crimesCommitted",
  "felonies",
  "heistsCompleted",
  "drugSales",
  "drugsCooked",
  "gunsManufactured",
  "dirtyMoneyEarned",
  "dirtyMoneyCleaned",
  "policeGunnedDown",
  "timesArrested",
  "jailTimeMonths",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export type MemberStats = Partial<Record<StatKey, number>>;

// ── Documents ──────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string; // "Ravens of Death MC"
  publicName: string; // "Ravens of Death Community Foundation"
  slug: string;
  status: "active" | "suspended";
  features: Record<string, boolean>;
  memberCount: number;
  foundedAt: Timestamp | Date;
  createdAt: Timestamp | Date;
}

/**
 * Every swappable image on either surface.
 *
 * The key list lives here rather than beside the catalog in `branding-art.ts`
 * so `Branding.assets` can be typed without this module importing the catalog
 * (which imports Branding right back). The catalog is the rich table — labels,
 * pixel sizes, fallbacks — and declares itself `satisfies
 * Record<BrandingAssetKey, BrandingArtSpec>`, so a key added here without a row
 * there is a build error rather than a silently unswappable image.
 *
 * These ids are also the document ids in `organizations/{orgId}/brandingArt`.
 * The first three predate the catalog: DO NOT rename them, or every club that
 * has already uploaded a backdrop loses it.
 */
export const BRANDING_ASSET_KEYS = [
  "rosterBackdrop",
  "portalRosterBackdrop",
  "characterStage",
  "clubPatch",
  "logo",
  "heroImage",
  "watermark",
  "defaultAvatar",
  "emblemOne",
  "emblemTwo",
  "emblemThree",
  "emblemFour",
  // The engraved Chain of Command plate. Unlike every other slot its shipped
  // default may be EMPTY ("") — a club without a plate gets the stacked panel,
  // not another club's engraving — so readers treat "" as "no plate".
  "plateArt",
] as const;

export type BrandingAssetKey = (typeof BRANDING_ASSET_KEYS)[number];

/**
 * Served URLs for the images an admin has uploaded, written onto the branding
 * doc by `uploadBrandingArt`. A missing key means "still on the shipped
 * default" — resolution is `assets[key] ?? DEFAULT_ASSETS[key]`, which is why
 * a reset DELETES the key rather than blanking it.
 *
 * The URLs live on the branding doc (not looked up from the sibling
 * `brandingArt` collection) so resolving a whole club's imagery still costs
 * the ONE document read every layout already makes. The bytes stay in the
 * sibling collection; only the pointer rides along.
 */
export type BrandingAssets = Partial<Record<BrandingAssetKey, string>>;

export interface BrandingColors {
  // Any valid CSS color string ("#0A0A0B", "rgba(255,255,255,0.08)") —
  // injected as shadcn CSS variable overrides by <BrandStyle>.
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  /**
   * The nav rail's own ground. Absent ⇒ `card`, which is what every org had
   * before the rail was given its own surface, so nothing changes for them.
   * Set it DARKER than `background` to make the rail read as recessed — the
   * page is the lit room, the rail is the wall it's cut into.
   */
  sidebar?: string;
  /** The rail's right edge. Absent ⇒ `border`. */
  sidebarBorder?: string;
  /**
   * The bloom under buttons, the halo on a focused input, the ember wash on a
   * hovered card. Absent ⇒ `primary`, which is what every surface mixed from
   * before this existed. Split out because a club can reasonably want its
   * glow warmer or cooler than the colour it paints buttons with.
   */
  glow?: string;
  /**
   * A surface one step ABOVE `card` — popovers, hovered rows, the raised
   * panels in the character screen. Absent ⇒ `card`.
   */
  elevated?: string;
}

export interface Branding {
  colors: BrandingColors;
  fonts: {
    display: string; // CSS var name from allowlist, e.g. "var(--font-blackletter)"
    body: string;
    mono?: string;
  };
  /**
   * Uploaded imagery, keyed by catalog slot. This is the field to read from
   * (via `resolveBranding`); the five `*Path` fields below it are the
   * pre-catalog spelling, still written on upload so anything not yet moved
   * over keeps working.
   */
  assets?: BrandingAssets;
  logoPath?: string;
  heroImagePath?: string; // full-bleed public hero backdrop
  characterStagePath?: string; // portal: backdrop art for member character screens
  /** public: what stands behind the figures on the Brotherhood cards. */
  rosterBackdropPath?: string;
  /** portal: the same, for the Brotherhood wall behind the login. Its own
   *  field so the club can dress the private wall differently. */
  portalRosterBackdropPath?: string;
  orgDisplayName: string;
  /** The club's initials, for tight spots: "RODMC". Absent ⇒ derived from the
   *  display name's initials, so it is never empty on screen. */
  shortName?: string;
  /** Chapter or territory: "San Andreas". Runs in the footer and on Contact. */
  location?: string;
  /** The line above it: "The Clubhouse, Sandy Shores". Blank hides the line. */
  addressLine?: string;
  tagline?: string;
  mission?: string;
  /**
   * portal: the heading engraved on the Brotherhood page's chain-of-command
   * plate (and on the stacked panel when there is no plate art). Blank falls
   * back to the club preset, so it is never empty on screen.
   */
  chainTitle?: string;
  /** portal: the line under that heading. Empty is a choice and renders nothing. */
  chainBlurb?: string;
  /**
   * portal: where the boxes sit on the chain-of-command plate, when the club
   * has dragged them off the template positions to match its own art. Absent
   * means the template layout, which is what every club had before this field.
   */
  plateLayout?: PlateLayout;
  /**
   * public: where the home page watermark sits and how it glows, when the club
   * has moved it off the shipped treatment. Absent means that treatment
   * (`DEFAULT_WATERMARK_STYLE`), which is what every club had before this
   * field existed.
   */
  watermarkStyle?: WatermarkStyle;
  /**
   * public: how the four emblems read on the home page pillars and the About
   * page rule, when the club has tuned them. Absent means the shipped
   * treatment (`DEFAULT_EMBLEM_STYLE`), which is what every club had before
   * this field existed.
   */
  emblemStyle?: EmblemStyle;
  /**
   * YouTube id for the floating club anthem. Absent ⇒ CLUB_ANTHEM_VIDEO_ID.
   * Branding rather than a constant because the anthem is as much a club's
   * signature as its colours, and the next club's is not this club's.
   */
  anthemVideoId?: string;
  /**
   * public: the club's story on the About page, one entry per paragraph.
   * `mission` stays the short line — it also runs on the home page.
   */
  story?: string[];
  /**
   * public: chapter headings for `story`, matched BY INDEX. Titles only, so
   * the prose has exactly one home. Short entries are fine — a paragraph with
   * no title just renders without an eyebrow. Absent ⇒ CLUB_STORY_TITLES.
   */
  storyTitles?: string[];
  /** public: the closing lines under the story, set in the display face. */
  creed?: string[];
}

export interface Rank {
  id: string;
  name: string;
  order: number; // 1 = President
  isOfficer: boolean;
  tab?: CutPlacementBase & { text: string };
}

/**
 * One entry in a member's club career, written by the member actions when a
 * rank, portal role, or standing changes. Server-written only — rules make the
 * subcollection read-only to clients. The profile composes these with the join
 * date and patch awards to render the full record.
 */
export interface ServiceRecordEntry {
  id: string;
  kind: "promotion" | "removal";
  title: string;
  detail?: string;
  at: Timestamp | Date;
  byUid?: string;
}

export interface ActivityType {
  id: string;
  name: string;
  statKey: StatKey;
  /** Advisory only — the form suggests attaching proof but never blocks on it. */
  requiresProof: boolean;
  allowQuantity: boolean;
  defaultQuantity: number;
  icon: string; // lucide icon name
  active: boolean;
  order: number;
}

export type MemberStatus =
  | "hangaround"
  | "prospect"
  | "patched"
  | "retired"
  | "exiled";

/**
 * One line on the character screen's record panel.
 *
 * @deprecated The Criminal Record is now derived from `stats` via
 * CRIMINAL_RECORD_ROWS, so approved activity logs drive it. Kept so existing
 * hand-authored docs still parse; `scripts/migrate-criminal-record.ts` folds
 * their values into `stats`. Nothing reads this field.
 */
export interface RapSheetEntry {
  label: string; // "Crimes Committed"
  value: string; // "187", "96 mo", "$2.4M" — freeform; pure numbers count up
  danger?: boolean; // render in destructive color
}

/**
 * Where a member's render sits on their character stage. Stored per member
 * because renders differ wildly in crop and framing — the shipped defaults are
 * tuned to the seeded Ravens art and rarely fit someone else's screenshot.
 *
 * All three are percentages of the stage box, not pixels, so a pose holds at
 * any viewport size.
 */
export interface CharacterPose {
  x: number; // left edge, % of stage width
  y: number; // bottom edge, % of stage height
  scale: number; // figure height, % of stage height
}

/**
 * One award pinned to the character stage by its owner. When a member has any
 * of these, the stage shows their arrangement instead of the automatic
 * rarest-four diamond slots. Same unit convention as {@link CharacterPose}:
 * percentages of the stage box, so a layout holds at any viewport size.
 */
export interface StageEmblemPlacement {
  patchId: string;
  x: number; // tile center, % of stage width
  y: number; // tile center, % of stage height
  size: number; // tile width, % of stage width
}

export interface Member {
  id: string;
  uid: string | null;
  displayName: string;
  roadName: string;
  photoPath?: string;
  /** Character-stage placement; falls back to DEFAULT_CHARACTER_POSE. */
  characterPose?: CharacterPose;
  /**
   * Member-arranged emblems on the character stage. Absent ⇒ the automatic
   * rarest-four slots; present (even empty) ⇒ exactly these, where the member
   * put them. Only awards the member has actually earned can be placed —
   * saveCharacterEmblems checks each one against awardedPatches.
   */
  characterEmblems?: StageEmblemPlacement[];
  /** @deprecated Legacy hand-authored rap sheet — see {@link RapSheetEntry}. */
  rapSheet?: RapSheetEntry[];
  /** Character-screen status line, e.g. "At Large", "Incarcerated". */
  rapStatus?: string;
  /**
   * In-character blurb shown on the PUBLIC site when this member is opened
   * from the home page roster, and on their portal profile.
   *
   * Written by the member themselves (`saveMemberBio`) or by an admin — it is
   * the only member-authored prose the outside world ever sees, so self-edits
   * are tagged `member.bio.self` in the audit log for officers to spot.
   */
  bio?: string;
  /**
   * Overrides the computed tenure caption on the PUBLIC Brotherhood card
   * ("New to the colors", "3 years riding"). Club-authored, admin-only: it is
   * the club's word on someone's standing, so "Founding member" or "Prez" is
   * the org's call to make, not the member's. Empty/absent ⇒ computed tenure.
   */
  publicLabel?: string;
  rankId: string;
  status: MemberStatus;
  joinDate: Timestamp | Date;
  sponsorMemberId?: string;
  memberNumber: number;
  stats: MemberStats;
  patchCount: number;
  lastActivityAt?: Timestamp | Date;
  /** Stamped by treasury approval when a dues payment lands, so the Dues Roll
   *  reads off the member list instead of querying the ledger per member. */
  lastDuesPaidAt?: Timestamp | Date;
  createdAt: Timestamp | Date;
}

export type ActivityStatus = "pending" | "approved" | "denied";

/** One activity type on a ticket. statKey/quantity denormalized at submit time. */
export interface ActivityEntry {
  typeId: string;
  statKey: StatKey;
  quantity: number;
}

export interface Activity {
  id: string;
  memberId: string;
  /** Multi-type tickets. Docs from before multi-select carry the three legacy
   *  top-level fields instead — read via activityEntries(), never directly. */
  entries?: ActivityEntry[];
  typeId?: string;
  statKey?: StatKey;
  quantity?: number;
  date: Timestamp | Date;
  description: string;
  proofPath?: string;
  witnesses: string[]; // memberIds
  status: ActivityStatus;
  reviewedBy?: string;
  reviewedAt?: Timestamp | Date;
  reviewNote?: string;
  createdAt: Timestamp | Date;
}

// ── Treasury: the club bank ────────────────────────────────────────────

/** Dues and deposits pay IN; withdrawals pay OUT. */
export type TreasuryTxKind = "dues" | "deposit" | "withdrawal";

/**
 * Which set of books a movement lands on. The club keeps two: money it can
 * account for and money it cannot. Every movement names one, the two balances
 * never mix, and a withdrawal is covered by ITS OWN book or it is refused.
 *
 * Absent on a stored row means clean: everything filed before the books split
 * moved the one balance the bank had, and that balance became the clean book.
 * See bookOf in treasury-core, which is the only place that default is spelled.
 */
export type TreasuryBook = "clean" | "dirty";

/**
 * One money movement, pending until a reviewer rules on it. Same lifecycle as
 * an activity ticket on purpose (anyone files, review applies it), but the
 * review gate is narrower: portal admins and the member holding the Treasurer
 * rank, not every officer — see canReviewTreasury in treasury-core.
 */
export interface TreasuryTransaction {
  id: string;
  kind: TreasuryTxKind;
  /** Whole dollars, always positive; `kind` carries the direction. */
  amount: number;
  /** Which book it lands on. Optional because rows filed before the split
   *  carry no field; read it through bookOf, never directly. */
  book?: TreasuryBook;
  /** Whose money movement this is — for dues, the member whose dues are paid. */
  memberId: string;
  /** Who actually filed it. Differs from memberId when a reviewer logs cash
   *  handed over in person. */
  submittedByUid: string;
  note: string;
  status: ActivityStatus;
  createdAt: Timestamp | Date;
  reviewedBy?: string;
  reviewedAt?: Timestamp | Date;
  reviewNote?: string;
  /** THIS ROW'S BOOK after the transaction applied — not the club's total.
   *  Approved rows only; it makes the ledger read like a bank statement, one
   *  running column per book. */
  balanceAfter?: number;
}

/**
 * organizations/{orgId}/treasury/account — the running balance of each book.
 * Missing doc means the club has never moved money: both zero.
 */
export interface TreasuryAccount {
  /** Money the club can account for. */
  clean: number;
  /** Money it cannot. */
  dirty: number;
  /**
   * DEAD FIELD. The single balance the bank ran on before it kept two books,
   * left in place so the split stays reversible. It is read exactly once, as
   * the opening clean figure when `clean` is absent (accountBooks in
   * treasury-core), and nothing writes it any more.
   */
  balance?: number;
  updatedAt: Timestamp | Date;
}

/** Both books and their sum, the shape every balance surface renders. */
export interface TreasuryBalances {
  clean: number;
  dirty: number;
  total: number;
}

export type PatchCategory =
  | "activity"
  | "service"
  | "leadership"
  | "recognition"
  | "legendary";

export interface PatchRequirement {
  statKey: StatKey;
  threshold: number;
}

/** Presentation weight — drives glow/border/sort on the cut. Distinct from category. */
export type Rarity = "common" | "rare" | "epic" | "legendary";

export interface Patch {
  id: string;
  name: string;
  category: PatchCategory;
  description: string;
  imagePath?: string;
  tier: number;
  rarity?: Rarity; // Digital Cut: visual weight. Backfilled from tier for legacy patches.
  defaultSlot?: string; // Digital Cut: named slot on the vest (resolves to u/v via VestConfig).
  requirement: PatchRequirement | null; // null ⇒ manual-only
  manual: boolean;
  active: boolean;
  /**
   * Achievement emblem, not a patch worn on the cut. Emblems are earned the
   * same way (threshold on a stat, awarded by the engine) and show in the
   * Patches tab on a member's profile, but the cut never places them —
   * criminal-record ladders would bury the vest fifty-five deep.
   * Absent ⇒ false, so every patch that predates emblems is still worn.
   */
  emblem?: boolean;
  defaultPlacement: CutPlacementBase; // legacy direct u/v; kept as fallback when no slot resolves
}

export interface AwardedPatch {
  id: string; // `${memberId}_${patchId}` — composite ⇒ idempotent
  memberId: string;
  patchId: string;
  awardedAt: Timestamp | Date;
  awardedBy: "system" | string; // uid for manual awards
  reason?: string;
  activityId?: string;
}

// ── Digital cut (3D-ready now, rendered 2D until M8) ──────────────────

export type CutSurface = "front" | "back";

export interface CutPlacementBase {
  surface: CutSurface;
  u: number; // 0..1 across the vest
  v: number; // 0..1 top→bottom
  scale: number;
  rotationDeg: number;
}

export interface CutPlacement extends CutPlacementBase {
  kind: "patch" | "rankTab" | "officerTab";
  refId: string; // patchId or rankId
  zIndex: number;
  mirrored: boolean;
}

export interface CutLayout {
  surfaces: {
    front: CutPlacement[];
    back: CutPlacement[];
  };
  updatedAt: Timestamp | Date;
}

// ── Digital Cut config (M8) — org-authored vest, slots, and rank visuals ───

/**
 * A named anchor on a vest surface. Slot names double as future 3D attachment
 * points (leftChest, upperBack, …), so position is stored as normalized u/v —
 * never pixels — to survive resolution changes and the 2D→3D migration.
 */
export interface PatchSlot {
  slot: string; // e.g. "LEFT_CHEST" — semantic, stable, org-defined
  u: number; // 0..1 across the surface
  v: number; // 0..1 top→bottom
  maxScale: number; // caps patch render size in this slot
  accepts: PatchCategory[]; // which categories may land here (designer/validation guard)
  capacity: number; // patches before overflow-nudging kicks in
}

/** One vest surface for an org: the base art plus its slot map. Doc id = surface. */
export interface VestConfig {
  surface: CutSurface; // "front" | "back"
  imagePath: string | null; // Storage path; null ⇒ renderer draws a schematic placeholder
  aspectRatio: number; // w/h — the render stage locks to this so u/v stays true
  slots: PatchSlot[]; // embedded: small, always read with the surface
  model3d?: { gltfPath: string; anchors: Record<string, string> } | null; // Phase 3 only
}

/** What a rank puts on the cut, independent of earned patches. */
export type GrantKind =
  | "topRocker"
  | "bottomRocker"
  | "centerPatch"
  | "rankTab"
  | "prospectTab"
  | "saaDiamond";

export interface Grant {
  kind: GrantKind;
  surface: CutSurface;
  u: number;
  v: number;
  scale: number;
  text?: string; // stand-in until org uploads art
  assetPath?: string; // Storage path for the tab/rocker artwork
}

/** Rank → cut visuals. Doc id = rankId. Config, not code: each org defines its own. */
export interface RankVisual {
  showsColors: boolean; // Hangaround = false (bare vest); Patched+ = true
  grants: Grant[];
}

/**
 * The renderer-agnostic output of buildRenderModel(). A plain, serializable
 * object with no coordinate assumptions beyond "u/v + surface". The 2D DOM
 * renderer consumes it today; the 3D R3F renderer will consume the same shape.
 */
export interface ResolvedPlacement {
  key: string; // "patch:road-warrior" | "rank:topRocker" — stable react key
  type: "patch" | GrantKind;
  surface: CutSurface;
  u: number;
  v: number;
  scale: number;
  z: number;
  label: string; // patch name or rocker/tab text
  art: string | null; // Storage image path if any; null ⇒ styled placeholder
  rarity?: Rarity;
  category?: PatchCategory;
  // Inspection metadata (patches only)
  patchId?: string;
  description?: string;
  awardedAt?: string | null; // ISO string
  awardedBy?: string | null;
  reason?: string | null;
}

export interface CutRenderModel {
  front: ResolvedPlacement[];
  back: ResolvedPlacement[];
}

// ── Prospects, gallery ────────────────────────────────────────────────

export interface ProspectRequirement {
  key: string;
  label: string;
  statKey: StatKey | null; // null ⇒ manual progress
  target: number;
  manualProgress: number | null;
}

export interface ProspectProfile {
  id: string; // memberId
  startDate: Timestamp | Date;
  sponsorMemberId?: string;
  targetPatchDate?: Timestamp | Date;
  requirements: ProspectRequirement[];
  /** `vote_pending` records that the club is deciding, wherever it votes.
   *  There is no in-portal ballot: it is a status an officer sets by hand. */
  status: "active" | "vote_pending" | "patched" | "dropped";
}

/**
 * A club photo. METADATA ONLY — the image itself is a webp data URL in the
 * sibling `galleryArt/{photoId}` collection, same split (and same reason) as
 * patches/patchArt: a wall of two hundred photos must be listable without
 * dragging two hundred base64 blobs into one page read.
 *
 * `storagePath` is gone with the Storage bucket this project never provisioned.
 */
export interface GalleryPhoto {
  id: string;
  uploadedByMemberId: string;
  caption?: string;
  /** Rejection DELETES the photo (see `reviewGalleryPhoto`), so there is no
   *  "rejected" state to read back — same call as a rejected character render. */
  status: "pending" | "approved";
  /** Approved puts a photo on the CLUB's wall. Public is a second, deliberate
   *  step: the shopfront is a charity foundation and the portal is an outlaw
   *  MC, so clearing a shot for the brothers must not clear it for visitors. */
  visibility: "portal" | "public";
  /** Intrinsic pixels of the STORED image, measured once at upload — the
   *  masonry gets its aspect ratios without anyone reading the bytes back. */
  width: number;
  height: number;
  /** Tiny inlined WebP for next/image `placeholder="blur"`. */
  blurDataURL: string;
  /** Stored webp size — what the 1MB document ceiling is actually spent on. */
  bytes: number;
  reviewedBy?: string;
  reviewedAt?: Timestamp | Date;
  /** Bumped whenever the art is written. Lives on the METADATA doc so the
   *  `?v=` that makes an image URL immutable comes free with the list read —
   *  patch art needs a second query (`listPatchArtVersions`) for the same. */
  updatedAt: Timestamp | Date;
  createdAt: Timestamp | Date;
}

// ── Club Map (tactical territory map) ─────────────────────────────────
// Coordinates are normalized u/v (0..1, u left→right, v top→bottom) against
// the map image surface — the same convention as cut layouts. Never pixels.

export interface MapPoint {
  u: number; // 0..1 across the map
  v: number; // 0..1 top→bottom
}

export interface MapMarker extends MapPoint {
  id: string;
  label: string;
  style: string; // pin-style key from MAP_PIN_STYLES
  description?: string;
  createdByMemberId: string | null; // null ⇒ super admin without a member record
  createdAt: Timestamp | Date;
  updatedAt: Timestamp | Date;
}

export interface MapTerritory {
  id: string;
  crewName: string; // free text — "Ravens of Death", "Lost MC", …
  label?: string; // optional zone nickname ("North docks turf")
  color: string | null; // hex override; null ⇒ autoCrewColor(crewName)
  points: MapPoint[]; // polygon vertices, min 3
  createdByMemberId: string | null;
  createdAt: Timestamp | Date;
  updatedAt: Timestamp | Date;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  action: string; // 'activity.approve' | 'patch.award' | 'member.promote' | ...
  targetPath: string;
  detail?: string;
  at: Timestamp | Date;
}

export interface Invite {
  id: string;
  email: string;
  memberId: string;
  role: SystemRole;
  token: string;
  expiresAt: Timestamp | Date;
  usedAt?: Timestamp | Date;
}

// Open recruitment: a public applicant awaiting officer review. Keyed by the
// applicant's uid (one live application per account). Grants no access until
// approved — approval creates the Member + membership.
export interface Application {
  id: string; // == applicant uid
  roadName: string;
  handle: string; // Discord/in-game handle
  email: string;
  message?: string;
  status: "pending" | "approved" | "rejected";
  memberId?: string; // set on approval
  role?: SystemRole; // granted role, set on approval
  reviewedBy?: string;
  reviewedAt?: Timestamp | Date;
  reviewNote?: string;
  createdAt: Timestamp | Date;
}

// ── Root collections ───────────────────────────────────────────────────

export interface UserMembership {
  memberId: string;
  role: SystemRole;
}

export interface UserDoc {
  email: string;
  displayName: string;
  photoURL?: string;
  superAdmin?: boolean; // mirror; custom claims are authoritative
  memberships: Record<string, UserMembership>; // keyed by orgId
  /**
   * Discord account linked to this portal account, written only by the bot's
   * /link code redemption (src/lib/discord/link.ts). Account-level like
   * memberships, so one link serves every org the account belongs to. The id
   * is Discord's permanent snowflake; the username is a display copy taken at
   * link time and may go stale.
   */
  discordId?: string;
  discordUsername?: string;
  createdAt: Timestamp | Date;
}

/**
 * A pending Discord link handshake: minted by createDiscordLinkCode (the
 * signed-in website side), redeemed by /link in Discord (the signed
 * interaction side). Doc id IS the code. Root collection `discordLinkCodes`,
 * server-only in rules like invites.
 */
export interface DiscordLinkCode {
  uid: string;
  orgId: string; // where the code was minted; used for the audit log entry
  expiresAt: Timestamp | Date;
  createdAt: Timestamp | Date;
}

// Custom-claims shape (kept tiny — 1000 byte limit):
// { superAdmin?: true, orgs: { [orgId]: { r: SystemRole, m: memberId } } }
export interface OrgClaims {
  r: SystemRole;
  m: string;
}
export interface SessionClaims {
  superAdmin?: boolean;
  orgs?: Record<string, OrgClaims>;
}
