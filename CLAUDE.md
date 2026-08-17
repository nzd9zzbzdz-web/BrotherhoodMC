@AGENTS.md

# Brotherhood Portal Platform

Multi-tenant GTA RP organization management platform. This deployment serves
**Brotherhood MC** (org slug `brotherhood`). The public site is the shopfront;
the real product is the private portal behind the /volunteer-resources login.

**This repo is a sibling of the Ravens deployment, and they SHARE ONE FIREBASE
PROJECT.** Two consequences that bite:

- `ORG_SLUG=brotherhood` is set in `.env.local` and must be set on Vercel too.
  Without it this domain would happily serve `/silent-souls` (see
  `src/lib/tenant-lock.ts`), unbranded, because the Ravens preset is not in
  this repo.
- Every script defaults to `ORG_ID=brotherhood` rather than the Ravens slug.
  Do not "fix" one back: a stray `npx tsx scripts/apply-branding.ts` with the
  wrong default rewrites the LIVE Ravens branding from this checkout. The
  Ravens org is real data in the shared project, and `npm run seed` is
  destructive.

**No club presets ship here.** `src/lib/clubs/` is deliberately empty of real
clubs, so every slug resolves to the blank `PLATFORM_PRESET` and the whole
identity is set from Admin -> Branding. There is no artwork in the repo beyond
`public/brand/_platform/*` (generated placeholders) and
`public/brand/members/silhouette.webp` (a person, no club marks).

## Running locally (everything on emulators — no Firebase account needed)

```powershell
npm run emulators   # Firebase emulator suite (auth 9099, firestore 8080, storage 9199, UI 4000)
npm run seed        # DESTRUCTIVE: wipes + reseeds the org, 6 members, 15 patches, demo data
npm run dev         # Next.js on :3000  (or use dev.cmd which fixes PATH)
```

`npm run seed` still authors the inherited demo club (6 members with Ravens-era
road names, on @silentsouls.rp addresses) under the `brotherhood` org id. It is
EMULATOR-ONLY scaffolding for exercising the portal locally, not this club's
roster. Demo logins, password `brotherhood`: reaper@silentsouls.rp
(admin/President), six@ and thorn@ (officers), ledger@ / static@ (members),
patch@ (prospect), platform@brotherhood.app (super admin).

For the LIVE club, use `scripts/bootstrap.ts` instead: merge-only, seeds
structure plus ONE real admin, no demo accounts, and it refuses to run while
`FIRESTORE_EMULATOR_HOST` is set.

`npm test` = vitest (rules isolation + patch engine; requires emulators running).
`npm run typecheck` before committing.

## Architecture invariants — do not break

- **All mutations via Server Actions** (`src/actions/*`) using firebase-admin.
  Client SDK is read-only, with no exceptions: every `allow write` in
  `firestore.rules` is `if false`. (Event RSVPs used to be the one shape-enforced
  client write; they went with the events feature, so the rule is now absolute
  and a new client write should be treated as a design error, not a precedent.)
- Every action calls `requireOrgRole(orgId, minRole)` and scopes doc refs as
  `organizations/${orgId}/...` — never trust client-posted ids to cross tenants.
