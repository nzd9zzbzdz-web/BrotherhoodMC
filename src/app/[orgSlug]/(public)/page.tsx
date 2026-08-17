import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getBranding, getOrgBySlug } from "@/lib/tenant";
import { composeGallery } from "@/lib/gallery";
import { listMembers, listMembersWithRender, listRanks } from "@/lib/queries";
import {
  bySeniority,
  isPubliclyVisible,
  publicCardLabel,
  type PublicRosterMember,
} from "@/lib/public-roster";
import { resolveBranding } from "@/lib/branding-resolve";
import { DEFAULT_WATERMARK_STYLE, watermarkCss } from "@/lib/watermark";
import { DEFAULT_EMBLEM_STYLE, emblemCss } from "@/lib/emblem-style";
import { CHARACTER_SILHOUETTE } from "@/lib/constants";
import { clubPreset } from "@/lib/clubs";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { Button } from "@/components/ui/button";
import { HeroGalleryFilmstrip } from "@/components/public/HeroGalleryFilmstrip";
import { BrotherhoodSection } from "@/components/public/BrotherhoodSection";
import { OrnamentRule } from "@/components/public/OrnamentRule";
import type { Timestamp } from "firebase-admin/firestore";

export default async function PublicHomePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  const branding = resolveBranding(await getBranding(org.id, "public"), "public", org);
  const preset = clubPreset(org.slug);
  const photos = await composeGallery(org.id, org.slug);
  const base = `/${orgSlug}`;

  // The club's own name, not the org record's: renaming from Admin → Branding
  // has to be able to change the headline without a second edit somewhere else.
  const [line1, line2] = splitName(branding.name);
  const creed = branding.tagline;

  // The public roster: everyone under the colors, chain of command first. The
  // same gate guards the render route, so a face can't load for anyone the
  // section doesn't list.
  const [members, ranks] = await Promise.all([listMembers(org.id), listRanks(org.id)]);
  const rankById = new Map(ranks.map((r) => [r.id, r]));
  const publicMembers = members.filter((m) =>
    isPubliclyVisible(m, rankById.get(m.rankId)),
  );
  const withRender = await listMembersWithRender(
    org.id,
    publicMembers.map((m) => m.id),
  );
  const now = new Date();
  const brotherhood: PublicRosterMember[] = publicMembers
    .map((member) => {
      const joined = (member.joinDate as Timestamp)?.toDate?.() ?? null;
      // The seeder writes the shared silhouette into photoPath when a member
      // has no art, so a set photoPath alone doesn't mean they have a render.
      const ownArt =
        member.photoPath && member.photoPath !== CHARACTER_SILHOUETTE
          ? member.photoPath
          : undefined;
      return {
        id: member.id,
        // APPROVED renders only. A member's own upload is theirs to see in the
        // portal the moment it lands, but it doesn't reach the shopfront until
        // an officer says so — the render route enforces the same rule on the
        // bytes, so this isn't the only thing standing between the two.
        imageUrl: withRender.get(member.id)?.approved
          ? `/api/orgs/${org.id}/members/${member.id}/render`
          : (ownArt ?? CHARACTER_SILHOUETTE),
        tenureLabel: publicCardLabel(member, joined, now),
        joinedAtMs: joined?.getTime() ?? Number.MAX_SAFE_INTEGER,
        bio: member.bio ?? "",
      };
    })
    .sort(bySeniority);

  // Emblems and pillar copy both come from THIS club: the images from the
  // branding catalog (so an admin swaps them without touching code) and the
  // words from the club preset. The slots are listed out of numeric order on
  // purpose: 1-4 is the order the About page draws them in, and the pillars
  // have always led with the second.
  const emblems = [
    branding.assets.emblemTwo,
    branding.assets.emblemOne,
    branding.assets.emblemThree,
    branding.assets.emblemFour,
  ];
  const hrefFor = (h: "about" | "brotherhood" | "join") =>
    h === "brotherhood" ? "#brotherhood" : `${base}/${h}`;
  const pillars = preset.copy.pillars.map((p, i) => ({
    img: emblems[i] ?? emblems[0],
    title: p.title,
    // {club} rather than a baked-in name, so renaming from Admin -> Branding
    // moves the copy with it.
    body: p.body.replace(/{club}/g, branding.name),
    href: hrefFor(p.href),
    cta: p.cta,
  }));

  return (
    <>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-destructive/15 bg-black">
        {/* Gallery filmstrip backdrop: club photos auto-scroll across the full
            banner width, each at its natural aspect ratio (full banner height,
            width follows) so nothing is cropped or stretched. Falls back to the
            hero clip if public/gallery is empty. */}
        <div
          className="relative w-full min-h-[440px] overflow-hidden sm:min-h-0 sm:aspect-[2400/1026] sm:max-h-[760px]"
          // Two pools of club colour over a fall from panel to page ground.
          // Every stop mixes from a brand token, so a blue club gets a blue
          // hero without this file changing.
          style={{
            background:
              "radial-gradient(120% 80% at 78% 18%, color-mix(in srgb, var(--brand-accent) 16%, transparent), transparent 55%), radial-gradient(90% 60% at 50% 120%, color-mix(in srgb, var(--brand-primary) 12%, transparent), transparent 60%), linear-gradient(180deg, var(--background-panel), var(--background-main))",
          }}
        >
          {photos.length > 0 ? (
            <HeroGalleryFilmstrip photos={photos} />
          ) : preset.heroVideo ? (
            <video
              className="absolute inset-0 h-full w-full object-contain"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster={branding.assets.heroImage}
              aria-hidden
            >
              <source src={preset.heroVideo} type="video/mp4" />
            </video>
          ) : (
            // No club clip and no photos yet: the poster alone, so the hero is
            // still a picture rather than an empty band.
            /* eslint-disable-next-line @next/next/no-img-element -- static or served art */
            <img
              src={branding.assets.heroImage}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
        </div>

        {/* Legibility scrim */}
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/35 to-transparent"
          aria-hidden
        />

        {/* Text — overlaid, pushed right of the left edge */}
        <div className="absolute inset-0 flex items-center">
          <div className="px-6 md:pl-32 md:pr-6 lg:pl-56">
            <DisplayHeading className="text-6xl leading-[0.92] text-foreground drop-shadow-[0_2px_16px_rgba(0,0,0,0.7)] md:text-7xl lg:text-8xl">
              {line1}
              {line2 && <span className="mt-1 block">{line2}</span>}
            </DisplayHeading>

            {/* Creed, sandwiched by ornamental rules. Both the rules and the
                mission are conditional: a club that has not written them yet
                would otherwise get two ornaments framing an empty line, which
                reads as a broken page rather than an unfinished one. */}
            {creed && (
              <div className="mt-8 max-w-xl">
                <OrnamentRule />
                <p className="my-3.5 text-center text-base font-semibold uppercase tracking-[0.16em] text-primary md:text-lg">
                  {creed.split(/\s*[·|]\s*/).join(" | ")}
                </p>
                <OrnamentRule />
              </div>
            )}

            {branding.mission && (
              <p className="mt-7 max-w-lg text-lg leading-relaxed text-foreground">
                {branding.mission}
              </p>
            )}
            <div className="mt-10">
              <Button
                asChild
                variant="outline"
                size="lg"
                className="px-10 font-semibold uppercase tracking-[0.22em]"
              >
                <Link href={`${base}/about`}>Learn More</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pillars ── */}
      <section aria-labelledby="creed-heading" className="relative overflow-hidden bg-background">
        {/* Watermark illustration bleeds off the left; art fades to black on the right */}
        {/* The art's canvas is near-black (~#020202), darker than the section, so an
            opaque contain image reads as a rectangle. mix-blend-mode:lighten takes the
            per-pixel max against the section bg: the dark canvas becomes exactly the
            section color (vanishes) while the brighter artwork shows — no seam, any
            width. The asset card says so, because a transparent PNG here would show
            as a bright rectangle instead. Blend, filter, placement and scale all
            come from watermarkCss: the club tunes them in Admin → Branding
            (public tab), and null means the treatment this page always had. */}
        <Image
          src={branding.assets.watermark}
          alt=""
          fill
          sizes="100vw"
          className="pointer-events-none object-contain object-left"
          style={watermarkCss(branding.watermarkStyle ?? DEFAULT_WATERMARK_STYLE)}
        />
        <div className="relative px-6 py-16 md:py-20 lg:pl-[24%] lg:pr-12">
          <h2 id="creed-heading" className="sr-only">
            The club
          </h2>
          <div className="grid gap-y-12 sm:grid-cols-2 sm:gap-x-10 lg:grid-cols-4 lg:gap-x-0 lg:gap-y-0 lg:divide-x lg:divide-destructive/15">
            {pillars.map((p) => (
              // The whole pillar is the target — emblem, heading and copy all
              // read as one clickable card, so aiming at the small link below
              // them is never the only way through.
              <Link
                key={p.title}
                href={p.href}
                className="group flex flex-col items-center rounded-lg px-6 py-2 text-center transition-colors duration-200 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                {/* Height and shadow come from emblemCss (the club's saved
                    treatment over this page's shipped size); the classes only
                    set the responsive base the scale multiplies. */}
                <Image
                  src={p.img}
                  alt=""
                  width={160}
                  height={160}
                  unoptimized
                  className="w-auto object-contain transition-transform duration-300 group-hover:scale-105 [--emblem-h:4rem] md:[--emblem-h:4.75rem]"
                  style={emblemCss(branding.emblemStyle ?? DEFAULT_EMBLEM_STYLE)}
                />
                <h3 className="mt-5 text-sm font-semibold uppercase tracking-[0.2em] text-foreground">
                  {p.title}
                </h3>
                <p className="mt-3 max-w-[17rem] text-sm leading-relaxed text-muted-foreground">
                  {p.body}
                </p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-primary group-hover:underline">
                  {p.cta} <ChevronRight className="size-3.5" aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── The Brotherhood ── */}
      <BrotherhoodSection
        members={brotherhood}
        joinHref={`${base}/join`}
        backdropPath={branding.assets.rosterBackdrop}
      />

      {/* "Latest from the Club" used to sit here. It was three hardcoded
          placeholder items — a run "this weekend", a food drive "this month" —
          which a visitor reads as the club's actual plans. Pulled rather than
          left lying: fiction dated to the present tense ages badly on a public
          site. It comes back when there's a real source behind it (the Events
          collection, or an admin-authored feed). See git history for the
          markup, which was fine — only the data was made up. */}

      {/* ── Closing ── */}
      <section className="border-t border-destructive/12 bg-background">
        <div className="mx-auto max-w-3xl px-4 py-20 text-center">
          <DisplayHeading as="h2" className="text-3xl text-foreground md:text-4xl">
            {preset.copy.closingHeading}
          </DisplayHeading>
          {/* "with us" rather than "with the Ravens": the sentence has to
              survive a rebrand, and no club noun fits every club. */}
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            {preset.copy.closingBody}
          </p>
          {/* The page's one true action — ember tier. */}
          <Button
            asChild
            className="mt-8 px-8 text-xs font-semibold uppercase tracking-[0.16em]"
          >
            <Link href={`${base}/join`}>Start Your Prospect Run</Link>
          </Button>
        </div>
      </section>
    </>
  );
}

/** Thin gold rule with a centered diamond — brackets the hero creed. */

/** "Ravens of Death MC" → ["Ravens of Death", "MC"] for a two-line hero. */
function splitName(name: string): [string, string | null] {
  const m = name.match(/^(.*?)\s+(MC.*)$/i);
  if (m) return [m[1], m[2]];
  return [name, null];
}

