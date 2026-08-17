"use client";

import { useRef, useTransition } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removePatchArt, uploadPatchArt } from "@/actions/patch-art";

/**
 * Artwork control for one row of the admin patch table: the current art (or an
 * empty frame), click to replace, and a remove button once something is set.
 *
 * The thumbnail is the drop target rather than a separate button — with sixty
 * rows, a column of "Upload" buttons is a wall of text, and the frame doubles
 * as the preview an admin needs to see whether the art actually reads at size.
 */
export function PatchArtCell({
  orgId,
  patchId,
  patchName,
  art,
}: {
  orgId: string;
  patchId: string;
  patchName: string;
  art: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function handleFile(file: File | undefined) {
    if (!file) return;
    const formData = new FormData();
    formData.set("orgId", orgId);
    formData.set("patchId", patchId);
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadPatchArt(formData);
      if (result.ok) {
        toast.success(`Artwork set for ${patchName}`);
      } else {
        toast.error(result.error ?? "Upload failed");
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await removePatchArt({ orgId, patchId });
      if (result.ok) {
        toast.success(`Artwork removed from ${patchName}`);
      } else {
        toast.error(result.error ?? "Could not remove");
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {/* glass-card, not glass: this cell repeats for every row of the patch
          table, and sixty backdrop-blurs is a compositor bill. border-dashed
          keeps the drop-frame affordance (single-property utilities sort after
          glass-card's border shorthand, so the dash survives). */}
      <button
        type="button"
        disabled={pending}
        onClick={() => fileRef.current?.click()}
        aria-label={art ? `Replace artwork for ${patchName}` : `Add artwork for ${patchName}`}
        className="glass-card glass-hover flex size-11 shrink-0 items-center justify-center rounded-md border-dashed outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
        ) : art ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by the art route, already sized
          <img
            src={art}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full rounded-md object-contain p-0.5"
          />
        ) : (
          <ImagePlus className="size-4 text-muted-foreground" aria-hidden />
        )}
      </button>
      {art && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={pending}
          onClick={handleRemove}
          aria-label={`Remove artwork from ${patchName}`}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      )}
    </div>
  );
}
