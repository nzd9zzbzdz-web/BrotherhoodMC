import type { CSSProperties } from "react";

/**
 * How the four club emblems read on the public site.
 *
 * The emblems are the transparent-ground badges drawn above the home page
 * pillars and as a rule between the About page acts. This module owns the
 * knobs an admin can turn on that set as a whole: how big they run, how their
 * colour reads, and how strongly they sit on the page. One style covers all
 * four on purpose — they are worn as a set, and four independently tinted
 * badges stop reading as one club.
 *
 * Unlike the watermark there is no blend mode and no position: the art is a
 * cut-out over whatever ground the page gives it, and where the badges stand
 * is the page's layout, not the club's. Size multiplies each surface's own
 * shipped height (the pillars and the About rule draw at different sizes, and
 * both should grow together), which is why the height rides a CSS variable
 * rather than a pixel value here.
 *
 * `DEFAULT_EMBLEM_STYLE` is the identity treatment the pages have always
 * shipped with. Stored as null-or-whole-object like the watermark style:
 * absent means this default, so every club that has never opened the tool
 * renders pixel-identical to before the field existed.
 */
export interface EmblemStyle {
  /** Multiplies the surface's shipped emblem height. 1 is the shipped size. */
  scale: number;
  /** Hue rotation in degrees, for tinting the art toward the club's colour. */
  hue: number;
  /** Colour intensity. 0 runs the art in monochrome. */
  saturate: number;
  /** Lifts or darkens the art. 1 is as drawn. */
  brightness: number;
  /** 1 is full strength; 0 hides the emblems entirely. */
  opacity: number;
}

export const DEFAULT_EMBLEM_STYLE: EmblemStyle = {
  scale: 1,
  hue: 0,
  saturate: 1,
  brightness: 1,
  opacity: 1,
};

/**
 * The one place the style becomes CSS. Both public pages and the admin
 * editor's preview call this, which is what makes the preview trustworthy
 * rather than an approximation.
 *
 * The element it lands on must set `--emblem-h` (via responsive classes, e.g.
 * `[--emblem-h:4rem] md:[--emblem-h:4.75rem]`) to its shipped height; the
 * scale multiplies that, so a size chosen on desktop stays proportionate on a
 * phone. The drop shadow that used to be a utility class is baked into the
 * filter here because an inline filter replaces a class-set one wholesale —
 * it is the art's seat on the page, not a knob. `baseOpacity` is the
 * surface's shipped strength (the About rule has always run at 0.7), which
 * the club's own opacity multiplies rather than replaces.
 */
export function emblemCss(style: EmblemStyle, baseOpacity = 1): CSSProperties {
  return {
    height: `calc(var(--emblem-h, 4rem) * ${style.scale})`,
    filter: `brightness(${style.brightness}) saturate(${style.saturate}) hue-rotate(${style.hue}deg) drop-shadow(0 4px 16px rgba(0,0,0,0.6))`,
    opacity: baseOpacity * style.opacity,
  };
}
