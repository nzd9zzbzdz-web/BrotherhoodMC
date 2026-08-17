/**
 * What the vest is MADE of, as opposed to what the club paints on it.
 *
 * These are deliberately not branding fields. A cut is black leather with gold
 * embroidery thread regardless of whose colours are stitched onto it, and a
 * club that changed its primary to blue would not expect the leather to turn
 * blue. Everything on the vest that IS club identity — rocker borders, the
 * centre patch ground, the rank tab edge — reads from `var(--brand-*)`
 * instead, so a rebrand restitches the club's colours onto the same jacket.
 *
 * They live in one file rather than inline because they were inline: the same
 * two browns were written into `CutViewer` and `VestBody` separately, which is
 * how a vest ends up with a body and a pocket in different leathers.
 */

/** Embroidery thread — the gold on rockers, tabs and the centre patch. */
export const THREAD_GOLD = "#EBCB63";

/** Backing behind stitched lettering: dark, slightly warm. */
export const THREAD_BACKING = "linear-gradient(180deg,#231d12,#171308)";

/** The badge ground a patch token is embroidered onto. */
export const PATCH_GROUND = "radial-gradient(circle at 50% 30%,#2a2620,#12100c)";

/** The Sergeant-at-Arms diamond: oxblood leather, pale thread. */
export const SAA_EDGE = "#C64A3E";
export const SAA_GROUND = "#1a0f0c";
export const SAA_THREAD = "#E9A99F";

/** The jacket itself — worn black leather, lit from the top left. */
export const LEATHER_BODY = "linear-gradient(160deg,#1c1913 0%,#14110c 45%,#0d0b07 100%)";
