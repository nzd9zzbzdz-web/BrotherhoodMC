"use client";

import { useState } from "react";
import { Award, CalendarDays, Shield, Sparkles, UserRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { CutRenderModel, CutSurface, Rarity, ResolvedPlacement } from "@/lib/types";
import type { CutSummary } from "@/lib/cut/getCut";
import { RARITY_COLOR, RARITY_LABEL } from "@/lib/rarity";
import {
  PATCH_GROUND,
  SAA_EDGE,
  SAA_GROUND,
  SAA_THREAD,
  THREAD_BACKING,
  THREAD_GOLD,
} from "@/lib/cut/materials";
import { VestBody } from "./VestBody";
import { cn } from "@/lib/utils";

function glow(rarity: Rarity): string {
  const c = RARITY_COLOR[rarity];
  if (rarity === "legendary") return `0 0 18px ${c}77, inset 0 0 6px ${c}44`;
  if (rarity === "epic") return `0 0 14px ${c}66`;
  if (rarity === "rare") return `0 0 10px ${c}44`;
  return "none";
}

function pct(n: number) {
  return `${n * 100}%`;
}

function GrantEl({ p }: { p: ResolvedPlacement }) {
  const base = "absolute flex items-center justify-center text-center pointer-events-none";
  const style = { left: pct(p.u), top: pct(p.v), transform: "translate(-50%,-50%)" };

  if (p.type === "topRocker" || p.type === "bottomRocker" || p.type === "prospectTab") {
    return (
      <div className={base} style={{ ...style, width: "68%" }}>
        <div
          className="w-full rounded-full border px-3 py-1 uppercase tracking-[0.18em]"
          // The rocker's edge is the CLUB's colour, stitched onto the jacket's
          // own leather and thread. That split is the whole rule on this vest.
          style={{
            borderColor: "var(--brand-primary)",
            color: THREAD_GOLD,
            background: THREAD_BACKING,
            fontSize: "clamp(0.5rem,2.6vw,0.78rem)",
            fontWeight: 700,
          }}
        >
          {p.label || (p.type === "prospectTab" ? "Prospect" : "")}
        </div>
      </div>
    );
  }
  if (p.type === "centerPatch") {
    return (
      <div className={base} style={{ ...style, width: "30%", aspectRatio: "1 / 1.15" }}>
        <div
          className="grid h-full w-full rotate-45 place-items-center rounded-[14%] border-2"
          style={{
            borderColor: "var(--brand-primary)",
            background:
              "radial-gradient(circle, var(--brand-secondary), var(--background-panel))",
          }}
        >
          <Shield className="-rotate-45 size-1/2" style={{ color: THREAD_GOLD }} aria-hidden />
        </div>
      </div>
    );
  }
  if (p.type === "rankTab") {
    return (
      <div className={base} style={{ ...style, width: "38%" }}>
        <div
          className="w-full rounded-md border px-2 py-0.5 uppercase tracking-[0.14em]"
          style={{
            borderColor: "var(--brand-primary)",
            color: THREAD_GOLD,
            background: THREAD_BACKING,
            fontSize: "clamp(0.42rem,2vw,0.62rem)",
            fontWeight: 700,
          }}
        >
          {p.label}
        </div>
      </div>
    );
  }
  // saaDiamond
  return (
    <div className={base} style={{ ...style, width: "15%", aspectRatio: "1" }}>
      <div
        className="grid h-full w-full rotate-45 place-items-center rounded-[18%] border-2"
        style={{ borderColor: SAA_EDGE, background: SAA_GROUND }}
      >
        <span
          className="-rotate-45 font-bold"
          style={{ color: SAA_THREAD, fontSize: "clamp(0.4rem,1.8vw,0.56rem)" }}
        >
          SAA
        </span>
      </div>
    </div>
  );
}

function PatchToken({
  p,
  onSelect,
}: {
  p: ResolvedPlacement;
  onSelect: (p: ResolvedPlacement) => void;
}) {
  const rarity = p.rarity ?? "common";
  const c = RARITY_COLOR[rarity];
  return (
    <button
      type="button"
      onClick={() => onSelect(p)}
      className="group absolute focus-visible:outline-none"
      style={{
        left: pct(p.u),
        top: pct(p.v),
        width: `${Math.max(13, p.scale * 22)}%`,
        transform: "translate(-50%,-50%)",
        zIndex: p.z,
      }}
      aria-label={`${p.label} · ${RARITY_LABEL[rarity]} patch`}
    >
      <span
        className="flex aspect-square w-full items-center justify-center rounded-full border-2 p-1 text-center transition-transform duration-150 group-hover:scale-110 group-focus-visible:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-amber-300"
        style={{
          borderColor: c,
          boxShadow: glow(rarity),
          background: PATCH_GROUND,
        }}
      >
        <span
          className="font-semibold uppercase leading-[1.05] tracking-tight text-stone-100"
          style={{ fontSize: "clamp(0.36rem,1.7vw,0.56rem)" }}
        >
          {p.label}
        </span>
      </span>
    </button>
  );
}

function Surface({
  placements,
  aspectRatio,
  face,
  onSelect,
}: {
  placements: ResolvedPlacement[];
  aspectRatio: number;
  face: CutSurface;
  onSelect: (p: ResolvedPlacement) => void;
}) {
  return (
    <div className="relative mx-auto w-full max-w-sm" style={{ aspectRatio }}>
      <VestBody />
      {placements.length === 0 && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-xs uppercase tracking-[0.2em] text-stone-500">
            {face === "front" ? "No colours yet" : "Bare"}
          </span>
        </div>
      )}
      {placements.map((p) =>
        p.type === "patch" ? (
          <PatchToken key={p.key} p={p} onSelect={onSelect} />
        ) : (
          <GrantEl key={p.key} p={p} />
        ),
      )}
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function CutViewer({
  model,
  summary,
  aspectRatio,
}: {
  model: CutRenderModel;
  summary: CutSummary;
  aspectRatio: number;
}) {
  const [face, setFace] = useState<CutSurface>("back"); // colours live on the back
  const [selected, setSelected] = useState<ResolvedPlacement | null>(null);
  const placements = face === "front" ? model.front : model.back;

  return (
    <div className="space-y-5">
      <div className="glass flex items-center justify-center gap-1 rounded-full p-1">
        {(["front", "back"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFace(f)}
            className={cn(
              "min-h-9 rounded-full px-6 text-sm font-semibold uppercase tracking-wider outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
              face === f
                ? "glass glass-ember text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <Surface
        placements={placements}
        aspectRatio={aspectRatio}
        face={face}
        onSelect={setSelected}
      />

      <p className="text-center text-xs text-muted-foreground">
        {model.back.filter((p) => p.type === "patch").length +
          model.front.filter((p) => p.type === "patch").length}{" "}
        patches on the cut · tap a patch to inspect
      </p>

      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Award className="size-5 text-primary" aria-hidden />
                  {selected.label}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {selected.rarity && (
                    <Badge
                      variant="outline"
                      className="gap-1"
                      style={{ borderColor: RARITY_COLOR[selected.rarity], color: RARITY_COLOR[selected.rarity] }}
                    >
                      <Sparkles className="size-3" aria-hidden />
                      {RARITY_LABEL[selected.rarity]}
                    </Badge>
                  )}
                  {selected.category && (
                    <Badge variant="secondary" className="capitalize">
                      {selected.category}
                    </Badge>
                  )}
                </div>
                {selected.description && (
                  <p className="text-sm leading-relaxed text-foreground">
                    {selected.description}
                  </p>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <CalendarDays className="size-3.5" aria-hidden /> Earned
                  </dt>
                  <dd className="text-foreground">{fmtDate(selected.awardedAt ?? null)}</dd>
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <UserRound className="size-3.5" aria-hidden /> Awarded by
                  </dt>
                  <dd className="text-foreground">
                    {selected.awardedBy ? "An officer" : "Earned through activity"}
                  </dd>
                </dl>
                {selected.reason && (
                  <p className="rounded-md bg-muted px-3 py-2 text-sm italic text-muted-foreground">
                    &ldquo;{selected.reason}&rdquo;
                  </p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
