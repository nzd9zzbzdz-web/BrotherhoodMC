import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME, SESSION_EXPIRES_MS } from "@/lib/constants";

/** POST { idToken } → mint a 5-day httpOnly session cookie. */
export async function POST(req: NextRequest) {
  let idToken: string | undefined;
  try {
    ({ idToken } = await req.json());
  } catch {
    // fallthrough
  }
  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json({ error: "missing idToken" }, { status: 400 });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    // Only mint for recently signed-in users (blocks replay of old tokens).
    if (Date.now() / 1000 - decoded.auth_time > 5 * 60) {
      return NextResponse.json({ error: "stale sign-in" }, { status: 401 });
    }
    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_EXPIRES_MS,
    });
    const res = NextResponse.json({
      ok: true,
      orgs: (decoded as Record<string, unknown>).orgs ?? {},
      superAdmin: (decoded as Record<string, unknown>).superAdmin === true,
    });
    res.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_EXPIRES_MS / 1000,
      path: "/",
    });
    return res;
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }
}

/** DELETE → clear cookie + revoke refresh tokens. */
export async function DELETE(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookie) {
    try {
      const decoded = await adminAuth.verifySessionCookie(cookie);
      await adminAuth.revokeRefreshTokens(decoded.uid);
    } catch {
      // already invalid — still clear it
    }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
