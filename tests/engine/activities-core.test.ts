/**
 * Ticket core tests against the Firestore emulator (Admin SDK).
 * Requires emulators running. Uses an isolated org so app data is untouched.
 *
 * Covers the transport-neutral submit/deny pipeline the Server Actions wrap
 * (approval is covered by patch-engine.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SubmitActivityInput } from "@/lib/schemas/activity";

// Isolated project id — the emulator keys datastores by project, so these
// tests can never touch the app's seeded demo data.
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "activities-core-test-isolated";

// Import AFTER env vars so the Admin SDK connects to the emulator.
const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { submitActivityCore, denyActivityCore, SubmissionError, EngineError } =
  await import("@/lib/activities-core");

const ORG = "activities-core-test-org";
const ACTOR = { uid: "u1", memberId: "m1" };

/** Today's rate-limit doc for ACTOR — same day key the core builds. */
function capRef() {
  const day = new Date().toISOString().slice(0, 10);
  return adminDb.doc(`organizations/${ORG}/rateLimits/${ACTOR.uid}_submit_${day}`);
}

function ticket(overrides: Partial<SubmitActivityInput> = {}): SubmitActivityInput {
  return {
    orgId: ORG,
    entries: [{ typeId: "club-ride", quantity: 1 }],
    date: new Date(),
    description: "a test submission",
    witnesses: [],
    ...overrides,
  };
}

async function resetOrg() {
  await adminDb.recursiveDelete(orgRef(ORG));
  const org = orgRef(ORG);
  await org.set({ name: "Core Test", slug: ORG, memberCount: 1 });

  const types = [
    { id: "club-ride", name: "Club Ride", statKey: "clubRuns", allowQuantity: false },
    { id: "heist", name: "Heist", statKey: "heistsCompleted", allowQuantity: true },
    { id: "retired", name: "Retired Op", statKey: "operations", allowQuantity: true, active: false },
  ];
  for (const [i, t] of types.entries()) {
    await org.collection("activityTypes").doc(t.id).set({
      name: t.name,
      statKey: t.statKey,
      requiresProof: false,
      allowQuantity: t.allowQuantity,
      defaultQuantity: 1,
      icon: "bike",
      active: t.active ?? true,
      order: i + 1,
    });
  }

  await org.collection("members").doc("m1").set({
    uid: ACTOR.uid,
    displayName: "Test Member",
    roadName: "Testy",
    rankId: "prospect",
    status: "prospect",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    stats: { clubRuns: 9 },
    patchCount: 0,
    createdAt: Timestamp.now(),
  });

  // A pending ticket for the deny tests.
  await org.collection("activities").doc("a1").set({
    memberId: "m1",
    entries: [{ typeId: "club-ride", statKey: "clubRuns", quantity: 1 }],
    date: Timestamp.now(),
    description: "test ride",
    witnesses: [],
    status: "pending",
    createdAt: Timestamp.now(),
  });
}

beforeAll(resetOrg);
beforeEach(resetOrg);

afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
});

