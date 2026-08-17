import "server-only";
import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp, adminDb, orgRef } from "@/lib/firebase/admin";
import type { DiscordLinkCode, UserDoc } from "@/lib/types";

/**
 * Discord ↔ portal account linking, proven on both sides: the website mints a
 * short-lived code for the SIGNED-IN account (session cookie is the proof),
 * and the member redeems it with /link in Discord, whose Ed25519-signed
 * payload is Discord's own word on which account invoked. The link lives on
 * users/{uid} like roles do, so one link serves every org the account belongs
 * to and later officer checks get the role and the identity in one read.
 *
 * Transport-neutral like activities-core: the Server Action and the Discord
 * handler both call in here.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
/** No I, L, O, 0 or 1: codes get read off a screen and retyped in Discord. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

/** "abcd-efgh" → "ABCDEFGH": accept whatever the member retyped. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "ABCDEFGH" → "ABCD-EFGH" for display. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

const codesRef = () => adminDb.collection("discordLinkCodes");
const usersRef = () => adminDb.collection("users");

/** Mint a fresh code for an account, replacing any it already had waiting. */
export async function createLinkCode(
  uid: string,
  orgId: string,
): Promise<{ code: string; expiresAtMs: number }> {
  const stale = await codesRef().where("uid", "==", uid).get();
  const code = generateCode();
  const expiresAt = Timestamp.fromMillis(Date.now() + CODE_TTL_MS);
  const batch = adminDb.batch();
  stale.docs.forEach((d) => batch.delete(d.ref));
  batch.set(codesRef().doc(code), {
    uid,
    orgId,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { code, expiresAtMs: expiresAt.toMillis() };
}

export type ConsumeResult =
  | { ok: true; uid: string; orgId: string }
  | { ok: false; reason: "invalid" | "taken" };

/**
 * Redeem a code from Discord. One transaction with the code doc as the lock,
 * so two racing redemptions cannot both land; expired codes are deleted on
 * sight. "invalid" deliberately covers unknown AND expired: the reply must
 * not confirm to a guesser that a code exists.
 */
export async function consumeLinkCode(
  rawCode: string,
  discord: { id: string; username?: string },
): Promise<ConsumeResult> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: "invalid" };
  const ref = codesRef().doc(code);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, reason: "invalid" as const };
    const data = snap.data() as DiscordLinkCode;
    const expiresAt = data.expiresAt as Timestamp;
    if (expiresAt.toMillis() < Date.now()) {
      tx.delete(ref);
      return { ok: false as const, reason: "invalid" as const };
    }

    // One Discord account, one portal account. A second portal account
    // claiming the same Discord id is refused, never silently moved: /unlink
    // from the Discord side is the deliberate way to switch.
    const holder = await tx.get(
      usersRef().where("discordId", "==", discord.id).limit(1),
    );
    if (!holder.empty && holder.docs[0].id !== data.uid) {
      return { ok: false as const, reason: "taken" as const };
    }

    tx.set(
      usersRef().doc(data.uid),
      {
        discordId: discord.id,
        ...(discord.username ? { discordUsername: discord.username } : {}),
      },
      { merge: true },
    );
    tx.delete(ref);
    tx.set(orgRef(data.orgId).collection("auditLogs").doc(), {
      actorUid: data.uid,
      action: "discord.link",
      targetPath: `users/${data.uid}`,
      detail: `Discord ${discord.username ?? discord.id}`,
      at: FieldValue.serverTimestamp(),
    });
    return { ok: true as const, uid: data.uid, orgId: data.orgId };
  });
}

/** The account a Discord user is linked to, or null. */
export async function findUserByDiscordId(
  discordId: string,
): Promise<({ uid: string } & UserDoc) | null> {
  const snap = await usersRef().where("discordId", "==", discordId).limit(1).get();
  if (snap.empty) return null;
  return { uid: snap.docs[0].id, ...(snap.docs[0].data() as UserDoc) };
}

/**
 * Turn Discord user ids (picked from a member picker) into the member ids
 * this club records as witnesses. Anyone unlinked, or linked but not riding
 * with this club, simply drops out: `Activity.witnesses` holds member ids, and
 * inventing one for a stranger would put a name on a ticket that the roster
 * cannot resolve. Callers report the shortfall rather than failing.
 */
export async function resolveWitnesses(
  orgId: string,
  discordIds: string[],
): Promise<string[]> {
  const ids = [...new Set(discordIds)].slice(0, 30); // Firestore `in` ceiling
  if (ids.length === 0) return [];
  const snap = await usersRef().where("discordId", "in", ids).get();
  const memberIds: string[] = [];
  for (const doc of snap.docs) {
    const membership = (doc.data() as UserDoc).memberships?.[orgId];
    if (membership?.memberId) memberIds.push(membership.memberId);
  }
  return memberIds;
}

/** Sever the link from the Discord side. True if there was one to sever. */
export async function unlinkDiscordId(discordId: string): Promise<boolean> {
  const user = await findUserByDiscordId(discordId);
  if (!user) return false;
  await usersRef().doc(user.uid).update({
    discordId: FieldValue.delete(),
    discordUsername: FieldValue.delete(),
  });
  return true;
}

/** Sever the link from the website side (the account's own action). */
export async function unlinkUid(uid: string, auditOrgId?: string): Promise<void> {
  const batch = adminDb.batch();
  batch.update(usersRef().doc(uid), {
    discordId: FieldValue.delete(),
    discordUsername: FieldValue.delete(),
  });
  if (auditOrgId) {
    batch.set(orgRef(auditOrgId).collection("auditLogs").doc(), {
      actorUid: uid,
      action: "discord.unlink",
      targetPath: `users/${uid}`,
      at: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

/** Link status for the dashboard card. Per-request read, never cached. */
export async function getDiscordLink(
  uid: string,
): Promise<{ discordId: string; username: string | null } | null> {
  const snap = await usersRef().doc(uid).get();
  const data = snap.data() as UserDoc | undefined;
  if (!data?.discordId) return null;
  return { discordId: data.discordId, username: data.discordUsername ?? null };
}
