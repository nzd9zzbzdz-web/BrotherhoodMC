"use client";

import { LayoutGrid, type LayoutGridCard } from "@/components/ui/layout-grid";
import type { GalleryImage } from "@/lib/gallery";

// Demo rhythm: wide card, two singles, wide card — per screen of four.
const SPAN_PATTERN = ["md:col-span-2", "col-span-1", "col-span-1", "md:col-span-2"];

/**
 * Public gallery: the Aceternity LayoutGrid demo experience, repeated — each
 * screen-tall section holds four photos in the demo's 2/1/1/2 bento rhythm.
 * Within a section the two widest shots take the double-width slots so crops
 * stay gentle. Click a photo to expand it in place; Escape or click away
 * to close.
 */
export function GalleryGrid({ photos }: { photos: GalleryImage[] }) {
  const sections: GalleryImage[][] = [];
  for (let i = 0; i < photos.length; i += 4) {
    sections.push(photos.slice(i, i + 4));
  }

  return (
    <div>
      {sections.map((group, s) => {
        // Widest two shots into the wide slots (0 and 3), the rest into 1, 2.
        const byWidth = [...group].sort(
          (a, b) => b.width / b.height - a.width / a.height,
        );
        const slotted =
          group.length === 4
            ? [byWidth[0], byWidth[2], byWidth[3], byWidth[1]]
            : group;

        const cards: LayoutGridCard[] = slotted.map((p, i) => ({
          id: s * 4 + i,
          label: p.caption,
          content: (
            <p className="text-xl font-bold capitalize text-white md:text-4xl">
              {p.caption}
            </p>
          ),
          className: SPAN_PATTERN[i] ?? "col-span-1",
          thumbnail: p.src,
          blurDataURL: p.blurDataURL,
          unoptimized: p.unoptimized,
        }));

        return (
          <div key={s} className="h-[85vh] min-h-[34rem] w-full md:h-screen md:py-6">
            <LayoutGrid cards={cards} />
          </div>
        );
      })}
    </div>
  );
}
