import { LEATHER_BODY } from "@/lib/cut/materials";

// The vest silhouette, drawn in CSS (no artwork required). Shared by the
// member-facing CutViewer and the admin Vest Designer so they stay identical.
export const VEST_CLIP =
  "polygon(14% 0, 41% 0, 50% 11%, 59% 0, 86% 0, 93% 9%, 90% 100%, 10% 100%, 7% 9%)";

export function VestBody() {
  return (
    <>
      <div
        className="absolute inset-0"
        // The leather is the jacket's own (see lib/cut/materials); the two
        // seam strokes are the club's accent, so a rebrand restitches the
        // piping without repainting the hide.
        style={{
          clipPath: VEST_CLIP,
          background: LEATHER_BODY,
          boxShadow:
            "inset 0 0 0 2px color-mix(in srgb, var(--brand-accent) 10%, transparent), inset 0 8px 40px rgba(0,0,0,0.6)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-[6%]"
        style={{
          clipPath: VEST_CLIP,
          boxShadow:
            "inset 0 0 0 1px color-mix(in srgb, var(--brand-accent) 14%, transparent)",
        }}
      />
    </>
  );
}
