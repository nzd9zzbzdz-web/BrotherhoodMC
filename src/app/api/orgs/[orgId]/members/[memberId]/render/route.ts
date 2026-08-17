import { NextResponse, type NextRequest } from "next/server";
import { AuthError, requireOrgRole } from "@/lib/auth/session";
import { getCharacterRender, getMember, listRanks } from "@/lib/queries";
import { isPubliclyVisible } from "@/lib/public-roster";

/**
 * Serves a member's uploaded character render as a real image response.
 *
 * Renders live in Firestore as data URLs (no Storage bucket — see
 * `src/actions/character.ts`), which is fine for one character screen but
 * would put megabytes of base64 into the HTML of a roster showing everyone.
 * Streaming them here keeps the page small and lets the browser cache.
 *
 * Members see everyone. Anonymous callers see only the members the club puts
 * on its public site — one gate (`isPubliclyVisible`) shared with the page
 * that renders them, so a face can never leak past the roster it belongs to.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; memberId: string }> },
) {
  const { orgId, memberId } = await ctx.params;

  let isPublicRequest = false;
  try {
    await requireOrgRole(orgId, "member");
  } catch (e) {
    const member = await getMember(orgId, memberId);
    const rank = member
      ? (await listRanks(orgId)).find((r) => r.id === member.rankId)
      : undefined;
    if (!member || !isPubliclyVisible(member, rank)) {
      const code = e instanceof AuthError ? e.code : "forbidden";
      return NextResponse.json(
        { error: code },
        { status: code === "unauthenticated" ? 401 : 403 },
      );
    }
    isPublicRequest = true;
  }

  const render = await getCharacterRender(orgId, memberId);
  if (!render) return new NextResponse(null, { status: 404 });

  // A render awaiting an officer's approval is portal-only. Hiding it on the
  // public CARD but still serving the bytes here would make the whole review
  // step decorative — anyone who guessed this URL would have the image.
  if (isPublicRequest && !render.approved) {
    return new NextResponse(null, { status: 404 });
  }

  const match = /^data:(image\/[a-z+]+);base64,([\s\S]*)$/.exec(render.dataUrl);
  if (!match) return new NextResponse(null, { status: 404 });
  const [, contentType, base64] = match;

  // Re-uploads bump updatedAt, so the tag changes exactly when the art does.
  const etag = `W/"${memberId}-${render.updatedAtMs}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  const body = new Uint8Array(Buffer.from(base64, "base64"));
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      ETag: etag,
      // A public roster face is the same bytes for everyone, so let shared
      // caches hold it. Members-only art never leaves a private cache.
      "Cache-Control": isPublicRequest
        ? "public, max-age=300, must-revalidate"
        : "private, max-age=300, must-revalidate",
    },
  });
}
