import type { Firestore } from "firebase-admin/firestore";
import {
  DEFAULT_VEST_ASPECT,
  defaultRankVisual,
  defaultSlotForCategory,
  defaultSlotsFor,
  tierToRarity,
} from "../../src/lib/cut/config";
import type { PatchCategory } from "../../src/lib/types";

/**
 * Idempotently write an org's Digital Cut configuration:
 *   - vestConfigs/{front,back}  (art placeholder + slot map)
 *   - rankVisuals/{rankId}      (three-piece colors + tabs, one per rank)
 *   - backfill rarity + defaultSlot on existing patches
 *
 * Shared by the demo seed, the live bootstrap, and the standalone migration so
 * the three can never drift.
 */
export async function writeCutConfig(
  db: Firestore,
  orgId: string,
  org: { orgName: string; location: string },
): Promise<{ vestSurfaces: number; rankVisuals: number; patchesBackfilled: number }> {
  const orgRef = db.collection("organizations").doc(orgId);

  // Vest surfaces
  for (const surface of ["front", "back"] as const) {
    await orgRef.collection("vestConfigs").doc(surface).set({
      surface,
      imagePath: null, // renderer draws a schematic placeholder until art is uploaded
      aspectRatio: DEFAULT_VEST_ASPECT,
      slots: defaultSlotsFor(surface),
      model3d: null,
    });
  }

  // Rank visuals — one per existing rank
  const ranksSnap = await orgRef.collection("ranks").get();
  let rankVisuals = 0;
  for (const doc of ranksSnap.docs) {
    const name = (doc.data().name as string) ?? doc.id;
    await orgRef.collection("rankVisuals").doc(doc.id).set(defaultRankVisual(name, org));
    rankVisuals++;
  }

  // Backfill rarity + defaultSlot on patches (only when missing)
  const patchesSnap = await orgRef.collection("patches").get();
  let patchesBackfilled = 0;
  for (const doc of patchesSnap.docs) {
    const d = doc.data();
    const update: Record<string, unknown> = {};
    if (d.rarity === undefined) update.rarity = tierToRarity(Number(d.tier ?? 1));
    if (d.defaultSlot === undefined) {
      update.defaultSlot = defaultSlotForCategory((d.category as PatchCategory) ?? "activity");
    }
    if (Object.keys(update).length) {
      await doc.ref.set(update, { merge: true });
      patchesBackfilled++;
    }
  }

  return { vestSurfaces: 2, rankVisuals, patchesBackfilled };
}
