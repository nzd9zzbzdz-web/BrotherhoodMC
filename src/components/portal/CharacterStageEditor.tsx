"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Loader2, Medal, Move, RotateCcw, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  CATEGORY_ICON,
  CharacterStage,
  slotCenter,
  type CharacterStageProps,
  type StageEmblem,
  type StagePatch,
} from "./CharacterStage";
import { saveCharacterEmblems, saveCharacterPose } from "@/actions/character";
import {
  CHARACTER_EMBLEM_LIMITS,
  CHARACTER_POSE_LIMITS,
  DEFAULT_CHARACTER_EMBLEM_SIZE,
  DEFAULT_CHARACTER_POSE,
} from "@/lib/constants";
import type { CharacterPose, StageEmblemPlacement } from "@/lib/types";

const L = CHARACTER_POSE_LIMITS;
const E = CHARACTER_EMBLEM_LIMITS;
const clamp = (n: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, n));

/** One award the member could pin: what to draw, plus which shelf it's from. */
export interface EmblemChoice extends StagePatch {
  kind: "emblem" | "patch";
}

/**
 * Member controls for their character stage: where the render stands, and
 * which earned emblems show and where.
 *
 * Renders the stage as normal and, in an edit mode, lays an interaction
 * surface over it. The overlay is why editing is a mode rather than always-on:
 * the stage already owns wheel events for its focus dolly, and permanently
 * draggable tiles would swallow that from every member viewing the page.
 *
 * Everything is stored as percentages of the stage box, so an arrangement
 * holds at any window size.
 */
