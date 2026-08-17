import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "__session";

/**
 * Next 16 proxy (formerly middleware). Keep it light: cookie PRESENCE check
 * only — real verification (verifySessionCookie + org membership) happens in
 * the portal layout with the Admin SDK. M9 adds hostname→orgSlug rewriting.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /{orgSlug}/portal/** requires a session cookie; bounce to the gateway.
  const portalMatch = pathname.match(/^\/([^/]+)\/portal(?:\/|$)/);
  if (portalMatch && !req.cookies.get(SESSION_COOKIE_NAME)) {
    const url = req.nextUrl.clone();
    url.pathname = `/${portalMatch[1]}/volunteer-resources`;
    url.searchParams.set("signin", "1");
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
