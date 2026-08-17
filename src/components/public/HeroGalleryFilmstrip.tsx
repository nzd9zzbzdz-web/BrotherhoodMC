import Image from "next/image";
import type { GalleryImage } from "@/lib/gallery";

/**
 * Full-bleed auto-scrolling filmstrip for the public hero. Every photo is
 * rendered at the banner's full height at its natural aspect ratio (portraits
 * narrow, landscapes wide) so nothing is cropped or stretched. The strip is
 * duplicated once and translated -50% for a seamless CSS-only loop — no JS,
 * so this stays a server component (same pattern as image-auto-slider).
 *
 * Adjacent photos crossfade: each image is masked so its left/right FEATHER
 * pixels fade to transparent, and every item overlaps its neighbor by FEATHER
 * via a uniform negative margin — A fades out exactly where B fades in.
 */
const FEATHER = 64;

export function HeroGalleryFilmstrip({ photos }: { photos: GalleryImage[] }) {
  if (photos.length === 0) return null;

  // Constant scroll speed regardless of the photo mix: strip width in units of
  // banner height = sum of aspect ratios; ~6s per unit ≈ a calm ~120px/s on a
  // 760px-tall banner.
  const aspectSum = photos.reduce((sum, p) => sum + p.width / p.height, 0);
  const duration = Math.max(30, Math.round(aspectSum * 6));

  // Fisher–Yates on a COPY: in prod `photos` is the module-cached array shared
  // with the Media page, which must keep its curated order. Shuffling before
  // the duplication keeps both strip halves identical, so the -50% loop wrap
  // stays seamless; the order changes per server render, not mid-loop.
  const shuffled = [...photos];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const strip = [...shuffled, ...shuffled];

  // The negative margin must be on EVERY item (first included): the strip then
  // stays perfectly periodic, so the -50% wrap lands on an identical frame.
  // The first image's feathered lead-in sits in the container's clipped
  // overflow, never on screen.
  const edgeFade = `linear-gradient(90deg, transparent 0, #000 ${FEATHER}px, #000 calc(100% - ${FEATHER}px), transparent 100%)`;

  return (
    <>
      <style>{`
        @keyframes hgf-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .hgf-strip { animation: none !important; }
        }
      `}</style>
      <div className="absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="hgf-strip flex h-full w-max items-center"
          style={{
            animation: `hgf-scroll ${duration}s linear infinite`,
            willChange: "transform",
          }}
        >
          {strip.map((p, i) => (
            <Image
              key={`${p.src}-${i}`}
              src={p.src}
              alt=""
              width={p.width}
              height={p.height}
              sizes={`${Math.round((p.width / p.height) * 760)}px`}
              loading={i < 3 ? "eager" : "lazy"}
              placeholder="blur"
              blurDataURL={p.blurDataURL}
              unoptimized={p.unoptimized}
              className="h-full w-auto flex-shrink-0"
              style={{
                marginLeft: -FEATHER,
                maskImage: edgeFade,
                WebkitMaskImage: edgeFade,
              }}
            />
          ))}
        </div>
      </div>
    </>
  );
}
