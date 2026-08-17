import Image from "next/image";
import Link from "next/link";
import type { ResolvedBranding } from "@/lib/branding-resolve";

/**
 * A server component on purpose: it draws no interactive chrome, so taking the
 * resolved branding as a prop from the layout keeps it off the client bundle
 * that every public page pays for. `useBranding` is for the components that
 * are already client-side.
 */
export function CharityFooter({
  orgSlug,
  branding,
}: {
  orgSlug: string;
  branding: ResolvedBranding;
}) {
  const { name, shortName, location, addressLine, tagline, assets } = branding;
  const base = `/${orgSlug}`;
  // Deliberately NOT glass — the footer is the calm end of the cover story.
  // Just an ember-tinted hairline up top, mixed from the tenant's primary so
  // a rebrand recolors it for free.
  return (
    <footer className="border-t [border-top-color:color-mix(in_srgb,var(--brand-primary)_18%,transparent)] bg-background text-muted-foreground">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:grid-cols-2 md:grid-cols-3">
        <div>
          <p className="flex items-center gap-2.5 text-foreground">
            <Image
              src={assets.clubPatch}
              alt=""
              width={720}
              height={1080}
              unoptimized
              aria-hidden
              className="h-32 w-auto object-contain"
            />
            <span className="text-lg" style={{ fontFamily: "var(--font-display)" }}>{name}</span>
          </p>
          {tagline && (
            <p className="mt-3 text-sm uppercase tracking-[0.14em] text-muted-foreground">{tagline}</p>
          )}
        </div>
        <nav aria-label="Footer" className="text-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-primary">The Club</p>
          <ul className="space-y-2">
            {/* "About RODMC" rather than "About the Ravens": the label has to
                survive a rebrand, and the short name is the club's own word
                for itself. */}
            <li><Link href={`${base}/about`} className="hover:text-foreground">About {shortName}</Link></li>
            <li><Link href={`${base}/join`} className="hover:text-foreground">Prospect With Us</Link></li>
            <li><Link href={`${base}/volunteer-resources`} className="hover:text-foreground">Member Login</Link></li>
          </ul>
        </nav>
        <div className="text-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Territory</p>
          {addressLine && <p>{addressLine}</p>}
          {location && <p>{location}</p>}
          <p className="mt-2">
            <Link href={`${base}/contact`} className="hover:text-foreground">Send word</Link>
          </p>
        </div>
      </div>
      <div className="border-t border-border/40 py-4 text-center text-xs text-muted-foreground/70">
        © {new Date().getFullYear()} {name}. Ride free.
      </div>
    </footer>
  );
}