- **Never `router.refresh()` after a successful Server Action.** Every action
  `revalidatePath`s the pages it changes, and Next returns the re-rendered page
  in the action's own response — a refresh doubles the render and the session
  verification. An action must revalidate EVERY page whose data it touched
  (that's what makes this safe). Refresh only after plain `fetch()` to API
  routes (sign-in/out) or to restore server truth after a FAILED optimistic
  mutation that already moved client-only state.
- Custom claims: `{ superAdmin?, orgs: { [orgId]: { r: role, m: memberId } } }`.
  Changed ONLY via `syncUserClaims()` which also revokes refresh tokens.
- Session cookie verified with `verifySessionCookie(cookie, true)` in
  `[orgSlug]/portal/layout.tsx`. `src/proxy.ts` (Next 16 middleware rename) checks
  cookie presence only — firebase-admin cannot run there. `getSessionUser` is
  React-cache()d: the revocation check is an Auth-backend round trip, so it runs
  once per request no matter how many layouts/pages/actions ask.
- Patch awards use composite doc ids `memberId_patchId` ⇒ idempotent. The engine
  (`src/lib/patch-engine.ts`) is a single transaction: ALL reads before writes.
- **Emblems are patch docs that are never worn** (`patch.emblem === true`).
  The criminal record ships as five-rung ladders, one per `CRIMINAL_RECORD_ROWS`
  stat — 55 emblems, which would bury a vest. They are earned by the same
  engine, counted in `patchCount`, and shown as levels on the profile's
  **Emblems** tab; the cut never places them (`isWorn` in the engine, on both
  the approval and manual-award paths; `scripts/seed.ts` repeats the rule in
  `buildCutLayout`). Absent flag ⇒ worn, so every pre-emblem patch is unchanged.
  - `PATCH_LADDERS` in constants is the source; `CRIMINAL_PATCH_SEEDS` (55) is
    derived from it — never hand-list a tier. Emblems carry no real cut
    coordinates (`EMBLEM_PLACEMENT` is inert; `Patch` just requires the field).
  - `composeLadders` (`src/lib/patch-ladders.ts`) builds ladders from the org's
    OWN patch docs filtered to emblems, so admin edits and org-authored emblems
    slot in. Progress is measured across the current segment, never from zero.
  - Patch Wall = what you wear (club + manual patches) with an emblem summary
    linking to the profile. `composeServiceRecord` collapses each emblem ladder
    to its top rung but leaves worn patches alone — Road Warrior doesn't stop
    counting because Iron Rider followed it.
  - The 8 pre-ladder criminal patches keep their id/threshold/category/rarity;
    awards already granted must not change meaning. `syncDefaultActivityTypes`
    is the migration for live orgs — it flags them `emblem` (merge-only) and
    strips emblems off existing `cutLayouts`. Idempotent; awards untouched.
- **Patch/emblem artwork lives in `organizations/{orgId}/patchArt/{patchId}`**
  as a webp data URL (`uploadPatchArt`, admin-only, sharp → 256² contain with
  alpha kept, ≤64KB) — same no-Storage-bucket trick as character renders.
  A SIBLING collection on purpose: `listPatches` is read by the profile, wall,
  cut and admin, and sixty data URLs riding along would be megabytes per read.
  **Never read the blob into a page.** Pages call `listPatchArtVersions`
  (a `.select("updatedAt")` query — ids and timestamps, no images) and build
  `<img>` URLs with `patchArtUrl()`; the bytes stream from
  `/api/orgs/{orgId}/patches/{patchId}/art`, same pattern as the character
  render route. The `?v=` is the art's updatedAt, so the response is
  `immutable` and a re-upload lands at a new URL. `getCut` puts that URL in
  `patch.imagePath`, which the render model already reads. Art is always
  optional — every surface falls back to the lettered badge.
- **Org-scoped reads are cached across requests** (`src/lib/cache.ts`). Firestore
  bills per document RETURNED and this project is on the free tier (50k/day);
  an uncached dashboard cost ~380 reads, so an evening of six members clicking
  around could black out the site. `orgCached(keyPrefix, tagsFor, ttl, loader)`
  wraps a loader in `unstable_cache` + React `cache()`; tags are org-scoped
  (`orgTags`), so one tenant's write can never flush or serve another's.
  - **Every mutating action must call `revalidateOrgTags(orgId, ...)`** next to
    its `revalidatePath` calls. `revalidatePath` re-renders a page but does NOT
    clear a tagged data-cache entry, so without it the rebuilt page renders the
    rows the action just replaced. Adding a write to a cached collection without
    adding its tag is the one way to break this layer.
  - It uses `updateTag`, not `revalidateTag`: actions return the re-rendered page
    in their own response (never `router.refresh()`), and `revalidateTag(t,"max")`
    would serve the stale copy into exactly that render. `updateTag` is
    Server-Actions-only — which is why no action module may be imported by a
    route handler or a page.
  - **Never cache anything derived from the session.** `getSessionUser` /
    `requireOrgRole` stay per-request; a cached authz decision is a privilege
    bug, and the revocation check is the point of them. Access gates live in the
    page or route ABOVE the cached read, never inside it.
  - Cached values round-trip through JSON, so Firestore `Timestamp`s, `Map`s and
    `Set`s are encoded on the way in and rebuilt on the way out — ~40 call sites
    do `.toMillis()` on cached data. `tests/lib/cache.test.ts` is that contract.
  - Caching is **off outside production** (`NODE_ENV`), because `npm run seed`
    wipes and rebuilds the emulator without firing any tag, and a warm cache
    would serve the previous club back at you.
  - `use cache` was NOT used: it needs the app-wide `cacheComponents` flag, and
    its default store is in-memory (near-zero hit rate on Vercel's serverless
    runtime for request-time-dynamic portal pages). The durable `use cache:
    remote` needs the same flag, which turns every uncached dynamic read across
    ~25 pages into a build error needing Suspense boundaries. `unstable_cache`
    keeps working as a separate layer after that migration.
- Officer-only data lives in **subcollections** (`members/*/notes`) — rules can't
  hide fields on a parent doc.
- **No hardcoded brand colors/names/images in components.** The whole visual
  identity is editable from Admin → Branding, and the chain has one shape:
  `organizations/{orgId}/branding/{public|portal}` → `resolveBranding()` →
  `<BrandStyle>` (CSS vars scoped to `[data-surface]`) + `<BrandingProvider>`
  (for client components) . Layouts resolve ONCE and pass down; nothing
  re-reads branding per component.
  - **Nothing is shared between clubs, including fallbacks.** `src/lib/clubs/`
    holds one preset PER ORG SLUG. The registry here is EMPTY: only
    `platform.ts` (deliberately blank) exists, and `clubPreset(slug)` returns
    it for every slug. `resolveBranding(doc, surface, slug)` folds the club's
    Firestore document over ITS OWN preset, so a club that has uploaded
    nothing renders placeholders rather than another club's identity. This is
    the whole point: isolation always held in Firestore, but every unset field
    used to leak the founding club through a global default.
    - A preset carries identity, both palettes, fonts, asset paths, the
      hierarchy plate art, the hero clip, and the long-form copy (story,
      creed, values, home pillars, contact details). Adding a club to a shared
      deployment is one file here plus `public/brand/<slug>/` and
      `public/gallery/<slug>/`; adding NOTHING is also valid and gives a blank
      site branded entirely from Admin.
    - A club that ships a preset puts its art in `public/brand/<slug>/`.
    - `public/brand/_platform/*` is the blank set, generated by
      `scripts/make-placeholder-art.ts`. Only `members/silhouette.webp` is
      genuinely shared, because it depicts a person and carries no club marks.
      Those two are the ONLY artwork in this repo.
    - `tests/lib/club-isolation.test.ts` asserts that a preset-less club
      resolves every colour, asset and identity string from the blank preset
      and nowhere else. Re-introducing a global default fails there rather
      than on someone's live site. With no club presets shipped, it states the
      property directly instead of against a second club's values; its
      `PRESET_SLUGS` loop starts covering any preset the moment one is added.
    - **The hierarchy plate is opt-in per club** (`preset.plateArt`, or an
      admin upload to the `plateArt` asset slot, which wins). No art ⇒
      `<ChainOfCommand>` renders the stacked panel, which needs no art and
      lays out for any headcount. The template layout in `plate-layout.ts`
      describes the plate TEMPLATE, not one club's picture. `plateArt` is the
      one asset slot whose resolved value may be `""` (meaning "no plate");
      the plate's heading/blurb/box-positions are portal branding
      (`chainTitle`/`chainBlurb`/`plateLayout`, editable in Admin → Branding,
      written to the portal doc only).
    - The gallery is `public/gallery/<slug>/`, with optional `_captions.json`
      for curated order and titles. `composeGallery(orgId, slug)` takes both
      because uploads are scoped by org id and shipped photos by slug.
- **`ORG_SLUG` pins a deployment to one club** (`src/lib/tenant-lock.ts`).
  Orgs share one database and routes are `/[orgSlug]/...`, so by default every
  deployment serves every club in that database. That is right for one shared
  site and wrong for a site per club: the other club's pages would render on
  your domain under the wrong branding, and its members could sign in at your
  address. Set `ORG_SLUG` and every other slug 404s in both layouts; leave it
  unset to serve them all. It is NOT a security boundary — rules and
  `requireOrgRole` still are — it decides which club appears on which domain.
  - **Images: add a key to `BRANDING_ASSET_KEYS` + a row to `BRANDING_ART`**
    and the asset card, upload, crop, serve and reset all follow. `fit: "cover"`
    crops backdrops to fill; `fit: "contain"` pads cut-outs (patch, wordmark,
    emblems) on a transparent ground. `surface: "both"` writes to both docs.
    Uploads land in `organizations/{orgId}/brandingArt/{key}` as webp data URLs
    and the SERVED URL is written to `branding.assets[key]`, so resolving a
    club's whole imagery still costs the one document read layouts already make.
  - **Identity is per surface EXCEPT `SHARED_IDENTITY_KEYS`.** The two faces
    legitimately differ in name (". . . Community Foundation" vs ". . . MC"),
    tagline (creed vs territory) and mission. A club's short name, chapter,
    clubhouse address and anthem are one value, so `saveBranding` writes them
    to BOTH documents and the editor mirrors them across both drafts. Adding a
    field of that kind means adding it to that list: several are only DRAWN on
    the public site, and the editor opens on the Portal tab, so a per-surface
    field of this sort silently writes somewhere nothing renders.
  - **Semantic tokens** (`--brand-primary`, `--brand-glow`, `--background-panel`,
    `--border-subtle`, `--text-muted`, …) come out of `src/lib/branding-css.ts`
    alongside the shadcn names. New markup should use them. They are RESTATED
    per surface, never aliased as `var(--primary)` in `:root`: custom properties
    substitute at computed-value time on the element that declares them, so an
    alias would freeze to the neutral value and ignore the surface override.
  - Deliberately NOT branding: rarity/medal tints (`src/lib/rarity.ts`, a game
    convention worth keeping recognizable), vest leather and thread
    (`src/lib/cut/materials.ts`), map pin categories, `CHAIN_OF_COMMAND_PLATE`
    (live text is positioned from measured coordinates painted into the art),
    and `HERO_VIDEO` (sharp decodes images, not video).
- **Ember is spent on state, not on structure.** Red (`--primary`) is earned by:
  the active nav item, hover/focus, officer + President standing, numbers that
  matter (patch counts, headcounts, progress), and alerts. Everything else —
  card and panel borders, page headings, dividers, ambient glows, icon tints in
  body copy — takes a neutral. The neutral is Weathered Bone, not grey:
  `border: rgba(184,160,165,0.14)`. This is enforced at the TOKEN, which is why
  it holds: a red `--border` put crimson on every bordered thing in the club
  before a component asked for it. The portal's one non-state red is the
  hierarchy plate's own heading — the club's front door, kept deliberately.
  The public shopfront keeps its original palette; this rule is portal-side.
- **The nav rail has its own ground.** `colors.sidebar` / `colors.sidebarBorder`
  are optional on `BrandingColors`; absent ⇒ `card` / `border`, which is what
  every org had before they existed. Set the rail BELOW the page background
  (the founding club used `#030206` under a near-black page) so it reads as
  recessed rather than as a floating card.
- **Portal page widths come from `PAGE_W`** (`src/lib/page-width.ts`), never a
  per-page `max-w-*`. Three values: `form` (a column of controls), `content`
  (mixed reading + data, and the dashboard — its territory embed is the
  portrait island and letterboxes when the card gets wide), `gallery` (the
  roster wall, patch wall, full map, character screen). The roster grid stops
  adding columns at `xl` on purpose: the extra width buys BIGGER cards, not
  more of them.
- The Brotherhood hierarchy plate runs at `max-w-[116rem]` and sits OUTSIDE
  the gallery column, because 116rem is wider than `PAGE_W.gallery` (96rem) and
  a child cannot exceed a capped parent. It is fixed-aspect painted art laid
  out at `height:auto`, so its height is purely a function of its width; on a
  very wide screen it overhangs the roster wall beneath it on purpose.
  - Where everything sits on the plate is a `PlateLayout`
    (`src/lib/plate-layout.ts`): fractions of the displayed art, so a club's
    uploaded plate can be any resolution. `DEFAULT_PLATE_LAYOUT` is the
    measured template; a club whose art is painted differently drags the boxes
    in Admin → Branding (`PlateLayoutEditor`, drag to move / handle to resize,
    a face ring drags its whole seat) and the override rides
    `branding.plateLayout` on the portal doc. Absent ⇒ template, which is what
    every club had before the field existed.
  - `PLATE_CROP` in that file is how the template numbers stay registered to
    the art. Every raw number is a pixel measured off the ORIGINAL 1556×720
    render; the shipped file is that render trimmed to its painted frame, and
    `PLATE_CROP` states the difference so the constants stay checkable against
    what was measured. POSITIONS carry the offset (`X`/`Y`), SIZES never do
    (`W`/`H`) — a width is a distance between two art-space points, and
    subtracting the offset from one shrinks every box. A re-crop is four
    numbers, not a re-measure.
- **`scripts/lib/branding.ts` is the scripts' door onto the club presets**
  for org name + portal/public branding. seed/bootstrap/apply-branding/
  update-public-branding/migrate-cut all import it — never re-declare these
  values in a script (they drifted once and silently rewrote the old club
  name/palette over a rebrand). Do not re-declare them in that file either:
  edit `src/lib/clubs/<slug>.ts`, which the runtime shares. `ORG_ID` selects
  which club a script seeds, so `ORG_ID=blue-wolves npx tsx scripts/bootstrap.ts`
  bootstraps that club against its own preset.
- To rebrand a running instance WITHOUT wiping data (`npm run seed` recursiveDeletes
  first): `npx tsx scripts/apply-branding.ts` — merge-only. Emulator data is
  in-memory, so reapply after every restart.
- The character screen's **Criminal Record is derived from `member.stats`** via
  `CRIMINAL_RECORD_ROWS` — members log those rows as ordinary activities and an
  officer approves, same pipeline as a club run. `member.rapSheet` is the dead
  hand-authored predecessor; nothing reads it.
  - Approval has no reverse gear, so a ticket approved with the wrong quantity
    would otherwise leave the record permanently wrong. `saveMemberStats`
    (`src/actions/member-stats.ts`, admin-only, surfaced as **Record
    Correction** on the member profile) is the ONLY path that moves a stat by
    hand, and the only one that moves one DOWN. Values are absolute, a reason
    is required, and every before/after lands in the audit log as
    `member.stats`. The ticket itself keeps its original numbers — this
    corrects the record, it does not rewrite history.
  - It re-judges that member's awards in the same batch, so a correction never
    leaves a rung lit that the record no longer reaches. Same two rules as
    `reconcilePatchAwards`: a manual award (`awardedBy` = a uid) is never
    revoked, and a patch with no requirement has nothing to measure it
    against. Granting stays narrower than revoking, matching
    `backfillPatchAwards`: only ACTIVE patches are handed out, but a retired
    one still carrying a requirement can be taken back. Revoked worn patches
    come off the cut; emblems were never on it.
- **Seed changes don't reach existing orgs** — the seeder only runs on a
  destructive reseed. Admin → Activity Types flags drift and fixes it via
  `syncDefaultActivityTypes` (no CLI or credentials needed): adds missing
  types, deactivates `RETIRED_ACTIVITY_TYPE_IDS` / `RETIRED_PATCH_IDS`, installs
  `CRIMINAL_PATCH_SEEDS`, and folds legacy rapSheets into stats. Idempotent, and
  it never deletes — a retired type/patch keeps its doc so past submissions and
  already-earned awards still resolve a name. Existing types keep admin edits;
  a stat with an approved log behind it is never overwritten.
  Ranks have the same problem and the same fix: Admin → Ranks flags drift and
  `syncDefaultRanks` adds missing `DEFAULT_RANKS`, corrects `order`/`isOfficer`
  on the rest (merge — the name and tab art survive), and authors a cut visual
  per new rank from the colors the club already wears. Rank ids come from
  `rankDocId(name)` — load-bearing, since `member.rankId` points at them.
- **Rank `isOfficer` is club hierarchy, not permissions.** It drives roster
  tiering and cut visuals only; portal access is the role claim. Enforcer and
  Chaplain are titled members — they wear a tab but sit outside the officer
  table; Head Enforcer is the officer rank.
  - ONE deliberate carve-out: treasury review. `canReviewTreasury`
    (`src/lib/treasury-core.ts`) admits portal ADMINS plus the member whose
    `rankId` is `TREASURER_RANK_ID` — the club's book-keeper is a rank, not a
    portal role, and the club wanted the top table and the Treasurer ruling on
    money, NOT every officer. It gates nothing but the bank, both transports
    check it through their own auth (session / account link), and Discord
    roles still grant nothing. Do not widen it and do not copy the pattern to
    another feature without asking.
- **The club bank is the ticket pipeline wearing money** (`treasuryTransactions`
  \+ the running balances in `treasury/account`, moved ONLY inside the approval
  transaction in `src/lib/treasury-core.ts`, which also stamps the row's
  `balanceAfter` and, for dues, the payer's `member.lastDuesPaidAt` — the Dues
  Roll reads off the member list, zero extra queries). Anyone files
  (portal Club Bank page, or `/dues` `/deposit` `/withdraw` on Discord;
  `/bank` shows the account); only `canReviewTreasury` rules, and a withdrawal
  the balance cannot cover is refused, never applied negative. Amounts are
  whole positive dollars; direction comes from the kind. Its own 20-a-day
  rate-limit counter per uid, separate from activity tickets. There is also a
  pinned **Club Bank card** (`/bankpanel`, admin-only, `src/lib/discord/bank-panel.ts`),
  the Activity Logger pattern with one difference: it carries the LIVE balance,
  so every approval on either transport calls `updateBankPanel` to edit the
  message in place. Its location rides on `discordClubs/{orgId}.bankPanel`
  (channelId + messageId, written by `setBankPanel`); no card bound ⇒ no-op.
  A failed edit leaves the card stale but never fails the approval behind it,
  which is why the dropdown's own balance option reads live. Review clears
  the `treasury` tag (approvals also `members`); the Discord buttons
  (`treasury:{decision}:{orgId}:{txId}`) use `expireOrgTags` like the activity
  buttons. Reviewers may file dues FOR another member (cash handed over in
  person) — web only, re-checked server-side.
  - **The club keeps TWO BOOKS, clean and dirty** (`TreasuryBook`), and the
    filer names one on every movement: a Book toggle on the web form, a
    required `book` choice option on the three slash commands, and a
    kind-and-book pair in the card's dropdown (`dues:dirty`, and
    `parseBankChoice` reads it back). Both surfaces show both figures; the
    book is not restricted to officers.
    - They are two FIELDS of the one account doc (`clean`, `dirty`), not two
      accounts: one read, one write, and the single-document transaction goes
      on settling racing reviewers unchanged. What the split changes is that
      **a book is the unit of solvency** — a withdrawal is covered by the book
      it names or refused, and the other book is NEVER raided to cover it.
      `balanceAfter` is that row's book, never the total.
    - **The migration is a fallback, not a script.** `accountBooks()` reads
      `clean ?? balance ?? 0`, so a club that banked money before the split
      keeps every dollar of it as clean money with nothing run; `bookOf()`
      reads a row with no `book` field as clean for the same reason. Those two
      functions are the ONLY places that default is spelled. The first
      approval materialises both fields; the legacy `balance` is then dead but
      deliberately left in place, so the split stays reversible. `getTreasuryBalances`
      took a NEW cache key with its new shape, so no cached bare number can
      outlive the deploy.
    - Pre-split Discord cards are live messages in real channels, so the bare
      dropdown value (`deposit`) and the two-part modal id (`bankform:{orgId}:{kind}`)
      both still resolve, to the clean book.
    - There is deliberately NO way to move money between the books. Washing
      dirty into clean was considered and left out; adding it is a rule change
      to make on purpose, not a fourth `TreasuryTxKind` someone slips in.
