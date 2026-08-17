"use client";

import { useRef, useState, useTransition } from "react";
import { CheckCircle2, FolderUp, Loader2, TriangleAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { uploadPatchArt } from "@/actions/patch-art";
import { matchFiles, type MatchReport, type PatchTarget } from "@/lib/patch-art-match";

/**
 * Drop a folder of artwork and have it land on the right patches.
 *
 * Sixty-two patches means sixty-two trips through the single-file control, so
 * this exists to do it in one gesture. It previews before it writes: which file
 * hits which patch, what would be replaced, and what didn't match at all — a
 * typo'd filename should be visible up front, not discovered as a missing image
 * on the wall later.
 *
 * One request per file rather than one big batch: server actions cap the
 * request body, and 62 images in a single post would exceed it. A small number
 * run at a time so a folder drop doesn't open 62 connections at once.
 */

const CONCURRENCY = 4;

export function BulkPatchArtUpload({
  orgId,
  patches,
}: {
  orgId: string;
  patches: (PatchTarget & { hasArt: boolean })[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<MatchReport | null>(null);
  const [done, setDone] = useState<{ ok: number; failed: string[] } | null>(null);
  const [progress, setProgress] = useState(0);
  const [pending, startTransition] = useTransition();

  const artById = new Set(patches.filter((p) => p.hasArt).map((p) => p.id));

  function handlePicked(picked: FileList | null) {
    if (!picked?.length) return;
    const images = Array.from(picked).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) {
      toast.error("No images in that selection");
      return;
    }
    setFiles(images);
    setReport(
      matchFiles(
        images.map((f) => f.name),
        patches,
        (id) => artById.has(id),
      ),
    );
    setDone(null);
    setProgress(0);
    setOpen(true);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleUpload() {
    if (!report) return;
    const byName = new Map(files.map((f) => [f.name, f]));
    const queue = [...report.matched];

    startTransition(async () => {
      let ok = 0;
      const failed: string[] = [];

      async function worker() {
        for (;;) {
          const item = queue.shift();
          if (!item) return;
          const file = byName.get(item.fileName);
          if (!file) continue;
          const formData = new FormData();
          formData.set("orgId", orgId);
          formData.set("patchId", item.patchId);
          formData.set("file", file);
          const result = await uploadPatchArt(formData);
          if (result.ok) ok += 1;
          else failed.push(`${item.fileName}: ${result.error ?? "failed"}`);
          setProgress((n) => n + 1);
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, report.matched.length) }, worker),
      );

      setDone({ ok, failed });
      if (failed.length === 0) toast.success(`Uploaded artwork for ${ok} patch(es)`);
      else toast.warning(`${ok} uploaded, ${failed.length} failed`);
    });
  }

  const total = report?.matched.length ?? 0;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handlePicked(e.target.files)}
      />
      <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
        <FolderUp className="size-4" aria-hidden />
        Bulk upload art
      </Button>

      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {done ? "Upload complete" : `Upload artwork for ${total} patch(es)?`}
            </DialogTitle>
            <DialogDescription>
              {done
                ? `${done.ok} uploaded${done.failed.length ? `, ${done.failed.length} failed` : ""}.`
                : "Files are matched to patches by name. Check the list before uploading; anything unmatched is skipped."}
            </DialogDescription>
          </DialogHeader>

          {done ? (
            done.failed.length > 0 && (
              <ul className="space-y-1 rounded-md border border-destructive/40 p-3 text-sm">
                {done.failed.map((f) => (
                  <li key={f} className="text-muted-foreground">
                    {f}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="space-y-4">
              {report && report.matched.length > 0 && (
                <section>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <CheckCircle2 className="size-4 text-primary" aria-hidden />
                    Matched ({report.matched.length})
                  </h3>
                  <ul className="mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
                    {report.matched.map((m) => (
                      <li
                        key={m.fileName}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5 text-sm"
                      >
                        <span className="font-stat text-xs text-muted-foreground">
                          {m.fileName}
                        </span>
                        <span className="text-foreground">
                          {m.patchName}
                          {m.replaces && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              replaces existing
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {report && report.unmatched.length > 0 && (
                <section>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <XCircle className="size-4 text-destructive" aria-hidden />
                    No matching patch ({report.unmatched.length})
                  </h3>
                  <ul className="mt-2 max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border">
                    {report.unmatched.map((u) => (
                      <li
                        key={u.fileName}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5 text-sm"
                      >
                        <span className="font-stat text-xs">{u.fileName}</span>
                        <span className="font-stat text-xs text-muted-foreground">
                          read as &ldquo;{u.tried}&rdquo;
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {report && report.duplicates.length > 0 && (
                <section>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <TriangleAlert className="size-4 text-primary" aria-hidden />
                    Duplicate ({report.duplicates.length})
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Another file already claimed the same patch; these are skipped.
                  </p>
                </section>
              )}
            </div>
          )}

          {pending && (
            <div>
              <div
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={total}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${total ? (progress / total) * 100 : 0}%` }}
                />
              </div>
              <p className="font-stat mt-2 text-xs text-muted-foreground">
                {progress} / {total} uploaded
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            {done ? (
              <Button onClick={() => setOpen(false)}>Close</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button onClick={handleUpload} disabled={pending || total === 0}>
                  {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  Upload {total}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
