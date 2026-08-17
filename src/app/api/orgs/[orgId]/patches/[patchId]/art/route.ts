import { NextResponse, type NextRequest } from "next/server";
import { AuthError, requireOrgRole } from "@/lib/auth/session";
import { getPatchArt } from "@/lib/queries";

/**
 * Serves a patch or emblem's artwork as a real image response.
 *
 * Same reasoning as the character render route, and more urgent: a club runs
 * sixty-odd patches, and the Patch Wall, the Emblems tab and the admin table
 * each show most of them at once. Inlining the base64 would put megabytes into
 * the HTML of all three, blocking render on bytes the browser could otherwise
 * fetch in parallel and cache.
 *
 * The pages pass `?v=<updatedAt ms>`, so a re-upload changes the URL. That lets
 * this respond `immutable` — the browser never revalidates a patch image it has
 * already got, and new art still appears immediately because it arrives at a
 * new address.
 *
 * Members only. Unlike a public roster face, patch art has no anonymous view.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; patchId: string }> },
) {
  const { orgId, patchId } = await ctx.params;

  try {
    await requireOrgRole(orgId, "member");
  } catch (e) {
    const code = e instanceof AuthError ? e.code : "forbidden";
    return NextResponse.json(
      { error: code },
      { status: code === "unauthenticated" ? 401 : 403 },
    );
  }

  const art = await getPatchArt(orgId, patchId);
  if (!art) return new NextResponse(null, { status: 404 });

  const match = /^data:(image\/[a-z+]+);base64,([\s\S]*)$/.exec(art.dataUrl);
  if (!match) return new NextResponse(null, { status: 404 });
  const [, contentType, base64] = match;

  const etag = `W/"${patchId}-${art.updatedAtMs}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  const body = new Uint8Array(Buffer.from(base64, "base64"));
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      ETag: etag,
      // Private: same bytes for everyone in the org, but a shared cache must
      // not hand them to someone outside it. Versioned URL makes it immutable.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
