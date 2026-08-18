import "server-only";
import { cache } from "react";
import { adminDb } from "@/lib/firebase/admin";
import { TTL, decodeFromCache, encodeForCache, orgTags } from "@/lib/cache";
import { unstable_cache } from "next/cache";
import type { Branding, Organization } from "@/lib/types";

// These three run on EVERY request in the app — public pages, portal pages,
// API routes, and `requireOrgRole` on every server action. They're also the
// most stable data the club has, so they're cached across requests as well as
// within one (see src/lib/cache.ts). `orgCached` can't be used here: it keys on
// an org id these functions are the ones resolving.

const CACHE_ENABLED = process.env.NODE_ENV === "production";

/**
 * Cache a lookup that can legitimately miss, without letting the miss stick.
 *
 * `unstable_cache` stores a null like any other value, so the ABSENCE of an org
 * was cached for the full reference TTL. Nothing cleared it: bootstrap and the
 * other scripts write Firestore straight from a CLI and fire no tag, and the one
 * action that clears `org:slug:*` is admin-gated behind pages that are themselves
 * 404ing on that very null. A newly bootstrapped club therefore stayed 404, and
 * because every 404 request rewrote the miss, a site anyone kept refreshing never
 * healed on its own.
 *
 * Hits keep the long reference TTL. A miss falls through to a short-lived entry,
 * which still absorbs a scan of unknown slugs but surfaces a new org in a minute.
 */
async function cachedNullable<T>(
  key: string[],
  tags: string[],
  load: () => Promise<T | null>,
): Promise<T | null> {
  const read = (parts: string[], revalidate: number) =>
    unstable_cache(async () => encodeForCache(await load()), parts, {
      tags,
      revalidate,
    })();
  const hit = decodeFromCache(await read(key, TTL.reference)) as T | null;
  if (hit !== null) return hit;
  return decodeFromCache(await read([...key, "miss"], TTL.miss)) as T | null;
}

/** Resolve an org by slug — React cache() dedupes per request. */
export const getOrgBySlug = cache(
  async (slug: string): Promise<Organization | null> => {
    const load = async (): Promise<Organization | null> => {
      const snap = await adminDb
        .collection("organizations")
        .where("slug", "==", slug)
        .limit(1)
        .get();
      if (snap.empty) return null;
      const doc = snap.docs[0];
      return { id: doc.id, ...(doc.data() as Omit<Organization, "id">) };
    };
    if (!CACHE_ENABLED) return load();
    // Tagged by slug as well as id: on a miss there is no id to tag with yet,
    // and a rename has to be able to clear the entry keyed on the old slug.
    return cachedNullable(["orgBySlug", slug], [`org:slug:${slug}`], load);
  },
);

/** Org doc by id — cached so repeated role checks in one request read it once. */
export const getOrgById = cache(
  async (orgId: string): Promise<Organization | null> => {
    const load = async (): Promise<Organization | null> => {
      const snap = await adminDb.collection("organizations").doc(orgId).get();
      return snap.exists
        ? { id: snap.id, ...(snap.data() as Omit<Organization, "id">) }
        : null;
    };
    if (!CACHE_ENABLED) return load();
    return cachedNullable(["orgById", orgId], [orgTags.org(orgId)], load);
  },
);

export const getBranding = cache(
  async (orgId: string, surface: "public" | "portal"): Promise<Branding | null> => {
    const load = async (): Promise<Branding | null> => {
      const snap = await adminDb
        .doc(`organizations/${orgId}/branding/${surface}`)
        .get();
      return snap.exists ? (snap.data() as Branding) : null;
    };
    if (!CACHE_ENABLED) return load();
    const run = unstable_cache(
      async () => encodeForCache(await load()),
      ["branding", orgId, surface],
      { tags: [orgTags.branding(orgId)], revalidate: TTL.reference },
    );
    return decodeFromCache(await run()) as Branding | null;
  },
);

/** Clear the slug-keyed org entry. Separate from `orgTags.org` because a slug
 *  lookup has no id to tag with until it resolves. */
export function orgSlugTag(slug: string): string {
  return `org:slug:${slug}`;
}

/**
 * Every active club in this database, for the cross-club global leaderboard.
 * Deliberately cross-tenant: global competition is the one feature whose
 * point is seeing the other clubs. Orgs are created bootstrap-rare, so the
 * TTL backstop alone is enough; nothing invalidates the tag on write.
 */
export const listActiveOrgs = cache(async (): Promise<Organization[]> => {
  const load = async (): Promise<Organization[]> => {
    const snap = await adminDb
      .collection("organizations")
      .where("status", "==", "active")
      .get();
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Organization, "id">),
    }));
  };
  if (!CACHE_ENABLED) return load();
  const run = unstable_cache(
    async () => encodeForCache(await load()),
    ["activeOrgs"],
    { tags: ["orgs:all"], revalidate: TTL.reference },
  );
  return decodeFromCache(await run()) as Organization[];
});
