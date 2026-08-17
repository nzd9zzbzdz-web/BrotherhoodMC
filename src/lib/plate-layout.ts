/**
 * Where everything sits ON the chain of command plate: the heading, the six
 * seats (a face ring, a nameplate and a rank plate each) and the three stat
 * readouts.
 *
 * All coordinates are FRACTIONS of the displayed art: `x`/`w` of its width,
 * `y`/`h` of its height, and font sizes as fractions of width so type scales
 * with the plate exactly as `cqw` does. Fractions rather than pixels because
 * a club's uploaded plate can be any resolution; the template file happens to
 * be 1473×695 but nothing below depends on that.
 *
 * The DEFAULT layout is the template, measured off the original render. A club
 * whose plate is painted to different positions drags the boxes into place in
 * Admin -> Branding, and the override rides the portal branding document
 * (`branding.plateLayout`); absent means "the template", which is what every
 * club had before this existed.
 */

export interface PlateBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A box that carries text, and the size that text is set at. */
export interface PlateTextBox extends PlateBox {
  size: number;
}

/** A face ring: centre and diameter (diameter as a fraction of plate WIDTH). */
export interface PlateFace {
  x: number;
  y: number;
  d: number;
}

/** One seat at the table: the ring, the nameplate, the rank plate below it. */
export interface PlateSeat {
  face: PlateFace;
  name: PlateTextBox;
  rank: PlateTextBox;
}

export interface PlateLayout {
  heading: PlateTextBox & { blurbSize: number };
  president: PlateSeat;
  /** The officer seats, left to right. The template paints five rings. */
  officers: PlateSeat[];
  /** Riding / Officers / Prospecting, in that order. */
  stats: (PlateTextBox & { labelSize: number })[];
}

/**
 * The window of the original 1556×720 render the shipped template file
 * actually contains.
 *
 * The original carried ~44px of soft red-brown smoke down each side (18 top,
 * 11 bottom) outside the painted frame, which against Void Black read as a
 * dirty rectangle around a crisp plate. The file is trimmed to the frame
 * itself, with two pixels of margin so the crop cannot slice the outer
 * hairline.
 *
 * Stated as an offset rather than baked into the measurements so every number
 * in the default layout below stays exactly as it was measured off the full
 * render and remains checkable against it. A future re-crop is these four
 * numbers.
 */
export const PLATE_CROP = { x: 42, y: 16, w: 1473, h: 695 } as const;

/** Width over height of the displayed plate; how a diameter becomes a height. */
export const PLATE_ASPECT = PLATE_CROP.w / PLATE_CROP.h;

/* ── The template, measured ──────────────────────────────────────────
   Every raw number below is a pixel measured off the original 1556×720
   render — positions AND type sizes. Positions carry the crop offset on
   the way to a fraction; sizes never do, because a width is a distance
   between two art-space points and subtracting the offset from one would
   shrink every box.                                                    */

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
const X = (v: number) => r5((v - PLATE_CROP.x) / PLATE_CROP.w);
const Y = (v: number) => r5((v - PLATE_CROP.y) / PLATE_CROP.h);
const W = (v: number) => r5(v / PLATE_CROP.w);
const H = (v: number) => r5(v / PLATE_CROP.h);

/** The five painted officer rings, left to right, by centre x. */
const OFFICER_CX = [307.5, 543.2, 779, 1014.8, 1250.5] as const;

/**
 * One officer seat of the template: ring centre and the face that sits inside
 * it (`face` stops a few px short of the ring's inner edge so a render never
 * laps the bezel), the nameplate spanning the seat, and the narrower rank
 * plate under it.
 */
function officerSeat(cx: number): PlateSeat {
  return {
    face: { x: X(cx), y: Y(458), d: W(106) },
    name: { x: X(cx - 86), y: Y(514), w: W(172), h: H(47), size: W(29) },
    rank: { x: X(cx - 70.5), y: Y(562), w: W(141), h: H(29), size: W(13) },
  };
}

export const DEFAULT_PLATE_LAYOUT: PlateLayout = {
  // Clear leather between the top ornament and the rule below it. Stops short
  // of x=680 on purpose: that is where the president's seat (a link) begins.
  heading: { x: X(120), y: Y(76), w: W(530), h: H(172), size: W(88), blurbSize: W(19) },
  president: {
    face: { x: X(779), y: Y(171), d: W(152) },
    name: { x: X(680), y: Y(256), w: W(198), h: H(56), size: W(43) },
    rank: { x: X(709), y: Y(313), w: W(141), h: H(30), size: W(15) },
  },
  officers: OFFICER_CX.map(officerSeat),
  // Seated to the right of the painted icons on the stat bar.
  stats: [
    { x: X(452), y: Y(613), w: W(148), h: H(78), size: W(37), labelSize: W(17) },
    { x: X(748), y: Y(613), w: W(162), h: H(78), size: W(37), labelSize: W(17) },
    { x: X(1050), y: Y(613), w: W(233), h: H(78), size: W(37), labelSize: W(17) },
  ],
};

/** The union of a seat's three pieces: the box its link (or outline) spans. */
export function seatBounds(seat: PlateSeat): PlateBox {
  const { face, name, rank } = seat;
  const faceH = face.d * PLATE_ASPECT;
  const x0 = Math.min(face.x - face.d / 2, name.x, rank.x);
  const y0 = Math.min(face.y - faceH / 2, name.y, rank.y);
  const x1 = Math.max(face.x + face.d / 2, name.x + name.w, rank.x + rank.w);
  const y1 = Math.max(face.y + faceH / 2, name.y + name.h, rank.y + rank.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