describe("submitActivityCore", () => {
  it("creates a pending ticket with the stat denormalized from the type", async () => {
    const { activityId } = await submitActivityCore(ACTOR, ticket());

    const doc = await orgRef(ORG).collection("activities").doc(activityId).get();
    expect(doc.exists).toBe(true);
    expect(doc.data()).toMatchObject({
      memberId: "m1",
      entries: [{ typeId: "club-ride", statKey: "clubRuns", quantity: 1 }],
      description: "a test submission",
      witnesses: [],
      status: "pending",
    });
    expect(doc.data()?.createdAt).toBeTruthy();

    const cap = await capRef().get();
    expect(cap.data()?.count).toBe(1);
  });

  it("forces quantity to 1 when the type disallows quantity", async () => {
    const { activityId } = await submitActivityCore(
      ACTOR,
      ticket({ entries: [{ typeId: "club-ride", quantity: 5 }] }),
    );
    const doc = await orgRef(ORG).collection("activities").doc(activityId).get();
    expect(doc.data()?.entries).toEqual([
      { typeId: "club-ride", statKey: "clubRuns", quantity: 1 },
    ]);
  });

  it("keeps the quantity on a quantity-enabled type", async () => {
    const { activityId } = await submitActivityCore(
      ACTOR,
      ticket({ entries: [{ typeId: "heist", quantity: 12 }] }),
    );
    const doc = await orgRef(ORG).collection("activities").doc(activityId).get();
    expect(doc.data()?.entries).toEqual([
      { typeId: "heist", statKey: "heistsCompleted", quantity: 12 },
    ]);
  });

  it("carries several types on one ticket", async () => {
    const { activityId } = await submitActivityCore(
      ACTOR,
      ticket({
        entries: [
          { typeId: "club-ride", quantity: 1 },
          { typeId: "heist", quantity: 3 },
        ],
      }),
    );
    const doc = await orgRef(ORG).collection("activities").doc(activityId).get();
    expect(doc.data()?.entries).toEqual([
      { typeId: "club-ride", statKey: "clubRuns", quantity: 1 },
      { typeId: "heist", statKey: "heistsCompleted", quantity: 3 },
    ]);
  });

  it("rejects an unknown type before anything is written", async () => {
    // One valid entry alongside the bad one: validation is all-before-any.
    await expect(
      submitActivityCore(
        ACTOR,
        ticket({
          entries: [
            { typeId: "club-ride", quantity: 1 },
            { typeId: "no-such-type", quantity: 1 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ name: "SubmissionError", code: "unknown_type" });

    const activities = await orgRef(ORG).collection("activities").get();
    expect(activities.docs.map((d) => d.id)).toEqual(["a1"]); // only the seeded one
    expect((await capRef().get()).exists).toBe(false); // no slot burned
  });

  it("rejects a disabled type and names it", async () => {
    await expect(
      submitActivityCore(ACTOR, ticket({ entries: [{ typeId: "retired", quantity: 1 }] })),
    ).rejects.toMatchObject({ code: "type_disabled", detail: "Retired Op" });
    expect((await capRef().get()).exists).toBe(false);
  });

  it("stops the submission over the daily cap", async () => {
    await capRef().set({ count: 20 });

    await expect(submitActivityCore(ACTOR, ticket())).rejects.toMatchObject({
      name: "SubmissionError",
      code: "daily_limit",
    });

    const activities = await orgRef(ORG).collection("activities").get();
    expect(activities.docs.map((d) => d.id)).toEqual(["a1"]);
    expect((await capRef().get()).data()?.count).toBe(20); // not bumped past the cap
  });

  it("is an instance the transport can catch", async () => {
    await expect(
      submitActivityCore(ACTOR, ticket({ entries: [{ typeId: "nope", quantity: 1 }] })),
    ).rejects.toBeInstanceOf(SubmissionError);
  });
});

describe("denyActivityCore", () => {
  it("flips pending to denied with reviewer stamp and audit log", async () => {
    await denyActivityCore(ORG, "a1", "officer-uid", "not enough proof");

    const doc = await orgRef(ORG).collection("activities").doc("a1").get();
    expect(doc.data()).toMatchObject({
      status: "denied",
      reviewedBy: "officer-uid",
      reviewNote: "not enough proof",
    });
    expect(doc.data()?.reviewedAt).toBeTruthy();

    const audits = await orgRef(ORG).collection("auditLogs").get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0].data()).toMatchObject({
      actorUid: "officer-uid",
      action: "activity.deny",
      detail: "not enough proof",
    });
    expect(audits.docs[0].data().targetPath.endsWith("/activities/a1")).toBe(true);
  });

  it("never touches member stats", async () => {
    await denyActivityCore(ORG, "a1", "officer-uid");
    const member = await orgRef(ORG).collection("members").doc("m1").get();
    expect(member.data()?.stats).toEqual({ clubRuns: 9 });
    expect(member.data()?.patchCount).toBe(0);
  });

  it("rejects a second review of the same ticket", async () => {
    await denyActivityCore(ORG, "a1", "officer-uid");
    await expect(denyActivityCore(ORG, "a1", "officer-uid")).rejects.toMatchObject({
      name: "EngineError",
      code: "not_pending",
    });
  });

  it("throws activity_not_found for a missing ticket", async () => {
    await expect(denyActivityCore(ORG, "ghost", "officer-uid")).rejects.toBeInstanceOf(
      EngineError,
    );
  });
});
