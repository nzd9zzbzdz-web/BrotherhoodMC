import "server-only";
import { adminDb, FieldValue, Timestamp, orgRef } from "@/lib/firebase/admin";
import type {
  Activity,
  CutLayout,
  CutPlacement,
  Member,
  Patch,
  StatKey,
} from "@/lib/types";
import { activityEntries } from "@/lib/activity-entries";

export interface EngineResult {
  memberId: string;
  /** Every stat the ticket touched, with its post-approval value. */
  stats: { statKey: StatKey; newValue: number }[];
  awardedPatchIds: string[];
}

/** Active, requirement-bearing patches — fetched outside the transaction (they change rarely). */
async function getCandidatePatches(orgId: string): Promise<Patch[]> {
  const snap = await orgRef(orgId)
    .collection("patches")
    .where("active", "==", true)
    .get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Patch, "id">) }))
    .filter((p) => p.requirement !== null);
}

/** Nudge v downward until the spot isn't occupied (simple collision avoidance). */
export function placeOnCut(
  layout: CutLayout,
  placement: Omit<CutPlacement, "zIndex" | "mirrored">,
): CutPlacement {
  const surface = layout.surfaces[placement.surface];
  const { u } = placement;
  let { v } = placement;
  const occupied = (uu: number, vv: number) =>
    surface.some((p) => Math.abs(p.u - uu) < 0.05 && Math.abs(p.v - vv) < 0.05);
  while (occupied(u, v) && v < 0.95) v += 0.06;
  return { ...placement, u, v, zIndex: surface.length + 1, mirrored: false };
}

/**
 * Emblems are earned like patches but never worn. The criminal-record ladders
 * run five tiers across eleven stats, so placing them would bury a vest
 * fifty-five deep — they live as levels on the member's profile instead.
 */
export function isWorn(patch: Patch): boolean {
  return patch.emblem !== true;
}

const EMPTY_LAYOUT: CutLayout = {
  surfaces: { front: [], back: [] },
  updatedAt: new Date(),
};

/**
 * Approve a pending activity: flip status, bump the member's stat, evaluate
 * patch requirements, award idempotently (composite doc id memberId_patchId),
 * and place new patches on the member's cut. Single Firestore transaction —
 * reads strictly before writes.
 */
export async function approveActivityTx(
  orgId: string,
  activityId: string,
  reviewerUid: string,
  reviewNote?: string,
): Promise<EngineResult> {
  const candidates = await getCandidatePatches(orgId);
  const org = orgRef(orgId);
  const activityRef = org.collection("activities").doc(activityId);

  const result = await adminDb.runTransaction(async (tx) => {
    // ── reads ──
    const aSnap = await tx.get(activityRef);
    if (!aSnap.exists) throw new EngineError("activity_not_found");
    const activity = aSnap.data() as Activity;
    if (activity.status !== "pending") throw new EngineError("not_pending");

    const memberRef = org.collection("members").doc(activity.memberId);
    const mSnap = await tx.get(memberRef);
    if (!mSnap.exists) throw new EngineError("member_not_found");
    const member = mSnap.data() as Member;

    // A ticket can carry several activity types. Aggregate per stat (two
    // entries may feed the same stat), then evaluate patches across all of them.
    const newStats = new Map<StatKey, number>();
    for (const entry of activityEntries(activity)) {
      const base = newStats.get(entry.statKey) ?? member.stats?.[entry.statKey] ?? 0;
      newStats.set(entry.statKey, base + (entry.quantity ?? 1));
    }

    const relevant = candidates.filter((p) => {
      const newStat = newStats.get(p.requirement!.statKey);
      return newStat !== undefined && newStat >= p.requirement!.threshold;
    });
    const awardRefs = relevant.map((p) =>
      org.collection("awardedPatches").doc(`${activity.memberId}_${p.id}`),
    );
    const awardSnaps = await Promise.all(awardRefs.map((r) => tx.get(r)));
    const newAwards = relevant.filter((_, i) => !awardSnaps[i].exists);
    // Emblems are awarded but never worn, so a batch of pure emblems must not
    // drag the cut into the transaction at all.
    const newWorn = newAwards.filter(isWorn);

    const cutRef = org.collection("cutLayouts").doc(activity.memberId);
    const cutSnap = newWorn.length ? await tx.get(cutRef) : null;

    // ── writes ──
    tx.update(activityRef, {
      status: "approved",
      reviewedBy: reviewerUid,
      reviewedAt: FieldValue.serverTimestamp(),
      ...(reviewNote ? { reviewNote } : {}),
    });

    tx.update(memberRef, {
      ...Object.fromEntries(
        [...newStats].map(([key, value]) => [`stats.${key}`, value]),
      ),
      patchCount: (member.patchCount ?? 0) + newAwards.length,
      lastActivityAt: FieldValue.serverTimestamp(),
    });

    for (const p of newAwards) {
      tx.set(org.collection("awardedPatches").doc(`${activity.memberId}_${p.id}`), {
        memberId: activity.memberId,
        patchId: p.id,
        awardedAt: FieldValue.serverTimestamp(),
        awardedBy: "system",
        activityId,
      });
    }

    if (newWorn.length) {
      const layout: CutLayout = cutSnap?.exists
        ? (cutSnap.data() as CutLayout)
        : structuredClone(EMPTY_LAYOUT);
      for (const p of newWorn) {
        const placement = placeOnCut(layout, {
          kind: "patch",
          refId: p.id,
          ...p.defaultPlacement,
        });
        layout.surfaces[placement.surface].push(placement);
      }
      tx.set(cutRef, { ...layout, updatedAt: Timestamp.now() });
    }

    tx.set(org.collection("auditLogs").doc(), {
      actorUid: reviewerUid,
      action: "activity.approve",
      targetPath: activityRef.path,
      detail: `${[...newStats]
        .map(([key, value]) => `${key} +${value - (member.stats?.[key] ?? 0)}`)
        .join(", ")}; awards: ${newAwards.map((p) => p.name).join(", ") || "none"}`,
      at: FieldValue.serverTimestamp(),
    });

    return {
      memberId: activity.memberId,
      stats: [...newStats].map(([statKey, newValue]) => ({ statKey, newValue })),
      awardedPatchIds: newAwards.map((p) => p.id),
    } satisfies EngineResult;
  });

  return result;
}

