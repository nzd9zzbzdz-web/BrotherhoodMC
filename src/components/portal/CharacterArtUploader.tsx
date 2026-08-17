"use client";

import { useRef, useTransition } from "react";
import { Clock, ImageUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  removeCharacterRender,
  uploadCharacterRender,
} from "@/actions/character";

/**
 * Upload (or remove) a character render, under the stage.
 *
 * Shown to the member themselves and to admins. A member's own upload appears
 * here immediately but waits on an officer before the public roster will show
 * it, so the copy has to say that at the moment they pick the file — finding
 * out afterwards that your face isn't on the club's front page reads as a bug.
 */
export function CharacterArtUploader({
  orgId,
  memberId,
  hasCustomArt,
  awaitingReview,
  needsApproval,
}: {
  orgId: string;
  memberId: string;
  hasCustomArt: boolean;
  /** Art is uploaded but an officer hasn't cleared it for the public site. */
  awaitingReview: boolean;
  /** This uploader's work would need review (a plain member editing their own). */
  needsApproval: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function handleFile(file: File | undefined) {
    if (!file) return;
    const formData = new FormData();
    formData.set("orgId", orgId);
    formData.set("memberId", memberId);
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadCharacterRender(formData);
      if (result.ok) {
        toast.success(
          result.data?.pending
            ? "Uploaded. An officer will clear it for the public page"
            : "Character model updated",
        );
      } else {
        toast.error(result.error ?? "Upload failed");
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await removeCharacterRender({ orgId, memberId });
      if (result.ok) {
        toast.success("Character model removed");
      } else {
        toast.error(result.error ?? "Could not remove");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {awaitingReview && (
        <p className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0 text-primary" aria-hidden />
          Waiting on an officer before it shows on the public page.
        </p>
      )}
      {!awaitingReview && needsApproval && (
        <p className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0 text-primary" aria-hidden />
          An officer clears new art before the public page shows it.
        </p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => fileRef.current?.click()}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <ImageUp className="size-4" aria-hidden />
        )}
        {pending ? "Processing…" : "Upload character model"}
      </Button>
      {hasCustomArt && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={handleRemove}
        >
          <Trash2 className="size-4" aria-hidden />
          Remove
        </Button>
      )}
    </div>
  );
}
