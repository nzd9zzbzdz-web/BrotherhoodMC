"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import type { PublicRosterMember } from "@/lib/public-roster";

/**
 * "The Brotherhood" on the public home page: everyone riding under the colors,
 * longest-serving first.
 *
 * Anonymous by design. No road names, no ranks, no member numbers — a face,
 * how long they've ridden, and the blurb the club wrote for them. Clicking a
 * card opens the render at full size with that blurb. Identity is what the
 * portal is for; this is the shopfront.
 */
export function BrotherhoodSection({
  members,
  joinHref,
  backdropPath,
}: {
  members: PublicRosterMember[];
  joinHref: string;
  /** Clubhouse art behind every figure. Falls back to the ember wash alone. */
  backdropPath?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = members.find((m) => m.id === openId) ?? null;

  // Always render, even with nobody to show. The Brotherhood nav tab and the
  // pillar both target this anchor: if the section disappeared when the roster
  // came back empty, those links would land nowhere and read as a broken page.
  return (
    <section
      id="brotherhood"
      aria-label="The Brotherhood"
      className="scroll-mt-24 border-t border-border bg-background md:scroll-mt-28"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
            Under the Colors
          </p>
          <DisplayHeading as="h2" className="mt-3 text-4xl text-foreground md:text-5xl">
            The Brotherhood
          </DisplayHeading>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-muted-foreground">
            {members.length === 0
              ? "Nobody has been patched in yet. The colors are earned, and the first riders to earn them will stand here."
              : `${members.length} riding. We don't put names to faces out here, but every one of them earned the patch on their back.`}
          </p>
        </div>

        <ul className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {members.map((member) => (
            <li key={member.id}>
              {/* glass-card, not glass: a roster-sized grid must not stack
                  backdrop-filters. No underglow either — overflow-hidden (for
                  the render zoom) would clip the bloom. */}
              <button
                type="button"
                onClick={() => setOpenId(member.id)}
                aria-label={`${member.tenureLabel}, view larger`}
                className="group relative flex aspect-[3/4] w-full flex-col overflow-hidden rounded-xl glass-card glass-hover focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                {/* Clubhouse backdrop, then the ember wash over it. Both sit
                    under the figure. The image is dimmed hard: it has to read
                    as a room the rider is standing in, not compete with them —
                    and every render is cut out with a transparent background,
                    so whatever is behind shows through around the edges. */}
                {backdropPath && (
                  // eslint-disable-next-line @next/next/no-img-element -- static art, sized by CSS
                  <img
                    src={backdropPath}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 size-full object-cover opacity-55 transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                )}
                <span
                  aria-hidden
                  className="absolute inset-0 bg-[radial-gradient(120%_75%_at_50%_18%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_70%)]"
                />

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={member.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-x-0 bottom-0 mx-auto h-[86%] w-full object-contain object-bottom drop-shadow-[0_18px_22px_rgba(0,0,0,0.55)] transition-transform duration-500 group-hover:scale-[1.04]"
                />

                {/* Scrim so the tenure line stays legible over any render */}
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[rgba(0,0,0,0.92)] via-[rgba(0,0,0,0.5)] to-transparent"
                />

                <span className="relative mt-auto w-full p-3 text-center">
                  <span
                    className="block truncate text-base leading-tight text-white drop-shadow"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {member.tenureLabel}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-12 text-center">
          <Link
            href={joinHref}
            className="glass glass-ember glass-hover underglow inline-flex min-h-11 items-center rounded-md px-8 text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Ride With Us
          </Link>
        </div>
      </div>

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpenId(null)}>
        <DialogContent className="max-w-3xl overflow-hidden p-0 sm:max-w-3xl">
          {open && (
            <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
              <div className="relative flex min-h-[16rem] items-end justify-center overflow-hidden bg-[radial-gradient(120%_80%_at_50%_10%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_70%)] md:min-h-[26rem]">
                {backdropPath && (
                  // eslint-disable-next-line @next/next/no-img-element -- static art, sized by CSS
                  <img
                    src={backdropPath}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 size-full object-cover opacity-55"
                  />
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={open.imageUrl}
                  alt=""
                  className="relative max-h-[26rem] w-auto object-contain drop-shadow-[0_18px_30px_rgba(0,0,0,0.6)]"
                />
              </div>

              <div className="flex flex-col justify-center p-6 md:p-8">
                <DialogTitle asChild>
                  <DisplayHeading as="h2" className="text-3xl text-primary">
                    {open.tenureLabel}
                  </DisplayHeading>
                </DialogTitle>
                <p className="mt-4 leading-relaxed text-muted-foreground">
                  {open.bio ||
                    "This one keeps their story to themselves. Ride with us long enough and you might hear it."}
                </p>
                <DialogClose className="glass glass-hover mt-8 inline-flex min-h-11 w-fit items-center rounded-md px-6 text-xs font-semibold uppercase tracking-[0.16em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Close
                </DialogClose>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
