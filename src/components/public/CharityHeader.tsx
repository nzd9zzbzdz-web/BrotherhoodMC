"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranding } from "@/components/theme/BrandingProvider";

type NavItem = { label: string; href?: string };

// Items without `href` are shown as labels only until their pages exist.
const NAV: NavItem[] = [
  { href: "", label: "Home" },
  { href: "/about", label: "About" },
  // The club roster lives in a section of the home page rather than its own
  // route, so this jumps there from wherever you are on the public site.
  { href: "#brotherhood", label: "Brotherhood" },
  { label: "Chapters" },
  { href: "/gallery", label: "Media" },
  { href: "/join", label: "Join Us" },
  { href: "/contact", label: "Contact" },
];

export function CharityHeader({ orgSlug }: { orgSlug: string }) {
  // Name and patch both come from the surface's branding rather than from
  // props: the footer and the About page draw the same two things, and passing
  // them down separately is how three copies of "/brand/club-patch.webp" got
  // written into three files.
  const { name, assets } = useBranding();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const base = `/${orgSlug}`;

  // glass-panel, not a solid bar: the header is the only floating chrome on
  // the public site, so it alone earns the blur. Side/top borders stripped —
  // a full-bleed sticky bar only wants its bottom hairline. Overflow stays
  // visible so the CTA's underglow can bloom past it.
  return (
    <header className="glass-panel sticky top-0 z-40 border-x-0 border-t-0">
      {/* Oversized club patch pinned to the far-left edge of the header,
          overhanging the bar onto the hero. z-10 keeps it above the nav;
          lg:pl on the bar reserves room so links never slide under it. */}
      <Link
        href={base}
        aria-label={name}
        onClick={() => {
          if (pathname === base) window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        className="absolute left-4 top-2 z-10"
      >
        <Image
          src={assets.clubPatch}
          alt={name}
          width={720}
          height={1080}
          priority
          unoptimized
          className="h-32 w-auto object-contain drop-shadow-[0_10px_28px_rgba(0,0,0,0.7)] sm:h-40 md:h-52 lg:h-60"
        />
      </Link>
      <div className="mx-auto flex h-24 max-w-6xl items-center justify-end gap-4 px-4 md:h-28 lg:pl-[240px]">
        <nav aria-label="Main" className="relative z-20 hidden items-center gap-1 lg:flex">
          {NAV.map((item) => {
            if (item.href === undefined) {
              return (
                <span
                  key={item.label}
                  aria-disabled
                  title="Coming soon"
                  className="flex min-h-11 cursor-default items-center px-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/60"
                >
                  {item.label}
                </span>
              );
            }
            const href = `${base}${item.href}`;
            const active =
              item.href === "" ? pathname === base : pathname.startsWith(href);
            return (
              <Link
                key={item.label}
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (href === pathname)
                    window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className={cn(
                  // Ember underline marks the active page; hovering a link
                  // previews the same underline at half strength — quieter
                  // than a background fill on floating glass.
                  "flex min-h-11 items-center px-3 text-xs font-semibold uppercase tracking-[0.14em] decoration-2 underline-offset-[6px] transition-colors duration-200",
                  active
                    ? "text-primary underline decoration-primary"
                    : "text-muted-foreground hover:text-foreground hover:underline hover:decoration-primary/50",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          <Link
            href={`${base}/volunteer-resources`}
            className="glass glass-hover underglow ml-3 flex min-h-11 items-center rounded-sm px-5 text-xs font-semibold uppercase tracking-[0.14em] text-primary"
          >
            Member Login
          </Link>
        </nav>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="glass glass-hover flex size-11 items-center justify-center rounded-sm text-foreground lg:hidden"
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </button>
      </div>

      {open && (
        // No background of its own — the menu lives inside the header, so the
        // glass-panel blur behind it is already doing the legibility work a
        // solid fill used to.
        <nav aria-label="Mobile" className="relative z-20 border-t border-border/60 px-4 pb-4 lg:hidden">
          {NAV.map((item) =>
            item.href !== undefined ? (
              <Link
                key={item.label}
                href={`${base}${item.href}`}
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center rounded-sm px-3 text-xs font-semibold uppercase tracking-[0.14em] text-foreground hover:bg-foreground/5"
              >
                {item.label}
              </Link>
            ) : (
              <span
                key={item.label}
                aria-disabled
                className="flex min-h-11 items-center px-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/60"
              >
                {item.label}
              </span>
            ),
          )}
          <Link
            href={`${base}/volunteer-resources`}
            onClick={() => setOpen(false)}
            className="glass glass-hover underglow mt-2 flex min-h-11 items-center justify-center rounded-sm px-5 text-xs font-semibold uppercase tracking-[0.14em] text-primary"
          >
            Member Login
          </Link>
        </nav>
      )}
    </header>
  );
}
