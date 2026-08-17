import type { ResolvedBranding } from "@/lib/branding-resolve";

/**
 * A club's branding expressed as CSS custom properties.
 *
 * Two layers come out of here, and the split is the point:
 *
 *   1. The shadcn contract (`--background`, `--primary`, `--border`, …). Every
 *      shipped component and every glass/glow utility in globals.css already
 *      mixes off these, so setting them is what recolours the existing site.
 *
 *   2. A semantic layer (`--brand-accent`, `--background-panel`,
 *      `--border-subtle`, `--text-muted`, …) that names things by ROLE rather
 *      than by shadcn slot. New markup should reach for these: "the panel
 *      ground" survives a rebrand, "#151017" does not, and even "card" is a
 *      shadcn word rather than a design one.
 *
 * Several of layer 2 are `color-mix` expressions rather than stored values, so
 * they track their source automatically — a club that changes its primary gets
 * a matching hover and glow without touching another field.
 *
 * Pure and client-safe: `<BrandStyle>` renders these into a `<style>` for a
 * whole surface, and the admin editor's preview applies the same map as inline
 * styles on one container. Same function, so the preview cannot drift from
 * what saving will actually produce.
 */
export function brandingVars(b: ResolvedBranding): Record<string, string> {
  const c = b.colors;
  return {
    // ── shadcn contract ──────────────────────────────────────────────
    "--background": c.background,
    "--foreground": c.foreground,
    "--card": c.card,
    "--card-foreground": c.cardForeground,
    // Popover mirrors card.
    "--popover": c.card,
    "--popover-foreground": c.cardForeground,
    "--primary": c.primary,
    "--primary-foreground": c.primaryForeground,
    "--secondary": c.secondary,
    "--secondary-foreground": c.secondaryForeground,
    "--muted": c.muted,
    "--muted-foreground": c.mutedForeground,
    "--accent": c.accent,
    "--accent-foreground": c.accentForeground,
    "--destructive": c.destructive,
    "--border": c.border,
    "--input": c.input,
    "--ring": c.ring,

    // The rail follows the same surface, with its own ground and edge.
    "--sidebar": c.sidebar,
    "--sidebar-foreground": c.cardForeground,
    "--sidebar-primary": c.primary,
    "--sidebar-primary-foreground": c.primaryForeground,
    "--sidebar-accent": c.secondary,
    "--sidebar-accent-foreground": c.secondaryForeground,
    "--sidebar-border": c.sidebarBorder,
    "--sidebar-ring": c.ring,

    // ── Semantic layer ───────────────────────────────────────────────
    "--brand-primary": c.primary,
    "--brand-secondary": c.secondary,
    "--brand-accent": c.accent,
    "--brand-on-primary": c.primaryForeground,
    // Lifted toward the text colour, so a hover reads as brighter on a dark
    // club and darker on a light one without either being stated.
    "--brand-accent-hover": `color-mix(in srgb, ${c.primary} 82%, ${c.foreground})`,
    "--brand-glow": c.glow,

    "--background-main": c.background,
    "--background-sidebar": c.sidebar,
    "--background-panel": c.card,
    "--background-elevated": c.elevated,

    "--border-primary": c.border,
    "--border-subtle": `color-mix(in srgb, ${c.border} 55%, transparent)`,
    // The heavier rule, already stated as the input stroke.
    "--border-strong": c.input,

    "--text-primary": c.foreground,
    "--text-secondary": `color-mix(in srgb, ${c.foreground} 78%, transparent)`,
    "--text-muted": c.mutedForeground,

    // ── Typography ───────────────────────────────────────────────────
    "--font-display": b.fonts.display,
    "--font-body": b.fonts.body,
    "--font-stat": b.fonts.mono,
  };
}

/** The same map as a CSS rule body, for a `<style>` tag. */
export function brandingCss(b: ResolvedBranding, selector: string): string {
  const lines = Object.entries(brandingVars(b)).map(([k, v]) => `${k}: ${v};`);
  return `${selector} {\n  ${lines.join("\n  ")}\n}`;
}
