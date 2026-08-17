"use client";

// Aceternity LayoutGrid — faithful port of the source demo: screen-filling
// bento cards, click-to-expand IN PLACE (the card morphs to a half-screen
// panel centered over the grid), caption sliding up from the bottom edge.
// Deliberate deviations from the source, all invisible to the eye:
// - React 19 removed the global JSX namespace → content is React.ReactNode.
// - Thumbnails go through next/image inside the layoutId wrapper (the gallery
//   PNGs are ~2.5MB originals; motion.img would ship them raw).
// - bg-white → bg-card so the pre-load flash matches the dark theme.
// - Enter/Space expand a focused card, Escape collapses.
// Use one <LayoutGrid> per ~4 cards inside a screen-tall wrapper (as the demo
// does): the expanded card centers within the grid container, so containers
// taller than a screen would center it off-viewport.

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export type LayoutGridCard = {
  id: number;
  content: React.ReactNode;
  className: string;
  thumbnail: string;
  /** Accessible name for the card; also the thumbnail alt text. */
  label?: string;
  /** Optional next/image blur placeholder. */
  blurDataURL?: string;
  /** Bypass the image optimizer — already-sized member uploads do. */
  unoptimized?: boolean;
};

export const LayoutGrid = ({ cards }: { cards: LayoutGridCard[] }) => {
  const [selected, setSelected] = useState<LayoutGridCard | null>(null);
  const [lastSelected, setLastSelected] = useState<LayoutGridCard | null>(null);

  const handleClick = (card: LayoutGridCard) => {
    setLastSelected(selected);
    setSelected(card);
  };

  const handleOutsideClick = () => {
    setLastSelected(selected);
    setSelected(null);
  };

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleOutsideClick();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <div className="relative mx-auto grid h-full w-full max-w-7xl grid-cols-1 gap-4 p-10 md:grid-cols-3">
      {cards.map((card, i) => (
        <div key={i} className={cn(card.className, "")}>
          <motion.div
            role="button"
            tabIndex={0}
            aria-label={card.label}
            onClick={() => handleClick(card)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick(card);
              }
            }}
            className={cn(
              card.className,
              "relative cursor-pointer overflow-hidden",
              selected?.id === card.id
                ? "absolute inset-0 z-50 m-auto flex h-1/2 w-full flex-col flex-wrap items-center justify-center rounded-lg md:w-1/2"
                : lastSelected?.id === card.id
                  ? "z-40 h-full w-full rounded-xl bg-card"
                  : "h-full w-full rounded-xl bg-card",
            )}
            layoutId={`card-${card.id}`}
          >
            {selected?.id === card.id && <SelectedCard selected={selected} />}
            <ImageComponent card={card} />
          </motion.div>
        </div>
      ))}
      <motion.div
        onClick={handleOutsideClick}
        className={cn(
          "absolute left-0 top-0 z-10 h-full w-full bg-black opacity-0",
          selected ? "pointer-events-auto" : "pointer-events-none",
        )}
        animate={{ opacity: selected ? 0.3 : 0 }}
        aria-hidden
      />
    </div>
  );
};

const ImageComponent = ({ card }: { card: LayoutGridCard }) => {
  return (
    <motion.div layoutId={`image-${card.id}-image`} className="absolute inset-0">
      <Image
        src={card.thumbnail}
        alt={card.label ?? ""}
        fill
        sizes="(max-width: 768px) 100vw, 66vw"
        placeholder={card.blurDataURL ? "blur" : "empty"}
        blurDataURL={card.blurDataURL}
        unoptimized={card.unoptimized}
        className="object-cover object-top transition duration-200"
      />
    </motion.div>
  );
};

const SelectedCard = ({ selected }: { selected: LayoutGridCard | null }) => {
  return (
    <div className="relative z-[60] flex h-full w-full flex-col justify-end rounded-lg bg-transparent shadow-2xl">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.6 }}
        className="absolute inset-0 z-10 h-full w-full bg-black opacity-60"
      />
      <motion.div
        layoutId={`content-${selected?.id}`}
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className="relative z-[70] px-8 pb-4"
      >
        {selected?.content}
      </motion.div>
    </div>
  );
};
