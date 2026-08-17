"use server";

import { revalidatePath } from "next/cache";
import { revalidateOrgTags } from "@/lib/cache";
import { FieldValue, Timestamp, adminDb, orgRef } from "@/lib/firebase/admin";
import { requireOrgRole } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { isWorn, placeOnCut } from "@/lib/patch-engine";
import { STAT_LABELS } from "@/lib/constants";
import {
  saveMemberStatsSchema,
  type SaveMemberStatsInput,
} from "@/lib/schemas/member";
import type { ActionResult } from "./activities";
import type {
  AwardedPatch,
  CutLayout,
  Member,
  MemberStats,
  Patch,
  StatKey,
} from "@/lib/types";

/**
 * Hand-correct a member's stats.
 *
 * Stats are supposed to move one way only: a member files a ticket, an officer
 * approves it, the engine bumps the number. That pipeline has no reverse gear,
 * so a ticket approved with the wrong quantity (a heist logged as 500 instead
 * of 5, a cash figure pasted with an extra zero) leaves the record permanently
 * wrong, and every emblem ladder, leaderboard and criminal-record row reads off
 * that number. This is the repair door.
 *
 * Absolute values, not deltas: the admin types what the record should say.
 *
 * The awards that hang off those stats are re-evaluated in the same write, so a
 * correction never leaves a member holding a rung the record no longer reaches
 * (or short of one it now does). Two rules carried over from
 * `reconcilePatchAwards`, for the same reasons:
 *
 *  - A MANUAL award is never revoked. `awardedBy` is "system" for anything the
 *    engine granted and a uid for anything leadership handed over; a
 *    President's Citation is a decision, not a calculation.
 *  - A patch with no requirement, or one whose doc is gone, is left alone.
 *    There is nothing to measure it against.
 *
 * Granting stays narrower than revoking, matching `backfillPatchAwards`: only
 * ACTIVE patches are handed out, but a retired patch that still carries a
 * requirement can be taken back.
 *
 * Admin-only, and it writes the before/after of every number to the audit log.
 * Officers can already move stats upward by approving a ticket, but nothing
 * else in the app can move one DOWN, and taking a member's record off them is
 * visible and awkward to undo.
 */

export interface StatCorrection {
  statKey: StatKey;
  label: string;
  from: number;
  to: number;
}

export interface SaveMemberStatsResult {
  changed: StatCorrection[];
  /** Patch/emblem names the corrected record now earns. */
  granted: string[];
  /** Patch/emblem names the corrected record no longer supports. */
  revoked: string[];
}

