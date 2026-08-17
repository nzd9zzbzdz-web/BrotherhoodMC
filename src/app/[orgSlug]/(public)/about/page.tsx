import { notFound } from "next/navigation";
import Image from "next/image";
import { getBranding, getOrgBySlug } from "@/lib/tenant";
import { resolveBranding } from "@/lib/branding-resolve";
import { DEFAULT_EMBLEM_STYLE, emblemCss } from "@/lib/emblem-style";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { OrnamentRule } from "@/components/public/OrnamentRule";
import { Reveal } from "@/components/motion/Reveal";
import { clubPreset } from "@/lib/clubs";

/**
 * What the club says about itself.
 *
 * Built as a composition rather than a document. The story is the same prose
 * it always was, but eight paragraphs set at one weight in one column is a
 * page nobody finishes — so it runs as titled acts on alternating grounds,
 * with the club's own art as punctuation and the creed given the close it
 * was written for.
 *
 * Everything here is branding data with a shipped fallback: a tenant tells
 * its own history (`story`), names its own chapters (`storyTitles`), and
 * closes on its own lines (`creed`). Nothing about the Ravens is written into
 * this component — the only thing hardcoded is the shape.
 */

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export default async function AboutPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  const doc = await getBranding(org.id, "public");
  const branding = resolveBranding(doc, "public", org);

  // Firestore first, then THIS CLUB's preset. Never a global default: a
  // shared fallback is how one club ends up telling another club's history.
  const preset = clubPreset(org.slug);
  const story = doc?.story?.length ? doc.story : preset.copy.story;
  const creed = doc?.creed?.length ? doc.creed : preset.copy.creed;
  const titles = doc?.storyTitles?.length ? doc.storyTitles : preset.copy.storyTitles;

  /** The four badges the club wears, used as a rule between acts. */
  const emblems = [
    branding.assets.emblemOne,
    branding.assets.emblemTwo,
    branding.assets.emblemThree,
    branding.assets.emblemFour,
  ];

  return (
    <div className="bg-background">
      {/* ── Opener ───────────────────────────────────────────────────
          The club's own patch, at size, next to the title. Every other
          public page opens on an image; this one used to open on 16px of
          padding and a heading in a black field. */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(115% 80% at 78% 42%, color-mix(in srgb, var(--primary) 13%, transparent), transparent 68%)",
          }}
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 md:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <div>
            <p className="text-[0.7rem] uppercase tracking-[0.3em] text-muted-foreground">
              Our story
            </p>
            <DisplayHeading className="mt-4 text-5xl leading-[0.95] text-foreground md:text-6xl lg:text-7xl">
              About {branding.name}
            </DisplayHeading>
            {branding.mission && (
              <>
                <OrnamentRule className="mt-8 max-w-md" />
                {/* The mission is the standfirst, not another paragraph —
                    it gets the display face and room around it. */}
                <p
                  className="mt-8 max-w-xl text-xl leading-relaxed text-foreground/85 md:text-2xl"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {branding.mission}
                </p>
              </>
            )}
          </div>

          <div className="relative mx-auto w-full max-w-sm lg:max-w-none">
            <Image
              src={branding.assets.clubPatch}
              alt=""
              aria-hidden
              width={640}
              height={640}
              priority
              className="h-auto w-full object-contain drop-shadow-[0_24px_60px_rgba(0,0,0,0.85)]"
            />
          </div>
        </div>
      </section>

      {/* ── The story, as acts ───────────────────────────────────────
          ONE ground for the whole story, not a band per act. Alternating
          grounds gave every act a hard edge top and bottom, and at full
          width that reads as grey stripes across the page rather than as
          rhythm. The depth comes from a single slow gradient down the
          section plus a soft pool of light behind each act, both of which
          fade rather than step, so the eye never meets a line.

          The rhythm is carried by the chapter marks and the space instead. */}
      <div
        className="relative"
        style={{
          background:
            "linear-gradient(180deg, var(--background) 0%, color-mix(in srgb, var(--card) 55%, var(--background)) 45%, var(--background) 100%)",
        }}
      >
        {story.map((paragraph, i) => {
          const title = titles[i];
          return (
            <section key={paragraph.slice(0, 48)} className="relative">
              {/* A wide, very soft pool behind the act, nudged to alternating
                  sides. It gives the page movement at exactly the strength
                  where you feel it and don't see it. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `radial-gradient(70% 60% at ${
                    i % 2 === 0 ? "28%" : "72%"
                  } 50%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 72%)`,
                }}
              />
              <div className="relative mx-auto max-w-3xl px-6 py-14 md:py-16">
              <Reveal>
                {title && (
                  <div className="mb-5 flex items-baseline gap-4">
                    <span
                      className="font-stat text-xs tracking-[0.2em] text-primary/70"
                      aria-hidden
                    >
                      {ROMAN[i] ?? i + 1}
                    </span>
                    <h2 className="text-[0.78rem] font-semibold uppercase tracking-[0.24em] text-foreground/70">
                      {title}
                    </h2>
                    <span
                      className="h-px flex-1 translate-y-[-0.15em]"
                      style={{
                        background:
                          "color-mix(in srgb, var(--accent) 40%, transparent)",
                      }}
                      aria-hidden
                    />
                  </div>
                )}
                {/* Drop cap on the opening act only. A second one would read
                    as a bullet rather than as the start of something. */}
                <p
                  className={
                    "text-[1.05rem] leading-[1.85] text-foreground/85 " +
                    (i === 0
                      ? "first-letter:float-left first-letter:mr-3 first-letter:mt-1 first-letter:text-6xl first-letter:leading-[0.8] first-letter:text-primary first-letter:[font-family:var(--font-display)] md:first-letter:text-7xl"
                      : "")
                  }
                >
                  {paragraph}
                </p>
              </Reveal>
              </div>
            </section>
          );
        })}
      </div>

      {/* ── The badges ───────────────────────────────────────────────
          The four emblems the club actually wears, as a rule between the
          story and its closing lines. */}
      <section className="bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-6 px-6 py-12 sm:gap-10 md:gap-16">
          {/* Height, shadow and strength come from emblemCss: the club's
              treatment over this rule's shipped size and its always-there
              0.7 base opacity. Keyed by slot, not URL — two slots may share
              art (the placeholder set does). */}
          {emblems.map((src, i) => (
            <Image
              key={i}
              src={src}
              alt=""
              aria-hidden
              width={96}
              height={96}
              className="w-auto object-contain [--emblem-h:3rem] md:[--emblem-h:3.5rem]"
              style={emblemCss(branding.emblemStyle ?? DEFAULT_EMBLEM_STYLE, 0.7)}
            />
          ))}
        </div>
      </section>

      {/* ── The creed ────────────────────────────────────────────────
          Three short lines that were sitting in a left-bordered box like a
          pull-quote. They are the close of the whole page, so they get a
          band of their own and the display face at size. */}
      {creed.length > 0 && (
        <section className="relative overflow-hidden bg-background">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(90% 120% at 50% 0%, color-mix(in srgb, var(--primary) 12%, transparent), transparent 70%)",
            }}
          />
          <div className="relative mx-auto max-w-3xl px-6 py-24 text-center md:py-28">
            <OrnamentRule className="mx-auto max-w-xs" />
            {/* Three lines of one statement, so it's one <p> with breaks
                rather than three headings — the creed is the club's closing
                sentence, not a stack of section titles. */}
            <p
              className="my-10 text-2xl leading-snug text-foreground md:text-4xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {creed.map((line, i) => (
                <span key={line} className="block">
                  {line}
                  {i < creed.length - 1 && <span className="sr-only"> </span>}
                </span>
              ))}
            </p>
            <OrnamentRule className="mx-auto max-w-xs" />
          </div>
        </section>
      )}

      {/* ── What we stand on ─────────────────────────────────────────── */}
      <section className="bg-background">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="text-center">
            <p className="text-[0.7rem] uppercase tracking-[0.3em] text-muted-foreground">
              What we stand on
            </p>
          </div>
          <ul className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
            {preset.copy.values.map(([title, body], i) => (
              <Reveal as="li" key={title} delay={i * 0.05} className="bg-background p-7">
                <DisplayHeading as="h3" className="text-2xl text-foreground">
                  {title}
                </DisplayHeading>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
