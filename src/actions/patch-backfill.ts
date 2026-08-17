"use server";

import { revalidatePath } from "next/cache";
import { revalidateOrgTags } from "@/lib/cache";
import { FieldValue, Timestamp, adminDb, orgRef } from "@/lib/firebase/admin";
import { requireOrgRole } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import type { ActionResult } from "./activities";
import type { CutLayout, CutPlacement, Member, Patch } from "@/lib/types";

export interface BackfillResult {
  membersChecked: number;
  awardsCreated: number;
  membersAwarded: number;
  cutsUpdated: number;
}

/**
 * Award every patch and emblem members already qualify for.
 *
 * The engine only evaluates thresholds when an activity is APPROVED, so a
 * member's existing stats never earn anything on their own. That leaves two
 * holes this closes:
 *
 *  - A newly installed patch or emblem. Admin → Activity Types creates the
 *    docs, but a member sitting on 187 crimes stays at zero emblems until they
 *    log crime 188.
 *  - A retuned threshold. Dropping Corner Boy from 1,000 sales to 100 does
 *    nothing for anyone until their next approved sale.
 *
 * Idempotent: awards use the same composite `memberId_patchId` id as the
 * engine, so an award that exists is skipped and re-running changes nothing.
 * It only ever ADDS — raising a threshold above what someone has already earned
 * does not take the award back, which matches how the engine behaves.
 *
 * One batch per member, so a club of any size stays well inside Firestore's
 * 500-write limit.
 */
export async function backfillPatchAwards(
  orgId: string,
): Promise<ActionResult<BackfillResult>> {
  try {
    const access = await requireOrgRole(orgId, "admin");
    const org = orgRef(orgId);

    const [patchesSnap, membersSnap, awardsSnap] = await Promise.all([
      org.collection("patches").where("active", "==", true).get(),
      org.collection("members").get(),
      org.collection("awardedPatches").get(),
    ]);

    const patches = patchesSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Patch, "id">) }))
      .filter((p) => p.requirement !== null);

    const held = new Set(awardsSnap.docs.map((d) => d.id));

    let awardsCreated = 0;
    let membersAwarded = 0;
    let cutsUpdated = 0;

    for (const memberDoc of membersSnap.docs) {
      const member = memberDoc.data() as Member;
      const earned = patches.filter((p) => {
        const { statKey, threshold } = p.requirement!;
        return (
          (member.stats?.[statKey] ?? 0) >= threshold &&
          !held.has(`${memberDoc.id}_${p.id}`)
        );
      });
      if (earned.length === 0) continue;

      // Worn patches also need a place on the cut; emblems never do.
      const worn = earned.filter((p) => p.emblem !== true);
      const cutRef = org.collection("cutLayouts").doc(memberDoc.id);
      const cutSnap = worn.length ? await cutRef.get() : null;

      const batch = adminDb.batch();
      for (const patch of earned) {
        batch.set(org.collection("awardedPatches").doc(`${memberDoc.id}_${patch.id}`), {
          memberId: memberDoc.id,
          patchId: patch.id,
          awardedAt: FieldValue.serverTimestamp(),
          awardedBy: "system",
        });
      }
      batch.update(memberDoc.ref, {
        patchCount: (member.patchCount ?? 0) + earned.length,
      });

      if (worn.length) {
        const layout: CutLayout = cutSnap?.exists
          ? (cutSnap.data() as CutLayout)
          : { surfaces: { front: [], back: [] }, updatedAt: new Date() };
        layout.surfaces.front ??= [];
        layout.surfaces.back ??= [];
        for (const patch of worn) {
          const base = patch.defaultPlacement;
          const list = layout.surfaces[base.surface];
          let v = base.v;
          const occupied = (vv: number) =>
            list.some(
              (pl: CutPlacement) =>
                Math.abs(pl.u - base.u) < 0.05 && Math.abs(pl.v - vv) < 0.05,
            );
          while (occupied(v) && v < 0.95) v += 0.06;
          list.push({
            kind: "patch",
            refId: patch.id,
            surface: base.surface,
            u: base.u,
            v,
            scale: base.scale,
            rotationDeg: base.rotationDeg,
            zIndex: list.length + 1,
            mirrored: false,
          });
        }
        batch.set(cutRef, { ...layout, updatedAt: Timestamp.now() });
        cutsUpdated += 1;
      }

      await batch.commit();
      awardsCreated += earned.length;
      membersAwarded += 1;
      for (const patch of earned) held.add(`${memberDoc.id}_${patch.id}`);
    }

    if (awardsCreated > 0) {
      await writeAuditLog(orgId, {
        actorUid: access.user.uid,
        action: "patches.backfill",
        targetPath: `organizations/${orgId}/awardedPatches`,
        detail: `${awardsCreated} award(s) across ${membersAwarded} member(s)`,
      });
    }

    revalidateOrgTags(orgId, "awards");
    revalidatePath(`/[orgSlug]/portal/admin/patches`, "page");
    revalidatePath(`/[orgSlug]/portal/patch-wall`, "page");
    revalidatePath(`/[orgSlug]/portal/brotherhood/[memberId]`, "page");

    return {
      ok: true,
      data: {
        membersChecked: membersSnap.size,
        awardsCreated,
        membersAwarded,
        cutsUpdated,
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
