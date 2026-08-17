/**
 * The admin "add missing default types" action. This is the only way an org
 * created before a type existed can get it — the seeder only runs on a
 * destructive reseed — so the idempotency and don't-clobber behaviour matters.
 *
 * Requires emulators running; isolated project.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "activity-types-test-isolated";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  // Actions clear cached reads via updateTag (see src/lib/cache.ts). No Server
  // Action context here, and NODE_ENV!=="production" means nothing is cached
  // in tests anyway — the stub just has to exist.
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("@/lib/auth/session", () => ({
  requireOrgRole: async () => ({
    user: { uid: "admin-1" },
    role: "admin",
    memberId: "m1",
    isSuper: false,
  }),
}));

const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { syncDefaultActivityTypes } = await import("@/actions/activity-types");
const { defaultActivityTypes } = await import("@/lib/criminal-record");
const {
  CRIMINAL_ACTIVITY_TYPE_SEEDS,
  CRIMINAL_PATCH_SEEDS,
  RETIRED_ACTIVITY_TYPE_IDS,
  RETIRED_PATCH_IDS,
} = await import("@/lib/constants");

const ORG = "activity-types-test-org";

async function typeIds(): Promise<string[]> {
  const snap = await orgRef(ORG).collection("activityTypes").get();
  return snap.docs.map((d) => d.id).sort();
}

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await orgRef(ORG).set({ name: "Sync Test", slug: ORG, memberCount: 0 });
});
afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
});

describe("syncDefaultActivityTypes", () => {
  it("installs every shipped type into an empty org", async () => {
    const res = await syncDefaultActivityTypes(ORG);
    expect(res.ok).toBe(true);
    expect(res.data!.created).toHaveLength(defaultActivityTypes().length);
    expect(await typeIds()).toEqual(defaultActivityTypes().map((t) => t.id).sort());
  });

  it("adds only what is missing — the production case", async () => {
    // Org has the club types but not the criminal ones: exactly the state of a
    // club seeded before the Criminal Record shipped.
    for (const t of defaultActivityTypes()) {
      if (CRIMINAL_ACTIVITY_TYPE_SEEDS.some((c) => c.id === t.id)) continue;
      await orgRef(ORG).collection("activityTypes").doc(t.id).set({
        name: t.name,
        statKey: t.statKey,
        requiresProof: t.requiresProof,
        allowQuantity: t.allowQuantity,
        defaultQuantity: 1,
        icon: t.icon,
        active: true,
        order: 1,
      });
    }

    const res = await syncDefaultActivityTypes(ORG);
    expect(res.data!.created).toHaveLength(CRIMINAL_ACTIVITY_TYPE_SEEDS.length);
    expect(res.data!.created).toContain("Heist Completed");
    expect(await typeIds()).toEqual(defaultActivityTypes().map((t) => t.id).sort());
  });

  it("is idempotent — a second run adds nothing", async () => {
    await syncDefaultActivityTypes(ORG);
    const res = await syncDefaultActivityTypes(ORG);
    expect(res.data!.created).toEqual([]);
    expect(res.data!.alreadyPresent).toBe(defaultActivityTypes().length);
  });

  it("leaves an admin's edits to an existing type alone", async () => {
    await orgRef(ORG).collection("activityTypes").doc("club-ride").set({
      name: "Sunday Run",
      statKey: "clubRuns",
      requiresProof: false, // admin turned proof off
      allowQuantity: false,
      defaultQuantity: 1,
      icon: "bike",
      active: false, // and disabled it
      order: 1,
    });

    await syncDefaultActivityTypes(ORG);

    const doc = await orgRef(ORG).collection("activityTypes").doc("club-ride").get();
    expect(doc.data()?.name).toBe("Sunday Run");
    expect(doc.data()?.active).toBe(false);
    expect(doc.data()?.requiresProof).toBe(false);
  });

  it("hides retired club types without deleting their history", async () => {
    // A club still offering the old set, with a submission against one of them.
    await orgRef(ORG).collection("activityTypes").doc("territory-patrol").set({
      name: "Territory Patrol",
      statKey: "territoryPatrol",
      requiresProof: false,
      allowQuantity: false,
      defaultQuantity: 1,
      icon: "map",
      active: true,
      order: 7,
    });

    const res = await syncDefaultActivityTypes(ORG);
    expect(res.data!.retired).toBe(1);

    const doc = await orgRef(ORG).collection("activityTypes").doc("territory-patrol").get();
    // Still there — a past submission must still resolve a name — just hidden.
    expect(doc.exists).toBe(true);
    expect(doc.data()?.active).toBe(false);
    expect(doc.data()?.name).toBe("Territory Patrol");
  });

  it("swaps the orphaned patches for the criminal set", async () => {
    await orgRef(ORG).collection("patches").doc("night-watchman").set({
      name: "Night Watchman",
      category: "activity",
      description: "Complete 15 territory patrols.",
      tier: 1,
      requirement: { statKey: "territoryPatrol", threshold: 15 },
      manual: false,
      active: true,
      defaultPlacement: { surface: "back", u: 0.3, v: 0.72, scale: 0.8, rotationDeg: 0 },
    });

    const res = await syncDefaultActivityTypes(ORG);
    expect(res.data!.patchesRetired).toBe(1);
    expect(res.data!.patchesAdded).toHaveLength(CRIMINAL_PATCH_SEEDS.length);

    // Retired, not deleted: anyone who already earned it keeps it on their cut.
    const old = await orgRef(ORG).collection("patches").doc("night-watchman").get();
    expect(old.exists).toBe(true);
    expect(old.data()?.active).toBe(false);

    const added = await orgRef(ORG).collection("patches").doc("most-wanted").get();
    expect(added.data()?.requirement).toEqual({ statKey: "felonies", threshold: 100 });
    expect(added.data()?.active).toBe(true);
  });

  it("every retired id refers to something that once shipped", () => {
    // Guards against a typo silently retiring nothing.
    for (const id of RETIRED_ACTIVITY_TYPE_IDS) {
      expect(defaultActivityTypes().some((t) => t.id === id)).toBe(false);
    }
    expect(RETIRED_PATCH_IDS.length).toBeGreaterThan(0);
    for (const id of RETIRED_PATCH_IDS) {
      expect(CRIMINAL_PATCH_SEEDS.some((p) => p.id === id)).toBe(false);
    }
  });

  it("folds a legacy rap sheet into stats without clobbering logged ones", async () => {
    await orgRef(ORG).collection("members").doc("m1").set({
      uid: null,
      displayName: "Legacy Member",
      roadName: "Legacy",
      rankId: "patched",
      status: "patched",
      joinDate: Timestamp.now(),
      memberNumber: 1,
      patchCount: 0,
      createdAt: Timestamp.now(),
      // heistsCompleted already has an approved log behind it.
      stats: { clubRuns: 5, heistsCompleted: 2 },
      rapSheet: [
        { label: "Crimes Committed", value: "187" },
        { label: "Heists Completed", value: "12" },
        { label: "Jail Time Served", value: "96 mo" },
        { label: "Dirty Money Earned", value: "$2.4M" },
      ],
    });

    const res = await syncDefaultActivityTypes(ORG);
    expect(res.data!.membersMigrated).toBe(1);

    const stats = (await orgRef(ORG).collection("members").doc("m1").get()).data()!.stats;
    expect(stats.crimesCommitted).toBe(187);
    expect(stats.jailTimeMonths).toBe(96);
    expect(stats.dirtyMoneyEarned).toBe(2_400_000);
    expect(stats.heistsCompleted).toBe(2); // approved log wins over the typed value
    expect(stats.clubRuns).toBe(5); // untouched
  });

  describe("emblem migration", () => {
    /**
     * The live org ran the pre-emblem build: eight criminal patches exist
     * without the flag and are sitting on real cuts. The sync is the only way
     * those orgs get fixed — no CLI, no credentials — so it has to both flag
     * the docs and take them back off the vest.
     */
    // Read from the seed rather than hardcoded: thresholds are tuned to the
    // club's pace and expected to move, and this test is about the merge, not
    // about any particular number.
    const SEEDED_CORNER_BOY_THRESHOLD = CRIMINAL_PATCH_SEEDS.find(
      (p) => p.id === "corner-boy",
    )!.requirement.threshold;

    async function seedPreEmblemState() {
      // Two criminal patches as they shipped: no `emblem` field.
      for (const id of ["corner-boy", "the-cook"]) {
        const seed = CRIMINAL_PATCH_SEEDS.find((p) => p.id === id)!;
        await orgRef(ORG).collection("patches").doc(id).set({
          name: seed.name,
          category: seed.category,
          description: seed.description,
          tier: seed.tier,
          requirement: seed.requirement,
          manual: false,
          active: true,
          defaultPlacement: { surface: "back", u: 0.3, v: 0.62, scale: 0.8, rotationDeg: 0 },
        });
      }
      await orgRef(ORG).collection("cutLayouts").doc("m1").set({
        surfaces: {
          front: [
            { kind: "rankTab", refId: "rank", surface: "front", u: 0.5, v: 0.16, scale: 1, rotationDeg: 0, zIndex: 1, mirrored: false },
            { kind: "patch", refId: "road-warrior", surface: "front", u: 0.3, v: 0.42, scale: 0.8, rotationDeg: 0, zIndex: 2, mirrored: false },
          ],
          back: [
            { kind: "patch", refId: "corner-boy", surface: "back", u: 0.3, v: 0.62, scale: 0.8, rotationDeg: 0, zIndex: 1, mirrored: false },
            { kind: "patch", refId: "the-cook", surface: "back", u: 0.7, v: 0.62, scale: 0.8, rotationDeg: 0, zIndex: 2, mirrored: false },
          ],
        },
        updatedAt: Timestamp.now(),
      });
    }

    it("flags pre-emblem criminal patches without touching their content", async () => {
      await seedPreEmblemState();
      const res = await syncDefaultActivityTypes(ORG);

      expect(res.data!.emblemsMarked).toBe(2);
      const doc = (await orgRef(ORG).collection("patches").doc("corner-boy").get()).data()!;
      expect(doc.emblem).toBe(true);
      // Merge, not overwrite: the sync adds the flag and leaves everything the
      // org already had — including a threshold an admin has since retuned.
      expect(doc.name).toBe("Corner Boy");
      expect(doc.requirement.threshold).toBe(SEEDED_CORNER_BOY_THRESHOLD);
    });

    it("strips emblems off existing cuts and leaves real patches alone", async () => {
      await seedPreEmblemState();
      const res = await syncDefaultActivityTypes(ORG);

      expect(res.data!.cutsCleaned).toBe(1);
      const cut = (await orgRef(ORG).collection("cutLayouts").doc("m1").get()).data()!;
      expect(cut.surfaces.back).toEqual([]);
      // The rank tab and the club patch survive.
      expect(cut.surfaces.front.map((p: { refId: string }) => p.refId)).toEqual([
        "rank",
        "road-warrior",
      ]);
    });

    it("is idempotent — a second run changes nothing", async () => {
      await seedPreEmblemState();
      await syncDefaultActivityTypes(ORG);
      const second = await syncDefaultActivityTypes(ORG);

      expect(second.data!.emblemsMarked).toBe(0);
      expect(second.data!.laddersRetuned).toBe(0);
      expect(second.data!.cutsCleaned).toBe(0);
      expect(second.data!.patchesAdded).toHaveLength(0);
    });

    it("brings a stale threshold in line with the ladder", async () => {
      // The live case: an org carrying Corner Boy at its original 1,000 after
      // the ladder was retuned. Without this the org keeps a rung that asks for
      // more than the rung above it, and a description quoting a dead number.
      const seed = CRIMINAL_PATCH_SEEDS.find((p) => p.id === "corner-boy")!;
      await orgRef(ORG).collection("patches").doc("corner-boy").set({
        name: "Corner Boy",
        category: seed.category,
        description: "Move 1,000 drug sales.",
        tier: seed.tier,
        requirement: { statKey: "drugSales", threshold: 1_000 },
        manual: false,
        active: true,
        emblem: true, // already synced once
        defaultPlacement: { surface: "back", u: 0.3, v: 0.62, scale: 0.8, rotationDeg: 0 },
      });

      const res = await syncDefaultActivityTypes(ORG);
      expect(res.data!.emblemsMarked).toBe(0); // already flagged
      expect(res.data!.laddersRetuned).toBeGreaterThan(0);

      const doc = (await orgRef(ORG).collection("patches").doc("corner-boy").get()).data()!;
      expect(doc.requirement.threshold).toBe(seed.requirement.threshold);
      expect(doc.description).toBe(seed.description); // no longer quotes 1,000
    });

    it("leaves a renamed emblem's name alone while retuning it", async () => {
      const seed = CRIMINAL_PATCH_SEEDS.find((p) => p.id === "corner-boy")!;
      await orgRef(ORG).collection("patches").doc("corner-boy").set({
        name: "Block Runner", // the club renamed it
        category: seed.category,
        description: "Move 1,000 drug sales.",
        tier: seed.tier,
        requirement: { statKey: "drugSales", threshold: 1_000 },
        manual: false,
        active: true,
        emblem: true,
        defaultPlacement: { surface: "back", u: 0.3, v: 0.62, scale: 0.8, rotationDeg: 0 },
      });

      await syncDefaultActivityTypes(ORG);

      const doc = (await orgRef(ORG).collection("patches").doc("corner-boy").get()).data()!;
      expect(doc.name).toBe("Block Runner"); // theirs to keep
      expect(doc.requirement.threshold).toBe(seed.requirement.threshold); // ours to set
    });

    it("installs every new emblem already flagged", async () => {
      const res = await syncDefaultActivityTypes(ORG);
      expect(res.data!.patchesAdded).toHaveLength(CRIMINAL_PATCH_SEEDS.length);

      const snap = await orgRef(ORG).collection("patches").get();
      expect(snap.docs.every((d) => d.data().emblem === true)).toBe(true);
    });
  });
});
