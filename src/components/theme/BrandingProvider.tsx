"use client";

import { createContext, useContext } from "react";
import type { ResolvedBranding } from "@/lib/branding-resolve";

/**
 * Makes the resolved branding available to client components.
 *
 * Server components take branding as a prop or resolve it themselves; that
 * covers most of the site. This exists for the handful of client components
 * that draw branded imagery or copy and sit several levels below a layout —
 * the public header and footer, the anthem player, the cut viewer. Threading a
 * `clubPatch` prop through each of them is how "/brand/club-patch.webp" ends
 * up written into three separate files, which is exactly what it did.
 *
 * Costs nothing at runtime: the value is resolved ONCE per request in the
 * layout (from the one branding document it already reads) and serialized into
 * the tree. There is no fetch here, no effect, and no state — so a colour
 * change re-renders from the server rather than re-rendering every consumer.
 */
const BrandingContext = createContext<ResolvedBranding | null>(null);

export function BrandingProvider({
  branding,
  children,
}: {
  branding: ResolvedBranding;
  children: React.ReactNode;
}) {
  return (
    <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>
  );
}

/**
 * The current surface's resolved branding. Throws outside a provider rather
 * than returning defaults: a component silently rendering the Ravens patch on
 * another club's site is the failure this whole refactor exists to prevent, so
 * it should be a crash in development, not a surprise in production.
 */
export function useBranding(): ResolvedBranding {
  const value = useContext(BrandingContext);
  if (!value) {
    throw new Error("useBranding must be used inside <BrandingProvider>");
  }
  return value;
}
