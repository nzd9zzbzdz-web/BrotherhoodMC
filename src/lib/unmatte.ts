import "server-only";
import sharp, { type Sharp } from "sharp";

/**
 * Strip a solid white matte off cut-out artwork.
 *
 * `contain` slots (the club patch, the wordmark, the four emblems, patch art)
 * are cut-outs: art with a shape, fitted onto a transparent ground so it never
 * gains a rectangle. That works only when the SOURCE carries an alpha channel.
 * A JPEG cannot, and plenty of "transparent" PNGs turn out to be white-matted,
 * so the honest failure mode was a club uploading its emblems and getting four
 * white blocks on a near-black page. Sharp cannot invent alpha that was never
 * in the file, so the matte has to be measured and removed.
 *
 * It is a flood fill inwards from the edges, NOT a global white key. Keying
 * every white pixel would punch holes through the artwork itself: a bone-white
 * skull emblem is mostly matte-coloured, and a global key eats it. Only the
 * region reachable from the border without crossing the art is cleared, so
 * enclosed whites survive.
 *
 * The caller decides WHETHER art is a candidate, by checking that the source
 * was fully opaque before any resize (sharp's `stats().isOpaque`). Post-resize
 * transparency is no evidence either way, because a `contain` fit pads with
 * transparent pixels itself. This function then decides whether the pixels
 * actually look like a matte, and declines rather than guesses.
 */

/** Below this alpha a pixel is already background and the fill passes through. */
const CLEAR_ALPHA = 8;
/** Least-bright channel at or above this counts as matte white. */
const WHITE = 235;
/** Fraction of the border that must read as matte before acting at all. */
const BORDER_RATIO = 0.9;
/** Refuse above this: whatever was found, the "art" would be the matte. */
const MAX_CLEARED = 0.985;
/** Not worth rewriting the buffer below this. */
const MIN_CLEARED = 0.02;
/** Fringe pixels lighter than this get partial alpha so the cut is not jagged. */
const FRINGE = 200;

/**
 * Clear the matte, in place, in a raw RGBA buffer.
 *
 * Returns false when it declined, in which case the buffer is untouched and
 * the caller should carry on with the image exactly as it was.
 */
export function stripWhiteMatte(rgba: Buffer, width: number, height: number): boolean {
  const total = width * height;
  if (total === 0 || rgba.length < total * 4) return false;

  const at = (x: number, y: number) => (y * width + x) * 4;
  /** How close to white a pixel is, by its least-bright channel. */
  const level = (o: number) => Math.min(rgba[o], rgba[o + 1], rgba[o + 2]);
  /** Transparent padding counts too: a `contain` fit puts it around the art. */
  const isOutside = (o: number) => rgba[o + 3] < CLEAR_ALPHA || level(o) >= WHITE;

  let border = 0;
  let matte = 0;
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      border++;
      if (isOutside(at(x, y))) matte++;
    }
  }
  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) {
      border++;
      if (isOutside(at(x, y))) matte++;
    }
  }
  if (border === 0 || matte / border < BORDER_RATIO) return false;

  const outside = new Uint8Array(total);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (outside[p] || !isOutside(p * 4)) return;
    outside[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length) {
    const p = stack.pop() as number;
    const x = p % width;
    const y = (p - x) / width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  let cleared = 0;
  for (let p = 0; p < total; p++) if (outside[p]) cleared++;
  const ratio = cleared / total;
  if (ratio > MAX_CLEARED || ratio < MIN_CLEARED) return false;

  for (let p = 0; p < total; p++) {
    const o = p * 4;
    if (outside[p]) {
      rgba[o + 3] = 0;
      continue;
    }
    // Anti-aliased edges blend art into matte, so a pixel touching the hole is
    // part matte. Fade it by how light it is rather than leave a white rim.
    const x = p % width;
    const y = (p - x) / width;
    const touching =
      (x + 1 < width && outside[p + 1] === 1) ||
      (x > 0 && outside[p - 1] === 1) ||
      (y + 1 < height && outside[p + width] === 1) ||
      (y > 0 && outside[p - width] === 1);
    if (!touching) continue;
    const l = level(o);
    if (l > FRINGE) {
      rgba[o + 3] = Math.max(0, Math.round(255 - ((l - FRINGE) * 255) / (255 - FRINGE)));
    }
  }
  return true;
}

/**
 * A cut-out pipeline with any white matte taken off, or the original untouched.
 *
 * `base` must already be resized with `fit: "contain"` on a transparent ground.
 * `input` is the ORIGINAL upload, used only to ask whether it had alpha of its
 * own: a source that is already a cut-out is never second-guessed, and one that
 * cannot carry alpha at all (every JPEG) is exactly the case worth rescuing.
 * Returns a pipeline the caller can clone and encode as before.
 */
export async function containWithoutMatte(
  base: Sharp,
  input: Buffer,
): Promise<Sharp> {
  let opaque: boolean;
  try {
    opaque = (await sharp(input).stats()).isOpaque;
  } catch {
    return base; // unreadable stats are not a reason to fail an upload
  }
  if (!opaque) return base;

  const { data, info } = await base
    .clone()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (!stripWhiteMatte(data, info.width, info.height)) return base;
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  });
}
