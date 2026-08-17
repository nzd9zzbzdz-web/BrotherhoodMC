import { CHARACTER_SILHOUETTE_FILE } from "./branding-defaults";
import type { CharacterPose, StatKey, TreasuryBook } from "./types";

// Slugs that can never be org slugs (static route segments win in App Router,
// but we validate at org creation too).
export const RESERVED_SLUGS = ["admin", "api", "login", "_next", "favicon.ico"];

export const SESSION_COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME ?? "__session";

export const SESSION_EXPIRES_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

// The six spec-highlighted stats shown on member profiles (others still tracked).
export const PROFILE_STAT_ORDER: { key: StatKey; label: string }[] = [
  { key: "churchAttendance", label: "Church Attendance" },
  { key: "clubRuns", label: "Club Runs" },
  { key: "operations", label: "Operations" },
  { key: "territoryDefense", label: "Territory Defense" },
  { key: "recruitment", label: "Recruitment" },
  { key: "specialAssignments", label: "Special Assignments" },
];

/**
 * The character screen's Criminal Record, in display order. Every row reads a
 * stat that members log and officers approve, so the panel moves on its own —
 * `format` turns the raw count into the row's display string.
 */
export const CRIMINAL_RECORD_ROWS: {
  label: string;
  statKey: StatKey;
  danger?: boolean;
  format?: (n: number) => string;
}[] = [
  { label: "Crimes Committed", statKey: "crimesCommitted" },
  { label: "Felonies", statKey: "felonies", danger: true },
  { label: "Heists Completed", statKey: "heistsCompleted" },
  { label: "Drug Sales", statKey: "drugSales" },
  { label: "Drugs Cooked", statKey: "drugsCooked" },
  { label: "Guns Manufactured", statKey: "gunsManufactured" },
  { label: "Dirty Money Earned", statKey: "dirtyMoneyEarned", format: formatDirtyMoney },
  { label: "Dirty Money Cleaned", statKey: "dirtyMoneyCleaned", format: formatDirtyMoney },
  { label: "Police Gunned Down", statKey: "policeGunnedDown", danger: true },
  { label: "Times Arrested", statKey: "timesArrested" },
  { label: "Jail Time Served", statKey: "jailTimeMonths", format: (n) => `${n} mo` },
];

/**
 * Upper bound on a single activity's quantity. Generous because quantity now
 * carries raw amounts, not counts — dollars of dirty money, months served — so
 * the old cap of 50 rejected any realistic cash log. Abuse is gated by officer
 * approval and the 20-submissions-per-day limit, not by this number.
 */
export const MAX_ACTIVITY_QUANTITY = 10_000_000;

/**
 * Ceiling on a hand-corrected stat. Stats accumulate across a whole career, so
 * this sits well above any single ticket's quantity; it exists to catch a
 * fat-fingered paste, not to bound a real record.
 */
export const MAX_STAT_VALUE = 1_000_000_000;

/**
 * Ceiling on one treasury transaction. Same reasoning as MAX_STAT_VALUE: it
 * exists to catch a pasted extra zero, not to bound a real club's money.
 */
export const MAX_TREASURY_AMOUNT = 1_000_000_000;

/**
 * Exact dollars for the club bank: $12,500, never $12.5K. The compact
 * formatDirtyMoney below is for stat panels where space wins; a ledger is the
 * one place the club expects to see every digit.
 */
export function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

/** The two books, in the order every picker, panel and ledger lists them. */
export const TREASURY_BOOKS: readonly TreasuryBook[] = ["clean", "dirty"];

/** One word each, used on every surface so the club learns one vocabulary. */
export const TREASURY_BOOK_LABEL: Record<TreasuryBook, string> = {
  clean: "Clean",
  dirty: "Dirty",
};

/** What each book is for, on the surfaces that have room to say it. */
export const TREASURY_BOOK_BLURB: Record<TreasuryBook, string> = {
  clean: "Money the club can account for",
  dirty: "Money the club cannot account for",
};

/**
 * The Treasurer seat's rank doc id (rankDocId("Treasurer")), spelled out as a
 * constant because treasury review keys on it. Club rank is deliberately not a
 * portal permission ANYWHERE ELSE — this is the one carve-out, made because
 * the club's book-keeper is a rank, not a portal role, and it gates only the
 * treasury's approve/deny. See canReviewTreasury in treasury-core.
 */
