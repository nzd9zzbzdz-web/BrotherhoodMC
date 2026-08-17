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
    const run = unstable_cache(
      async () => encodeForCache(await load()),
      ["orgBySlug", slug],
      { tags: [`org:slug:${slug}`], revalidate: TTL.reference },
    );
    return decodeFromCache(await run()) as Organization | null;
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
    const run = unstable_cache(
      async () => encodeForCache(await load()),
      ["orgById", orgId],
      { tags: [orgTags.org(orgId)], revalidate: TTL.reference },
    );
    return decodeFromCache(await run()) as Organization | null;
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
