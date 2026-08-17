"use client";

import { useRef } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_WATERMARK_STYLE,
  watermarkCss,
  type WatermarkStyle,
} from "@/lib/watermark";

/**
 * Place, size and colour the home page watermark on a stand-in of the pillars
 * band.
 *
 * The canvas paints the art through the SAME `watermarkCss` the live page
 * uses, over the draft's own page background, with ghost pillars where the
 * real four sit — so dragging the skull half off the left edge here is
 * dragging it half off the left edge on the home page. Values ride the public
 * branding draft and save with the rest of the form, plate-editor style:
 * null means the shipped treatment, and Reset returns to it.
 *
 * Position is drag-only (a fraction pair has no business being typed), the
 * rest are sliders because "a little brighter" is a nudge, not a number.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Slider rows. Bounds sit INSIDE what `watermarkStyleSchema` accepts so
 * nothing this tool produces can be refused by Save. Formats round for
 * display only; the draft keeps the precise value.
 */
const SLIDERS: {
  key: Exclude<keyof WatermarkStyle, "x" | "y">;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}[] = [
  {
    key: "scale",
    label: "Size",
    hint: "100% fits the band's height, the shipped size.",
    min: 0.2,
    max: 2.5,
    step: 0.01,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "brightness",
    label: "Glow",
    hint: "How hard the art burns out of the black behind it.",
    min: 0.2,
    max: 8,
    step: 0.1,
    format: (v) => `${v.toFixed(1)}×`,
  },
  {
    key: "hue",
    label: "Colour shift",
    hint: "Spins the art's colour around the wheel, for tinting it toward the club's own.",
    min: -180,
    max: 180,
    step: 1,
    format: (v) => `${v > 0 ? "+" : ""}${Math.round(v)}°`,
  },
  {
    key: "saturate",
    label: "Colour intensity",
    hint: "0% runs the art in monochrome.",
    min: 0,
    max: 3,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "opacity",
    label: "Strength",
    hint: "Fades the whole watermark back. 0% hides it entirely.",
    min: 0,
    max: 1,
    step: 0.01,
    format: (v) => `${Math.round(v * 100)}%`,
  },
];

export function WatermarkEditor({
  art,
  background,
  value,
  onChange,
}: {
  /** The watermark artwork the treatment is applied to. */
  art: string;
  /** The draft's page background, so the blend previews over the real ground. */
  background: string;
  /** The club's saved treatment, or null for the shipped one. */
  value: WatermarkStyle | null;
  onChange: (next: WatermarkStyle | null) => void;
}) {
  const style = value ?? DEFAULT_WATERMARK_STYLE;
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    sx: number;
    sy: number;
    base: WatermarkStyle;
    rect: DOMRect;
  } | null>(null);

  function set(key: keyof WatermarkStyle, v: number) {
    onChange({ ...style, [key]: r4(v) });
  }

  function startDrag(e: React.PointerEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, base: style, rect };
  }

  function handleMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    // Shift slows the drag to a quarter speed for fine placement. Both deltas
    // come off the ORIGINAL grab point, so easing off Shift mid-drag stays
    // continuous rather than jumping. Clamps match the schema bounds: far
    // enough to bleed the art off any edge, near enough to drag it back.
    const fine = e.shiftKey ? 0.25 : 1;
    const dx = ((e.clientX - d.sx) / d.rect.width) * fine;
    const dy = ((e.clientY - d.sy) / d.rect.height) * fine;
    onChange({
      ...d.base,
      x: r4(clamp(d.base.x + dx, -2, 2)),
      y: r4(clamp(d.base.y + dy, -2, 2)),
    });
  }

  function endDrag() {
    dragRef.current = null;
  }

  return (
    <div className="space-y-3">
      <div
        ref={canvasRef}
        className="relative aspect-[7/2] w-full cursor-move touch-none select-none overflow-hidden rounded-lg border border-border"
        style={{ background }}
        onPointerDown={startDrag}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* The art, through the same CSS the home page applies. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- static or served art */}
        <img
          src={art}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain object-left"
          style={watermarkCss(style)}
        />
        {/* Ghost pillars, standing where the real four stand (the pillar
            column starts 24% in on the live page), so "behind the second
            pillar" means the same thing here and there. */}
        <div
          className="pointer-events-none absolute inset-y-[18%] left-[24%] right-[4%] grid grid-cols-4"
          aria-hidden
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex flex-col items-center justify-center gap-[7%] border-l border-foreground/10 px-[5%] first:border-l-0"
            >
              <div className="aspect-square w-[16%] rounded-full border border-foreground/20" />
              <div className="h-0.5 w-[55%] rounded bg-foreground/20" />
              <div className="h-0.5 w-[80%] rounded bg-foreground/10" />
              <div className="h-0.5 w-[70%] rounded bg-foreground/10" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {SLIDERS.map((s) => (
          <div key={s.key}>
            <div className="flex items-baseline justify-between">
              <Label htmlFor={`watermark-${s.key}`} className="text-xs font-medium">
                {s.label}
              </Label>
              <span className="font-stat text-xs tabular-nums text-muted-foreground">
                {s.format(style[s.key])}
              </span>
            </div>
            <input
              id={`watermark-${s.key}`}
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={style[s.key]}
              onChange={(e) => set(s.key, Number(e.target.value))}
              className="mt-1 block w-full cursor-pointer"
              style={{ accentColor: "var(--brand-primary, var(--primary))" }}
            />
            <p className="mt-0.5 text-[0.7rem] leading-snug text-muted-foreground">
              {s.hint}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={value === null}
          onClick={() => onChange(null)}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Reset treatment
        </Button>
        <p className="text-xs text-muted-foreground">
          {value
            ? "Custom treatment. It saves with the public branding below."
            : "Using the shipped treatment."}
        </p>
      </div>

      <p className="text-[0.7rem] leading-snug text-muted-foreground">
        Drag the art to place it; hold Shift for fine control. Positions are
        relative, so the watermark keeps its place as the band stretches with
        the screen. The band here stands in for the four-pillar strip on the
        home page; the artwork itself is swapped under Brand assets.
      </p>
    </div>
  );
}