export function CharacterStageEditor({
  orgId,
  memberId,
  canEdit,
  initialPose,
  initialEmblems,
  emblemChoices,
  ...stageProps
}: Omit<CharacterStageProps, "emblems"> & {
  orgId: string;
  memberId: string;
  canEdit: boolean;
  initialPose?: CharacterPose;
  /** Saved arrangement; null/undefined ⇒ the automatic diamond slots. */
  initialEmblems?: StageEmblemPlacement[] | null;
  /** Everything this member has earned and may therefore pin. */
  emblemChoices: EmblemChoice[];
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"pose" | "emblems" | null>(null);

  const choiceById = useMemo(
    () => new Map(emblemChoices.map((c) => [c.patchId, c])),
    [emblemChoices],
  );
  // A revoked award may leave a stale placement behind; never draw or resave it.
  const sanitize = (list: StageEmblemPlacement[] | null | undefined) =>
    list == null ? null : list.filter((p) => choiceById.has(p.patchId));

  const [pose, setPose] = useState<CharacterPose>(
    initialPose ?? DEFAULT_CHARACTER_POSE,
  );
  // What's on the server, so Cancel can put it back. State rather than a ref
  // because it renders: it's what Save compares against to know it's enabled.
  const [savedPose, setSavedPose] = useState<CharacterPose>(
    initialPose ?? DEFAULT_CHARACTER_POSE,
  );
  const [placements, setPlacements] = useState<StageEmblemPlacement[] | null>(
    () => sanitize(initialEmblems),
  );
  const [savedPlacements, setSavedPlacements] = useState<
    StageEmblemPlacement[] | null
  >(() => sanitize(initialEmblems));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const poseDragRef = useRef<{ px: number; py: number; pose: CharacterPose } | null>(null);
  const tileDragRef = useRef<{
    px: number;
    py: number;
    start: StageEmblemPlacement;
  } | null>(null);

  // ── Pose editing ────────────────────────────────────────────────────

  function beginPoseDrag(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    poseDragRef.current = { px: e.clientX, py: e.clientY, pose };
  }

  function onPoseDrag(e: React.PointerEvent<HTMLDivElement>) {
    const start = poseDragRef.current;
    const box = surfaceRef.current?.getBoundingClientRect();
    if (!start || !box) return;
    // Pixels → percent of the stage. y is measured from the bottom, so a
    // downward drag (positive dy) has to *lower* the value.
    const dx = ((e.clientX - start.px) / box.width) * 100;
    const dy = ((e.clientY - start.py) / box.height) * 100;
    setPose({
      x: clamp(start.pose.x + dx, L.x),
      y: clamp(start.pose.y - dy, L.y),
      scale: start.pose.scale,
    });
  }

  function endPoseDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    poseDragRef.current = null;
  }

  function nudgePose(dx: number, dy: number) {
    setPose((p) => ({
      ...p,
      x: clamp(p.x + dx, L.x),
      y: clamp(p.y + dy, L.y),
    }));
  }

  function persistPose(next: CharacterPose | null) {
    startTransition(async () => {
      const result = await saveCharacterPose({ orgId, memberId, pose: next });
      if (!result.ok) {
        toast.error(result.error ?? "Could not save position");
        return;
      }
      const applied = next ?? DEFAULT_CHARACTER_POSE;
      setSavedPose(applied);
      setPose(applied);
      setMode(null);
      toast.success(next ? "Character position saved" : "Position reset");
    });
  }

  const poseDirty =
    pose.x !== savedPose.x ||
    pose.y !== savedPose.y ||
    pose.scale !== savedPose.scale;

  // ── Emblem editing ──────────────────────────────────────────────────

  const draft = placements ?? [];
  const selected = draft.find((p) => p.patchId === selectedId) ?? null;

  function updatePlacement(patchId: string, patch: Partial<StageEmblemPlacement>) {
    setPlacements((list) =>
      (list ?? []).map((p) => (p.patchId === patchId ? { ...p, ...patch } : p)),
    );
  }

  function toggleChoice(patchId: string) {
    const cur = placements ?? [];
    if (cur.some((p) => p.patchId === patchId)) {
      if (selectedId === patchId) setSelectedId(null);
      setPlacements(cur.filter((p) => p.patchId !== patchId));
      return;
    }
    if (cur.length >= E.count) return;
    // New tiles land in a loose grid on the open right side of the stage,
    // clear of the spotlight and the record panel.
    const i = cur.length;
    setSelectedId(patchId);
    setPlacements([
      ...cur,
      {
        patchId,
        x: clamp(68 + (i % 3) * 10, E.x),
        y: clamp(18 + Math.floor(i / 3) * 14, E.y),
        size: DEFAULT_CHARACTER_EMBLEM_SIZE,
      },
    ]);
  }

  function beginTileDrag(e: React.PointerEvent<HTMLDivElement>, patchId: string) {
    e.stopPropagation();
    const start = draft.find((p) => p.patchId === patchId);
    if (!start) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedId(patchId);
    tileDragRef.current = { px: e.clientX, py: e.clientY, start };
  }

  function onTileDrag(e: React.PointerEvent<HTMLDivElement>) {
    const drag = tileDragRef.current;
    const box = surfaceRef.current?.getBoundingClientRect();
    if (!drag || !box) return;
    const dx = ((e.clientX - drag.px) / box.width) * 100;
    const dy = ((e.clientY - drag.py) / box.height) * 100;
    updatePlacement(drag.start.patchId, {
      x: clamp(drag.start.x + dx, E.x),
      y: clamp(drag.start.y + dy, E.y),
    });
  }

  function endTileDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    tileDragRef.current = null;
  }

  function persistEmblems(next: StageEmblemPlacement[] | null) {
    startTransition(async () => {
      const result = await saveCharacterEmblems({
        orgId,
        memberId,
        placements: next,
      });
      if (!result.ok) {
        toast.error(result.error ?? "Could not save emblems");
        return;
      }
      setSavedPlacements(next);
      setPlacements(next);
      setSelectedId(null);
      setMode(null);
      toast.success(next ? "Stage emblems saved" : "Back to your top patches");
    });
  }

  const emblemsDirty =
    JSON.stringify(placements) !== JSON.stringify(savedPlacements);

  function enterEmblemMode() {
    // With no saved arrangement the stage is showing the automatic slots, so
    // start the draft from those exact tiles: what you grab first is what you
    // were already looking at, not a blank stage or a frozen rail.
    if (placements == null) {
      setPlacements(
        stageProps.patches
          .slice(0, 4)
          .filter((p) => choiceById.has(p.patchId))
          .map((p, i) => ({ patchId: p.patchId, ...slotCenter(i) })),
      );
    }
    setSelectedId(null);
    setMode("emblems");
  }

  // ── Stage view ──────────────────────────────────────────────────────

  const shownPlacements = mode === "emblems" ? placements : savedPlacements;
  const stageEmblems: StageEmblem[] | undefined =
    shownPlacements == null
      ? undefined
      : shownPlacements.flatMap((p) => {
          const c = choiceById.get(p.patchId);
          return c ? [{ ...c, x: p.x, y: p.y, size: p.size }] : [];
        });

  const cap = E.count;
  const groups: { label: string; kind: EmblemChoice["kind"] }[] = [
    { label: "Emblems", kind: "emblem" },
    { label: "Patches", kind: "patch" },
  ];

  return (
    <div>
      {/* select-none while editing: a drag would otherwise sweep a text
          selection across the stage's stat panel. The z-10 on every overlay
          piece matters too — the stage's own children carry z-index up to 6
          and the stage root is not a stacking context, so an unranked overlay
          would paint above them but lose the hit test. */}
      <div
        className={mode ? "relative select-none" : "relative"}
        ref={surfaceRef}
      >
        <CharacterStage {...stageProps} pose={pose} emblems={stageEmblems} />

        {mode === "pose" && (
          <>
            {/* Drag surface. Covers the stage so the grab works anywhere,
                which beats hunting for the figure's transparent edges. */}
            <div
              role="application"
              aria-label="Drag to move the character"
              onPointerDown={beginPoseDrag}
              onPointerMove={onPoseDrag}
              onPointerUp={endPoseDrag}
              onPointerCancel={endPoseDrag}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 5 : 1;
                if (e.key === "ArrowLeft") nudgePose(-step, 0);
                else if (e.key === "ArrowRight") nudgePose(step, 0);
                else if (e.key === "ArrowUp") nudgePose(0, step);
                else if (e.key === "ArrowDown") nudgePose(0, -step);
                else return;
                e.preventDefault();
              }}
              tabIndex={0}
              className="absolute inset-0 z-10 cursor-move rounded-[var(--radius,0.5rem)] outline-none ring-2 ring-inset ring-primary/70 focus-visible:ring-4"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/75 px-3 py-1 text-xs text-white/85 backdrop-blur-sm"
            >
              Drag to move · arrow keys to nudge
            </div>
          </>
        )}

        {mode === "emblems" && (
          <>
            {/* Deselect ground. The emblems themselves render inside the stage;
                these hit tiles sit at the same coordinates on top of them, so
                what you grab is exactly what you see. */}
            <div
              className="absolute inset-0 z-10 rounded-[var(--radius,0.5rem)] ring-2 ring-inset ring-primary/70"
              onPointerDown={() => setSelectedId(null)}
            />
            {draft.map((p) => {
              const choice = choiceById.get(p.patchId);
              if (!choice) return null;
              const isSelected = p.patchId === selectedId;
              return (
                <div
                  key={p.patchId}
                  role="button"
                  aria-label={`${choice.name}: drag to move, arrow keys to nudge, Delete to remove`}
                  tabIndex={0}
                  onPointerDown={(e) => beginTileDrag(e, p.patchId)}
                  onPointerMove={onTileDrag}
                  onPointerUp={endTileDrag}
                  onPointerCancel={endTileDrag}
                  onKeyDown={(e) => {
                    const step = e.shiftKey ? 5 : 1;
                    if (e.key === "ArrowLeft")
                      updatePlacement(p.patchId, { x: clamp(p.x - step, E.x) });
                    else if (e.key === "ArrowRight")
                      updatePlacement(p.patchId, { x: clamp(p.x + step, E.x) });
                    else if (e.key === "ArrowUp")
                      updatePlacement(p.patchId, { y: clamp(p.y - step, E.y) });
                    else if (e.key === "ArrowDown")
                      updatePlacement(p.patchId, { y: clamp(p.y + step, E.y) });
                    else if (e.key === "Delete" || e.key === "Backspace")
                      toggleChoice(p.patchId);
                    else return;
                    e.preventDefault();
                  }}
                  className={`absolute z-10 aspect-square -translate-x-1/2 -translate-y-1/2 cursor-move touch-none rounded-sm outline-none ${
                    isSelected
                      ? "ring-2 ring-primary"
                      : "ring-1 ring-primary/40 hover:ring-primary/80"
                  } focus-visible:ring-2 focus-visible:ring-primary`}
                  style={{
                    left: `${p.x}%`,
                    top: `${p.y}%`,
                    width: `${p.size}%`,
                  }}
                />
              );
            })}
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/75 px-3 py-1 text-xs text-white/85 backdrop-blur-sm"
            >
              {selected
                ? "Drag to move · size slider below"
                : "Pick emblems below, then drag them into place"}
            </div>
          </>
        )}
      </div>

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {mode === null && (
            <>
              <Button variant="outline" size="sm" onClick={() => setMode("pose")}>
                <Move className="size-4" aria-hidden />
                Adjust character
              </Button>
              <Button variant="outline" size="sm" onClick={enterEmblemMode}>
                <Medal className="size-4" aria-hidden />
                Arrange emblems
              </Button>
            </>
          )}

          {mode === "pose" && (
            <>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="pose-scale"
                  className="text-xs uppercase tracking-[0.14em] text-muted-foreground"
                >
                  Size
                </label>
                <input
                  id="pose-scale"
                  type="range"
                  min={L.scale.min}
                  max={L.scale.max}
                  step={1}
                  value={pose.scale}
                  onChange={(e) =>
                    setPose((p) => ({ ...p, scale: Number(e.target.value) }))
                  }
                  className="w-40 accent-[var(--primary)]"
                />
                <span className="font-stat w-10 text-xs text-muted-foreground">
                  {Math.round(pose.scale)}%
                </span>
              </div>

              <Button
                size="sm"
                onClick={() => persistPose(pose)}
                disabled={pending || !poseDirty}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                Save position
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setPose(savedPose);
                  setMode(null);
                }}
              >
                <X className="size-4" aria-hidden />
                Cancel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => persistPose(null)}
                title="Back to the default placement"
              >
                <RotateCcw className="size-4" aria-hidden />
                Reset
              </Button>
            </>
          )}

          {mode === "emblems" && (
            <>
              {selected && (
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="emblem-size"
                    className="text-xs uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    Size
                  </label>
                  <input
                    id="emblem-size"
                    type="range"
                    min={E.size.min}
                    max={E.size.max}
                    step={0.5}
                    value={selected.size}
                    onChange={(e) =>
                      updatePlacement(selected.patchId, {
                        size: Number(e.target.value),
                      })
                    }
                    className="w-40 accent-[var(--primary)]"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => toggleChoice(selected.patchId)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    Remove
                  </Button>
                </div>
              )}

              <Button
                size="sm"
                onClick={() => persistEmblems(placements ?? [])}
                disabled={pending || !emblemsDirty}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                Save emblems
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setPlacements(savedPlacements);
                  setSelectedId(null);
                  setMode(null);
                }}
              >
                <X className="size-4" aria-hidden />
                Cancel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => persistEmblems(null)}
                title="Back to your four rarest patches, placed automatically"
              >
                <RotateCcw className="size-4" aria-hidden />
                Reset
              </Button>
            </>
          )}
        </div>
      )}

      {mode === "emblems" && (
        <div className="mt-3 rounded-[var(--radius,0.5rem)] border border-border bg-card/60 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Show on your stage
            </p>
            <p className="font-stat text-xs text-muted-foreground">
              {draft.length}/{cap}
            </p>
          </div>
          {emblemChoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing earned yet. Log activities to unlock emblems you can place
              here.
            </p>
          ) : (
            groups.map(({ label, kind }) => {
              const items = emblemChoices.filter((c) => c.kind === kind);
              if (items.length === 0) return null;
              return (
                <div key={kind} className="mb-2 last:mb-0">
                  <p className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
                    {label}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {items.map((c) => {
                      const added = draft.some((p) => p.patchId === c.patchId);
                      const full = !added && draft.length >= cap;
                      const Icon = CATEGORY_ICON[c.category];
                      return (
                        <button
                          key={c.patchId}
                          type="button"
                          onClick={() => toggleChoice(c.patchId)}
                          disabled={pending || full}
                          title={`${c.name} · ${c.awardedLabel}`}
                          aria-pressed={added}
                          className={`flex w-16 flex-col items-center gap-1 rounded-sm p-1 outline-none transition-colors ${
                            added
                              ? "bg-primary/10 ring-1 ring-primary"
                              : "hover:bg-muted/40 focus-visible:ring-1 focus-visible:ring-primary"
                          } ${full ? "opacity-40" : ""}`}
                        >
                          <span className="flex size-11 items-center justify-center">
                            {c.artUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- streamed by the art route, already sized
                              <img
                                src={c.artUrl}
                                alt=""
                                className="max-h-full max-w-full object-contain"
                              />
                            ) : (
                              <Icon
                                className="size-6 text-primary/80"
                                aria-hidden
                              />
                            )}
                          </span>
                          <span className="w-full truncate text-center text-[10px] leading-tight text-muted-foreground">
                            {c.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
