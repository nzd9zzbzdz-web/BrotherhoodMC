"use client";

import { useRef, useState, useTransition } from "react";
import { Clock, ImageUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadGalleryPhoto } from "@/actions/gallery";
import { GALLERY_CAPTION_MAX } from "@/lib/schemas/gallery";

/**
 * Post a photo to the club wall.
 *
 * A member's shot waits on an officer, so the copy says so BEFORE they pick the
 * file — finding out afterwards that nobody else can see your photo reads as a
 * bug. Officers skip their own queue and get the one extra decision that a
 * member never sees: whether this also goes on the public foundation site.
 */
export function GalleryUploader({
  orgId,
  canReview,
}: {
  orgId: string;
  /** Officer or admin: their upload lands approved, and can publish outright. */
  canReview: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [publish, setPublish] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleFile(file: File | undefined) {
    if (!file) return;
    const formData = new FormData();
    formData.set("orgId", orgId);
    formData.set("file", file);
    formData.set("caption", caption);
    if (canReview && publish) formData.set("publish", "1");

    startTransition(async () => {
      const result = await uploadGalleryPhoto(formData);
      if (result.ok) {
        toast.success(
          result.data?.pending
            ? "Posted. An officer will clear it for the club"
            : result.data?.published
              ? "Posted and published to the public site"
              : "Posted to the club wall",
        );
        setCaption("");
        setPublish(false);
      } else {
        toast.error(result.error ?? "Upload failed");
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <div className="glass-card space-y-4 rounded-xl p-4">
      <div className="grid gap-2">
        <Label htmlFor="gallery-caption">Caption (optional)</Label>
        <Input
          id="gallery-caption"
          value={caption}
          maxLength={GALLERY_CAPTION_MAX}
          placeholder="Paleto run, 3am"
          onChange={(e) => setCaption(e.target.value)}
          disabled={pending}
        />
      </div>

      {canReview ? (
        <div className="flex items-start gap-2">
          <Checkbox
            id="gallery-publish"
            checked={publish}
            onCheckedChange={(v) => setPublish(v === true)}
            disabled={pending}
          />
          <div className="grid gap-1 leading-none">
            <Label htmlFor="gallery-publish" className="cursor-pointer">
              Also publish to the public site
            </Label>
            <p className="text-xs text-muted-foreground">
              Leave this off and the photo stays inside the club. You can publish
              it later from the wall.
            </p>
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0 text-primary" aria-hidden />
          Your photo shows here right away. An officer clears it before the rest
          of the club sees it.
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <Button disabled={pending} onClick={() => fileRef.current?.click()}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <ImageUp className="size-4" aria-hidden />
        )}
        {pending ? "Processing…" : "Choose a photo"}
      </Button>
    </div>
  );
}
