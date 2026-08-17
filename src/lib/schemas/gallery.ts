import { z } from "zod";

/** Captions ride on the metadata doc and under every photo on the wall. */
export const GALLERY_CAPTION_MAX = 120;

const target = {
  orgId: z.string().min(1),
  photoId: z.string().min(1),
};

export const reviewGalleryPhotoSchema = z.object({
  ...target,
  approve: z.boolean(),
});

export const setGalleryVisibilitySchema = z.object({
  ...target,
  visibility: z.enum(["portal", "public"]),
});

export const updateGalleryCaptionSchema = z.object({
  ...target,
  caption: z.string().trim().max(GALLERY_CAPTION_MAX),
});

export const deleteGalleryPhotoSchema = z.object(target);
