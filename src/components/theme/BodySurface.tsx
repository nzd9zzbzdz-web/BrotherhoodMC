"use client";

import { useEffect } from "react";

/**
 * Radix portals (Dialog, Select, Popover, DropdownMenu, Sheet) render into
 * <body> — OUTSIDE the layout's [data-surface] div, so they'd fall back to the
 * light :root tokens instead of the org's brand vars. Mirroring the surface
 * attribute (and the portal's `dark` class) onto <body> while the layout is
 * mounted lets <BrandStyle>'s [data-surface] rules reach portaled UI too.
 */
export function BodySurface({
  surface,
  dark = false,
}: {
  surface: "public" | "portal";
  dark?: boolean;
}) {
  useEffect(() => {
    const body = document.body;
    body.setAttribute("data-surface", surface);
    if (dark) body.classList.add("dark");
    return () => {
      // Guarded: on a public⇄portal route change the next layout may have
      // stamped body before this cleanup runs — never clobber its value.
      if (body.getAttribute("data-surface") === surface) {
        body.removeAttribute("data-surface");
      }
      if (dark) body.classList.remove("dark");
    };
  }, [surface, dark]);

  return null;
}
