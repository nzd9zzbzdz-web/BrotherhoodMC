"use client";

import { useRef, useTransition } from "react";
import { ImageUp, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resetBrandingArt, uploadBrandingArt } from "@/actions/branding-art";
import type { BrandingArtKey } from "@/lib/branding-art";

/**
 * Admin control for one piece of branding scene art: preview, replace, reset.
 *
 * The preview is the URL the site is actually using, not the file just picked,
 * so what an admin sees here is what the club sees. After a successful upload
 * the server action revalidates the page and the new `?v=` arrives with the
 * re-render — no local object URL to go stale.
 */
export function BrandingArtUploader({
  orgId,
  artKey,
  label,
  blurb,
  ratioHint,
  currentUrl,
  isCustom,
  aspect,
}: {
  orgId: string;
  artKey: BrandingArtKey;
  label: string;
  blurb: string;
  ratioHint: string;
  currentUrl: string;
  /** Something has been uploaded (vs. running on the shipped default). */
  isCustom: boolean;
  aspect: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function handleFile(file: File | undefined) {
    if (!file) return;
    const formData = new FormData();
    formData.set("orgId", orgId);
    formData.set("key", artKey);
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadBrandingArt(formData);
      if (result.ok) toast.success(`${label} updated`);
      else toast.error(result.error ?? "Upload failed");
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function handleReset() {
    startTransition(async () => {
      const result = await resetBrandingArt({ orgId, key: artKey });
      if (result.ok) toast.success(`${label} back to the default`);
      else toast.error(result.error ?? "Could not reset");
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm text-muted-foreground">{blurb}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {ratioHint}{" "}
          <span className={isCustom ? "text-primary" : undefined}>
            {isCustom ? "Using your upload." : "Using the built-in default."}
          </span>
        </p>
      </div>

      {/* Sized to the real slot shape so the crop is visible before it ships. */}
      <div
        className="relative w-full max-w-xs overflow-hidden rounded-lg border border-border"
        style={{ aspectRatio: aspect }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served art / static file */}
        <img src={currentUrl} alt={`Current ${label.toLowerCase()}`} className="size-full object-cover" />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <div className="flex flex-wrap gap-2">
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
          {pending ? "Processing…" : isCustom ? "Replace image" : "Upload image"}
        </Button>
        {isCustom && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={handleReset}>
            <RotateCcw className="size-4" aria-hidden />
            Use the default
          </Button>
        )}
      </div>
    </div>
  );
}