/**
 * Manual award (President's Citation, War Veteran, ...). Same composite-id
 * idempotency and cut placement as system awards.
 */
export async function manualAwardTx(
  orgId: string,
  memberId: string,
  patchId: string,
  awarderUid: string,
  reason: string,
): Promise<boolean> {
  const org = orgRef(orgId);
  const awarded = await adminDb.runTransaction(async (tx) => {
    const patchSnap = await tx.get(org.collection("patches").doc(patchId));
    if (!patchSnap.exists) throw new EngineError("patch_not_found");
    const patch = { id: patchSnap.id, ...(patchSnap.data() as Omit<Patch, "id">) };

    const memberRef = org.collection("members").doc(memberId);
    const mSnap = await tx.get(memberRef);
    if (!mSnap.exists) throw new EngineError("member_not_found");
    const member = mSnap.data() as Member;

    const awardRef = org.collection("awardedPatches").doc(`${memberId}_${patchId}`);
    const aSnap = await tx.get(awardRef);
    if (aSnap.exists) return false; // already has it

    const cutRef = org.collection("cutLayouts").doc(memberId);
    const cutSnap = await tx.get(cutRef);

    tx.set(awardRef, {
      memberId,
      patchId,
      awardedAt: FieldValue.serverTimestamp(),
      awardedBy: awarderUid,
      reason,
    });
    tx.update(memberRef, { patchCount: (member.patchCount ?? 0) + 1 });

    // Hand-granting an emblem still awards it — it just doesn't go on the cut.
    if (isWorn(patch)) {
      const layout: CutLayout = cutSnap.exists
        ? (cutSnap.data() as CutLayout)
        : structuredClone(EMPTY_LAYOUT);
      const placement = placeOnCut(layout, {
        kind: "patch",
        refId: patch.id,
        ...patch.defaultPlacement,
      });
      layout.surfaces[placement.surface].push(placement);
      tx.set(cutRef, { ...layout, updatedAt: Timestamp.now() });
    }

    tx.set(org.collection("auditLogs").doc(), {
      actorUid: awarderUid,
      action: "patch.manualAward",
      targetPath: awardRef.path,
      detail: `${patch.name} → ${member.roadName || member.displayName}: ${reason}`,
      at: FieldValue.serverTimestamp(),
    });
    return true;
  });

  return awarded;
}

export class EngineError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "EngineError";
  }
}
