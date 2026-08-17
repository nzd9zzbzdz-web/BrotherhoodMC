"use server";

import { revalidatePath } from "next/cache";
import { revalidateOrgTags } from "@/lib/cache";
import { orgRef } from "@/lib/firebase/admin";
import { requireOrgRole } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { DEFAULT_RANKS, rankDocId } from "@/lib/constants";
import { defaultRankVisual } from "@/lib/cut/config";
import type { Organization, RankVisual } from "@/lib/types";

export interface RankSyncResult {
  created: string[]; // names of ranks added
  updated: string[]; // names whose order/officer flag was corrected
  alreadyCurrent: number;
  visualsWritten: number; // cut visuals authored for the new ranks
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/**
 * The club colors an org actually wears, read back off any rank that already
 * shows them. New ranks inherit those exact rockers rather than a guess — the
 * org doc has no location field, and a rebrand only ever touches these docs.
 */
function clubIdentityFrom(
  visuals: RankVisual[],
  fallbackName: string,
): { orgName: string; location: string } {
  for (const rv of visuals) {
    const top = rv.grants?.find((g) => g.kind === "topRocker")?.text;
    if (!top) continue;
    const bottom = rv.grants?.find((g) => g.kind === "bottomRocker")?.text;
    return { orgName: top, location: bottom ?? "" };
  }
  return { orgName: fallbackName, location: "" };
}

/**
 * Admin: bring an org's ranks up to the shipped defaults.
 *
 * Ranks are only written on a destructive reseed, so a rank added to
 * DEFAULT_RANKS after the org was created (Head Enforcer, Chaplain) never
 * reaches a live club, and a rank that changed sides — Enforcer moving out of
 * the officer table — keeps its stale flag. This adds what's missing and
 * corrects order/isOfficer on the defaults, then authors a cut visual for each
 * new rank so it renders colors and a tab straight away.
 *
 * Never deletes: a rank an org added itself, or one dropped from the defaults,
 * keeps its doc so members sitting on it still resolve a name. Idempotent.
 */
export async function syncDefaultRanks(
  orgId: string,
): Promise<ActionResult<RankSyncResult>> {
  try {
    const access = await requireOrgRole(orgId, "admin");
    const org = orgRef(orgId);

    const [orgSnap, ranksSnap, visualsSnap] = await Promise.all([
      org.get(),
      org.collection("ranks").get(),
      org.collection("rankVisuals").get(),
    ]);

    const existing = new Map(ranksSnap.docs.map((d) => [d.id, d.data()]));
    const haveVisual = new Set(visualsSnap.docs.map((d) => d.id));
    const identity = clubIdentityFrom(
      visualsSnap.docs.map((d) => d.data() as RankVisual),
      (orgSnap.data() as Organization | undefined)?.name ?? "",
    );

    const created: string[] = [];
    const updated: string[] = [];
    let visualsWritten = 0;

    for (const rank of DEFAULT_RANKS) {
      const id = rankDocId(rank.name);
      const current = existing.get(id);

      if (!current) {
        await org.collection("ranks").doc(id).set({
          name: rank.name,
          order: rank.order,
          isOfficer: rank.isOfficer,
          tab: {
            text: rank.name.toUpperCase(),
            surface: "front",
            u: 0.5,
            v: 0.16,
            scale: 1,
          },
        });
        created.push(rank.name);
      } else if (
        current.order !== rank.order ||
        current.isOfficer !== rank.isOfficer
      ) {
        // Merge, not set: leave the name and any tab art the org has tuned.
        await org
          .collection("ranks")
          .doc(id)
          .set({ order: rank.order, isOfficer: rank.isOfficer }, { merge: true });
        updated.push(rank.name);
      }

      // Without a visual doc a rank renders a bare vest — write one for ranks
      // that are missing it, but never overwrite one the org already has.
      if (!haveVisual.has(id)) {
        await org
          .collection("rankVisuals")
          .doc(id)
          .set(defaultRankVisual(rank.name, identity));
        visualsWritten += 1;
      }
    }

    const changed = created.length + updated.length + visualsWritten;
    if (changed > 0) {
      await writeAuditLog(orgId, {
        actorUid: access.user.uid,
        action: "ranks.sync",
        targetPath: `organizations/${orgId}/ranks`,
        detail:
          `+${created.length} rank(s), ${updated.length} corrected, ` +
          `${visualsWritten} cut visual(s) written`,
      });
    }

    revalidateOrgTags(orgId, "ranks");
    revalidatePath(`/[orgSlug]/portal/admin/ranks`, "page");
    revalidatePath(`/[orgSlug]/portal/admin`, "page");
    revalidatePath(`/[orgSlug]/portal/brotherhood`, "page");
    revalidatePath(`/[orgSlug]/portal/my-cut`, "page");

    return {
      ok: true,
      data: {
        created,
        updated,
        alreadyCurrent: DEFAULT_RANKS.length - created.length - updated.length,
        visualsWritten,
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
