"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_EMBLEM_STYLE,
  emblemCss,
  type EmblemStyle,
} from "@/lib/emblem-style";

/**
 * Size, colour and strength for the four public emblems, on a stand-in of the
 * About page's badge rule.
 *
 * The canvas paints the club's actual four emblems through the SAME
 * `emblemCss` the live pages use, over the draft's own page background, so
 * what the sliders show is what the home page pillars and the About rule will
 * do. One style covers all four on purpose: the badges are worn as a set.
 * Values ride the public branding draft and save with the rest of the form,
 * watermark-editor style: null means the shipped treatment, and Reset
 * returns to it.
 */

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Slider rows. Bounds sit INSIDE what `emblemStyleSchema` accepts so nothing
 * this tool produces can be refused by Save. Formats round for display only;
 * the draft keeps the precise value.
 */
const SLIDERS: {
  key: keyof EmblemStyle;
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
    hint: "100% is the shipped size. Both pages grow together.",
    min: 0.3,
    max: 2.5,
    step: 0.01,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "brightness",
    label: "Brightness",
    hint: "Lifts the art out of a dark ground, or beds it back in.",
    min: 0.2,
    max: 3,
    step: 0.05,
    format: (v) => `${v.toFixed(2)}×`,
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
    hint: "0% runs the badges in monochrome.",
    min: 0,
    max: 3,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "opacity",
    label: "Strength",
    hint: "Fades all four back. 0% hides them entirely.",
    min: 0,
    max: 1,
    step: 0.01,
    format: (v) => `${Math.round(v * 100)}%`,
  },
];

export function EmblemStyleEditor({
  arts,
  background,
  value,
  onChange,
}: {
  /** The four emblem artworks, in catalog order. */
  arts: string[];
  /** The draft's page background, so the preview sits on the real ground. */
  background: string;
  /** The club's saved treatment, or null for the shipped one. */
  value: EmblemStyle | null;
  onChange: (next: EmblemStyle | null) => void;
}) {
  const style = value ?? DEFAULT_EMBLEM_STYLE;

  function set(key: keyof EmblemStyle, v: number) {
    onChange({ ...style, [key]: r4(v) });
  }

  return (
    <div className="space-y-3">
      {/* The four badges through the same CSS the public pages apply. The
          canvas keeps a fixed height so a big Size setting grows the badges
          into the room rather than reflowing the form under the slider. */}
      <div
        className="flex h-40 items-center justify-center gap-8 overflow-hidden rounded-lg border border-border px-6"
        style={{ background }}
      >
        {arts.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- static or served art
          <img
            key={i}
            src={src}
            alt=""
            draggable={false}
            className="w-auto select-none object-contain [--emblem-h:3.5rem]"
            style={emblemCss(style)}
          />
        ))}
      </div>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {SLIDERS.map((s) => (
          <div key={s.key}>
            <div className="flex items-baseline justify-between">
              <Label htmlFor={`emblem-style-${s.key}`} className="text-xs font-medium">
                {s.label}
              </Label>
              <span className="font-stat text-xs tabular-nums text-muted-foreground">
                {s.format(style[s.key])}
              </span>
            </div>
            <input
              id={`emblem-style-${s.key}`}
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
        One treatment covers all four badges, on the home page pillars and the
        About page alike. The artwork itself is swapped under Brand assets.
      </p>
    </div>
  );
}
