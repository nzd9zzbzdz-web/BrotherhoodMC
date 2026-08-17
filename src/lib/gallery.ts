import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { listGalleryPhotos } from "@/lib/queries";
import type { GalleryPhoto } from "@/lib/types";
import type { Timestamp } from "firebase-admin/firestore";

/**
 * One photo as the public surfaces want it, whichever side it came from —
 * a file shipped in `public/gallery` or a member upload in Firestore.
 *
 * Distinct from `GalleryPhoto` in types.ts, which is the Firestore DOCUMENT.
 * This is the display shape the filmstrip, the slider and the masonry consume.
 */
export type GalleryImage = {
  src: string;
  caption: string;
  /** Intrinsic pixel dimensions — drives the masonry aspect ratio. */
  width: number;
  height: number;
  /** Tiny inlined WebP for next/image `placeholder="blur"`. */
  blurDataURL: string;
  /**
   * Skip Next's image optimizer. True for uploads: the action already capped
   * them at 1600px webp and the route serves them `immutable`, so optimizing
   * again would bill a transformation to re-encode what we sized ourselves.
   * Shipped disk photos are full-size PNGs and still want the optimizer.
   */
  unoptimized?: boolean;
};

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

/**
 * Per-club curation, read from `public/gallery/<slug>/_captions.json`.
 *
 * A JSON file in the club's own folder rather than a table in this module:
 * the whole point of per-slug folders is that adding a club touches no code,
 * and a curated caption list in here would have been one more place a second
 * club had to be added by hand. Absent or malformed, every photo is captioned
 * from its filename in alphabetical order, which is what a club that has just
 * dropped its photos in wants.
 */
type Curation = { file: string; title: string }[];

function readCuration(dir: string): Curation {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "_captions.json"), "utf8"));
    const order = raw?.order;
    if (!Array.isArray(order)) return [];
    return order.filter(
      (e: unknown): e is { file: string; title: string } =>
        typeof (e as { file?: unknown })?.file === "string" &&
        typeof (e as { title?: unknown })?.title === "string",
    );
  } catch {
    return [];
  }
}

// Caption for files not in CURATION: strip an ordering prefix like "01-" and
// turn separators into spaces.
function deriveCaption(file: string): string {
  return path
    .basename(file, path.extname(file))
    .replace(/^\d+[-_\s]*/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

async function loadGalleryPhotos(slug: string): Promise<GalleryImage[]> {
  // Per CLUB, not per deployment. A flat public/gallery was read by every org,
  // so a second club on one deployment showed the first club's photo wall on
  // its own home page and Media page.
  const dir = path.join(process.cwd(), "public", "gallery", slug);
  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()));
  } catch {
    return [];
  }

  const curation = readCuration(dir);
  const orderOf = new Map(curation.map((c, i) => [c.file, i]));
  const titleOf = new Map(curation.map((c) => [c.file, c.title]));

  files.sort((a, b) => {
    const ia = orderOf.get(a) ?? Number.POSITIVE_INFINITY;
    const ib = orderOf.get(b) ?? Number.POSITIVE_INFINITY;
    return ia === ib ? a.localeCompare(b) : ia - ib;
  });

  return Promise.all(
    files.map(async (file) => {
      const full = path.join(dir, file);
      let width = 1200;
      let height = 900;
      let blurDataURL =
        "data:image/svg+xml;base64," +
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="#12090c"/></svg>',
        ).toString("base64");

      try {
        const meta = await sharp(full).metadata();
        if (meta.width && meta.height) {
          width = meta.width;
          height = meta.height;
        }
        const blur = await sharp(full)
          .resize(24, null, { fit: "inside" })
          .webp({ quality: 30 })
          .toBuffer();
        blurDataURL = `data:image/webp;base64,${blur.toString("base64")}`;
      } catch {
        // Keep the fallback dimensions + solid-color placeholder.
      }

      return {
        src: `/gallery/${slug}/${encodeURIComponent(file)}`,
        caption: titleOf.get(file) ?? deriveCaption(file),
        width,
        height,
        blurDataURL,
      };
    }),
  );
}

// A club's gallery folder is immutable within a deployment, so in production
// each manifest (dimensions + blur placeholders) is computed once per server
// instance. Keyed BY SLUG, so two clubs on one deployment each get their own
// rather than sharing whichever was read first. In dev we recompute so newly
// dropped photos appear on refresh.
const cached = new Map<string, Promise<GalleryImage[]>>();

/** The photos shipped in `public/gallery/<slug>`, in curated order. */
export function getGalleryPhotos(slug: string): Promise<GalleryImage[]> {
  if (process.env.NODE_ENV !== "production") return loadGalleryPhotos(slug);
  let hit = cached.get(slug);
  if (!hit) {
    hit = loadGalleryPhotos(slug);
    cached.set(slug, hit);
  }
  return hit;
}

/**
 * Where a gallery photo's bytes are served from. The `v` is the photo's
 * updatedAt, so the URL changes only when the image does and the route can
 * answer `immutable` — same contract as `patchArtUrl`.
 */
export function galleryPhotoUrl(orgId: string, photo: GalleryPhoto): string {
  const v = (photo.updatedAt as Timestamp)?.toMillis?.() ?? 0;
  return `/api/orgs/${orgId}/gallery/${photo.id}?v=${v}`;
}

/**
 * The public gallery: member uploads the club has published, newest first,
 * followed by the curated set shipped on disk.
 *
 * The two sources are MERGED rather than migrated. `public/gallery/<slug>` is
 * already committed, already live, and costs nothing to serve; moving those
 * twenty-odd files into Firestore would be a destructive one-way step against
 * production data for no gain. New photos simply lead, which is what a club
 * gallery wants — the founding shots keep their curated order underneath.
 *
 * Takes the SLUG as well as the org id because the two sources are scoped
 * differently: uploads by org id in Firestore, shipped photos by slug on disk.
 */
export async function composeGallery(
  orgId: string,
  slug: string,
): Promise<GalleryImage[]> {
  const [uploads, disk] = await Promise.all([
    listGalleryPhotos(orgId),
    getGalleryPhotos(slug),
  ]);

  const published: GalleryImage[] = uploads
    .filter((p) => p.status === "approved" && p.visibility === "public")
    .map((p) => ({
      src: galleryPhotoUrl(orgId, p),
      caption: p.caption ?? "",
      width: p.width,
      height: p.height,
      blurDataURL: p.blurDataURL,
      unoptimized: true,
    }));

  return [...published, ...disk];
}
