import type { CSSProperties } from "react";

/**
 * How the home page watermark sits and glows.
 *
 * The watermark is the oversized illustration behind the four pillars,
 * composited with mix-blend-mode:lighten over a near-black band (see the
 * comment where the public home page draws it). This module owns the knobs an
 * admin can turn on that treatment: where the art sits, how big it runs, and
 * how its colour reads. The band itself (its height, the pillar layout) is not
 * up for grabs — only the art on it.
 *
 * Everything is expressed relative to the band, never in pixels, because the
 * band is as wide as the viewport and as tall as the pillar copy makes it:
 * `x`/`y` are fractions of the band's width/height, `scale` multiplies the
 * fitted size. The art keeps `object-fit: contain` underneath, so on a narrow
 * phone it still fits the band first and THEN takes the club's scale — a
 * setting made on a desktop cannot become a wall of art on a phone.
 *
 * `DEFAULT_WATERMARK_STYLE` is the treatment the page has always shipped with
 * (identity transform, the original filter numbers). Styling is stored as
 * null-or-whole-object like the plate layout: absent means this default, so
 * every club that has never opened the tool renders pixel-identical to before
 * the field existed.
 */
export interface WatermarkStyle {
  /** Multiplies the fitted size. 1 fills the band's height as shipped. */
  scale: number;
  /** Horizontal shift as a fraction of the band width. 0 is flush left. */
  x: number;
  /** Vertical shift as a fraction of the band height. 0 is centred. */
  y: number;
  /** Hue rotation in degrees, for tinting the art toward the club's colour. */
  hue: number;
  /** Colour intensity. 0 is monochrome. */
  saturate: number;
  /** How hard the art glows out of the black. */
  brightness: number;
  /** 1 is full strength; 0 hides the watermark entirely. */
  opacity: number;
}

export const DEFAULT_WATERMARK_STYLE: WatermarkStyle = {
  scale: 1,
  x: 0,
  y: 0,
  hue: 0,
  saturate: 1.15,
  brightness: 3.8,
  opacity: 1,
};

/**
 * The one place the style becomes CSS. The public home page and the admin
 * editor's preview both call this, which is what makes the preview
 * trustworthy rather than an approximation — the same principle as
 * `draftToResolved` painting the branding preview.
 *
 * The element these land on is the full-band image (`fill` +
 * `object-contain object-left`), so translate percentages are band fractions
 * and the transform moves the art without disturbing the contain fit.
 * `transform-origin` is left-centre — where the art actually sits — so
 * growing it holds the left edge and swells the art in place instead of
 * sliding it toward the band's middle. Contrast stays baked at the shipped
 * value: it exists to bed the art into the black, not to say whose club this
 * is, and one more slider would not earn its keep.
 */
export function watermarkCss(style: WatermarkStyle): CSSProperties {
  return {
    transformOrigin: "left center",
    transform: `translate(${style.x * 100}%, ${style.y * 100}%) scale(${style.scale})`,
    mixBlendMode: "lighten",
    filter: `brightness(${style.brightness}) contrast(1.12) saturate(${style.saturate}) hue-rotate(${style.hue}deg)`,
    opacity: style.opacity,
  };
}
