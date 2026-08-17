import { notFound } from "next/navigation";
import { Palette } from "lucide-react";
import { PAGE_W } from "@/lib/page-width";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { BrandingEditor } from "@/components/portal/branding/BrandingEditor";
import { requireOrgRole } from "@/lib/auth/session";
import { BRANDING_ART, BRANDING_ART_KEYS } from "@/lib/branding-art";
import { resolveBranding } from "@/lib/branding-resolve";
import { getBranding, getOrgBySlug } from "@/lib/tenant";
import type { BrandingAssetKey } from "@/lib/types";

/**
 * Admin → Branding: the control panel for the entire site's visual identity.
 *
 * Server-side this is only a gate and two reads. `requireOrgRole(…, "admin")`
 * sits ABOVE the cached loads, never inside them — an authz decision must
 * never be what gets cached (see src/lib/cache.ts). The two branding documents
 * are the same ones both layouts already read, so opening this page costs
 * nothing extra.
 */
export default async function BrandingAdminPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  await requireOrgRole(org.id, "admin");

  const [portalDoc, publicDoc] = await Promise.all([
    getBranding(org.id, "portal"),
    getBranding(org.id, "public"),
  ]);

  const resolved = {
    portal: resolveBranding(portalDoc, "portal", org),
    public: resolveBranding(publicDoc, "public", org),
  };

  // Each slot is shown once, resolved on the surface that owns it. A "both"
  // slot is written to the two documents together by the upload action, so
  // reading either gives the same answer; portal is picked arbitrarily.
  const assetUrls = {} as Record<BrandingAssetKey, string>;
  const customAssetKeys: BrandingAssetKey[] = [];
  for (const key of BRANDING_ART_KEYS) {
    const owner = BRANDING_ART[key].surface === "public" ? resolved.public : resolved.portal;
    assetUrls[key] = owner.assets[key];
    if (owner.customAssets.has(key)) customAssetKeys.push(key);
  }

  return (
    <div className={`${PAGE_W.content} space-y-8`}>
      <div>
        <DisplayHeading className="flex items-center gap-3 text-3xl text-foreground md:text-4xl">
          <Palette className="size-7" aria-hidden />
          Branding
        </DisplayHeading>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Both faces of the organization: the clubhouse and the cover story.
          Everything the site uses to say whose club it is lives here, and
          nothing outside this page needs editing to rebrand it. Members, ranks,
          patches and activity are untouched by anything on this page.
        </p>
      </div>

      <BrandingEditor
        orgId={org.id}
        orgSlug={org.slug}
        initial={resolved}
        assetUrls={assetUrls}
        customAssetKeys={customAssetKeys}
      />
    </div>
  );
}
