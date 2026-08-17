"use client";

import { useState, useTransition } from "react";
import { Check, Globe, Lock, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  deleteGalleryPhoto,
  reviewGalleryPhoto,
  setGalleryVisibility,
  updateGalleryCaption,
} from "@/actions/gallery";
import { GALLERY_CAPTION_MAX } from "@/lib/schemas/gallery";

export interface GalleryItem {
  id: string;
  src: string;
  caption: string;
  width: number;
  height: number;
  blurDataURL: string;
  status: "pending" | "approved";
  visibility: "portal" | "public";
  uploaderName: string;
  uploadedByMemberId: string;
  takenLabel: string;
}

/**
 * The club wall: a masonry of photos with whatever controls the viewer has
 * earned. Members get their own photos' delete and rename; officers get the
 * approve/reject and publish decisions on everyone's.
 *
 * Photos come through the gallery route already capped at 1600px webp and
 * served `immutable`, so a plain lazy <img> is the right element — next/image
 * would re-optimize bytes we sized ourselves. The blur placeholder sits behind
 * each one as a background so a slow tile fades in rather than popping.
 *
 * CSS columns rather than a grid: photos arrive at whatever aspect ratio the
 * game gave them, and columns let a portrait shot stay tall without punching a
 * hole in the row beside it.
 */
export function GalleryWall({
  orgId,
  items,
  canReview,
  viewerMemberId,
  emptyMessage,
}: {
  orgId: string;
  items: GalleryItem[];
  canReview: boolean;
  viewerMemberId: string | null;
  emptyMessage: string;
}) {
  const [open, setOpen] = useState<GalleryItem | null>(null);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (result.ok) toast.success(success);
      else toast.error(result.error ?? "Could not save that");
    });
  }

  if (items.length === 0) {
    return (
      <p className="glass-card rounded-xl p-6 text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <>
      <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4">
        {items.map((item) => {
          const mine = Boolean(viewerMemberId && viewerMemberId === item.uploadedByMemberId);
          return (
            <figure
              key={item.id}
              className="glass-card break-inside-avoid overflow-hidden rounded-xl"
            >
              <button
                type="button"
                onClick={() => setOpen(item)}
                className="block w-full cursor-zoom-in bg-cover bg-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ backgroundImage: `url(${item.blurDataURL})` }}
                aria-label={`View ${item.caption || "photo"} full size`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- gallery route, pre-sized + immutable */}
                <img
                  src={item.src}
                  alt={item.caption || `Photo by ${item.uploaderName}`}
                  width={item.width}
                  height={item.height}
                  loading="lazy"
                  className="h-auto w-full"
                />
              </button>

              <figcaption className="space-y-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.caption || <span className="text-muted-foreground">Untitled</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    &ldquo;{item.uploaderName}&rdquo; · {item.takenLabel}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {item.status === "pending" && (
                    <Badge variant="secondary">Awaiting review</Badge>
                  )}
                  {item.status === "approved" && (
                    <Badge variant={item.visibility === "public" ? "default" : "outline"}>
                      {item.visibility === "public" ? (
                        <>
                          <Globe className="size-3" aria-hidden /> Public
                        </>
                      ) : (
                        <>
                          <Lock className="size-3" aria-hidden /> Club only
                        </>
                      )}
                    </Badge>
                  )}
                </div>

                {(canReview || mine) && (
                  <div className="flex flex-wrap gap-1.5">
                    {canReview && item.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () =>
                                reviewGalleryPhoto({
                                  orgId,
                                  photoId: item.id,
                                  approve: true,
                                }),
                              "Photo is on the wall",
                            )
                          }
                        >
                          <Check className="size-4" aria-hidden />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={pending}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Reject and delete this photo? "${item.uploaderName}" will need to post another.`,
                              )
                            )
                              return;
                            run(
                              () =>
                                reviewGalleryPhoto({
                                  orgId,
                                  photoId: item.id,
                                  approve: false,
                                }),
                              "Photo rejected",
                            );
                          }}
                        >
                          <X className="size-4" aria-hidden />
                          Reject
                        </Button>
                      </>
                    )}

                    {canReview && item.status === "approved" && (
                      <Button
                        size="sm"
                        variant={item.visibility === "public" ? "outline" : "secondary"}
                        disabled={pending}
                        onClick={() =>
                          run(
                            () =>
                              setGalleryVisibility({
                                orgId,
                                photoId: item.id,
                                visibility:
                                  item.visibility === "public" ? "portal" : "public",
                              }),
                            item.visibility === "public"
                              ? "Pulled from the public site"
                              : "Published to the public site",
                          )
                        }
                      >
                        {item.visibility === "public" ? (
                          <>
                            <Lock className="size-4" aria-hidden />
                            Make club only
                          </>
                        ) : (
                          <>
                            <Globe className="size-4" aria-hidden />
                            Publish
                          </>
                        )}
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setOpen(item)}
                    >
                      <Pencil className="size-4" aria-hidden />
                      Caption
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm("Delete this photo for good?")) return;
                        run(
                          () => deleteGalleryPhoto({ orgId, photoId: item.id }),
                          "Photo deleted",
                        );
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                )}
              </figcaption>
            </figure>
          );
        })}
      </div>

      <PhotoDialog
        orgId={orgId}
        item={open}
        canEdit={
          open ? canReview || viewerMemberId === open.uploadedByMemberId : false
        }
        onClose={() => setOpen(null)}
      />
    </>
  );
}

/** Full-size view, and where a caption is actually written. */
function PhotoDialog({
  orgId,
  item,
  canEdit,
  onClose,
}: {
  orgId: string;
  item: GalleryItem | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();

  // Keyed by photo id, so opening a different photo resets the draft without an
  // effect syncing state to props.
  const [lastId, setLastId] = useState<string | null>(null);
  if (item && item.id !== lastId) {
    setLastId(item.id);
    setDraft(item.caption);
  }

  function save() {
    if (!item) return;
    startTransition(async () => {
      const result = await updateGalleryCaption({
        orgId,
        photoId: item.id,
        caption: draft,
      });
      if (result.ok) {
        toast.success("Caption saved");
        onClose();
      } else {
        toast.error(result.error ?? "Could not save that");
      }
    });
  }

  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{item?.caption || "Untitled"}</DialogTitle>
        </DialogHeader>
        {item && (
          <div className="space-y-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- gallery route */}
            <img
              src={item.src}
              alt={item.caption || `Photo by ${item.uploaderName}`}
              className="max-h-[65vh] w-full rounded-lg object-contain"
            />
            <p className="text-sm text-muted-foreground">
              Posted by &ldquo;{item.uploaderName}&rdquo; · {item.takenLabel}
            </p>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Input
                  value={draft}
                  maxLength={GALLERY_CAPTION_MAX}
                  placeholder="Add a caption"
                  className="min-w-48 flex-1"
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={pending}
                />
                <Button onClick={save} disabled={pending || draft === item.caption}>
                  Save caption
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
