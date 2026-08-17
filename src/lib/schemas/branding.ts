import { z } from "zod";

/**
 * What the Branding editor is allowed to write.
 *
 * Deliberately narrow. A branding document also carries `assets` (written only
 * by the upload action) and the long-form club copy `story` / `storyTitles` /
 * `creed`. Neither is in this schema, and the save action merges rather than
 * replaces, so a colour change can never blank a club's history — which is the
 * one way a "visual identity" editor could destroy business content.
 */

/**
 * Any CSS colour the browser will actually paint: hex, rgb/rgba, hsl/hsla, or
 * a `color-mix()` expression. Validated by shape rather than by an allowlist
 * of formats, because the shipped Ravens palette itself mixes hex with rgba
 * and a stricter rule would reject the defaults.
 */
const cssColor = z
  .string()
  .trim()
  .min(1, "Pick a colour")
  .max(120, "That is not a colour value")
  // No quotes, semicolons, braces or comment markers: these land inside a
  // `<style>` element, so the value must not be able to close a declaration
  // and start another one.
  .regex(/^[^"'`;{}<>\\]+$/, "That is not a colour value")
  .refine((v) => !v.includes("/*") && !v.includes("*/"), "That is not a colour value");

export const brandingColorsSchema = z.object({
  background: cssColor,
  foreground: cssColor,
  card: cssColor,
  cardForeground: cssColor,
  primary: cssColor,
  primaryForeground: cssColor,
  secondary: cssColor,
  secondaryForeground: cssColor,
  muted: cssColor,
  mutedForeground: cssColor,
  accent: cssColor,
  accentForeground: cssColor,
  destructive: cssColor,
  border: cssColor,
  input: cssColor,
  ring: cssColor,
  sidebar: cssColor,
  sidebarBorder: cssColor,
  glow: cssColor,
  elevated: cssColor,
});

export type BrandingColorsInput = z.infer<typeof brandingColorsSchema>;

/** A YouTube video id, or empty to fall back to the shipped anthem. */
const videoId = z
  .string()
  .trim()
  .max(24)
  .regex(/^[A-Za-z0-9_-]*$/, "That is not a YouTube video id");

/**
 * The chain-of-command plate layout: fractions of the displayed art (see
 * `src/lib/plate-layout.ts`). Positions may run a little past the edges — a
 * box deliberately overhanging the frame is a layout choice, not corruption —
 * but not so far that a lost box cannot be dragged back. Sizes stay positive
 * so nothing can be saved at zero and become unclickable in the editor.
 */
const plateFrac = z.number().min(-0.5).max(1.5);
const plateDim = z.number().min(0.002).max(1.5);
const plateFontSize = z.number().min(0.002).max(0.5);
const plateBox = z.object({ x: plateFrac, y: plateFrac, w: plateDim, h: plateDim });
const plateTextBox = plateBox.extend({ size: plateFontSize });
const plateSeat = z.object({
  face: z.object({ x: plateFrac, y: plateFrac, d: plateDim }),
  name: plateTextBox,
  rank: plateTextBox,
});

export const plateLayoutSchema = z.object({
  heading: plateTextBox.extend({ blurbSize: plateFontSize }),
  president: plateSeat,
  // The counts match the template art: five officer rings, three stat slots.
  officers: z.array(plateSeat).length(5),
  stats: z.array(plateTextBox.extend({ labelSize: plateFontSize })).length(3),
});

/**
 * The home page watermark treatment (see `src/lib/watermark.ts`). Bounds sit
 * a little outside what the editor's sliders offer, plate-layout style, so a
 * value the tool produced can never be refused by Save. Position may run past
 * the band — bleeding off an edge is the whole point of the art — but not so
 * far that a lost watermark cannot be dragged back.
 */
const watermarkFrac = z.number().min(-2).max(2);
export const watermarkStyleSchema = z.object({
  scale: z.number().min(0.05).max(5),
  x: watermarkFrac,
  y: watermarkFrac,
  hue: z.number().min(-180).max(180),
  saturate: z.number().min(0).max(5),
  brightness: z.number().min(0).max(12),
  opacity: z.number().min(0).max(1),
});

/**
 * The public emblem treatment (see `src/lib/emblem-style.ts`). Same
 * wider-than-the-sliders rule as the watermark: nothing the tool produces can
 * be refused by Save.
 */
export const emblemStyleSchema = z.object({
  scale: z.number().min(0.05).max(5),
  hue: z.number().min(-180).max(180),
  saturate: z.number().min(0).max(5),
  brightness: z.number().min(0).max(8),
  opacity: z.number().min(0).max(1),
});

export const brandingDraftSchema = z.object({
  orgDisplayName: z.string().trim().min(1, "The club needs a name").max(80),
  shortName: z.string().trim().max(16, "Keep the short name under 16 characters"),
  location: z.string().trim().max(60),
  addressLine: z.string().trim().max(120),
  tagline: z.string().trim().max(160),
  mission: z.string().trim().max(1200),
  // Blank falls back to the club preset on resolve, so no minimum.
  chainTitle: z.string().trim().max(40, "Keep the plate heading under 40 characters"),
  chainBlurb: z.string().trim().max(160),
  // Null means the template layout; the save action deletes the field.
  plateLayout: plateLayoutSchema.nullable(),
  // Null means the shipped watermark treatment; same delete-on-save rule.
  watermarkStyle: watermarkStyleSchema.nullable(),
  // Null means the shipped emblem treatment; same delete-on-save rule.
  emblemStyle: emblemStyleSchema.nullable(),
  anthemVideoId: videoId,
  colors: brandingColorsSchema,
});

export type BrandingDraftInput = z.infer<typeof brandingDraftSchema>;

export const saveBrandingSchema = z.object({
  orgId: z.string().min(1),
  surface: z.enum(["public", "portal"]),
  draft: brandingDraftSchema,
  /**
   * Whether the club's own name changes with it. The display name lives on the
   * organization document as well as both branding docs, and a club renamed on
   * one surface only reads as a bug — but the caller decides, because the
   * public shopfront legitimately runs under a different name from the portal
   * ("… Community Foundation" vs "… MC").
   */
  renameOrg: z.boolean().default(false),
});

export type SaveBrandingInput = z.input<typeof saveBrandingSchema>;

/**
 * A branding preset: what Export writes and Import reads.
 *
 * Colours and copy only. Images are megabytes and are already addressable
 * through the asset cards, so a preset stays a small file that can live in a
 * repo or a chat message. `version` is here so a future shape change can be
 * detected rather than silently half-applied.
 */
export const brandingPresetSchema = z.object({
  version: z.literal(1),
  name: z.string().trim().max(80).optional(),
  public: brandingDraftSchema.partial().optional(),
  portal: brandingDraftSchema.partial().optional(),
});

export type BrandingPreset = z.infer<typeof brandingPresetSchema>;
