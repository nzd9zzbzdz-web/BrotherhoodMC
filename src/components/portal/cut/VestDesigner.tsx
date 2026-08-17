"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { saveVestConfig } from "@/actions/vest";
import type { CutSurface, PatchCategory, PatchSlot } from "@/lib/types";
import { VestBody } from "./VestBody";
import { cn } from "@/lib/utils";

const CATEGORIES: PatchCategory[] = ["activity", "service", "leadership", "recognition", "legendary"];
const clamp = (n: number) => Math.min(1, Math.max(0, n));

type Slots = Record<CutSurface, PatchSlot[]>;

export function VestDesigner({
  orgId,
  initial,
}: {
  orgId: string;
  initial: Slots;
}) {
  const [surface, setSurface] = useState<CutSurface>("front");
  const [slots, setSlots] = useState<Slots>(initial);
  const [selected, setSelected] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const stageRef = useRef<HTMLDivElement>(null);
  const initialJson = useMemo(() => JSON.stringify(initial), [initial]);

  const list = slots[surface];
  const dirty = JSON.stringify(slots) !== initialJson;

  function update(next: PatchSlot[]) {
    setSlots((s) => ({ ...s, [surface]: next }));
  }
  function patchSlot(i: number, patch: Partial<PatchSlot>) {
    update(list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function addSlot() {
    const n = list.length + 1;
    update([
      ...list,
      { slot: `SLOT_${n}`, u: 0.5, v: 0.5, maxScale: 0.7, accepts: ["activity"], capacity: 2 },
    ]);
    setSelected(list.length);
  }
  function removeSlot(i: number) {
    update(list.filter((_, idx) => idx !== i));
    setSelected(null);
  }

  function pointerToUV(e: React.PointerEvent) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { u: clamp((e.clientX - rect.left) / rect.width), v: clamp((e.clientY - rect.top) / rect.height) };
  }

  function save() {
    startTransition(async () => {
      const result = await saveVestConfig({ orgId, surface, slots: slots[surface] });
      if (result.ok) toast.success(`${surface[0].toUpperCase() + surface.slice(1)} layout saved`);
      else toast.error(result.error ?? "Save failed");
    });
  }

  const sel = selected !== null ? list[selected] : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* Stage */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="glass flex gap-1 rounded-full p-1">
            {(["front", "back"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setSurface(f);
                  setSelected(null);
                }}
                className={cn(
                  "min-h-8 rounded-full px-4 text-xs font-semibold uppercase tracking-wider outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  surface === f ? "glass glass-ember text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={addSlot}>
            <Plus className="size-4" aria-hidden /> Add slot
          </Button>
        </div>

        <div
          ref={stageRef}
          className="relative mx-auto w-full max-w-sm touch-none select-none"
          style={{ aspectRatio: 0.88 }}
          onPointerMove={(e) => {
            if (dragging === null) return;
            const uv = pointerToUV(e);
            if (uv) patchSlot(dragging, uv);
          }}
          onPointerUp={() => setDragging(null)}
          onPointerLeave={() => setDragging(null)}
        >
          <VestBody />
          {list.map((s, i) => (
            <button
              key={i}
              type="button"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setSelected(i);
                setDragging(i);
              }}
              className="group absolute flex cursor-move flex-col items-center gap-1 focus-visible:outline-none"
              style={{ left: `${s.u * 100}%`, top: `${s.v * 100}%`, transform: "translate(-50%,-50%)" }}
              aria-label={`Slot ${s.slot} at ${Math.round(s.u * 100)}, ${Math.round(s.v * 100)}`}
            >
              {/* Keyboard focus lands on the diamond, not the outline-less
                  button — tab order has to be visible on the stage too. */}
              <span
                className={cn(
                  "size-4 rotate-45 border-2 transition-shadow group-focus-visible:ring-2 group-focus-visible:ring-ring",
                  selected === i
                    ? "border-primary bg-primary/40 ring-4 ring-primary/25"
                    : "border-primary/70 bg-primary/10",
                )}
              />
              <span className="rounded bg-background/80 px-1 text-[0.55rem] font-medium tracking-tight text-foreground">
                {s.slot}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Drag a marker to move it. Add slots, edit them on the right, then save the {surface}.
        </p>
      </div>

      {/* Inspector / actions */}
      <div className="space-y-4">
        <div className="glass-card rounded-lg p-4">
          {sel ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="slot-name">Slot name</Label>
                <Input
                  id="slot-name"
                  value={sel.slot}
                  onChange={(e) =>
                    patchSlot(selected!, { slot: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })
                  }
                  className="mt-1 font-mono text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="slot-scale">Max scale</Label>
                  <Input
                    id="slot-scale"
                    type="number"
                    min={0.2}
                    max={2}
                    step={0.1}
                    value={sel.maxScale}
                    onChange={(e) => patchSlot(selected!, { maxScale: Number(e.target.value) })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="slot-cap">Capacity</Label>
                  <Input
                    id="slot-cap"
                    type="number"
                    min={1}
                    max={20}
                    value={sel.capacity}
                    onChange={(e) => patchSlot(selected!, { capacity: Math.round(Number(e.target.value)) })}
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <Label>Accepts categories</Label>
                <div className="mt-2 space-y-1.5">
                  {CATEGORIES.map((c) => (
                    <label key={c} className="flex items-center gap-2 text-sm capitalize">
                      <Checkbox
                        checked={sel.accepts.includes(c)}
                        onCheckedChange={(v) =>
                          patchSlot(selected!, {
                            accepts: v ? [...sel.accepts, c] : sel.accepts.filter((x) => x !== c),
                          })
                        }
                      />
                      {c}
                    </label>
                  ))}
                </div>
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                u {sel.u.toFixed(3)} · v {sel.v.toFixed(3)}
              </p>
              <Button variant="destructive" size="sm" onClick={() => removeSlot(selected!)} className="w-full">
                <Trash2 className="size-4" aria-hidden /> Delete slot
              </Button>
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Select a slot marker to edit it, or add a new one.
            </p>
          )}
        </div>

        <Button onClick={save} disabled={pending || !dirty} className="w-full">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
          {dirty ? "Save layout" : "Saved"}
        </Button>

        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Vest artwork upload arrives with cloud Storage (paid plan). For now the schematic vest is the canvas. Slot positions and rules are fully editable and drive every member&rsquo;s cut.
        </p>
      </div>
    </div>
  );
}