export const TREASURER_RANK_ID = "treasurer";

/** $0 · $12.5K · $2.4M — keeps six figures from blowing out the panel. */
export function formatDirtyMoney(n: number): string {
  if (n >= 1_000_000) return `$${trimZero(n / 1_000_000)}M`;
  if (n >= 1_000) return `$${trimZero(n / 1_000)}K`;
  return `$${n.toLocaleString("en-US")}`;
}

function trimZero(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/**
 * The SHIPPED silhouette file, used as a SENTINEL rather than as a fallback.
 *
 * The seeder writes this exact path into `member.photoPath` for anyone with no
 * art, so `photoPath !== CHARACTER_SILHOUETTE` is how the roster asks "does
 * this member actually have a render?". That question is about the shipped
 * file specifically, so it must NOT follow a club's uploaded default avatar.
 *
 * What to DRAW when someone has no render is `branding.assets.defaultAvatar`,
 * which does follow the upload. The two coincide until a club uploads its own,
 * and conflating them is why the distinction is spelled out here.
 */
export const CHARACTER_SILHOUETTE = CHARACTER_SILHOUETTE_FILE;

/**
 * Where the figure stands when nobody has adjusted it. Matches the spotlight in
 * the seeded stage art; officers can drag per member from the character screen.
 */
export const DEFAULT_CHARACTER_POSE: CharacterPose = { x: 3.5, y: 12, scale: 66 };

/** Editing bounds — generous enough to reframe an odd crop, short of losing it. */
export const CHARACTER_POSE_LIMITS = {
  x: { min: -30, max: 95 },
  y: { min: -25, max: 70 },
  scale: { min: 15, max: 130 },
} as const;

/**
 * Bounds for member-arranged stage emblems. x/y are the tile CENTER, so 0..100
 * keeps at least half of every tile on the stage; size tops out well short of
 * the artwork's focal areas so an emblem can't become a second backdrop. The
 * count cap keeps a save to one small doc write plus one award check per tile.
 */
export const CHARACTER_EMBLEM_LIMITS = {
  x: { min: 0, max: 100 },
  y: { min: 0, max: 100 },
  size: { min: 2, max: 25 },
  count: 12,
} as const;

/** Starting tile width for a newly placed emblem, % of stage width. */
export const DEFAULT_CHARACTER_EMBLEM_SIZE = 6;

export const STAT_LABELS: Record<StatKey, string> = {
  churchAttendance: "Church Attendance",
  clubRuns: "Club Runs",
  clubEvents: "Club Events",
  communityOutreach: "Community Outreach",
  operations: "Operations",
  securityDetail: "Security Details",
  territoryPatrol: "Territory Patrols",
  territoryDefense: "Territory Defense",
  prospectTasks: "Prospect Tasks",
  recruitment: "Recruitment",
  charityEvents: "Charity Events",
  mentoring: "Mentoring",
  specialAssignments: "Special Assignments",
  crimesCommitted: "Crimes Committed",
  felonies: "Felonies",
  heistsCompleted: "Heists Completed",
  drugSales: "Drug Sales",
  drugsCooked: "Drugs Cooked",
  gunsManufactured: "Guns Manufactured",
  dirtyMoneyEarned: "Dirty Money Earned",
  dirtyMoneyCleaned: "Dirty Money Cleaned",
  policeGunnedDown: "Police Gunned Down",
  timesArrested: "Times Arrested",
  jailTimeMonths: "Jail Time Served",
};

// Default club ranks (org-configurable; seeded per org).
// tab u/v are normalized cut coordinates (front surface).
// `isOfficer` is the CLUB chain of command — it drives roster tiering and cut
// visuals only. Portal permissions live on the role claim, not here.
export const DEFAULT_RANKS = [
  { name: "President", order: 1, isOfficer: true },
  { name: "Vice President", order: 2, isOfficer: true },
  { name: "Sergeant-at-Arms", order: 3, isOfficer: true },
  { name: "Road Captain", order: 4, isOfficer: true },
  { name: "Secretary", order: 5, isOfficer: true },
  { name: "Treasurer", order: 6, isOfficer: true },
  { name: "Head Enforcer", order: 7, isOfficer: true },
  // Titled members: they wear a tab but sit outside the officer table.
  { name: "Enforcer", order: 8, isOfficer: false },
  { name: "Chaplain", order: 9, isOfficer: false },
  { name: "Patched Member", order: 10, isOfficer: false },
  { name: "Prospect", order: 11, isOfficer: false },
  { name: "Hangaround", order: 12, isOfficer: false },
] as const;

/**
 * Rank doc id from its name — "Head Enforcer" → "head-enforcer". Seeds, the
 * bootstrap and the admin sync all derive ids this way, so the same rank is the
 * same doc in every org (and a re-sync updates rather than duplicates).
 */
export function rankDocId(name: string): string {
  return name.toLowerCase().replace(/[^a-z]+/g, "-");
}

// Club activity types. The original spec shipped 13 of these; the rest were
// retired in favour of the criminal record set below (see
// RETIRED_ACTIVITY_TYPE_IDS) — their stat keys stay in STAT_KEYS so historical
// values and already-earned patches still resolve.
export const ACTIVITY_TYPE_SEEDS: {
  name: string;
  statKey: StatKey;
  requiresProof: boolean;
  allowQuantity: boolean;
  icon: string;
}[] = [
  { name: "Club Ride", statKey: "clubRuns", requiresProof: true, allowQuantity: false, icon: "bike" },
  { name: "Mandatory Church Attendance", statKey: "churchAttendance", requiresProof: false, allowQuantity: false, icon: "landmark" },
];

/**
 * Club types that shipped once and are no longer offered. The sync action
 * deactivates these rather than deleting them: past submissions reference the
 * type id, so the review queue and a member's history still need to resolve a
 * name. Deactivating just hides them from the submit dropdown.
 */
/**
 * Patches whose requirement stat is no longer loggable. Retiring rather than
 * deleting keeps them on the cut of anyone who already earned one — the award
 * doc and the patch name still resolve; they just stop being awarded again.
 */
export const RETIRED_PATCH_IDS = [
  "ghost-rider",
  "guardian",
  "night-watchman",
  "territory-defender",
  "community-pillar",
  "giving-soul",
  "mentor",
  "shot-caller",
];

/**
 * Criminal-record emblem ladders — one per row of CRIMINAL_RECORD_ROWS, five
 * tiers each. Every tier is driven by a stat members log and officers approve,
 * so the whole ladder moves on the existing pipeline; the patch engine already
 * awards every threshold crossed in a single pass, so jumping several tiers at
 * once works without special-casing.
 *
 * These are EMBLEMS, not patches: earned like a patch, shown as a levelled
 * ladder on the member's profile, never placed on the cut. Fifty-five of them
 * would bury a vest, and levelling up an emblem is a different feeling from
 * being handed a patch — so `emblem: true` on every seed below, and no cut
 * coordinates to invent.
 *
 * `legacy: true` marks the eight that shipped before the ladders existed. Their
 * ids are load-bearing — awards reference them, so a rename or a delete would
 * orphan somebody's record — but their thresholds are not: lowering a threshold
 * never revokes an award, it only makes the rung easier for the next member.
 *
 * Thresholds are tuned to the club's actual pace and are expected to be
 * retuned. Changing one does NOT retroactively award anybody: the engine only
 * evaluates on activity approval. Run Admin → Patches → "Backfill awards" after
 * any change, or members sit below a rung they already cleared.
 */
export const PATCH_LADDERS: {
  statKey: StatKey;
  tiers: {
    id: string;
    name: string;
    description: string;
    threshold: number;
    category?: "activity" | "service" | "leadership" | "recognition" | "legendary";
    rarity?: "common" | "rare" | "epic" | "legendary";
    legacy?: true;
  }[];
}[] = [
  {
    statKey: "crimesCommitted",
    tiers: [
      { id: "petty-thief", name: "Petty Thief", description: "Commit 10 crimes.", threshold: 10 },
      { id: "troublemaker", name: "Troublemaker", description: "Commit 50 crimes.", threshold: 50 },
      { id: "menace", name: "Menace", description: "Commit 150 crimes.", threshold: 150 },
      { id: "crime-wave", name: "Crime Wave", description: "Commit 500 crimes.", threshold: 500 },
      { id: "one-man-riot", name: "One-Man Riot", description: "Commit 1,500 crimes.", threshold: 1_500 },
    ],
  },
  {
    statKey: "felonies",
    tiers: [
      { id: "convicted", name: "Convicted", description: "Commit 5 felonies.", threshold: 5 },
      { id: "repeat-offender", name: "Repeat Offender", description: "Commit 25 felonies.", threshold: 25 },
      { id: "career-criminal", name: "Career Criminal", description: "Commit 60 felonies.", threshold: 60 },
      { id: "most-wanted", name: "Most Wanted", description: "Commit 100 felonies.", threshold: 100, category: "legendary", rarity: "legendary", legacy: true },
      { id: "public-enemy", name: "Public Enemy", description: "Commit 250 felonies.", threshold: 250 },
    ],
  },
  {
    statKey: "heistsCompleted",
    tiers: [
      { id: "first-job", name: "First Job", description: "Pull 3 heists.", threshold: 3 },
      { id: "made-man", name: "Made Man", description: "Pull 10 heists.", threshold: 10, rarity: "epic", legacy: true },
      { id: "heavy-hitter", name: "Heavy Hitter", description: "Pull 25 heists.", threshold: 25 },
      { id: "mastermind", name: "Mastermind", description: "Pull 60 heists.", threshold: 60 },
      { id: "the-score", name: "The Score", description: "Pull 150 heists.", threshold: 150 },
    ],
  },
  {
    statKey: "drugSales",
    tiers: [
      { id: "corner-boy", name: "Corner Boy", description: "Move 100 drug sales.", threshold: 100, legacy: true },
      { id: "slinger", name: "Slinger", description: "Move 500 drug sales.", threshold: 500 },
      { id: "dealer", name: "Dealer", description: "Move 1,000 drug sales.", threshold: 1_000 },
      { id: "distributor", name: "Distributor", description: "Move 5,000 drug sales.", threshold: 5_000 },
      { id: "kingpin", name: "Kingpin", description: "Move 10,000 drug sales.", threshold: 10_000 },
    ],
  },
  {
    statKey: "drugsCooked",
    tiers: [
      { id: "line-cook", name: "Line Cook", description: "Cook 100 batches.", threshold: 100 },
      { id: "the-cook", name: "The Cook", description: "Cook 500 batches.", threshold: 500, legacy: true },
      { id: "chemist", name: "Chemist", description: "Cook 1,000 batches.", threshold: 1_000 },
      { id: "master-chemist", name: "Master Chemist", description: "Cook 5,000 batches.", threshold: 5_000 },
      { id: "cartel-chemist", name: "Cartel Chemist", description: "Cook 10,000 batches.", threshold: 10_000 },
    ],
  },
  {
    statKey: "gunsManufactured",
    tiers: [
      { id: "tinkerer", name: "Tinkerer", description: "Manufacture 10 guns.", threshold: 10 },
      { id: "gunsmith", name: "Gunsmith", description: "Manufacture 50 guns.", threshold: 50, legacy: true },
      { id: "armorer", name: "Armorer", description: "Manufacture 100 guns.", threshold: 100 },
      { id: "arms-dealer", name: "Arms Dealer", description: "Manufacture 500 guns.", threshold: 500 },
      { id: "merchant-of-death", name: "Merchant of Death", description: "Manufacture 1,000 guns.", threshold: 1_000 },
    ],
  },
  {
    statKey: "dirtyMoneyEarned",
    tiers: [
      { id: "hustler", name: "Hustler", description: "Earn $50K in dirty money.", threshold: 50_000, category: "service" },
      { id: "earner", name: "Earner", description: "Earn $250K in dirty money.", threshold: 250_000, category: "service", legacy: true },
      { id: "big-earner", name: "Big Earner", description: "Earn $1M in dirty money.", threshold: 1_000_000, category: "service" },
      { id: "rainmaker", name: "Rainmaker", description: "Earn $5M in dirty money.", threshold: 5_000_000, category: "service" },
      { id: "untouchable", name: "Untouchable", description: "Earn $10M in dirty money.", threshold: 10_000_000, category: "service" },
    ],
  },
  {
    statKey: "dirtyMoneyCleaned",
    tiers: [
      { id: "cash-wash", name: "Cash Wash", description: "Wash $25K through the books.", threshold: 25_000, category: "service" },
      { id: "bookkeeper", name: "Bookkeeper", description: "Wash $100K through the books.", threshold: 100_000, category: "service" },
      { id: "the-launderer", name: "The Launderer", description: "Wash $500K through the books.", threshold: 500_000, category: "service", legacy: true },
      { id: "front-man", name: "Front Man", description: "Wash $2.5M through the books.", threshold: 2_500_000, category: "service" },
      { id: "clean-hands", name: "Clean Hands", description: "Wash $5M through the books.", threshold: 5_000_000, category: "service" },
    ],
  },
  {
    statKey: "policeGunnedDown",
    tiers: [
      { id: "shots-fired", name: "Shots Fired", description: "Put down 5 police.", threshold: 5 },
      { id: "badge-hunter", name: "Badge Hunter", description: "Put down 25 police.", threshold: 25 },
      { id: "blue-streak", name: "Blue Streak", description: "Put down 50 police.", threshold: 50 },
      { id: "no-quarter", name: "No Quarter", description: "Put down 150 police.", threshold: 150 },
      { id: "ghost-of-the-precinct", name: "Ghost of the Precinct", description: "Put down 300 police.", threshold: 300 },
    ],
  },
  {
    statKey: "timesArrested",
    tiers: [
      { id: "booked", name: "Booked", description: "Get arrested 5 times.", threshold: 5 },
      { id: "frequent-flyer", name: "Frequent Flyer", description: "Get arrested 15 times.", threshold: 15 },
      { id: "revolving-door", name: "Revolving Door", description: "Get arrested 30 times.", threshold: 30 },
      { id: "known-to-police", name: "Known to Police", description: "Get arrested 75 times.", threshold: 75 },
      { id: "never-talks", name: "Never Talks", description: "Get arrested 150 times and give them nothing.", threshold: 150 },
    ],
  },
  {
    statKey: "jailTimeMonths",
    tiers: [
      // Names re-cut for the scale: this ladder starts at 300 months, so the
      // old "Held Overnight" / "Done a Bit" read as jokes against 25 and 83
      // years. Ids are unchanged — awards point at them.
      { id: "held-overnight", name: "Did a Stretch", description: "Serve 300 months inside.", threshold: 300, category: "leadership" },
      { id: "done-a-bit", name: "Hard Time", description: "Serve 1,000 months inside.", threshold: 1_000, category: "leadership" },
      { id: "hardened", name: "Hardened", description: "Serve 2,000 months inside and come back.", threshold: 2_000, category: "leadership", legacy: true },
      { id: "lifer", name: "Lifer", description: "Serve 5,000 months inside.", threshold: 5_000, category: "leadership" },
      { id: "institutionalized", name: "Institutionalized", description: "Serve 10,000 months inside.", threshold: 10_000, category: "leadership" },
    ],
  },
];

/**
 * Placement stored on an emblem seed. Inert: the engine never places an emblem
 * on a cut, and the seeder skips them too. It exists only because `Patch`
 * requires a `defaultPlacement`, and one obviously-neutral value beats
 * scattering invented coordinates that read as if they mean something.
 */
const EMBLEM_PLACEMENT = {
  surface: "front" as const,
  u: 0.5,
  v: 0.5,
  scale: 0.8,
  rotationDeg: 0,
};

/**
 * The ladders flattened into patch seeds — what the seeder writes and what
 * Admin → Activity Types installs into an org that predates a tier. Derived
 * rather than hand-listed so a ladder edit can't drift from what gets seeded.
 */
export const CRIMINAL_PATCH_SEEDS: {
  id: string;
  name: string;
  category: "activity" | "service" | "leadership" | "recognition" | "legendary";
  description: string;
  tier: number;
  rarity: "common" | "rare" | "epic" | "legendary";
  requirement: { statKey: StatKey; threshold: number };
  emblem: true;
  surface: "front" | "back";
  u: number;
  v: number;
}[] = PATCH_LADDERS.flatMap((ladder) =>
  ladder.tiers.map((t, i) => ({
    id: t.id,
    name: t.name,
    category: t.category ?? ("activity" as const),
    description: t.description,
    tier: i + 1,
    // Same tier→rarity scale the cut renderer uses (tierToRarity): tiers IV and
    // V both read legendary. A tier that shipped with its own rarity keeps it.
    rarity:
      t.rarity ??
      ((i + 1 >= 4 ? "legendary" : i + 1 === 3 ? "epic" : i + 1 === 2 ? "rare" : "common") as
        | "common"
        | "rare"
        | "epic"
        | "legendary"),
    requirement: { statKey: ladder.statKey, threshold: t.threshold },
    emblem: true as const,
    surface: EMBLEM_PLACEMENT.surface,
    u: EMBLEM_PLACEMENT.u,
    v: EMBLEM_PLACEMENT.v,
  })),
);

export const RETIRED_ACTIVITY_TYPE_IDS = [
  "club-event",
  "community-outreach",
  "operation-participation",
  "security-detail",
  "territory-patrol",
  "territory-defense",
  "prospect-task",
  "recruitment",
  "charity-event",
  "mentoring",
  "special-assignment",
];

/**
 * Criminal record activities — these drive CRIMINAL_RECORD_ROWS on the
 * character screen. Quantity-bearing ones take the raw amount (months served,
 * dollars earned) rather than a count of submissions.
 *
 * Ids are explicit rather than slugged from the name: the seeder's slug helper
 * strips non-letters, which would mangle the unit hints in these names.
 */
export const CRIMINAL_ACTIVITY_TYPE_SEEDS: {
  id: string;
  name: string;
  statKey: StatKey;
  requiresProof: boolean;
  allowQuantity: boolean;
  icon: string;
}[] = [
  { id: "crime-committed", name: "Crime Committed", statKey: "crimesCommitted", requiresProof: false, allowQuantity: true, icon: "skull" },
  { id: "felony", name: "Felony", statKey: "felonies", requiresProof: false, allowQuantity: true, icon: "gavel" },
  { id: "heist-completed", name: "Heist Completed", statKey: "heistsCompleted", requiresProof: true, allowQuantity: false, icon: "banknote" },
  { id: "drug-sale", name: "Drug Sale", statKey: "drugSales", requiresProof: false, allowQuantity: true, icon: "pill" },
  { id: "drugs-cooked", name: "Drugs Cooked", statKey: "drugsCooked", requiresProof: false, allowQuantity: true, icon: "flask-conical" },
  { id: "gun-manufactured", name: "Guns Manufactured", statKey: "gunsManufactured", requiresProof: false, allowQuantity: true, icon: "wrench" },
  { id: "dirty-money-earned", name: "Dirty Money Earned ($)", statKey: "dirtyMoneyEarned", requiresProof: true, allowQuantity: true, icon: "dollar-sign" },
  { id: "dirty-money-cleaned", name: "Dirty Money Cleaned ($)", statKey: "dirtyMoneyCleaned", requiresProof: true, allowQuantity: true, icon: "washing-machine" },
  { id: "police-gunned-down", name: "Police Gunned Down", statKey: "policeGunnedDown", requiresProof: true, allowQuantity: true, icon: "crosshair" },
  { id: "arrested", name: "Arrested", statKey: "timesArrested", requiresProof: false, allowQuantity: false, icon: "handcuffs" },
  { id: "jail-time-served", name: "Jail Time Served (months)", statKey: "jailTimeMonths", requiresProof: false, allowQuantity: true, icon: "lock" },
];

export const PORTAL_NAV = [
  { href: "", label: "Dashboard", icon: "layout-dashboard" },
  { href: "/brotherhood", label: "Brotherhood", icon: "users" },
  { href: "/prospects", label: "Prospects", icon: "user-plus" },
  { href: "/activities", label: "Activities", icon: "activity" },
  { href: "/patch-wall", label: "Patch Wall", icon: "award" },
  { href: "/my-cut", label: "My Cut", icon: "shirt" },
  { href: "/gallery", label: "Gallery", icon: "image" },
] as const;
