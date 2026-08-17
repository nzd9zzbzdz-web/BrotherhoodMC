"use client";

import { useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_PLATE_LAYOUT,
  PLATE_ASPECT,
  type PlateBox,
  type PlateLayout,
  type PlateSeat,
} from "@/lib/plate-layout";
import { cn } from "@/lib/utils";

/**
 * Drag the chain-of-command boxes into place on the club's own plate art.
 *
 * The template layout is measured off the shipped plate render, and a club's
 * uploaded art rarely paints its rings and nameplates to the pixel in the same
 * places. This editor shows the art with every live element on top of it as a
 * draggable box; the admin drags them onto the painted positions and the
 * result rides the portal branding draft, saving with the rest of the form.
 *
 * Coordinates are fractions of the displayed art (see plate-layout.ts), so
 * what is placed here lands identically on the Brotherhood page at any width.
 */

type Part = "face" | "name" | "rank";
type ItemRef =
  | { kind: "heading" }
  | { kind: "stat"; index: number }
  /** Seat 0 is the president; 1 through 5 the officer rings, left to right. */
  | { kind: "seat"; index: number; part: Part };
type Mode = "move" | "resize";

const keyOf = (item: ItemRef) =>
  item.kind === "seat" ? `seat-${item.index}-${item.part}` : item.kind === "stat" ? `stat-${item.index}` : "heading";

const pc = (f: number) => `${f * 100}%`;
const cq = (f: number) => `${f * 100}cqw`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

function cloneLayout(layout: PlateLayout): PlateLayout {
  return JSON.parse(JSON.stringify(layout)) as PlateLayout;
}

function seatOf(layout: PlateLayout, index: number): PlateSeat {
  return index === 0 ? layout.president : layout.officers[index - 1];
}

// Bounds sit inside what the schema accepts (positions ±0.5, sizes to 1.5,
// fonts to 0.5) so nothing draggable can ever be refused by Save.
const movePoint = (p: { x: number; y: number }, dx: number, dy: number) => {
  p.x = r4(clamp(p.x + dx, -0.4, 1.4));
  p.y = r4(clamp(p.y + dy, -0.4, 1.4));
};

/** Resize a text box; its type scales with the height so the drag is WYSIWYG. */
const resizeTextBox = (
  b: PlateBox & { size: number },
  dx: number,
  dy: number,
  also?: { get: () => number; set: (v: number) => void },
) => {
  const h = clamp(b.h + dy, 0.01, 1.4);
  const scale = h / b.h;
  b.w = r4(clamp(b.w + dx, 0.01, 1.4));
  b.h = r4(h);
  b.size = r4(clamp(b.size * scale, 0.004, 0.45));
  if (also) also.set(r4(clamp(also.get() * scale, 0.004, 0.45)));
};

function applyDrag(
  base: PlateLayout,
  item: ItemRef,
  mode: Mode,
  dx: number,
  dy: number,
): PlateLayout {
  const next = cloneLayout(base);
  if (item.kind === "heading") {
    if (mode === "move") movePoint(next.heading, dx, dy);
    else
      resizeTextBox(next.heading, dx, dy, {
        get: () => next.heading.blurbSize,
        set: (v) => (next.heading.blurbSize = v),
      });
  } else if (item.kind === "stat") {
    const stat = next.stats[item.index];
    if (mode === "move") movePoint(stat, dx, dy);
    else
      resizeTextBox(stat, dx, dy, {
        get: () => stat.labelSize,
        set: (v) => (stat.labelSize = v),
      });
  } else {
    const seat = seatOf(next, item.index);
    if (item.part === "face") {
      // The ring is the seat's anchor: dragging it carries the nameplate and
      // rank plate with it, so lining a seat up with a painted ring is one
      // motion. The plates still move alone when dragged themselves.
      if (mode === "move") {
        movePoint(seat.face, dx, dy);
        movePoint(seat.name, dx, dy);
        movePoint(seat.rank, dx, dy);
      } else {
        seat.face.d = r4(clamp(seat.face.d + dx, 0.01, 0.5));
      }
    } else {
      const b = seat[item.part];
      if (mode === "move") movePoint(b, dx, dy);
      else resizeTextBox(b, dx, dy);
    }
  }
  return next;
}

const STAT_PREVIEW = [
  { value: "12", label: "Riding" },
  { value: "6", label: "Officers" },
  { value: "3", label: "Prospecting" },
] as const;

