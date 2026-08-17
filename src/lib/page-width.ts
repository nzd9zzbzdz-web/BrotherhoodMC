/**
 * The portal's width scale.
 *
 * Every page used to carry its own `mx-auto max-w-*`, picked page by page and
 * ranging from 2xl to 6xl with no rule behind which got which. That is why the
 * roster looked squeezed while the black around it did nothing: the widest
 * thing the club owns sat on the same 1152px column as a settings form.
 *
 * Three widths, chosen by what a page is FOR:
 *
 *   form    — one column of controls or prose. Wider actively hurts; a text
 *             input stretched across a 27" monitor is harder to use.
 *   content — mixed reading and data. Queues, tables, timelines, and the
 *             dashboard: its territory embed is the portrait island (2356×3200),
 *             which letterboxes into dead bands once the card gets much wider
 *             than this. A summary screen is read, not toured.
 *   gallery — art the club made: the roster wall, the patch wall, the full
 *             map page, the character screen. These earn the pixels — they are
 *             the reason someone opened the portal on a big screen at all.
 *
 * 96rem = 1536px, a third wider than the old 6xl and still short of filling a
 * 1920 viewport once the nav rail and page padding are taken out. If the wall
 * wants more room later it changes here, once, for every gallery surface.
 */
export const PAGE_W = {
  form: "mx-auto w-full max-w-3xl",
  content: "mx-auto w-full max-w-5xl",
  gallery: "mx-auto w-full max-w-[96rem]",
} as const;
