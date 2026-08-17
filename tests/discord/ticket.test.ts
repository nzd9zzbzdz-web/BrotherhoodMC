/**
 * /ticket from Discord: command → modal → submission through the same core
 * the website's Server Action wraps. Against the Firestore emulator; isolated
 * project and org, same pattern as the other Discord tests.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "discord-ticket-test-isolated";
process.env.DISCORD_ORG_ID = "discord-ticket-test-org";

// Import AFTER env vars so the Admin SDK connects to the emulator.
const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { handleDiscordCommand, handleAutocomplete, handleModalSubmit } = await import(
  "@/lib/discord/interactions"
);

const ORG = "discord-ticket-test-org";
const LINKED = { id: "D1", username: "reaper_rides" };

function ticketCmd(
  typeValue: string,
  user: { id: string; username?: string } = LINKED,
) {
  return {
    type: 2,
    data: { name: "ticket", options: [{ name: "type", type: 3, value: typeValue }] },
    member: { user },
  };
}

function modalSubmit(
  typeId: string,
  fields: Record<string, string>,
  user: { id: string; username?: string } = LINKED,
) {
  return {
    type: 5,
    data: {
      custom_id: `ticket:${typeId}`,
      components: Object.entries(fields).map(([custom_id, value]) => ({
        type: 1,
        components: [{ type: 4, custom_id, value }],
      })),
    },
    member: { user },
  };
}

async function wipe(collection: string) {
  const snap = await adminDb.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await wipe("users");

  const org = orgRef(ORG);
  await org.set({ name: "Ticket Test MC", slug: ORG, status: "active", memberCount: 1 });

  await org.collection("activityTypes").doc("drug-sale").set({
    name: "Drug Sale",
    statKey: "drugSales",
    requiresProof: false,
    allowQuantity: true,
    defaultQuantity: 1,
    icon: "pill",
    active: true,
    order: 1,
  });
  await org.collection("activityTypes").doc("club-ride").set({
    name: "Club Ride",
    statKey: "clubRuns",
    requiresProof: false,
    allowQuantity: false,
    defaultQuantity: 1,
    icon: "bike",
    active: true,
    order: 2,
  });
  await org.collection("activityTypes").doc("retired-op").set({
    name: "Retired Op",
    statKey: "operations",
    requiresProof: false,
    allowQuantity: true,
    defaultQuantity: 1,
    icon: "ghost",
    active: false,
    order: 3,
  });

  await org.collection("members").doc("m1").set({
    uid: "u1",
    displayName: "Marcus Vane",
    roadName: "Reaper",
    rankId: "president",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    stats: {},
    patchCount: 0,
    createdAt: Timestamp.now(),
  });
  await adminDb.collection("users").doc("u1").set({
    email: "reaper@test.rp",
    displayName: "Marcus Vane",
    memberships: { [ORG]: { memberId: "m1", role: "member" } },
    discordId: LINKED.id,
    discordUsername: LINKED.username,
    createdAt: Timestamp.now(),
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await wipe("users");
});

describe("/ticket command", () => {
  it("answers with a modal for a quantity type", async () => {
    const res = await handleDiscordCommand(ticketCmd("drug-sale"));
    expect(res.type).toBe(9); // modal
    // The club rides in the id so the submit cannot land on the wrong club
    // in a server that hosts several.
    expect(res.data?.custom_id).toBe(`ticket:${ORG}:drug-sale`);
    expect(res.data?.title).toContain("Drug Sale");

    // /ticket opens the same dialog as the channel card, so the fields are
    // Label-wrapped (Action Rows around modal inputs are deprecated) and the
    // witness picker comes along too.
    const parts = res.data?.components as {
      type: number;
      component: { custom_id: string };
    }[];
    expect(parts.every((p) => p.type === 18)).toBe(true);
    expect(parts.map((p) => p.component.custom_id)).toEqual([
      "quantity",
      "description",
      "witnesses",
    ]);
  });

  it("omits the quantity input when the type disallows it", async () => {
    const res = await handleDiscordCommand(ticketCmd("club-ride"));
    const parts = res.data?.components as { component: { custom_id: string } }[];
    expect(parts.map((p) => p.component.custom_id)).toEqual([
      "description",
      "witnesses",
    ]);
  });

  it("matches a hand-typed name as a courtesy", async () => {
    const res = await handleDiscordCommand(ticketCmd("drug sale"));
    expect(res.data?.custom_id).toBe(`ticket:${ORG}:drug-sale`);
  });

  it("refuses unknown and disabled types", async () => {
    const unknown = await handleDiscordCommand(ticketCmd("no-such-type"));
    expect(unknown.data?.content).toContain("Pick an activity type");
    const disabled = await handleDiscordCommand(ticketCmd("retired-op"));
    expect(disabled.data?.content).toContain("Pick an activity type");
  });

  it("requires a linked account", async () => {
    const res = await handleDiscordCommand(ticketCmd("drug-sale", { id: "D404" }));
    expect(res.data?.content).toContain("/link");
    expect(res.type).toBe(4); // reply, not a modal
  });
});

describe("autocomplete", () => {
  it("suggests active types matching the typed fragment", async () => {
    const res = await handleAutocomplete({
      type: 4,
      data: {
        name: "ticket",
        options: [{ name: "type", type: 3, value: "dru", focused: true }],
      },
    });
    expect(res.type).toBe(8);
    expect(res.data?.choices).toEqual([{ name: "Drug Sale", value: "drug-sale" }]);
  });

  it("lists every active type for an empty fragment and hides retired ones", async () => {
    const res = await handleAutocomplete({
      type: 4,
      data: {
        name: "ticket",
        options: [{ name: "type", type: 3, value: "", focused: true }],
      },
    });
    const names = (res.data?.choices as { name: string }[]).map((c) => c.name);
    expect(names.sort()).toEqual(["Club Ride", "Drug Sale"]);
  });
});

describe("modal submit", () => {
  it("files a pending ticket through the shared core", async () => {
    const res = await handleModalSubmit(
      modalSubmit("drug-sale", {
        quantity: "20",
        description: "moved product across the docks",
      }),
    );
    expect(res.data?.content).toContain("Ticket filed: Drug Sale ×20");

    const activities = await orgRef(ORG).collection("activities").get();
    expect(activities.size).toBe(1);
    expect(activities.docs[0].data()).toMatchObject({
      memberId: "m1",
      entries: [{ typeId: "drug-sale", statKey: "drugSales", quantity: 20 }],
      description: "moved product across the docks",
      witnesses: [],
      status: "pending",
    });

    // Shares the website's daily allowance, keyed by the same uid.
    const day = new Date().toISOString().slice(0, 10);
    const cap = await adminDb
      .doc(`organizations/${ORG}/rateLimits/u1_submit_${day}`)
      .get();
    expect(cap.data()?.count).toBe(1);
  });

  it("forgives thousands separators in quantity", async () => {
    await handleModalSubmit(
      modalSubmit("drug-sale", {
        quantity: "2,400",
        description: "a very good week for business",
      }),
    );
    const activities = await orgRef(ORG).collection("activities").get();
    expect(activities.docs[0].data().entries[0].quantity).toBe(2400);
  });

  it("rejects a garbage quantity without writing", async () => {
    const res = await handleModalSubmit(
      modalSubmit("drug-sale", { quantity: "lots", description: "counting is hard today" }),
    );
    expect(res.data?.content).toContain("whole number");
    expect((await orgRef(ORG).collection("activities").get()).size).toBe(0);
  });

  it("rejects a short description with the website's own message", async () => {
    const res = await handleModalSubmit(
      modalSubmit("drug-sale", { quantity: "1", description: "short" }),
    );
    expect(res.data?.content).toContain("Describe what happened");
    expect((await orgRef(ORG).collection("activities").get()).size).toBe(0);
  });

  it("honors the shared daily cap", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await adminDb
      .doc(`organizations/${ORG}/rateLimits/u1_submit_${day}`)
      .set({ count: 20 });
    const res = await handleModalSubmit(
      modalSubmit("drug-sale", { quantity: "1", description: "one deal too many today" }),
    );
    expect(res.data?.content).toBe("Daily submission limit reached");
    expect((await orgRef(ORG).collection("activities").get()).size).toBe(0);
  });

  it("requires a linked account", async () => {
    const res = await handleModalSubmit(
      modalSubmit(
        "drug-sale",
        { quantity: "1", description: "an unlinked stranger appears" },
        { id: "D404" },
      ),
    );
    expect(res.data?.content).toContain("Link your Discord account");
    expect((await orgRef(ORG).collection("activities").get()).size).toBe(0);
  });

  it("ignores forms it did not open", async () => {
    const res = await handleModalSubmit({
      type: 5,
      data: { custom_id: "somebody-elses-form", components: [] },
      member: { user: LINKED },
    });
    expect(res.data?.content).toBe("Unsupported form.");
  });
});
