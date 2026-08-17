import { brandingCss } from "@/lib/branding-css";
import type { ResolvedBranding } from "@/lib/branding-resolve";

/**
 * Injects an org's branding tokens as CSS variable overrides, scoped to a
 * [data-surface] subtree. Rendered server-side after globals.css, so these win
 * over the defaults. Zero hardcoded brand hex anywhere in components — a
 * club's colours are Firestore data, and the shipped Ravens palette lives in
 * `branding-defaults.ts` as the fallback.
 *
 * The variable map itself is `brandingVars` in `branding-css.ts`, shared with
 * the admin editor's live preview so the two can never disagree.
 */
export function BrandStyle({
  branding,
  surface,
}: {
  branding: ResolvedBranding;
  surface: "public" | "portal";
}) {
  const css = brandingCss(branding, `[data-surface="${surface}"]`);
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
