import "server-only";
import { cache } from "react";
import { revalidateTag, unstable_cache, updateTag } from "next/cache";
import { Timestamp } from "@/lib/firebase/admin";

/**
 * Cross-request caching for org-scoped reads.
 *
 * WHY THIS EXISTS: Firestore bills a read per document RETURNED, and this app
 * is on the Spark (free) plan — 50k reads/day. Before this layer a single
 * portal dashboard cost ~380 reads (70 patches + 200 map markers + 50
 * territories + members + awards + types), so six members clicking around an
 * evening could take the site down for the rest of the day. React `cache()`
 * only dedupes within ONE render; this layer holds the same data across
 * requests, deployments, and server instances.
 *
 * WHY `unstable_cache` AND NOT `use cache`: `use cache` (Next 16) needs the
 * app-wide `cacheComponents` flag, and its default store is in-memory — on
 * Vercel's serverless runtime each request can land on a cold instance, so the
 * hit rate for our request-time-dynamic portal pages would be near zero. The
 * durable variant, `use cache: remote`, needs that same flag, and enabling it
 * turns every uncached dynamic read across ~25 pages into a build error
 * requiring Suspense boundaries. `unstable_cache` is backed by the same durable
 * data cache today with no flag and no render-semantics change. Next's own
 * migration guide keeps it working as a separate layer after Cache Components
 * is enabled, so this is a step toward that migration, not away from it.
 *
 * WHAT IS NEVER CACHED: anything derived from the session. `getSessionUser`
 * and `requireOrgRole` stay per-request — a cached authz decision is a
 * privilege-escalation bug, and the revocation check is the point of them.
 */

/** Serialization marker. Deliberately ugly — real club data never has this key. */
const MARK = "__fsCache";

type Encoded =
  | { [MARK]: "ts"; s: number; n: number }
  | { [MARK]: "date"; v: number }
  | { [MARK]: "map"; v: [unknown, unknown][] }
  | { [MARK]: "set"; v: unknown[] };

/**
 * The data cache stores JSON, so a `Timestamp` would come back as a plain
 * `{_seconds, _nanoseconds}` bag and every `.toMillis()` in the app — 38 call
 * sites — would throw. Maps and Sets would come back as `{}`. So we encode the
 * shapes we actually store on the way in and rebuild them on the way out; the
 * wrapped function's public signature is unchanged, and callers never learn
 * their data took a trip through a cache.
 */
export function encodeForCache(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Timestamp) {
    return { [MARK]: "ts", s: value.seconds, n: value.nanoseconds } satisfies Encoded;
  }
  if (value instanceof Date) {
    return { [MARK]: "date", v: value.getTime() } satisfies Encoded;
  }
  if (value instanceof Map) {
    return {
      [MARK]: "map",
      v: [...value].map(
        ([k, v]) => [encodeForCache(k), encodeForCache(v)] as [unknown, unknown],
      ),
    } satisfies Encoded;
  }
  if (value instanceof Set) {
    return { [MARK]: "set", v: [...value].map(encodeForCache) } satisfies Encoded;
  }
  if (Array.isArray(value)) return value.map(encodeForCache);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue; // absent === undefined for every optional field here
      out[k] = encodeForCache(v);
    }
    return out;
  }
  return value;
}

