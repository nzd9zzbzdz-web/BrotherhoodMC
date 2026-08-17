"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { revalidateOrgTags } from "@/lib/cache";
import {
  FieldPath,
  FieldValue,
  Timestamp,
  adminAuth,
  adminDb,
  orgRef,
} from "@/lib/firebase/admin";
import { requireOrgRole, requireSelfOrRole } from "@/lib/auth/session";
import { syncUserClaims } from "@/lib/auth/claims";
import {
  createMemberSchema,
  deleteMemberSchema,
  inviteMemberSchema,
  officerNoteSchema,
  saveMemberBioSchema,
  updateMemberSchema,
  type CreateMemberInput,
  type DeleteMemberInput,
  type InviteMemberInput,
  type OfficerNoteInput,
  type SaveMemberBioInput,
  type UpdateMemberInput,
} from "@/lib/schemas/member";
import type { ActionResult } from "./activities";
import type { SystemRole } from "@/lib/types";

/** Org-admin: create a member record (unlinked until they accept an invite). */
export async function createMember(
  raw: CreateMemberInput,
): Promise<ActionResult<{ memberId: string }>> {
  const parsed = createMemberSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const input = parsed.data;

  try {
    const access = await requireOrgRole(input.orgId, "admin");
    const org = orgRef(input.orgId);

    const memberId = await adminDb.runTransaction(async (tx) => {
      const orgSnap = await tx.get(org);
      const orgData = orgSnap.data() ?? {};
      const memberCount = (orgData.memberCount ?? 0) as number;
      // Member numbers come from a monotonic counter, NOT the head-count, so
      // exiled/removed members never cause a number to be reused.
      const lastMemberNumber = (orgData.lastMemberNumber ?? memberCount) as number;
      const nextNumber = lastMemberNumber + 1;
      const ref = org.collection("members").doc();
      tx.set(ref, {
        uid: null,
        displayName: input.displayName,
        roadName: input.roadName,
        rankId: input.rankId,
        status: input.status,
        joinDate: Timestamp.fromDate(input.joinDate),
        ...(input.sponsorMemberId ? { sponsorMemberId: input.sponsorMemberId } : {}),
        memberNumber: nextNumber,
        stats: {},
        patchCount: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(org, {
        memberCount: FieldValue.increment(1),
        lastMemberNumber: nextNumber,
      });
      tx.set(org.collection("auditLogs").doc(), {
        actorUid: access.user.uid,
        action: "member.create",
        targetPath: ref.path,
        detail: `${input.roadName} (${input.displayName})`,
        at: FieldValue.serverTimestamp(),
      });
      return ref.id;
    });

    revalidateOrgTags(input.orgId, "members", "org");
    revalidatePath(`/[orgSlug]/portal/brotherhood`, "page");
    revalidatePath(`/[orgSlug]/portal/admin`, "page");
    return { ok: true, data: { memberId } };
  } catch (e) {
    return failure(e);
  }
}

/** Org-admin: update member fields (rank change, status change, ...). */
export async function updateMember(raw: UpdateMemberInput): Promise<ActionResult> {
  const parsed = updateMemberSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, memberId, ...fields } = parsed.data;

  try {
    const access = await requireOrgRole(orgId, "admin");
    const ref = orgRef(orgId).collection("members").doc(memberId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: "Member not found" };
    const current = snap.data();

    const update: Record<string, unknown> = {};
    if (fields.displayName) update.displayName = fields.displayName;
    if (fields.roadName) update.roadName = fields.roadName;
    if (fields.rankId) update.rankId = fields.rankId;
    if (fields.status) update.status = fields.status;
    if (fields.joinDate) update.joinDate = Timestamp.fromDate(fields.joinDate);
    if (fields.sponsorMemberId !== undefined) update.sponsorMemberId = fields.sponsorMemberId;
    // Trimmed-empty clears it, so an admin can take a bio back off the public
    // site without having to delete and recreate the member.
    if (fields.bio !== undefined) update.bio = fields.bio.trim();
    // Same clearing rule: emptying the box hands the card back to the computed
    // tenure label rather than leaving it blank.
    if (fields.publicLabel !== undefined) {
      update.publicLabel = fields.publicLabel.trim();
    }

    // ── Portal role ────────────────────────────────────────────────────
    // Roles live on users/{uid}, not the member doc, because one account can
    // belong to several orgs. Resolve the change before touching anything so a
    // rejected promotion doesn't half-apply alongside the member fields.
    const linkedUidForRole = current?.uid as string | null | undefined;
    let roleChange: { uid: string; from: SystemRole; to: SystemRole } | null = null;

    if (fields.role) {
      if (!linkedUidForRole) {
        return {
          ok: false,
          error: "This member has no portal account yet. Invite them to set a role",
        };
      }
      // Exiling/retiring deletes the membership outright. Granting a role in
      // the same save would delete it and immediately put it back.
      if (fields.status === "exiled" || fields.status === "retired") {
        return {
          ok: false,
          error: "Can't set a portal role while retiring or exiling. Access is removed",
        };
      }
      const userSnap = await adminDb.collection("users").doc(linkedUidForRole).get();
      const from = (userSnap.data()?.memberships?.[orgId]?.role ?? "member") as SystemRole;

      if (from !== fields.role) {
        // Changing your own role would rewrite your claims mid-request and
        // could drop you out of the admin area you're standing in.
        if (access.memberId === memberId) {
          return { ok: false, error: "You cannot change your own portal role" };
        }
        // Never leave the org without an admin.
        if (from === "admin") {
          const admins = await adminDb
            .collection("users")
            .where(new FieldPath("memberships", orgId, "role"), "==", "admin")
            .select()
            .get();
          if (admins.size <= 1) {
            return { ok: false, error: "This is the last admin. Promote someone first" };
          }
        }
        roleChange = { uid: linkedUidForRole, from, to: fields.role };
      }
    }

    if (!Object.keys(update).length && !roleChange) {
      return { ok: false, error: "Nothing to update" };
    }

    // De-provisioning: exile/retire strips portal access. Firestore and Auth
    // can't share a single transaction, so revoke access FIRST — if it throws
    // we bail before flipping status, leaving the member consistent. If the
    // status write later fails, access is already gone, which is the safe
    // failure direction: a stale status can be re-applied on retry, but a
    // member marked exiled with a live session cannot be allowed to happen.
    const linkedUid = current?.uid as string | null | undefined;
    // Leaving the club is a fact about their standing; revoking portal access
    // is what we do about it. Keep them separate — a member who never had a
    // login still retires, and their service record has to say so.
    const isLeaving =
      (fields.status === "exiled" || fields.status === "retired") &&
      fields.status !== current?.status;
    const isDeprovision = !!linkedUid && isLeaving;

    if (isDeprovision) {
      await adminDb
        .collection("users")
        .doc(linkedUid!)
        .set(
          { memberships: { [orgId]: FieldValue.delete() } },
          { merge: true },
        );
      await syncUserClaims(linkedUid!);
    }

    if (roleChange) {
      await adminDb
        .collection("users")
        .doc(roleChange.uid)
        .set(
          { memberships: { [orgId]: { role: roleChange.to, memberId } } },
          { merge: true },
        );
      // Revokes refresh tokens too, so a demoted admin's live session dies
      // rather than keeping elevated claims until it expires.
      await syncUserClaims(roleChange.uid);
      await ref.collection("serviceRecord").add({
        kind: "promotion",
        title: `Portal role changed to ${roleChange.to}`,
        detail: `Was ${roleChange.from}.`,
        at: FieldValue.serverTimestamp(),
        byUid: access.user.uid,
      });
      await orgRef(orgId).collection("auditLogs").add({
        actorUid: access.user.uid,
        action: "member.role",
        targetPath: ref.path,
        detail: `${roleChange.from} → ${roleChange.to}`,
        at: FieldValue.serverTimestamp(),
      });
    }

    if (Object.keys(update).length) await ref.update(update);

    // Rank changes land in the service record.
    if (fields.rankId && fields.rankId !== current?.rankId) {
      const rankSnap = await orgRef(orgId).collection("ranks").doc(fields.rankId).get();
      await ref.collection("serviceRecord").add({
        kind: "promotion",
        title: `Rank changed to ${rankSnap.data()?.name ?? fields.rankId}`,
        detail: "",
        at: FieldValue.serverTimestamp(),
        byUid: access.user.uid,
      });
    }

    if (isLeaving) {
      await ref.collection("serviceRecord").add({
        kind: "removal",
        title: fields.status === "exiled" ? "Exiled from the club" : "Retired",
        detail: isDeprovision ? "Portal access revoked." : "",
        at: FieldValue.serverTimestamp(),
        byUid: access.user.uid,
      });
    }

    await orgRef(orgId).collection("auditLogs").add({
      actorUid: access.user.uid,
      action: "member.update",
      targetPath: ref.path,
      detail: Object.keys(update).join(", "),
      at: FieldValue.serverTimestamp(),
    });

    // A rank or role change moves the roster AND the portal-role join.
    revalidateOrgTags(orgId, "members", "roles");
    revalidatePath(`/[orgSlug]/portal/brotherhood`, "page");
    revalidatePath(`/[orgSlug]/portal/brotherhood/[memberId]`, "page");
    revalidatePath(`/[orgSlug]/portal/admin`, "page");
    // bio, publicLabel, status and rank all change what the PUBLIC roster
    // shows (or whether it lists this member at all). Without this an officer
    // edits a bio and the outside world keeps the old one until something
    // unrelated rebuilds the page.
    revalidatePath(`/[orgSlug]`, "page");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/**
 * Self-service bio: a member writing their own, or an admin writing anyone's.
 *
 * This is the one field a member can put in front of the outside world — the
 * same `bio` the public roster reads — so two things matter. The editor says so
 * out loud (see MemberBio), and every self-edit is tagged `.self` in the audit
 * log, which is how an officer notices something that needs taking down.
 *
 * Deliberately its own action rather than opening `updateMember` to members:
 * that one also moves rank, status and portal role, and the safest way to keep
 * a member away from those fields is to never hand them the door.
 */
export async function saveMemberBio(raw: SaveMemberBioInput): Promise<ActionResult> {
  const parsed = saveMemberBioSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, memberId, bio } = parsed.data;

  try {
    const { access, isSelf } = await requireSelfOrRole(orgId, memberId, "admin");
    const ref = orgRef(orgId).collection("members").doc(memberId);
    if (!(await ref.get()).exists) {
      return { ok: false, error: "Member not found" };
    }

    // Trimmed-empty clears it, matching the admin form — "save an empty box"
    // is how you take your blurb back off the public site.
    await ref.update({ bio: bio.trim() });

    await orgRef(orgId).collection("auditLogs").add({
      actorUid: access.user.uid,
      action: `member.bio${isSelf ? ".self" : ""}`,
      targetPath: ref.path,
      detail: bio.trim() ? `${bio.trim().length} chars` : "cleared",
      at: FieldValue.serverTimestamp(),
    });

    // The bio renders in two places and BOTH have to be revalidated: the
    // profile, and the PUBLIC roster on the org home page. Miss the second and
    // a member "removes" their blurb while the outside world still sees it.
    revalidateOrgTags(orgId, "members");
    revalidatePath(`/[orgSlug]/portal/brotherhood/[memberId]`, "page");
    revalidatePath(`/[orgSlug]`, "page");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/**
 * Org-admin: permanently remove a member and everything hanging off them.
 *
 * This is the hard delete. `updateMember` with status exiled/retired is the
 * reversible one — it revokes access and files them under Past Colors while
 * keeping their record. Use this only when the record shouldn't exist at all.
 *
 * Order matters: portal access is revoked BEFORE anything is deleted, for the
 * same reason de-provisioning does it in `updateMember` — if a later step
 * throws, a member with no data and no access is recoverable, but a member
 * whose data is gone while their session still works is not.
 *
 * The member number is NOT recycled: `lastMemberNumber` is a monotonic counter,
 * so a future member never inherits a deleted member's number.
 */
export async function deleteMember(raw: DeleteMemberInput): Promise<ActionResult> {
  const parsed = deleteMemberSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, memberId, confirmRoadName } = parsed.data;

  try {
    const access = await requireOrgRole(orgId, "admin");
    const org = orgRef(orgId);
    const memberRef = org.collection("members").doc(memberId);
    const snap = await memberRef.get();
    if (!snap.exists) return { ok: false, error: "Member not found" };
    const member = snap.data()!;

    // An admin removing their own record would strip their own claims and lock
    // them out mid-request. Make them do it from another admin account.
    if (access.memberId === memberId) {
      return { ok: false, error: "You cannot delete your own member record" };
    }

    // Typo guard: the dialog asks for the road name, and it has to match.
    if (
      confirmRoadName.trim().toLowerCase() !== String(member.roadName ?? "").toLowerCase()
    ) {
      return { ok: false, error: "Road name doesn't match" };
    }

    // Never leave an org with no way back in. FieldPath, not a dotted string —
    // an org slug like "silent-souls" isn't a valid unquoted field path.
    const linkedUid = member.uid as string | null | undefined;
    if (linkedUid) {
      const userSnap = await adminDb.collection("users").doc(linkedUid).get();
      const isAdmin =
        (userSnap.data()?.memberships?.[orgId]?.role as string | undefined) === "admin";
      if (isAdmin) {
        const admins = await adminDb
          .collection("users")
          .where(new FieldPath("memberships", orgId, "role"), "==", "admin")
          .select()
          .get();
        if (admins.size <= 1) {
          return { ok: false, error: "This is the last admin. Promote someone first" };
        }
      }
    }

    // 1. Revoke portal access first (see the note above on ordering).
    if (linkedUid) {
      await adminDb
        .collection("users")
        .doc(linkedUid)
        .set({ memberships: { [orgId]: FieldValue.delete() } }, { merge: true });
      await syncUserClaims(linkedUid);
    }

    // 2. Audit before the target disappears — auditLogs live at org level, so
    //    the entry outlives the member it describes.
    await org.collection("auditLogs").add({
      actorUid: access.user.uid,
      action: "member.delete",
      targetPath: memberRef.path,
      detail: `${member.roadName} (${member.displayName}) · No. ${member.memberNumber}`,
      at: FieldValue.serverTimestamp(),
    });

    // 3. Everything keyed to the member. Their own doc's subcollections
    //    (notes, serviceRecord, assets) go with recursiveDelete.
    for (const collection of ["awardedPatches", "activities"] as const) {
      const owned = await org
        .collection(collection)
        .where("memberId", "==", memberId)
        .get();
      await Promise.all(owned.docs.map((d) => d.ref.delete()));
    }
    await org.collection("cutLayouts").doc(memberId).delete();

    // 4. Don't leave dangling sponsor pointers on the people they brought in.
    const sponsored = await org
      .collection("members")
      .where("sponsorMemberId", "==", memberId)
      .get();
    await Promise.all(
      sponsored.docs.map((d) => d.ref.update({ sponsorMemberId: FieldValue.delete() })),
    );

    // 5. The member and their subcollections.
    await adminDb.recursiveDelete(memberRef);

    await org.update({ memberCount: FieldValue.increment(-1) });

    // A removal takes the member, their awards, their portal role, and a seat
    // off the org's memberCount — four cached reads.
    revalidateOrgTags(orgId, "members", "awards", "roles", "org");
    revalidatePath(`/[orgSlug]/portal/brotherhood`, "page");
    revalidatePath(`/[orgSlug]/portal/admin`, "page");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Officer+: add an officer-only note to a member. */
export async function addOfficerNote(raw: OfficerNoteInput): Promise<ActionResult> {
  const parsed = officerNoteSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, memberId, body } = parsed.data;

  try {
    const access = await requireOrgRole(orgId, "officer");
    await orgRef(orgId)
      .collection("members")
      .doc(memberId)
      .collection("notes")
      .add({ body, authorUid: access.user.uid, at: FieldValue.serverTimestamp() });
    revalidatePath(`/[orgSlug]/portal/brotherhood/${memberId}`, "page");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Org-admin: generate an invite for an unlinked member record. */
export async function inviteMember(
  raw: InviteMemberInput,
): Promise<ActionResult<{ inviteUrl: string }>> {
  const parsed = inviteMemberSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, memberId, email, role } = parsed.data;

  try {
    const access = await requireOrgRole(orgId, "admin");
    const org = orgRef(orgId);
    const memberSnap = await org.collection("members").doc(memberId).get();
    if (!memberSnap.exists) return { ok: false, error: "Member not found" };
    if (memberSnap.data()?.uid) return { ok: false, error: "Member already has an account" };

    const token = randomBytes(24).toString("base64url");
    await org.collection("invites").add({
      email,
      memberId,
      role,
      token,
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
    });

    const orgSnap = await org.get();
    const slug = orgSnap.data()?.slug ?? orgId;
    await org.collection("auditLogs").add({
      actorUid: access.user.uid,
      action: "member.invite",
      targetPath: memberSnap.ref.path,
      detail: email,
      at: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      data: { inviteUrl: `/${slug}/volunteer-resources?invite=${token}` },
    };
  } catch (e) {
    return failure(e);
  }
}

class InviteError extends Error {}

/**
 * New user accepts an invite: link member.uid, write membership, sync claims.
 * Called right after client-side signup, passing a FRESH Firebase ID token.
 *
 * Security: the caller's identity is derived ONLY from the verified ID token —
 * never from client-supplied uid/email (which would let anyone with the token
 * bind an admin-role member record to their own account). The authenticated
 * email must match the invited email, and the used/expiry check runs inside the
 * transaction so a token can't be redeemed twice under a race.
 */
export async function acceptInvite(raw: {
  orgId: string;
  token: string;
  idToken: string;
}): Promise<ActionResult> {
  const { orgId, token, idToken } = raw;
  if (!orgId || !token || !idToken) return { ok: false, error: "Invalid invite" };

  try {
    // Authenticate the caller from a fresh, non-revoked ID token.
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    const uid = decoded.uid;
    const email = decoded.email;
    if (!email) return { ok: false, error: "Your account has no email address" };
    const displayName = decoded.name ?? email;

    const org = orgRef(orgId);
    const inviteQuery = await org
      .collection("invites")
      .where("token", "==", token)
      .limit(1)
      .get();
    if (inviteQuery.empty) return { ok: false, error: "Invite not found" };
    const inviteRef = inviteQuery.docs[0].ref;

    await adminDb.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      const data = inviteSnap.data();
      if (!data) throw new InviteError("Invite not found");
      if (data.usedAt) throw new InviteError("This invite has already been used");
      if (data.expiresAt.toDate() < new Date()) throw new InviteError("This invite has expired");
      // Identity binding: only the invited email may redeem the invite.
      if (String(data.email).toLowerCase() !== email.toLowerCase()) {
        throw new InviteError("This invite was issued to a different email address");
      }

      // The member must still be unlinked. Multiple invites can be issued for
      // one member before any is accepted; without this check a second redeemer
      // would overwrite member.uid and bind two accounts to the same member.
      const memberRef = org.collection("members").doc(data.memberId);
      const memberSnap = await tx.get(memberRef);
      if (!memberSnap.exists) throw new InviteError("Member record no longer exists");
      if (memberSnap.data()?.uid) {
        throw new InviteError("This member is already linked to an account");
      }

      tx.update(memberRef, { uid });
      tx.set(
        adminDb.collection("users").doc(uid),
        {
          email,
          displayName,
          memberships: { [orgId]: { memberId: data.memberId, role: data.role } },
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      tx.update(inviteRef, { usedAt: FieldValue.serverTimestamp() });
    });

    await syncUserClaims(uid);
    // Accepting links the uid onto the member doc and grants the portal role.
    revalidateOrgTags(orgId, "members", "roles");
    return { ok: true };
  } catch (e) {
    if (e instanceof InviteError) return { ok: false, error: e.message };
    return failure(e);
  }
}

function failure(e: unknown): { ok: false; error: string } {
  if (e instanceof Error && e.name === "AuthError") {
    return { ok: false, error: e.message === "unauthenticated" ? "Sign in required" : "Not permitted" };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong" };
}
