/**
 * Restrict a deployment to a single club.
 *
 * Orgs live in one Firestore database, and routes are `/[orgSlug]/...`, so by
 * default ANY deployment pointed at that database serves EVERY club in it. On
 * one shared site that is the whole point. On separate sites per club it is
 * wrong twice over: the other club's public pages would render on your domain
 * under the wrong branding (its preset is not in your repo), and its members
 * could sign in to their portal at your address.
 *
 * `ORG_SLUG` closes that. Set it to the club a deployment belongs to and every
 * other slug 404s. Leave it unset and the deployment serves all of them, which
 * is what a single multi-club site wants.
 *
 * This is layout-level, not a security boundary — Firestore rules and
 * `requireOrgRole` are still the thing standing between a member and another
 * club's data, and they are unchanged. What this fixes is a club appearing on
 * a domain that is not its own.
 */

/** The one club this deployment serves, or null when it serves all of them. */
export function lockedOrgSlug(): string | null {
  const slug = process.env.ORG_SLUG?.trim();
  return slug ? slug : null;
}

/** False when this deployment is locked to a different club. */
export function servesOrg(slug: string): boolean {
  const locked = lockedOrgSlug();
  return locked === null || locked === slug;
}
