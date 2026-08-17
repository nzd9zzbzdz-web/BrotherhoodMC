"use server";

import { revalidatePath } from "next/cache";
import { revalidateOrgTags } from "@/lib/cache";
import { Timestamp, adminDb, orgRef } from "@/lib/firebase/admin";
import { requireOrgRole } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import type { ActionResult } from "./activities";
import type { AwardedPatch, CutLayout, Member, Patch } from "@/lib/types";

export interface StaleAward {
  memberId: string;
  memberName: string; // road name, falling back to display name
  patchId: string;
  patchName: string;
  statLabel: string;
  current: number;
  threshold: number;
}

export interface ReconcileResult {
  revoked: number;
  membersAffected: number;
  cutsUpdated: number;
}

/**
 * Award reconciliation: take back what the record no longer supports.
 *
 * The mirror of `backfillPatchAwards`. Raising a threshold leaves members
 * holding a rung they can no longer reach — retuning Hardened from 300 months
 * to 2,000 doesn't touch anyone who earned it at 300, so their ladder shows a
 * tier lit that their stats don't justify.
 *
 * Two things it will not do:
 *
 *  - Touch a manual award. `awardedBy` is "system" for anything the engine or
 *    the backfill granted and a uid for anything leadership handed over. A
 *    President's Citation is a decision, not a calculation, and no threshold
 *    change gets to overrule it.
 *  - Touch an award whose patch is gone or has no requirement. There is nothing
 *    to measure it against, and a retired patch's award is real history.
 *
 * Destructive and visible to members, so it comes in two halves: `findStale`
 * reports what would go, and only `reconcilePatchAwards` writes.
 */

async function loadStale(orgId: string): Promise<StaleAward[]> {
  const org = orgRef(orgId);
  const [patchesSnap, membersSnap, awardsSnap] = await Promise.all([
    org.collection("patches").get(),
    org.collection("members").get(),
    org.collection("awardedPatches").where("awardedBy", "==", "system").get(),
  ]);

  const patchById = new Map(
    patchesSnap.docs.map((d) => [d.id, { id: d.id, ...(d.data() as Omit<Patch, "id">) }]),
  );
  const memberById = new Map(
    membersSnap.docs.map((d) => [d.id, { id: d.id, ...(d.data() as Omit<Member, "id">) }]),
  );

  const { STAT_LABELS } = await import("@/lib/constants");
  const stale: StaleAward[] = [];

  for (const doc of awardsSnap.docs) {
    const award = doc.data() as AwardedPatch;
    const patch = patchById.get(award.patchId);
    const member = memberById.get(award.memberId);
    if (!patch?.requirement || !member) continue;

    const current = member.stats?.[patch.requirement.statKey] ?? 0;
    if (current >= patch.requirement.threshold) continue;

    stale.push({
      memberId: award.memberId,
      memberName: member.roadName || member.displayName,
      patchId: patch.id,
      patchName: patch.name,
      statLabel: STAT_LABELS[patch.requirement.statKey] ?? patch.requirement.statKey,
      current,
      threshold: patch.requirement.threshold,
    });
  }

  stale.sort(
    (a, b) => a.memberName.localeCompare(b.memberName) || a.patchName.localeCompare(b.patchName),
  );
  return stale;
}

/** Admin: what a reconcile would revoke. Reads only — nothing is written. */
export async function findStaleAwards(
  orgId: string,
): Promise<ActionResult<StaleAward[]>> {
  try {
    await requireOrgRole(orgId, "admin");
    return { ok: true, data: await loadStale(orgId) };
  } catch (e) {
    return failure(e);
  }
}

/** Admin: revoke every system award the member's stats no longer support. */
export async function reconcilePatchAwards(
  orgId: string,
): Promise<ActionResult<ReconcileResult>> {
  try {
    const access = await requireOrgRole(orgId, "admin");
    const org = orgRef(orgId);
    const stale = await loadStale(orgId);

    if (stale.length === 0) {
      return { ok: true, data: { revoked: 0, membersAffected: 0, cutsUpdated: 0 } };
    }

    const byMember = new Map<string, StaleAward[]>();
    for (const item of stale) {
      const list = byMember.get(item.memberId);
      if (list) list.push(item);
      else byMember.set(item.memberId, [item]);
    }

    let revoked = 0;
    let cutsUpdated = 0;

    for (const [memberId, items] of byMember) {
      const memberRef = org.collection("members").doc(memberId);
      const memberSnap = await memberRef.get();
      if (!memberSnap.exists) continue;
      const member = memberSnap.data() as Member;

      const cutRef = org.collection("cutLayouts").doc(memberId);
      const cutSnap = await cutRef.get();

      const batch = adminDb.batch();
      const dropped = new Set(items.map((i) => i.patchId));
      for (const patchId of dropped) {
        batch.delete(org.collection("awardedPatches").doc(`${memberId}_${patchId}`));
      }
      batch.update(memberRef, {
        patchCount: Math.max(0, (member.patchCount ?? 0) - dropped.size),
      });

      // A revoked patch comes off the cut too. Emblems were never on it, so
      // this only bites for worn patches — but leaving one behind would show a
      // patch the member no longer holds.
      if (cutSnap.exists) {
        const layout = cutSnap.data() as CutLayout;
        let removedFromCut = 0;
        const surfaces = { ...layout.surfaces };
        for (const surface of ["front", "back"] as const) {
          const before = surfaces[surface] ?? [];
          const after = before.filter(
            (p) => !(p.kind === "patch" && dropped.has(p.refId)),
          );
          removedFromCut += before.length - after.length;
          surfaces[surface] = after;
        }
        if (removedFromCut > 0) {
          batch.set(cutRef, { ...layout, surfaces, updatedAt: Timestamp.now() });
          cutsUpdated += 1;
        }
      }

      await batch.commit();
      revoked += dropped.size;
    }

    await writeAuditLog(orgId, {
      actorUid: access.user.uid,
      action: "patches.reconcile",
      targetPath: `organizations/${orgId}/awardedPatches`,
      detail:
        `revoked ${revoked} award(s) across ${byMember.size} member(s): ` +
        stale
          .slice(0, 12)
          .map((s) => `${s.memberName}/${s.patchName}`)
          .join(", ") +
        (stale.length > 12 ? ` +${stale.length - 12} more` : ""),
    });

    // Reconcile can revoke awards AND rewrite member patchCount.
    revalidateOrgTags(orgId, "awards", "members");
    revalidatePath(`/[orgSlug]/portal/admin/patches`, "page");
    revalidatePath(`/[orgSlug]/portal/patch-wall`, "page");
    revalidatePath(`/[orgSlug]/portal/brotherhood/[memberId]`, "page");

    return {
      ok: true,
      data: { revoked, membersAffected: byMember.size, cutsUpdated },
    };
  } catch (e) {
    return failure(e);
  }
}

function failure(e: unknown): { ok: false; error: string } {
  if (e instanceof Error && e.name === "AuthError") {
    return {
      ok: false,
      error: e.message === "unauthenticated" ? "Sign in required" : "Admins only",
    };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong" };
}