export function PlateLayoutEditor({
  art,
  title,
  blurb,
  value,
  onChange,
}: {
  /** The plate art the boxes are placed on. */
  art: string;
  /** The draft heading and blurb, so the preview shows the club's words. */
  title: string;
  blurb: string;
  /** The club's saved positions, or null for the template. */
  value: PlateLayout | null;
  onChange: (next: PlateLayout | null) => void;
}) {
  const layout = value ?? DEFAULT_PLATE_LAYOUT;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    item: ItemRef;
    mode: Mode;
    sx: number;
    sy: number;
    base: PlateLayout;
    rect: DOMRect;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  function startDrag(e: React.PointerEvent, item: ItemRef, mode: Mode) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { item, mode, sx: e.clientX, sy: e.clientY, base: layout, rect };
    setSelected(keyOf(item));
  }

  function handleMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    // Shift slows the drag to a quarter speed for registration work. Both
    // deltas come off the ORIGINAL grab point, so easing off Shift mid-drag
    // stays continuous rather than jumping.
    const fine = e.shiftKey ? 0.25 : 1;
    const dx = ((e.clientX - d.sx) / d.rect.width) * fine;
    const dy = ((e.clientY - d.sy) / d.rect.height) * fine;
    onChange(applyDrag(d.base, d.item, d.mode, dx, dy));
  }

  function endDrag() {
    dragRef.current = null;
  }

  /** One draggable overlay. A plain function, not a component: a component
   *  defined inside the render would remount every keystroke and drop the
   *  pointer capture mid-drag. */
  function dragBox(
    item: ItemRef,
    box: { left: string; top: string; width: string; height: string },
    opts: { label: string; circle?: boolean; resizable?: boolean },
    children?: React.ReactNode,
  ) {
    const isSelected = selected === keyOf(item);
    return (
      <div
        key={keyOf(item)}
        className={cn(
          "group absolute cursor-move touch-none border border-dashed",
          opts.circle && "rounded-full",
          isSelected
            ? "z-10 border-primary bg-primary/10"
            : "border-foreground/25 hover:border-primary/70 hover:bg-primary/5",
        )}
        style={box}
        onPointerDown={(e) => startDrag(e, item, "move")}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {children}
        <span
          className={cn(
            "pointer-events-none absolute left-0.5 top-0.5 whitespace-nowrap text-[0.55rem] uppercase tracking-wide text-primary/90",
            isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          {opts.label}
        </span>
        {(opts.resizable ?? true) && (
          <span
            role="presentation"
            className={cn(
              "absolute -bottom-1 -right-1 size-2.5 touch-none rounded-[2px] bg-primary",
              opts.circle && "bottom-auto right-0 top-1/2 -translate-y-1/2 translate-x-1/2 rounded-full",
              isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            style={{ cursor: opts.circle ? "ew-resize" : "nwse-resize" }}
            onPointerDown={(e) => startDrag(e, item, "resize")}
            onPointerMove={handleMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        )}
      </div>
    );
  }

  function faceBox(index: number, seat: PlateSeat, label: string) {
    const { face } = seat;
    return dragBox(
      { kind: "seat", index, part: "face" },
      {
        left: pc(face.x - face.d / 2),
        top: pc(face.y - (face.d * PLATE_ASPECT) / 2),
        width: pc(face.d),
        height: pc(face.d * PLATE_ASPECT),
      },
      { label, circle: true },
    );
  }

  function textPreview(text: string, size: number, className: string) {
    return (
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <span className={cn("max-w-full truncate leading-none", className)} style={{ fontSize: cq(size) }}>
          {text}
        </span>
      </span>
    );
  }

  const seatBoxes = (index: number, seat: PlateSeat, who: string) => [
    faceBox(index, seat, `${who} face`),
    dragBox(
      { kind: "seat", index, part: "name" },
      { left: pc(seat.name.x), top: pc(seat.name.y), width: pc(seat.name.w), height: pc(seat.name.h) },
      { label: `${who} name` },
      textPreview(
        "Road Name",
        seat.name.size,
        index === 0 ? "text-primary" : "text-foreground",
      ),
    ),
    dragBox(
      { kind: "seat", index, part: "rank" },
      { left: pc(seat.rank.x), top: pc(seat.rank.y), width: pc(seat.rank.w), height: pc(seat.rank.h) },
      { label: `${who} rank` },
      textPreview("Rank", seat.rank.size, "uppercase tracking-[0.05em] text-muted-foreground"),
    ),
  ];

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="@container relative w-full select-none overflow-hidden rounded-lg border border-border"
        style={{ fontFamily: "var(--font-display)" }}
        onPointerDown={() => setSelected(null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={art} alt="" className="block w-full" style={{ height: "auto" }} draggable={false} />

        {dragBox(
          { kind: "heading" },
          {
            left: pc(layout.heading.x),
            top: pc(layout.heading.y),
            width: pc(layout.heading.w),
            height: pc(layout.heading.h),
          },
          { label: "Heading" },
          <span className="pointer-events-none absolute inset-0 flex flex-col justify-start overflow-hidden">
            <span className="leading-[0.95] text-primary" style={{ fontSize: cq(layout.heading.size) }}>
              {title}
            </span>
            {blurb && (
              <span
                className="mt-[4%] uppercase leading-[1.7] tracking-[0.14em] text-muted-foreground"
                style={{ fontFamily: "var(--font-body, inherit)", fontSize: cq(layout.heading.blurbSize) }}
              >
                {blurb}
              </span>
            )}
          </span>,
        )}

        {seatBoxes(0, layout.president, "President")}
        {layout.officers.flatMap((seat, i) => seatBoxes(i + 1, seat, `Officer ${i + 1}`))}

        {layout.stats.map((stat, i) =>
          dragBox(
            { kind: "stat", index: i },
            { left: pc(stat.x), top: pc(stat.y), width: pc(stat.w), height: pc(stat.h) },
            { label: STAT_PREVIEW[i].label },
            <span className="pointer-events-none absolute inset-0 flex items-center gap-[0.5cqw] overflow-hidden">
              <span className="font-stat leading-none text-foreground" style={{ fontSize: cq(stat.size) }}>
                {STAT_PREVIEW[i].value}
              </span>
              <span
                className="uppercase leading-none tracking-[0.14em] text-muted-foreground"
                style={{ fontFamily: "var(--font-body, inherit)", fontSize: cq(stat.labelSize) }}
              >
                {STAT_PREVIEW[i].label}
              </span>
            </span>,
          ),
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={value === null}
          onClick={() => {
            onChange(null);
            setSelected(null);
          }}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Reset positions
        </Button>
        <p className="text-xs text-muted-foreground">
          {value
            ? "Custom positions. They save with the portal branding below."
            : "Using the template positions."}
        </p>
      </div>

      <p className="text-[0.7rem] leading-snug text-muted-foreground">
        Drag a box to move it; drag the small square to resize it, and the text
        scales with the box height. Dragging a face ring moves its whole seat
        (ring, name and rank together); its round handle changes the ring size.
        Hold Shift while dragging for fine control.
      </p>
    </div>
  );
}
