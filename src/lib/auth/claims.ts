import "server-only";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { SessionClaims, UserDoc } from "@/lib/types";

/**
 * Rebuild a user's custom claims from their users/{uid} doc and revoke their
 * refresh tokens so stale elevated sessions die (portal layout verifies with
 * checkRevoked: true). Call from EVERY membership-mutating server action.
 */
export async function syncUserClaims(uid: string): Promise<void> {
  const snap = await adminDb.collection("users").doc(uid).get();
  const user = snap.data() as UserDoc | undefined;

  const claims: SessionClaims = {};
  if (user?.superAdmin) claims.superAdmin = true;
  if (user?.memberships && Object.keys(user.memberships).length > 0) {
    claims.orgs = {};
    for (const [orgId, m] of Object.entries(user.memberships)) {
      claims.orgs[orgId] = { r: m.role, m: m.memberId };
    }
  }

  await adminAuth.setCustomUserClaims(uid, claims as object);
  await adminAuth.revokeRefreshTokens(uid);
}
