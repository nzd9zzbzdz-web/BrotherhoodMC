import { notFound } from "next/navigation";
import { getBranding, getOrgBySlug } from "@/lib/tenant";
import { servesOrg } from "@/lib/tenant-lock";
import { resolveBranding } from "@/lib/branding-resolve";
import { BrandStyle } from "@/components/theme/BrandStyle";
import { BrandingProvider } from "@/components/theme/BrandingProvider";
import { BodySurface } from "@/components/theme/BodySurface";
import { CharityHeader } from "@/components/public/CharityHeader";
import { CharityFooter } from "@/components/public/CharityFooter";
import { MusicPlayer } from "@/components/media/MusicPlayer";

export default async function PublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org || org.status !== "active") notFound();
  // A deployment pinned to one club (ORG_SLUG) does not serve the others,
  // even though they share a database. See src/lib/tenant-lock.ts.
  if (!servesOrg(orgSlug)) notFound();

  // Resolved once, here. Everything below reads a value where every colour and
  // every image URL is already present, which is what keeps `?? "/brand/..."`
  // out of components. A club with no branding document renders the shipped
  // defaults rather than 404ing, so a fresh tenant is never a broken site.
  const branding = resolveBranding(await getBranding(org.id, "public"), "public", org);

  return (
    <BrandingProvider branding={branding}>
      <div
        data-surface="public"
        className="flex min-h-dvh flex-col bg-background text-foreground"
        style={{ fontFamily: "var(--font-body)" }}
      >
        <BrandStyle branding={branding} surface="public" />
        <BodySurface surface="public" />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        <CharityHeader orgSlug={orgSlug} />
        <main id="main" className="flex-1">
          {children}
        </main>
        <CharityFooter orgSlug={orgSlug} branding={branding} />
        {/* No anthem chosen, no player. Mounting it with an empty id loads the
          embed anyway and YouTube parks "This video is unavailable" in the
          corner of an otherwise finished site. */}
      {branding.anthemVideoId && (
        <MusicPlayer videoId={branding.anthemVideoId} label="Club Anthem" />
      )}
      </div>
    </BrandingProvider>
  );
}
