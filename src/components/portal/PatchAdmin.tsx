"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { Loader2, Medal, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { PatchArtCell } from "@/components/portal/PatchArtCell";
import { manualAward, upsertPatch } from "@/actions/patches";
import { groupPatches, patchMatchesQuery } from "@/lib/patch-groups";
import { STAT_LABELS } from "@/lib/constants";
import type { PatchCategory, StatKey } from "@/lib/types";

interface PatchRow {
  id: string;
  name: string;
  category: PatchCategory;
  description: string;
  tier: number;
  requirement: { statKey: StatKey; threshold: number } | null;
  manual: boolean;
  active: boolean;
  emblem: boolean;
  art: string | null; // webp data URL from the patchArt collection
  surface: "front" | "back";
  u: number;
  v: number;
}

const CATEGORIES: PatchCategory[] = [
  "activity",
  "service",
  "leadership",
  "recognition",
  "legendary",
];

const ROMAN = ["I", "II", "III", "IV", "V"];

const EMPTY_FORM = {
  patchId: undefined as string | undefined,
  name: "",
  category: "activity" as PatchCategory,
  description: "",
  tier: 1,
  hasRequirement: true,
  statKey: "clubRuns" as StatKey,
  threshold: 10,
  active: true,
  emblem: false,
  surface: "front" as "front" | "back",
};