export async function saveMemberStats(
  raw: SaveMemberStatsInput,
): Promise<ActionResult<SaveMemberStatsResult>> {
  const parsed = saveMemberStatsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { orgId, memberId, stats, reason } = parsed.data;

  try {
    const access = await requireOrgRole(orgId, "admin");
    const org = orgRef(orgId);
    const memberRef = org.collection("members").doc(memberId);

    // One member's documents plus the patch catalog. Not a transaction: the
    // engine's own approval path is the contended one, and a correction is a
    // deliberate single-admin act. Awards keep their composite ids, so the
    // worst a race can do is grant something the engine was about to grant.
    const [memberSnap, patchesSnap, awardsSnap] = await Promise.all([
      memberRef.get(),
      org.collection("patches").get(),
      org.collection("awardedPatches").where("memberId", "==", memberId).get(),
    ]);
    if (!memberSnap.exists) return { ok: false, error: "Member not found" };
    const member = memberSnap.data() as Member;

    const changed: StatCorrection[] = stats
      .map(({ statKey, value }) => ({
        statKey,
        label: STAT_LABELS[statKey] ?? statKey,
        from: member.stats?.[statKey] ?? 0,
        to: value,
      }))
      .filter((c) => c.from !== c.to);
    if (changed.length === 0) {
      return { ok: false, error: "Those are the numbers already on the record" };
    }

    // What the record will say once this lands — every patch is judged against
    // the whole corrected sheet, not just the rows that moved.
    const corrected: MemberStats = { ...(member.stats ?? {}) };
    for (const c of changed) corrected[c.statKey] = c.to;

    const patches = patchesSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Patch, "id">),
    }));
    const held = new Map(
      awardsSnap.docs.map((d) => {
        const award = d.data() as AwardedPatch;
        return [award.patchId, award];
      }),
    );

    const granting: Patch[] = [];
    const revoking: Patch[] = [];
    for (const patch of patches) {
      const requirement = patch.requirement;
      if (!requirement) continue;
      const value = corrected[requirement.statKey] ?? 0;
      const award = held.get(patch.id);
      if (!award) {
        if (patch.active && value >= requirement.threshold) granting.push(patch);
      } else if (award.awardedBy === "system" && value < requirement.threshold) {
        revoking.push(patch);
      }
    }

    // Emblems are never on the cut, so a correction that only moves emblems
    // must not drag the layout into the write at all.
    const wornGranting = granting.filter(isWorn);
    const wornRevoking = revoking.filter(isWorn);
    const touchesCut = wornGranting.length > 0 || wornRevoking.length > 0;
    const cutRef = org.collection("cutLayouts").doc(memberId);
    const cutSnap = touchesCut ? await cutRef.get() : null;

    const batch = adminDb.batch();
    batch.update(memberRef, {
      ...Object.fromEntries(changed.map((c) => [`stats.${c.statKey}`, c.to])),
      patchCount: Math.max(
        0,
        (member.patchCount ?? 0) + granting.length - revoking.length,
      ),
    });
    for (const patch of granting) {
      batch.set(org.collection("awardedPatches").doc(`${memberId}_${patch.id}`), {
        memberId,
        patchId: patch.id,
        awardedAt: FieldValue.serverTimestamp(),
        awardedBy: "system",
      });
    }
    for (const patch of revoking) {
      batch.delete(org.collection("awardedPatches").doc(`${memberId}_${patch.id}`));
    }

    if (cutSnap) {
      const layout: CutLayout = cutSnap.exists
        ? (cutSnap.data() as CutLayout)
        : { surfaces: { front: [], back: [] }, updatedAt: new Date() };
      layout.surfaces.front ??= [];
      layout.surfaces.back ??= [];
      const dropped = new Set(wornRevoking.map((p) => p.id));
      for (const surface of ["front", "back"] as const) {
        layout.surfaces[surface] = layout.surfaces[surface].filter(
          (placement) => !(placement.kind === "patch" && dropped.has(placement.refId)),
        );
      }
      // Placed after the removals so a newly earned patch can take the spot a
      // revoked one just gave up.
      for (const patch of wornGranting) {
        const placement = placeOnCut(layout, {
          kind: "patch",
          refId: patch.id,
          ...patch.defaultPlacement,
        });
        layout.surfaces[placement.surface].push(placement);
      }
      batch.set(cutRef, { ...layout, updatedAt: Timestamp.now() });
    }

    await batch.commit();

    await writeAuditLog(orgId, {
      actorUid: access.user.uid,
      action: "member.stats",
      targetPath: memberRef.path,
      detail:
        `${changed
          .map(
            (c) =>
              `${c.label} ${c.from.toLocaleString("en-US")} → ${c.to.toLocaleString("en-US")}`,
          )
          .join(", ")}` +
        (granting.length ? `; awarded: ${granting.map((p) => p.name).join(", ")}` : "") +
        (revoking.length ? `; revoked: ${revoking.map((p) => p.name).join(", ")}` : "") +
        ` · ${reason}`,
    });

    // Stats and awards are read behind the profile, the roster, the wall, the
    // standings board and the dashboard, and a revoked patch changes a cut.
    revalidateOrgTags(orgId, "members", "awards");
    revalidatePath(`/[orgSlug]/portal/brotherhood/[memberId]`, "page");
    revalidatePath(`/[orgSlug]/portal/brotherhood`, "page");
    revalidatePath(`/[orgSlug]/portal/patch-wall`, "page");
    revalidatePath(`/[orgSlug]/portal/standings`, "page");
    revalidatePath(`/[orgSlug]/portal/prospects`, "page");
    revalidatePath(`/[orgSlug]/portal/my-cut`, "page");
    revalidatePath(`/[orgSlug]/portal`, "page");

    return {
      ok: true,
      data: {
        changed,
        granted: granting.map((p) => p.name),
        revoked: revoking.map((p) => p.name),
      },
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AuthError") {
      return {
        ok: false,
        error: e.message === "unauthenticated" ? "Sign in required" : "Admins only",
      };
    }
    console.error(e);
    return { ok: false, error: "Something went wrong" };
  }
}