export function decodeFromCache(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decodeFromCache);
  const tag = (value as Record<string, unknown>)[MARK];
  if (typeof tag === "string") {
    const enc = value as Encoded;
    switch (enc[MARK]) {
      case "ts":
        return new Timestamp(enc.s, enc.n);
      case "date":
        return new Date(enc.v);
      case "map":
        return new Map(
          enc.v.map(([k, v]) => [decodeFromCache(k), decodeFromCache(v)]),
        );
      case "set":
        return new Set(enc.v.map(decodeFromCache));
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = decodeFromCache(v);
  return out;
}

/**
 * Local dev reads straight through. Emulator data is wiped and rebuilt by
 * `npm run seed`, which runs outside Next and so fires no `revalidateTag` — a
 * warm data cache would serve the PREVIOUS club after a reseed, which reads as
 * a bug in whatever you were actually working on.
 */
const CACHE_ENABLED = process.env.NODE_ENV === "production";

/** Backstop TTLs. Tag invalidation is the real mechanism — every mutating
 *  action calls `revalidateOrgTags`. These only bound how long a write that
 *  bypassed the app (a script, the Firebase console) can stay invisible. */
export const TTL = {
  /** Patches, ranks, activity types, branding, the org doc — admin-rare. */
  reference: 3600,
  /** Members, awards, map pins, gallery — moved by ordinary club activity. */
  club: 900,
} as const;

/**
 * Wrap an org-scoped loader in the cross-request data cache.
 *
 * The returned function keeps the loader's signature, and is additionally
 * React-`cache()`d so repeated calls inside one render don't even pay the
 * cache lookup. First arg must be the orgId — it is part of both the cache key
 * and the tag, which is what keeps one tenant from ever reading another's.
 */
export function orgCached<Rest extends string[], R>(
  keyPrefix: string,
  tagsFor: (orgId: string, ...rest: Rest) => string[],
  ttl: number,
  loader: (orgId: string, ...rest: Rest) => Promise<R>,
): (orgId: string, ...rest: Rest) => Promise<R> {
  if (!CACHE_ENABLED) return cache(loader) as typeof loader;
  return cache(async (orgId: string, ...rest: Rest): Promise<R> => {
    // Built per call so the tags can name this org. The closure captures
    // orgId/rest, so they must also appear in keyParts — a captured variable is
    // NOT part of the key on its own.
    const run = unstable_cache(
      async () => encodeForCache(await loader(orgId, ...rest)),
      [keyPrefix, orgId, ...rest],
      { tags: tagsFor(orgId, ...rest), revalidate: ttl },
    );
    return decodeFromCache(await run()) as R;
  }) as (orgId: string, ...rest: Rest) => Promise<R>;
}

/**
 * Cache tags, all org-scoped. `orgId` is in every tag so invalidating one
 * tenant never flushes another's data.
 */
export const orgTags = {
  org: (orgId: string) => `org:${orgId}:doc`,
  branding: (orgId: string) => `org:${orgId}:branding`,
  members: (orgId: string) => `org:${orgId}:members`,
  ranks: (orgId: string) => `org:${orgId}:ranks`,
  patches: (orgId: string) => `org:${orgId}:patches`,
  patchArt: (orgId: string) => `org:${orgId}:patchArt`,
  activityTypes: (orgId: string) => `org:${orgId}:activityTypes`,
  awards: (orgId: string) => `org:${orgId}:awards`,
  map: (orgId: string) => `org:${orgId}:map`,
  gallery: (orgId: string) => `org:${orgId}:gallery`,
  roles: (orgId: string) => `org:${orgId}:roles`,
  treasury: (orgId: string) => `org:${orgId}:treasury`,
} as const;

export type OrgTagName = keyof typeof orgTags;

/**
 * Invalidate cached reads after a mutation. Call this from EVERY action that
 * writes a collection behind `orgCached`, alongside the `revalidatePath` calls
 * it already makes — `revalidatePath` re-renders pages but does not clear a
 * tagged data-cache entry, so a page rebuilt without this would render the
 * stale rows it just replaced.
 *
 * `updateTag`, not `revalidateTag`: this codebase returns the re-rendered page
 * in the action's own response (never `router.refresh()`), and that render
 * happens immediately. `revalidateTag(tag, "max")` only marks the entry stale
 * and serves the stale copy while refreshing behind it — so an officer would
 * approve a run and get back a page still showing the old stat. `updateTag`
 * expires the entry so the very next read blocks for fresh data, which is the
 * read-your-own-writes behaviour every one of these actions needs.
 * Server-Actions-only, which is exactly where every caller lives.
 */
export function revalidateOrgTags(orgId: string, ...names: OrgTagName[]): void {
  for (const name of names) updateTag(orgTags[name](orgId));
}

/**
 * The ROUTE-HANDLER-safe sibling of `revalidateOrgTags`, for the one mutating
 * transport that is not a Server Action: the Discord interactions route, where
 * an officer's button click moves member stats. `updateTag` throws outside an
 * action; `revalidateTag` with `{ expire: 0 }` expires the tagged entries
 * immediately, so the next portal request blocks for fresh data. The default
 * "max" profile would instead serve the stale stat once (stale-while-
 * revalidate), which reads as a lost approval to whoever checks the website.
 * The route renders no page of its own, so updateTag's read-your-own-writes
 * advantage buys it nothing anyway. No-op outside production, like the cache.
 */
export function expireOrgTags(orgId: string, ...names: OrgTagName[]): void {
  if (!CACHE_ENABLED) return;
  for (const name of names) revalidateTag(orgTags[name](orgId), { expire: 0 });
}
