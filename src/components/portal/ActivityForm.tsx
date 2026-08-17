"use client";

import { useState, useTransition } from "react";
import { ref, uploadBytes } from "firebase/storage";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { getClientStorage } from "@/lib/firebase/client";
import { MAX_ACTIVITY_QUANTITY } from "@/lib/constants";
import { submitActivity } from "@/actions/activities";

interface TypeOption {
  id: string;
  name: string;
  requiresProof: boolean;
  allowQuantity: boolean;
}

/** Inline validation message, rendered only when the field has an error. */
function FieldError({
  id,
  error,
  className = "mt-1 text-sm text-destructive",
}: {
  id?: string;
  error?: string;
  className?: string;
}) {
  if (!error) return null;
  return (
    <p id={id} role="alert" className={className}>
      {error}
    </p>
  );
}

export function ActivityForm({
  orgId,
  memberId,
  types,
  witnesses,
}: {
  orgId: string;
  memberId: string;
  types: TypeOption[];
  witnesses: { id: string; label: string }[];
}) {
  // One ticket can carry several types — typeId → quantity for the checked ones.
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [selectedWitnesses, setSelectedWitnesses] = useState<string[]>([]);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const selectedTypes = types.filter((t) => t.id in selected);
  const proofRecommended = selectedTypes.filter((t) => t.requiresProof);

  /** Set (or clear, when `message` is undefined) one field's error. */
  function setFieldError(field: string, message?: string) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  }

  const DESCRIPTION_HINT = "Describe what happened (at least 10 characters)";

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (selectedTypes.length === 0) next.types = "Pick at least one activity type";
    if (!date) next.date = "Pick a date";
    if (description.trim().length < 10) next.description = DESCRIPTION_HINT;
    for (const type of selectedTypes) {
      if (!type.allowQuantity) continue;
      const quantity = selected[type.id];
      if (!Number.isInteger(quantity) || quantity < 1)
        next[`qty_${type.id}`] = "Enter a whole number of at least 1";
      else if (quantity > MAX_ACTIVITY_QUANTITY)
        next[`qty_${type.id}`] =
          `Max ${MAX_ACTIVITY_QUANTITY.toLocaleString("en-US")} per submission`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function toggleType(id: string) {
    setSelected((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = 1;
      return next;
    });
    setFieldError("types");
    setFieldError(`qty_${id}`);
  }

  function toggleWitness(id: string) {
    setSelectedWitnesses((prev) =>
      prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id].slice(0, 10),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    startTransition(async () => {
      try {
        let proofPath: string | undefined;
        if (proofFile) {
          // Owner-scoped path enforced by Storage rules.
          proofPath = `orgs/${orgId}/proof/${memberId}/pending-${Date.now()}/${proofFile.name}`;
          await uploadBytes(ref(getClientStorage(), proofPath), proofFile, {
            contentType: proofFile.type,
          });
        }
        const result = await submitActivity({
          orgId,
          entries: selectedTypes.map((t) => ({
            typeId: t.id,
            quantity: selected[t.id],
          })),
          date: new Date(date),
          description: description.trim(),
          witnesses: selectedWitnesses,
          proofPath,
        });
        if (result.ok) {
          // No router.refresh() — the action revalidated this page, so the
          // response already carried the fresh submission list.
          toast.success("Activity submitted for review");
          setSelected({});
          setDescription("");
          setSelectedWitnesses([]);
          setProofFile(null);
        } else {
          toast.error(result.error ?? "Submission failed");
        }
      } catch {
        toast.error("Upload failed. Try again");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <fieldset>
        <legend className="text-sm font-medium">
          Activity types <span aria-hidden="true" className="text-destructive">*</span>
        </legend>
        <p className="text-xs text-muted-foreground">
          Check everything this ticket covers. Types with a box take an amount;
          the name carries the unit.
        </p>
        <div
          className="mt-2 max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-border p-2"
          aria-invalid={Boolean(errors.types)}
          aria-describedby={errors.types ? "activity-types-error" : undefined}
        >
          {types.map((type) => {
            const checked = type.id in selected;
            const qtyError = errors[`qty_${type.id}`];
            return (
              <div key={type.id} className="rounded-sm px-1 hover:bg-secondary/40">
                <div className="flex min-h-11 items-center gap-2">
                  <label className="flex flex-1 cursor-pointer items-center gap-2 py-1 text-sm">
                    <Checkbox
                      className="size-5"
                      checked={checked}
                      onCheckedChange={() => toggleType(type.id)}
                    />
                    {type.name}
                  </label>
                  {checked && type.allowQuantity && (
                    <Input
                      type="number"
                      min={1}
                      max={MAX_ACTIVITY_QUANTITY}
                      value={selected[type.id]}
                      onChange={(e) =>
                        setSelected((prev) => ({
                          ...prev,
                          [type.id]: Number(e.target.value) || 1,
                        }))
                      }
                      aria-label={`${type.name} amount`}
                      aria-invalid={Boolean(qtyError)}
                      className="h-9 w-28"
                    />
                  )}
                </div>
                <FieldError error={qtyError} className="pb-1 text-xs text-destructive" />
              </div>
            );
          })}
        </div>
        <FieldError id="activity-types-error" error={errors.types} />
      </fieldset>

      <div>
        <Label htmlFor="activity-date">
          Date <span aria-hidden="true" className="text-destructive">*</span>
        </Label>
        <Input
          id="activity-date"
          type="date"
          value={date}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1"
          required
          aria-required="true"
          aria-invalid={Boolean(errors.date)}
          aria-describedby={errors.date ? "activity-date-error" : undefined}
        />
        <FieldError id="activity-date-error" error={errors.date} />
      </div>

      <div>
        <Label htmlFor="activity-description">
          What happened? <span aria-hidden="true" className="text-destructive">*</span>
        </Label>
        <Textarea
          id="activity-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() =>
            setFieldError(
              "description",
              description && description.trim().length < 10
                ? DESCRIPTION_HINT
                : undefined,
            )
          }
          rows={3}
          maxLength={2000}
          placeholder="Route, who was there, what went down…"
          className="mt-1"
          required
          aria-required="true"
          aria-invalid={Boolean(errors.description)}
          aria-describedby={errors.description ? "activity-description-error" : undefined}
        />
        <FieldError id="activity-description-error" error={errors.description} />
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Witnesses</legend>
        <p className="text-xs text-muted-foreground">
          Who can vouch for this? (optional, up to 10)
        </p>
        <div className="mt-2 max-h-36 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
          {witnesses.map((witness) => (
            <label
              key={witness.id}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-1 text-sm hover:bg-secondary/40"
            >
              <Checkbox
                className="size-5"
                checked={selectedWitnesses.includes(witness.id)}
                onCheckedChange={() => toggleWitness(witness.id)}
              />
              {witness.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <Label htmlFor="activity-proof">
          Proof <span className="text-xs text-muted-foreground">(optional)</span>
        </Label>
        {proofRecommended.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Officers like to see proof for{" "}
            {proofRecommended.map((t) => t.name).join(", ")}.
          </p>
        )}
        {/* Focus lands on the sr-only input; surface it on the visible label. */}
        <label
          htmlFor="activity-proof"
          className="mt-1 flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary/50 focus-within:outline-none focus-within:ring-2 focus-within:ring-ring"
        >
          <Upload className="size-4" aria-hidden />
          {proofFile ? proofFile.name : "Photo or MP4 clip, up to 10 MB"}
        </label>
        <input
          id="activity-proof"
          type="file"
          accept="image/*,video/mp4"
          className="sr-only"
          aria-invalid={Boolean(errors.proof)}
          aria-describedby={errors.proof ? "activity-proof-error" : undefined}
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            if (file && file.size > 10 * 1024 * 1024) {
              setFieldError("proof", "File is over 10 MB");
              return;
            }
            setProofFile(file);
            setFieldError("proof");
          }}
        />
        <FieldError id="activity-proof-error" error={errors.proof} />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {pending ? "Submitting…" : "Submit for review"}
      </Button>
    </form>
  );
}
