import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getBranding, getOrgBySlug } from "@/lib/tenant";
import { servesOrg } from "@/lib/tenant-lock";
import { getMember, listRanks } from "@/lib/queries";
import { resolveBranding } from "@/lib/branding-resolve";
import { BrandStyle } from "@/components/theme/BrandStyle";
import { BrandingProvider } from "@/components/theme/BrandingProvider";
import { BodySurface } from "@/components/theme/BodySurface";
import { PortalShell } from "@/components/portal/PortalShell";
import { MusicPlayer } from "@/components/media/MusicPlayer";
import { Toaster } from "@/components/ui/sonner";

export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  // Real verification happens HERE (proxy only checked cookie presence).
  // Neither lookup needs the other, so they run in parallel.
  const [org, user] = await Promise.all([getOrgBySlug(orgSlug), getSessionUser()]);
  if (!org || org.status !== "active") notFound();
  // A deployment pinned to one club (ORG_SLUG) does not serve the others,
  // even though they share a database. See src/lib/tenant-lock.ts.
  if (!servesOrg(orgSlug)) notFound();
  if (!user) redirect(`/${orgSlug}/volunteer-resources?signin=1`);

  const entry = user.claims.orgs?.[org.id];
  const isSuper = user.claims.superAdmin === true;
  if (!entry && !isSuper) {
    // Generic bounce — never reveal the portal exists to outsiders.
    redirect(`/${orgSlug}/volunteer-resources`);
  }

  const role = isSuper ? "admin" : entry!.r;
  const memberId = entry?.m ?? null;

  // Branding, member, and ranks don't depend on each other — fetch together.
  // getMember/listRanks are request-cached, so pages that need them ride free.
  const [brandingDoc, member, ranks] = await Promise.all([
    getBranding(org.id, "portal"),
    memberId ? getMember(org.id, memberId) : null,
    memberId ? listRanks(org.id) : [],
  ]);
  // Resolved once, here — see the note in the public layout. A portal with no
  // branding document now renders the shipped defaults instead of 404ing,
  // which matters because that 404 locked admins out of the very page they
  // would use to fix it.
  const branding = resolveBranding(brandingDoc, "portal", org);

  const rankName = member
    ? ranks.find((r) => r.id === member.rankId)?.name
    : undefined;

  return (
    <BrandingProvider branding={branding}>
    <div
      data-surface="portal"
      className="dark bg-background text-foreground"
      style={{ fontFamily: "var(--font-body)" }}
    >
      <BrandStyle branding={branding} surface="portal" />
      <BodySurface surface="portal" dark />
      <PortalShell
        orgSlug={orgSlug}
        orgName={branding.name}
        tagline={branding.tagline}
        role={role}
        memberId={memberId}
        viewer={
          member
            ? {
                roadName: member.roadName,
                displayName: member.displayName,
                rankName: rankName ?? "",
              }
            : { roadName: "Platform", displayName: user.email ?? "Super Admin", rankName: "Super Admin" }
        }
      >
        {children}
      </PortalShell>
      {/* The anthem follows members inside. Mounted in the LAYOUT, so moving
          between portal pages never restarts the track — only a full reload
          does. Same component and corner as the public site; the portal's
          brand vars just repaint it. */}
      {/* No anthem chosen, no player. Mounting it with an empty id loads the
          embed anyway and YouTube parks "This video is unavailable" in the
          corner of an otherwise finished site. */}
      {branding.anthemVideoId && (
        <MusicPlayer videoId={branding.anthemVideoId} label="Club Anthem" />
      )}
      {/* Toasts moved off bottom-right when the player took that corner —
          a 356px toast sat squarely on the play pill. */}
      <Toaster richColors position="top-right" />
    </div>
    </BrandingProvider>
  );
}
