"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ImageUp, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resetBrandingArt, uploadBrandingArt } from "@/actions/branding-art";
import type { BrandingArtSpec, BrandingArtKey } from "@/lib/branding-art";

/** Matches the action's own list, so a rejection happens before the upload. */
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"];
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * One swappable image: what the site is drawing now, what it should be, and
 * the two buttons that change it.
 *
 * The card previews the LOCAL file first and only uploads when confirmed. The
 * previous version uploaded on pick, which meant the first time an admin saw a
 * bad crop was after it was already on the club's public home page. A pending
 * preview is the cheapest possible undo.
 */
export function AssetCard({
  orgId,
  artKey,
  spec,
  currentUrl,
  isCustom,
}: {
  orgId: string;
  artKey: BrandingArtKey;
  spec: BrandingArtSpec;
  /** The URL the site is actually using right now. */
  currentUrl: string;
  /** Running on an upload rather than on the shipped default. */
  isCustom: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [staged, setStaged] = useState<{ file: File; url: string } | null>(null);

  // Object URLs are a manual allocation; without this every rejected pick
  // leaks a blob for the lifetime of the page.
  useEffect(() => () => { if (staged) URL.revokeObjectURL(staged.url); }, [staged]);

  function clearStaged() {
    if (staged) URL.revokeObjectURL(staged.url);
    setStaged(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handlePick(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Use a PNG, JPG, WEBP or AVIF image");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image too large (max 12MB)");
      return;
    }
    if (staged) URL.revokeObjectURL(staged.url);
    setStaged({ file, url: URL.createObjectURL(file) });
  }

  function handleSave() {
    if (!staged) return;
    const formData = new FormData();
    formData.set("orgId", orgId);
    formData.set("key", artKey);
    formData.set("file", staged.file);
    startTransition(async () => {
      const result = await uploadBrandingArt(formData);
      if (result.ok) {
        toast.success(`${spec.label} updated`);
        clearStaged();
      } else {
        toast.error(result.error ?? "Upload failed");
      }
    });
  }

  function handleReset() {
    startTransition(async () => {
      const result = await resetBrandingArt({ orgId, key: artKey });
      if (result.ok) toast.success(`${spec.label} back to the default`);
      else toast.error(result.error ?? "Could not reset");
    });
  }

  const previewUrl = staged?.url ?? currentUrl;

  return (
    <div className="glass-card flex flex-col gap-3 rounded-xl p-4">
      <div>
        <h3 className="text-sm font-semibold text-card-foreground">{spec.label}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{spec.blurb}</p>
      </div>

      {/* Sized to the real slot shape so the crop is visible before it ships.
          Checkerboard behind it: a `contain` slot keeps its transparency, and
          an admin needs to see whether the cut-out survived. */}
      <div
        className="relative w-full overflow-hidden rounded-lg border border-border"
        style={{
          aspectRatio: `${spec.width} / ${spec.height}`,
          backgroundImage:
            "linear-gradient(45deg,#8882 25%,transparent 25%,transparent 75%,#8882 75%),linear-gradient(45deg,#8882 25%,transparent 25%,transparent 75%,#8882 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 8px 8px",
        }}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- served art, static file, or a local object URL
          <img
            src={previewUrl}
            alt={`${spec.label} preview`}
            className="size-full"
            style={{ objectFit: spec.fit === "cover" ? "cover" : "contain" }}
          />
        ) : (
          // A slot whose shipped default is "nothing" (the chain-of-command
          // plate for a club without one). The site draws its art-free
          // fallback, and this card is where an upload changes that.
          <div className="grid size-full place-items-center bg-background/60 px-4 text-center text-xs text-muted-foreground">
            No image. The site uses its art-free layout until one is uploaded.
          </div>
        )}
        {staged && (
          <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-primary-foreground">
            Not saved
          </span>
        )}
      </div>

      <dl className="space-y-1 text-[0.7rem] text-muted-foreground">
        <div className="flex gap-1.5">
          <dt className="shrink-0 font-medium">Recommended</dt>
          <dd>
            {spec.width} × {spec.height}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="shrink-0 font-medium">Source</dt>
          <dd className="min-w-0 break-all font-mono">
            {staged ? staged.file.name : displayPath(currentUrl) || "none"}
          </dd>
        </div>
        <p className="pt-0.5 leading-snug">{spec.ratioHint}</p>
        <p className={isCustom ? "text-primary" : undefined}>
          {isCustom
            ? "Using your upload."
            : currentUrl
              ? "Using the built-in default."
              : "Nothing set yet."}
        </p>
      </dl>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => handlePick(e.target.files?.[0])}
      />

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {staged ? (
          <>
            <Button size="sm" disabled={pending} onClick={handleSave}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ImageUp className="size-4" aria-hidden />
              )}
              {pending ? "Processing…" : "Save image"}
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={clearStaged}>
              <X className="size-4" aria-hidden />
              Discard
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
            >
              <ImageUp className="size-4" aria-hidden />
              {isCustom ? "Replace" : "Upload"}
            </Button>
            {isCustom && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={handleReset}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <RotateCcw className="size-4" aria-hidden />
                )}
                Reset to default
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Uploaded art is served from a long API path with a cache-busting `?v=`.
 * Showing the whole thing tells an admin nothing; the shipped defaults are
 * real file paths and worth showing in full.
 */
function displayPath(url: string): string {
  return url.startsWith("/api/") ? url.split("?")[0] : url;
}
