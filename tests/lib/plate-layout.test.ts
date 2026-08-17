import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATE_LAYOUT,
  PLATE_ASPECT,
  PLATE_CROP,
  seatBounds,
} from "@/lib/plate-layout";
import { plateLayoutSchema } from "@/lib/schemas/branding";

/**
 * The plate layout is the contract between three parties: the template
 * measurements, the schema the save action enforces, and the editor that
 * starts every club from the default. These tests pin the corners where a
 * quiet drift would strand someone: a default the schema refuses can never be
 * saved after the first drag, and a box outside the art can never be dragged
 * back.
 */

describe("the template plate layout", () => {
  it("is accepted by the schema that guards saving", () => {
    // The editor materializes the default on the first drag, so if this fails
    // the very first customization a club attempts is refused.
    expect(plateLayoutSchema.safeParse(DEFAULT_PLATE_LAYOUT).success).toBe(true);
  });

  it("keeps every box on the art", () => {
    const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {
      heading: DEFAULT_PLATE_LAYOUT.heading,
    };
    const seats = [DEFAULT_PLATE_LAYOUT.president, ...DEFAULT_PLATE_LAYOUT.officers];
    seats.forEach((seat, i) => {
      boxes[`seat-${i}-name`] = seat.name;
      boxes[`seat-${i}-rank`] = seat.rank;
      boxes[`seat-${i}`] = seatBounds(seat);
    });
    DEFAULT_PLATE_LAYOUT.stats.forEach((s, i) => (boxes[`stat-${i}`] = s));

    for (const [label, b] of Object.entries(boxes)) {
      expect(b.x, label).toBeGreaterThanOrEqual(0);
      expect(b.y, label).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w, label).toBeLessThanOrEqual(1);
      expect(b.y + b.h, label).toBeLessThanOrEqual(1);
    }
  });

  it("draws the officer rings left to right without overlap", () => {
    const xs = DEFAULT_PLATE_LAYOUT.officers.map((o) => o.face.x);
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i] - xs[i - 1];
      const radii =
        DEFAULT_PLATE_LAYOUT.officers[i].face.d / 2 +
        DEFAULT_PLATE_LAYOUT.officers[i - 1].face.d / 2;
      expect(gap).toBeGreaterThan(radii);
    }
  });

  it("matches the shipped template art's frame", () => {
    // The uploaded-art spec (branding-art.ts) stores plates at exactly this
    // window, and the <img> is drawn with these intrinsic dimensions.
    expect(PLATE_CROP.w).toBe(1473);
    expect(PLATE_CROP.h).toBe(695);
    expect(PLATE_ASPECT).toBeCloseTo(1473 / 695, 10);
  });
});
