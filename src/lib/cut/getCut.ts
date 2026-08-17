import "server-only";
import type { Timestamp } from "firebase-admin/firestore";
import { orgRef } from "@/lib/firebase/admin";
import type {
  AwardedPatch,
  CutRenderModel,
  CutSurface,
  Member,
  Patch,
  Rank,
  RankVisual,
  VestConfig,
} from "@/lib/types";
import { buildRenderModel } from "./buildRenderModel";

export interface CutSummary {
  roadName: string;
  displayName: string;
  rankName: string;
  status: string;
  joinDate: string | null;
  patchCount: number;
}

export interface MemberCut {
  model: CutRenderModel;
  summary: CutSummary;
  aspectRatio: number;
}

function iso(ts: unknown): string | null {
  const t = ts as Timestamp | undefined;
  return typeof t?.toDate === "function" ? t.toDate().toISOString() : null;
}

/** Load + resolve a member's cut. Returns null if the member doesn't exist. */
export async function getMemberCut(
  orgId: string,
  memberId: string,
): Promise<MemberCut | null> {
  const org = orgRef(orgId);
  const memberSnap = await org.collection("members").doc(memberId).get();
  if (!memberSnap.exists) return null;
  const member = memberSnap.data() as Member;

  const [vcFront, vcBack, rankSnap, rvSnap, patchesSnap, awardedSnap, artSnap] =
    await Promise.all([
      org.collection("vestConfigs").doc("front").get(),
      org.collection("vestConfigs").doc("back").get(),
      org.collection("ranks").doc(member.rankId).get(),
      org.collection("rankVisuals").doc(member.rankId).get(),
      org.collection("patches").get(),
      org.collection("awardedPatches").where("memberId", "==", memberId).get(),
      // Versions only — the bytes come from the art route. Reading the images
      // here would put every patch's base64 into the cut page's payload.
      org.collection("patchArt").select("updatedAt").get(),
    ]);

  const vestConfigs: Partial<Record<CutSurface, VestConfig>> = {};
  if (vcFront.exists) vestConfigs.front = vcFront.data() as VestConfig;
  if (vcBack.exists) vestConfigs.back = vcBack.data() as VestConfig;

  // Uploaded artwork resolves through `imagePath`, which the render model
  // already reads — an admin uploading a patch image gets it on the cut with
  // no renderer change. A patch with its own imagePath set keeps it.
  const artVersions = new Map(
    artSnap.docs.map((d) => {
      const ts = d.data()?.updatedAt as { toMillis?: () => number } | undefined;
      return [d.id, ts?.toMillis?.() ?? 0];
    }),
  );

  const patches = patchesSnap.docs.map((d) => {
    const patch = { id: d.id, ...(d.data() as Omit<Patch, "id">) };
    const version = artVersions.get(d.id);
    return {
      ...patch,
      imagePath:
        patch.imagePath ??
        (version === undefined
          ? undefined
          : `/api/orgs/${orgId}/patches/${d.id}/art?v=${version}`),
    };
  });

  const awarded = awardedSnap.docs.map((d) => {
    const a = d.data() as AwardedPatch & { slotOverride?: string };
    return {
      patchId: a.patchId,
      awardedAt: iso(a.awardedAt),
      awardedBy: a.awardedBy === "system" ? null : (a.awardedBy as string),
      reason: a.reason ?? null,
      slotOverride: a.slotOverride ?? null,
    };
  });

  const rankVisual = rvSnap.exists ? (rvSnap.data() as RankVisual) : null;

  return {
    model: buildRenderModel({ vestConfigs, rankVisual, patches, awarded }),
    aspectRatio: vestConfigs.front?.aspectRatio ?? 0.88,
    summary: {
      roadName: member.roadName,
      displayName: member.displayName,
      rankName: (rankSnap.data() as Rank | undefined)?.name ?? "",
      status: member.status,
      joinDate: iso(member.joinDate),
      patchCount: member.patchCount ?? 0,
    },
  };
}
