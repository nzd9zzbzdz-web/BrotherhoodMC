/**
 * Generate the blank club's placeholder artwork into `public/brand/_platform`.
 *
 * These are what an unbranded tenant renders. They are deliberately plain: a
 * dark ground, a hairline frame, and a short label saying what the slot is.
 * The point is that an unbranded club looks UNFINISHED rather than
 * finished-in-someone-else's-colours — the second is the failure that ships to
 * members by accident.
 *
 * Committed to the repo rather than generated at build time, so the files are
 * reviewable and the build stays a build. Re-run only if the slot list or the
 * neutral palette changes:
 *
 *   npx tsx scripts/make-placeholder-art.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT = path.join(process.cwd(), "public", "brand", "_platform");

/** Matches PLATFORM_PRESET's palette in src/lib/clubs/platform.ts. */
const GROUND = "#141417";
const LINE = "rgba(232,232,234,0.16)";
const TEXT = "rgba(232,232,234,0.34)";

type Slot = {
  name: string;
  w: number;
  h: number;
  label: string;
  /** Cut-out slots get a transparent ground so `contain` fitting still works. */
  transparent?: boolean;
  /** Round the frame into a disc, for badge-shaped slots. */
  disc?: boolean;
  /**
   * Draw on a NEAR-BLACK ground with barely-there strokes. Only the watermark
   * needs this: the home page composites it with mix-blend-mode:lighten and
   * brightness(3.8), which takes the per-pixel max against the section behind
   * it. A mid-grey placeholder under that filter glows lavender across a
   * quarter of the page.
   */
  blended?: boolean;
};

const SLOTS: Slot[] = [
  { name: "backdrop-portrait", w: 600, h: 800, label: "Roster backdrop" },
  { name: "stage-landscape", w: 1600, h: 1067, label: "Character stage" },
  { name: "hero", w: 1920, h: 820, label: "Hero image" },
  { name: "patch", w: 720, h: 1080, label: "Club patch", transparent: true },
  { name: "wordmark", w: 1200, h: 400, label: "Wordmark", transparent: true },
  { name: "emblem", w: 320, h: 320, label: "Emblem", transparent: true, disc: true },
  // The home page composites the watermark with mix-blend-mode:lighten, which
  // needs a near-black ground to disappear into the section behind it.
  { name: "watermark", w: 1200, h: 1200, label: "Watermark", disc: true, blended: true },
];

function svg({ w, h, label, transparent, disc, blended }: Slot): string {
  const ground = blended ? "#020202" : GROUND;
  const line = blended ? "rgba(255,255,255,0.035)" : LINE;
  const text = blended ? "rgba(255,255,255,0.05)" : TEXT;
  const inset = Math.round(Math.min(w, h) * 0.04);
  const fw = w - inset * 2;
  const fh = h - inset * 2;
  const radius = disc ? Math.min(fw, fh) / 2 : Math.round(Math.min(w, h) * 0.03);
  const fontSize = Math.max(12, Math.round(Math.min(w, h) * 0.055));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="${transparent ? "none" : ground}"/>
  <rect x="${inset}" y="${inset}" width="${fw}" height="${fh}" rx="${radius}"
        fill="none" stroke="${line}" stroke-width="${Math.max(1, Math.round(w / 400))}"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
        font-family="Inter, Segoe UI, sans-serif" font-size="${fontSize}"
        letter-spacing="${(fontSize * 0.14).toFixed(1)}" fill="${text}">${label.toUpperCase()}</text>
</svg>`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const slot of SLOTS) {
    const buf = await sharp(Buffer.from(svg(slot)))
      .webp({ quality: 90 })
      .toBuffer();
    const file = path.join(OUT, `${slot.name}.webp`);
    await writeFile(file, buf);
    console.log(`${slot.name}.webp  ${slot.w}x${slot.h}  ${(buf.length / 1024).toFixed(1)}KB`);
  }
  console.log(`\nWrote ${SLOTS.length} placeholders to public/brand/_platform`);
}

main();
