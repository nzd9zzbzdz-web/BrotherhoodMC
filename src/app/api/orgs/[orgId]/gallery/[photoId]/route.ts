import { NextResponse, type NextRequest } from "next/server";
import { AuthError, requireOrgRole } from "@/lib/auth/session";
import { getGalleryArt, getGalleryPhoto } from "@/lib/queries";

/**
 * Serves a gallery photo as a real image response.
 *
 * Same reasoning as the character-render and patch-art routes: photos live in
 * Firestore as webp data URLs (no Storage bucket), and inlining the base64
 * would put megabytes into the HTML of the very pages that show the most of
 * them — the club wall and the public gallery.
 *
 * Three audiences, one gate:
 *   · anonymous  — approved AND public only (the foundation shopfront)
 *   · member     — everything approved, plus their own photo while it waits
 *   · officer    — everything, because they're the ones judging the queue
 *
 * A pending photo answering 404 for other members is the whole point of the
 * queue: hiding it on the WALL while still serving the bytes to anyone who
 * guessed the URL would make review decorative.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; photoId: string }> },
) {
  const { orgId, photoId } = await ctx.params;

  const photo = await getGalleryPhoto(orgId, photoId);
  if (!photo) return new NextResponse(null, { status: 404 });

  const isPublished = photo.status === "approved" && photo.visibility === "public";

  let isPublicRequest = false;
  try {
    const access = await requireOrgRole(orgId, "member");
    const isOfficer = access.isSuper || access.role === "officer" || access.role === "admin";
    const isUploader = Boolean(
      access.memberId && access.memberId === photo.uploadedByMemberId,
    );
    if (photo.status !== "approved" && !isOfficer && !isUploader) {
      return new NextResponse(null, { status: 404 });
    }
  } catch (e) {
    if (!isPublished) {
      const code = e instanceof AuthError ? e.code : "forbidden";
      return NextResponse.json(
        { error: code },
        { status: code === "unauthenticated" ? 401 : 403 },
      );
    }
    isPublicRequest = true;
  }

  const art = await getGalleryArt(orgId, photoId);
  if (!art) return new NextResponse(null, { status: 404 });

  const match = /^data:(image\/[a-z+]+);base64,([\s\S]*)$/.exec(art.dataUrl);
  if (!match) return new NextResponse(null, { status: 404 });
  const [, contentType, base64] = match;

  const etag = `W/"${photoId}-${art.updatedAtMs}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  const body = new Uint8Array(Buffer.from(base64, "base64"));
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      ETag: etag,
      // Callers pass `?v=<updatedAt ms>`, so the bytes at a given URL never
      // change and a re-upload lands at a new address. A published photo is
      // the same for everyone, so shared caches may hold it; anything still
      // inside the club stays in a private cache.
      "Cache-Control": isPublicRequest
        ? "public, max-age=31536000, immutable"
        : "private, max-age=31536000, immutable",
    },
  });
}
