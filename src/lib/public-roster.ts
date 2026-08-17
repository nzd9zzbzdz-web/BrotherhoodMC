import type { Member, Rank } from "@/lib/types";

/**
 * Who the club shows the outside world.
 *
 * The portal roster and the public one are deliberately not the same data: a
 * member's profile carries their Criminal Record, and the public site is the
 * foundation's face. This is the single gate — the home page section and the
 * render route both ask it, so the site and the images it loads can never
 * disagree about who is public.
 *
 * Everyone under the colors qualifies: officers and patched members. Prospects
 * and hangarounds stay private until they're patched in, and anyone retired or
 * exiled drops off.
 */
export function isPubliclyVisible(
  member: Pick<Member, "status">,
  rank: Pick<Rank, "isOfficer"> | undefined,
): boolean {
  if (member.status === "retired" || member.status === "exiled") return false;
  return Boolean(rank?.isOfficer) || member.status === "patched";
}

/**
 * What the outside world gets. Deliberately anonymous: no road name, no rank,
 * no member number — how long they have ridden, their art, and whatever blurb
 * the club chose to write. Anything identifying stays behind the login.
 */
export interface PublicRosterMember {
  id: string;
  /** Art URL — the public render route, or a static fallback. */
  imageUrl: string;
  /** "3 years riding" — the only fact on the card. */
  tenureLabel: string;
  /** Sort key only; never rendered. */
  joinedAtMs: number;
  bio: string;
}

/** Longest-serving first — the one thing the cards show is the order they read in. */
export function bySeniority(a: PublicRosterMember, b: PublicRosterMember): number {
  return a.joinedAtMs - b.joinedAtMs;
}

/**
 * How long they've been under the colors, in the roundest honest unit.
 *
 * Deliberately coarse: to the month under a year, to the year after that. A
 * precise join date is an identifying detail, and this is the public site.
 */
/**
 * What the card actually says: the club's own caption when an admin wrote one,
 * otherwise the computed tenure. Kept here beside `tenureLabel` so the two can
 * never drift apart — the fallback IS the feature.
 */
export function publicCardLabel(
  member: Pick<Member, "publicLabel" | "joinDate">,
  joined: Date | null,
  now: Date,
): string {
  const custom = member.publicLabel?.trim();
  return custom ? custom : tenureLabel(joined, now);
}

export function tenureLabel(joined: Date | null, now: Date): string {
  if (!joined || Number.isNaN(joined.getTime())) return "Riding with the club";

  const months = Math.max(
    0,
    (now.getFullYear() - joined.getFullYear()) * 12 +
      (now.getMonth() - joined.getMonth()) -
      (now.getDate() < joined.getDate() ? 1 : 0),
  );

  if (months < 1) return "New to the colors";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} riding`;

  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} riding`;
}
