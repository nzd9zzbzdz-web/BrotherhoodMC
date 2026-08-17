import { NextResponse, type NextRequest } from "next/server";
import { getBrandingArt } from "@/lib/queries";
import { BRANDING_ART, type BrandingArtKey } from "@/lib/branding-art";

/**
 * Serves uploaded branding scene art (roster backdrop, character stage).
 *
 * Deliberately ANONYMOUS, unlike the patch-art route: the roster backdrop is
 * painted behind the cards on the club's public home page, so gating it would
 * break the very surface it exists for. This is org decoration — a wall and a
 * spotlight — not member data; nothing here is behind the login anyway.
 *
 * The `?v=` the branding doc carries is the upload time, so a re-upload lands
 * at a new URL and this can answer `immutable`.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; key: string }> },
) {
  const { orgId, key } = await ctx.params;

  // Only the known slots — this is a public route, so it must never become a
  // way to enumerate arbitrary documents by id.
  if (!(key in BRANDING_ART)) return new NextResponse(null, { status: 404 });

  const art = await getBrandingArt(orgId, key as BrandingArtKey);
  if (!art) return new NextResponse(null, { status: 404 });

  const match = /^data:(image\/[a-z+]+);base64,([\s\S]*)$/.exec(art.dataUrl);
  if (!match) return new NextResponse(null, { status: 404 });
  const [, contentType, base64] = match;

  const etag = `W/"${key}-${art.updatedAtMs}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  const body = new Uint8Array(Buffer.from(base64, "base64"));
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      ETag: etag,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
