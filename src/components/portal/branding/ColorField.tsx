"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";

/**
 * Turn any CSS colour into the `#rrggbb` a native colour input demands.
 *
 * The swatch is `<input type="color">`, which understands ONLY 6-digit hex —
 * hand it `rgba(184,160,165,0.14)` and it silently shows black. Several of the
 * shipped border tokens are exactly that, so the alpha is resolved against the
 * surface behind the swatch and the honest value stays in the text field
 * beside it, which accepts anything CSS does.
 */
function toSwatchHex(value: string, over: string): string {
  const rgba = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/i.exec(
    value.trim(),
  );
  if (rgba) {
    const [r, g, b] = [rgba[1], rgba[2], rgba[3]].map(Number);
    const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
    const ground = hexToRgb(over) ?? [0, 0, 0];
    const mix = (c: number, i: number) => Math.round(c * a + ground[i] * (1 - a));
    return rgbToHex(mix(r, 0), mix(g, 1), mix(b, 2));
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const h = hex[1];
    return h.length === 3
      ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase()
      : `#${h.toLowerCase()}`;
  }
  // Named colours, hsl(), color-mix() and anything else: the swatch cannot
  // represent it, so it opens on the surface behind it rather than on black.
  return hexToRgb(over) ? over.toLowerCase() : "#000000";
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * One theme token: a live swatch that opens the OS colour picker, and a text
 * field that takes any CSS colour.
 *
 * Both are offered because neither is sufficient. The picker is how anyone
 * actually chooses a colour; the text field is the only way to enter the
 * translucent rgba() values the structural tokens use, and the only way to
 * paste a hex out of a brand guide.
 */
export function ColorField({
  label,
  hint,
  value,
  /** What the swatch composites a translucent value over. */
  over,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  over: string;
  onChange: (next: string) => void;
}) {
  const id = useId();
  const swatch = toSwatchHex(value, over);

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        {/* A checkerboard behind the swatch so a translucent token reads as
            translucent rather than as a slightly-off solid. */}
        <span
          className="relative size-9 shrink-0 overflow-hidden rounded-md border border-border"
          style={{
            backgroundImage:
              "linear-gradient(45deg,#8883 25%,transparent 25%,transparent 75%,#8883 75%),linear-gradient(45deg,#8883 25%,transparent 25%,transparent 75%,#8883 75%)",
            backgroundSize: "10px 10px",
            backgroundPosition: "0 0, 5px 5px",
          }}
        >
          <span
            aria-hidden
            className="absolute inset-0"
            style={{ backgroundColor: value }}
          />
          <input
            type="color"
            aria-label={`${label} colour picker`}
            value={swatch}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </span>
        <Input
          id={id}
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 font-mono text-xs"
        />
      </div>
      {hint && <p className="text-[0.7rem] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}
