import React from "react";

// Default images (Unsplash) so the component renders standalone. In the app we
// pass the club's own gallery photos via the `images` prop.
const DEFAULT_IMAGES = [
  "https://images.unsplash.com/photo-1518495973542-4542c06a5843?q=80&w=1974&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1472396961693-142e6e269027?q=80&w=2152&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1505142468610-359e7d316be0?q=80&w=2126&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1482881497185-d4a9ddbe4151?q=80&w=1965&auto=format&fit=crop",
];

export const Component = ({ images = DEFAULT_IMAGES }: { images?: string[] }) => {
  if (images.length === 0) return null;

  // Duplicate images for a seamless loop.
  const duplicatedImages = [...images, ...images];

  return (
    <>
      <style>{`
        @keyframes ias-scroll-right {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }

        .ias-infinite-scroll {
          animation: ias-scroll-right 30s linear infinite;
        }
        .ias-infinite-scroll:hover {
          animation-play-state: paused;
        }

        .ias-scroll-container {
          mask: linear-gradient(90deg, transparent 0%, black 10%, black 90%, transparent 100%);
          -webkit-mask: linear-gradient(90deg, transparent 0%, black 10%, black 90%, transparent 100%);
        }

        .ias-image-item {
          transition: transform 0.3s ease, filter 0.3s ease;
        }
        .ias-image-item:hover {
          transform: scale(1.05);
          filter: brightness(1.1);
        }

        @media (prefers-reduced-motion: reduce) {
          .ias-infinite-scroll { animation: none; }
        }
      `}</style>

      <div className="relative w-full overflow-hidden bg-background py-8">
        <div className="ias-scroll-container w-full">
          <div className="ias-infinite-scroll flex w-max gap-6">
            {duplicatedImages.map((image, index) => (
              <div
                key={index}
                className="ias-image-item h-48 w-48 flex-shrink-0 overflow-hidden rounded-xl shadow-2xl md:h-64 md:w-64 lg:h-72 lg:w-72"
              >
                <img
                  src={image}
                  alt={`Gallery image ${(index % images.length) + 1}`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};