- The club activity set is **criminal-record-first**: only Club Ride and Church
  survive from the original 13 spec types. Retired stat keys stay in `STAT_KEYS`
  so historical values still render.
- **Never use an em dash (—) in user-visible text.** Sean's standing rule, and
  it is absolute: no em dashes anywhere a member or a visitor can read them.
  That covers JSX copy, string literals, toasts and error messages, aria-labels,
  placeholders, and the club content in `constants.ts` (story, creed, values).
  Rewrite the sentence so it reads naturally without one: a full stop, a
  semicolon, a colon, a comma, or parentheses. Do not swap in an en dash or a
  hyphen and call it done. Code comments are not user-visible and are exempt.
- Blackletter display font only via `<DisplayHeading>` / `var(--font-display)` —
  never in body text.
- Cut layouts store normalized u/v (0..1) coords per vest surface — designed for a
  future Three.js/R3F renderer; don't invent a different coordinate scheme.
- **Discord is a second transport over the same core, never a second system.**
  `src/lib/activities-core.ts` owns the ticket lifecycle (submit / approve /
  deny) as plain functions taking an already-authenticated actor; the Server
  Actions in `src/actions/activities.ts` and the Discord handlers in
  `src/lib/discord/` are both thin wrappers over it. A behaviour change belongs
  in the core, or the two surfaces drift. The 20-a-day submission cap is keyed
  by uid, so the two surfaces share ONE allowance.
  - The bot is an HTTP **interactions endpoint**
    (`src/app/api/discord/interactions/route.ts`), not a gateway bot: it ships
    with the site, shares the Admin SDK and the cached read layer, and needs no
    second host (a gateway bot cannot run on Vercel). Discord's Ed25519
    signature IS the auth (`verify.ts`, node:crypto, no dependency); the route
    fails closed with 503 when `DISCORD_PUBLIC_KEY` is unset and 401 on a bad
    signature. Because it is unauthenticated by design, it must never trust a
    client-supplied member id: every action resolves the caller from the SIGNED
    payload through the account link.
  - **It is the one mutating transport that is not a Server Action**, which is
    why `expireOrgTags` exists beside `revalidateOrgTags` in `src/lib/cache.ts`.
    `updateTag` throws outside an action, and `revalidateTag(tag,"max")` would
    serve the stale stat once (reading as a lost approval), so the route uses
    `revalidateTag(tag,{expire:0})`. Actions keep `updateTag`: they render the
    page in their own response and need read-your-own-writes. The rule that no
    action module may be imported by a route handler still holds.
  - **Account linking lives on `users/{uid}.discordId`**, written only by
    redeeming a short-lived code from `discordLinkCodes/{code}` (minted by the
    signed-in website, spent by `/link` in Discord, one transaction with the
    code doc as the lock). Account-level like memberships, so one link serves
    every club. One Discord account maps to one portal account; a collision is
    refused, never moved.
  - **One Discord server can host several clubs.** Bindings are per club in
    `discordClubs/{orgId}` (guildId + that club's officerChannelId), written by
    `/connect` behind the club's admin role. Each interaction resolves its club
    from the CALLER's membership, so a member of one club never names it;
    only someone riding with two in the same server is asked. `DISCORD_ORG_ID`
    is the fallback for an unbound server and for DMs. Modal and button
    `custom_id`s carry the orgId (`ticket:{orgId}:{typeId}`,
    `review:{decision}:{orgId}:{activityId}`) so a submit or a decision cannot
    land on the wrong club; the older two-part ids are still honoured.
  - **Discord roles are not portal permissions.** Whether a click may approve
    is decided by the portal role on `users/{uid}.memberships` (the same mirror
    `syncUserClaims` builds claims from). Discord roles only decide who can SEE
    a channel. Racing officers are settled by the engine's transaction, so the
    second click is told it came second.
  - `src/lib/discord/notify.ts` is the ONLY place the app sends TO Discord;
    delivery failures are logged and never fail the submission behind them.
    A private channel needs the bot's own role explicitly allowed or posts fail
    silently. Re-run `npm run register-discord` after editing `commands.ts`.

## Roadmap state

M1 Foundation ✅ · M2 Members ✅ · M3 Activities ✅ · M4 Patch Engine ✅
M5 Prospects (read-only board shipped; officer write flows outstanding)
M7 Gallery ✅ · M8 Digital Cut renderer ✅ (route exists, deliberately not in the
nav) · M9 Multi-tenant expansion (custom domains, org wizard, impersonation).

**Discord: code complete, NOT wired up on this deployment** (`/ping`,
`/mystats`, `/link`, `/unlink`, `/ticket`, `/leaderboard`, `/connect`,
`/panel`, and the bank: `/bank`, `/dues`, `/deposit`, `/withdraw`): linking,
ticket submission, officer review with Approve/Deny buttons, the club
treasury, club and global standings, and several clubs per server.

The bot ships with the site as an HTTP interactions endpoint, and **a Discord
application can point at exactly ONE interactions URL.** That URL belongs to
the Ravens deployment, so this site cannot share their app: standing this bot
up here means a SECOND Discord application, with its own
`DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` and `DISCORD_BOT_TOKEN`, and its
own `npm run register-discord`. The values copied into `.env.local` are the
Ravens app's and will not work against this domain. Until then, leave
`DISCORD_PUBLIC_KEY` unset in production and the route fails closed with 503.

GLOBAL standings span every club in ONE database. This deployment shares the
Ravens' Firebase project, so a global leaderboard here DOES see their clubs.
Nothing federates two databases, on purpose.

**Cut from the product 2026-08-10, do not rebuild without asking:** Events,
Church, Votes and Timeline. The pages, the `events` / `votes` / `timeline`
collections, their rules blocks and indexes, `ClubEvent` / `Vote` /
`TimelineEntry`, and the auto-milestone writer (`src/lib/milestones.ts`, called
post-commit from the patch engine and `createMember`) were all removed. The
original plan had them as M5/M6/M7; they are not deferred, they are gone. Git
history has the implementations if the club ever changes its mind.
`ProspectProfile.status` keeps `vote_pending` on purpose: the club still votes,
just not in the portal, so an officer sets that status by hand.

**The Discord ACTIVITY was cut 2026-08-13, do not rebuild without asking.** An
embedded UI (`/activity`, `@discord/embedded-app-sdk`, an OAuth session route
and a proxy rewrite on `frame_id`) was built and then removed the same day. It
worked, but an UNVERIFIED Activity only launches in servers under ~25 members
and only for the dev team and named testers, which is the opposite direction
from a club that intends to grow, and lifting the limit means taking the app
through Discord verification. The slash commands already cover the same jobs
for everyone in any size server. Git history has the implementation. The bot
itself is untouched by this: it is an HTTP interactions endpoint, not an
Activity, and needs no verification.

## Windows dev notes

- Node lives at `C:\Program Files\nodejs`; if a fresh shell can't find it:
  `$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")`
- shadcn CLI prompts hang headless shells — use `$env:CI="true"` and pass `-y`.
- Live Firebase later: fill `.env.local` keys, set `NEXT_PUBLIC_USE_EMULATORS=false`,
  add `FIREBASE_SERVICE_ACCOUNT_B64`. Deploy target: Vercel (Server Actions need Node;
  avoids Cloud Functions/Blaze).