export function PatchAdmin({
  orgId,
  patches,
  members,
}: {
  orgId: string;
  patches: PatchRow[];
  members: { id: string; label: string }[];
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [awardTarget, setAwardTarget] = useState<PatchRow | null>(null);
  const [awardMemberId, setAwardMemberId] = useState("");
  const [awardReason, setAwardReason] = useState("");
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  // Filter first, then group, so a search narrows the ladders rather than
  // flattening them — "drug" still shows Drug Sales as a ladder in tier order.
  const groups = useMemo(
    () => groupPatches(patches.filter((p) => patchMatchesQuery(p, query))),
    [patches, query],
  );

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  }

  function openEdit(patch: PatchRow) {
    setForm({
      patchId: patch.id,
      name: patch.name,
      category: patch.category,
      description: patch.description,
      tier: patch.tier,
      hasRequirement: patch.requirement !== null,
      statKey: patch.requirement?.statKey ?? "clubRuns",
      threshold: patch.requirement?.threshold ?? 10,
      active: patch.active,
      emblem: patch.emblem,
      surface: patch.surface,
    });
    setEditorOpen(true);
  }

  function save() {
    startTransition(async () => {
      const result = await upsertPatch({
        orgId,
        patchId: form.patchId,
        name: form.name,
        category: form.category,
        description: form.description,
        tier: form.tier,
        requirement: form.hasRequirement
          ? { statKey: form.statKey, threshold: form.threshold }
          : null,
        active: form.active,
        emblem: form.emblem,
        defaultPlacement: {
          surface: form.surface,
          u: 0.5,
          v: 0.5,
          scale: 0.8,
          rotationDeg: 0,
        },
      });
      if (result.ok) {
        toast.success(form.patchId ? "Patch updated" : "Patch created");
        setEditorOpen(false);
      } else {
        toast.error(result.error ?? "Save failed");
      }
    });
  }

  function award() {
    if (!awardTarget || !awardMemberId) return;
    startTransition(async () => {
      const result = await manualAward({
        orgId,
        memberId: awardMemberId,
        patchId: awardTarget.id,
        reason: awardReason.trim(),
      });
      if (result.ok) {
        toast.success(`${awardTarget.name} awarded`);
        setAwardTarget(null);
        setAwardMemberId("");
        setAwardReason("");
      } else {
        toast.error(result.error ?? "Award failed");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or stat…"
            aria-label="Filter patches"
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" aria-hidden />
          New patch
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Art</TableHead>
              <TableHead>Patch</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Requirement</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  Nothing matches &ldquo;{query}&rdquo;.
                </TableCell>
              </TableRow>
            )}
            {groups.map((group) => (
              <Fragment key={group.key}>
                <TableRow className="border-t-2 border-border bg-muted/40 hover:bg-muted/40">
                  <TableCell
                    colSpan={6}
                    className="py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {group.label}
                    <span className="font-stat ml-2 font-normal normal-case tracking-normal">
                      {group.patches.length}
                    </span>
                  </TableCell>
                </TableRow>
                {group.patches.map((patch, i) => (
              <TableRow key={patch.id}>
                <TableCell>
                  <PatchArtCell
                    orgId={orgId}
                    patchId={patch.id}
                    patchName={patch.name}
                    art={patch.art}
                  />
                </TableCell>
                <TableCell>
                  <p className="flex items-baseline gap-2 font-semibold">
                    {/* Rows inside a ladder are threshold-ordered, so position
                        is the tier — worth showing, since the names alone don't
                        say which rung comes first. */}
                    {group.laddered && (
                      <span className="font-stat text-xs text-muted-foreground">
                        {ROMAN[i] ?? i + 1}
                      </span>
                    )}
                    {patch.name}
                  </p>
                  <p className="max-w-xs truncate text-xs text-muted-foreground">
                    {patch.description}
                  </p>
                </TableCell>
                <TableCell className="capitalize">{patch.category}</TableCell>
                <TableCell className="text-sm">
                  {patch.requirement ? (
                    <span className="font-stat">
                      {/* The stat is the group header, so repeating it on every
                          row is noise — inside a ladder only the number varies. */}
                      {group.laddered ? "≥ " : `${STAT_LABELS[patch.requirement.statKey]} ≥ `}
                      {patch.requirement.threshold.toLocaleString("en-US")}
                    </span>
                  ) : (
                    <span className="italic text-muted-foreground">Manual award</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={patch.active ? "default" : "secondary"}>
                    {patch.active ? "Active" : "Disabled"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(patch)}>
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAwardTarget(patch)}
                    >
                      <Medal className="size-3.5" aria-hidden />
                      Award
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Editor dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.patchId ? "Edit patch" : "New patch"}</DialogTitle>
            <DialogDescription>
              Requirement-based patches award automatically when a member&apos;s
              stat crosses the threshold.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="patch-name">
                Name <span aria-hidden="true" className="text-destructive">*</span>
              </Label>
              <Input
                id="patch-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={60}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="patch-category">Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v as PatchCategory })}
                >
                  <SelectTrigger id="patch-category" className="mt-1 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="patch-tier">Tier (1-5)</Label>
                <Input
                  id="patch-tier"
                  type="number"
                  min={1}
                  max={5}
                  value={form.tier}
                  onChange={(e) => setForm({ ...form, tier: Number(e.target.value) || 1 })}
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="patch-description">
                Description <span aria-hidden="true" className="text-destructive">*</span>
              </Label>
              <Textarea
                id="patch-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                maxLength={500}
                className="mt-1"
              />
            </div>

            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={form.hasRequirement}
                onCheckedChange={(checked) =>
                  setForm({ ...form, hasRequirement: checked === true })
                }
              />
              Automatic requirement (unchecked = manual award only)
            </label>

            {form.hasRequirement && (
              <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3">
                <div>
                  <Label htmlFor="patch-stat">Stat</Label>
                  <Select
                    value={form.statKey}
                    onValueChange={(v) => setForm({ ...form, statKey: v as StatKey })}
                  >
                    <SelectTrigger id="patch-stat" className="mt-1 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(STAT_LABELS) as [StatKey, string][]).map(
                        ([key, label]) => (
                          <SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="patch-threshold">Threshold</Label>
                  <Input
                    id="patch-threshold"
                    type="number"
                    min={1}
                    max={10000}
                    value={form.threshold}
                    onChange={(e) =>
                      setForm({ ...form, threshold: Number(e.target.value) || 1 })
                    }
                    className="mt-1"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {/* An emblem is never placed, so asking where to put it is noise. */}
              {form.emblem ? (
                <div className="flex min-h-11 items-end pb-2">
                  <p className="text-xs text-muted-foreground">
                    Emblems aren&apos;t worn on the cut. They show as a levelled
                    ladder on the member&apos;s profile.
                  </p>
                </div>
              ) : (
                <div>
                  <Label htmlFor="patch-surface">Cut placement</Label>
                  <Select
                    value={form.surface}
                    onValueChange={(v) => setForm({ ...form, surface: v as "front" | "back" })}
                  >
                    <SelectTrigger id="patch-surface" className="mt-1 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="front">Front of vest</SelectItem>
                      <SelectItem value="back">Back of vest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex min-h-11 flex-col justify-end gap-2 pb-2 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={form.active}
                    onCheckedChange={(checked) =>
                      setForm({ ...form, active: checked === true })
                    }
                  />
                  Active
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={form.emblem}
                    onCheckedChange={(checked) =>
                      setForm({ ...form, emblem: checked === true })
                    }
                  />
                  Emblem (not worn on the cut)
                </label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={pending || !form.name.trim() || form.description.trim().length < 5}
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {form.patchId ? "Save changes" : "Create patch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual award dialog */}
      <Dialog
        open={awardTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAwardTarget(null);
            setAwardMemberId("");
            setAwardReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Award &ldquo;{awardTarget?.name}&rdquo;</DialogTitle>
            <DialogDescription>
              Manual awards go on the member&apos;s cut and record immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="award-member">
                Member <span aria-hidden="true" className="text-destructive">*</span>
              </Label>
              <Select value={awardMemberId} onValueChange={setAwardMemberId}>
                <SelectTrigger id="award-member" className="mt-1 w-full">
                  <SelectValue placeholder="Who earned it?" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="award-reason">
                Reason <span aria-hidden="true" className="text-destructive">*</span>
              </Label>
              <Textarea
                id="award-reason"
                value={awardReason}
                onChange={(e) => setAwardReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Held the line when it counted…"
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Shown in the Hall of Legends for legendary patches.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAwardTarget(null);
                setAwardMemberId("");
                setAwardReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={award}
              disabled={pending || !awardMemberId || awardReason.trim().length < 5}
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Award patch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
