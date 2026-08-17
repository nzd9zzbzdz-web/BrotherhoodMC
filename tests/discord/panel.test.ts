/**
 * The in-channel Activity Logger: the card, the per-category form dialog, and
 * filing through it (including witnesses picked from the member list).
 *
 * The payload SHAPES are pinned hard here because Discord rejects a malformed
 * one silently from the user's point of view: the dialog simply never opens.
 *
 * Against the Firestore emulator; isolated project.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "discord-panel-test-isolated";
process.env.DISCORD_ORG_ID = "panel-test-org";

// Import AFTER env vars so the Admin SDK connects to the emulator.
const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { handleDiscordCommand, handleComponent, handleModalSubmit } = await import(
  "@/lib/discord/interactions"
);
const { hexToInt } = await import("@/lib/discord/panel");

const ORG = "panel-test-org";
const ADMIN = { id: "D-admin" };
const MEMBER = { id: "D-member" };

function cmd(name: string, user: { id: string }, options?: unknown[]) {
  return {
    type: 2,
    guild_id: "G1",
    data: { name, options: options as never },
    member: { user },
  };
}

/** A Label-wrapped modal answer, the shape Discord actually submits. */
function label(customId: string, value?: string, values?: string[]) {
  return {
    type: 18,
    component: { type: 4, custom_id: customId, value, values },
  };
}

async function wipe(collection: string) {
  const snap = await adminDb.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await wipe("users");
  await wipe("discordClubs");

  await orgRef(ORG).set({
    name: "Panel MC",
    slug: ORG,
    status: "active",
    memberCount: 2,
  });
  await orgRef(ORG).collection("branding").doc("portal").set({
    colors: { primary: "#8B0000" },
    fonts: { display: "var(--font-blackletter)", body: "var(--font-inter)" },
    orgDisplayName: "Panel MC",
  });

  const types = [
    { id: "drug-sale", name: "Drug Sale", statKey: "drugSales", allowQuantity: true, active: true },
    { id: "club-ride", name: "Club Ride", statKey: "clubRuns", allowQuantity: false, active: true },
    { id: "retired-op", name: "Retired Op", statKey: "operations", allowQuantity: true, active: false },
  ];
  for (const [i, t] of types.entries()) {
    await orgRef(ORG).collection("activityTypes").doc(t.id).set({
      name: t.name,
      statKey: t.statKey,
      requiresProof: false,
      allowQuantity: t.allowQuantity,
      defaultQuantity: 1,
      icon: "pill",
      active: t.active,
      order: i + 1,
    });
  }

  await orgRef(ORG).collection("members").doc("m-admin").set({
    uid: "u-admin", displayName: "Marcus Vane", roadName: "Reaper",
    rankId: "president", status: "patched", joinDate: Timestamp.now(),
    memberNumber: 1, stats: {}, patchCount: 0, createdAt: Timestamp.now(),
  });
  await orgRef(ORG).collection("members").doc("m-member").set({
    uid: "u-member", displayName: "Ray Books", roadName: "Ledger",
    rankId: "member", status: "patched", joinDate: Timestamp.now(),
    memberNumber: 2, stats: {}, patchCount: 0, createdAt: Timestamp.now(),
  });

  await adminDb.collection("users").doc("u-admin").set({
    email: "a@test.rp", displayName: "Marcus Vane",
    memberships: { [ORG]: { memberId: "m-admin", role: "admin" } },
    discordId: ADMIN.id, createdAt: Timestamp.now(),
  });
  await adminDb.collection("users").doc("u-member").set({
    email: "m@test.rp", displayName: "Ray Books",
    memberships: { [ORG]: { memberId: "m-member", role: "member" } },
    discordId: MEMBER.id, createdAt: Timestamp.now(),
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await wipe("users");
  await wipe("discordClubs");
});

describe("/connect posting the card", () => {
  /** Stub Discord's REST: message create, then the pin. */
  function stubDiscord(opts: { postOk?: boolean; pinOk?: boolean } = {}) {
    const { postOk = true, pinOk = true } = opts;
    const calls: { url: string; method?: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        calls.push({ url: href, method: init?.method, body: init?.body as string });
        if (href.includes("/pins/")) {
          // A 204 must carry a null body; passing "" makes Response throw.
          return pinOk
            ? new Response(null, { status: 204 })
            : new Response("forbidden", { status: 403 });
        }
        return postOk
          ? new Response(JSON.stringify({ id: "msg-1" }), { status: 200 })
          : new Response("forbidden", { status: 403 });
      }),
    );
    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DISCORD_BOT_TOKEN;
  });

  function connect(options: { name: string; type: number; value: string }[]) {
    return {
      type: 2,
      guild_id: "G1",
      data: { name: "connect", options },
      member: { user: ADMIN },
    };
  }

  it("posts and pins the card in the named tickets channel", async () => {
    process.env.DISCORD_BOT_TOKEN = "tok";
    const calls = stubDiscord();

    const res = await handleDiscordCommand(
      connect([
        { name: "channel", type: 7, value: "C-review" },
        { name: "tickets", type: 7, value: "C-tickets" },
      ]),
    );
    expect(res.data?.content).toContain("posted and pinned in <#C-tickets>");

    // The card went to the tickets channel, carrying the V2 flag.
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toContain("/channels/C-tickets/messages");
    expect(JSON.parse(post.body!).flags).toBe(32768);
    // And it was pinned.
    expect(calls.some((c) => c.url.includes("/pins/msg-1"))).toBe(true);

    // Both channels are remembered on the binding.
    const binding = await adminDb.collection("discordClubs").doc(ORG).get();
    expect(binding.data()).toMatchObject({
      officerChannelId: "C-review",
      ticketChannelId: "C-tickets",
    });
  });

  it("still reports success when it cannot pin", async () => {
    process.env.DISCORD_BOT_TOKEN = "tok";
    stubDiscord({ pinOk: false });
    const res = await handleDiscordCommand(
      connect([{ name: "tickets", type: 7, value: "C-tickets" }]),
    );
    expect(res.data?.content).toContain("could not be pinned");
    expect(res.data?.content).toContain("Manage Messages");
  });

  it("says so when Discord refuses the card", async () => {
    process.env.DISCORD_BOT_TOKEN = "tok";
    stubDiscord({ postOk: false });
    const res = await handleDiscordCommand(
      connect([{ name: "tickets", type: 7, value: "C-locked" }]),
    );
    expect(res.data?.content).toContain("cannot post in that channel");
    expect(res.data?.content).toContain("/panel");
  });

  it("prompts for a tickets channel when none is given, and posts nothing", async () => {
    process.env.DISCORD_BOT_TOKEN = "tok";
    const calls = stubDiscord();
    const res = await handleDiscordCommand(
      connect([{ name: "channel", type: 7, value: "C-review" }]),
    );
    expect(res.data?.content).toContain("Add tickets:<channel>");
    expect(calls).toHaveLength(0);
  });
});

describe("hexToInt", () => {
  it("converts a hex colour and refuses anything else", () => {
    expect(hexToInt("#8B0000")).toBe(0x8b0000);
    expect(hexToInt("8B0000")).toBe(0x8b0000);
    expect(hexToInt("rgba(139,0,0,0.5)")).toBeNull();
    expect(hexToInt(undefined)).toBeNull();
  });
});

describe("/panel", () => {
  it("posts a Components V2 card carrying only the active types", async () => {
    const res = await handleDiscordCommand(cmd("panel", ADMIN));
    expect(res.type).toBe(4);
    // The V2 flag, without which the container silently renders as nothing.
    expect(res.data?.flags).toBe(32768);

    const container = (res.data?.components as Record<string, unknown>[])[0];
    expect(container.type).toBe(17);
    expect(container.accent_color).toBe(0x8b0000); // the club's own colour

    const kids = container.components as Record<string, unknown>[];
    expect(kids[0].type).toBe(10); // text display
    expect(String(kids[0].content)).toContain("Activity Logger");
    expect(String(kids[0].content)).toContain("Panel MC");
    expect(kids[1].type).toBe(14); // separator

    const row = kids[2] as { type: number; components: Record<string, unknown>[] };
    expect(row.type).toBe(1);
    const select = row.components[0] as {
      type: number;
      custom_id: string;
      options: { label: string; value: string; description?: string }[];
    };
    expect(select.type).toBe(3);
    expect(select.custom_id).toBe(`panel:${ORG}`);
    expect(select.options.map((o) => o.value)).toEqual(["drug-sale", "club-ride"]);
    // The quantity hint rides on the option that takes one.
    expect(select.options[0].description).toBe("Takes an amount");
    expect(select.options[1].description).toBeUndefined();
  });

  it("is refused to a member who is not an admin", async () => {
    const res = await handleDiscordCommand(cmd("panel", MEMBER));
    expect(res.data?.content).toContain("Only a club admin");
  });

  it("is refused in a DM", async () => {
    const res = await handleDiscordCommand({
      type: 2,
      data: { name: "panel" },
      member: { user: ADMIN },
    });
    expect(res.data?.content).toContain("the channel where the card should live");
  });
});

describe("the card's dropdown", () => {
  function pick(typeId: string, user = MEMBER) {
    return {
      type: 3,
      guild_id: "G1",
      data: { custom_id: `panel:${ORG}`, values: [typeId] },
      member: { user },
    };
  }

  it("opens a Label-wrapped dialog with quantity for a quantity type", async () => {
    const res = await handleComponent(pick("drug-sale"));
    expect(res.type).toBe(9); // modal
    expect(res.data?.custom_id).toBe(`panelform:${ORG}:drug-sale`);
    expect(String(res.data?.title)).toContain("Drug Sale");

    const parts = res.data?.components as {
      type: number;
      label: string;
      component: { type: number; custom_id: string };
    }[];
    // Every field is a Label (18) wrapping ONE input, the current shape.
    expect(parts.every((p) => p.type === 18)).toBe(true);
    expect(parts.map((p) => p.component.custom_id)).toEqual([
      "quantity",
      "description",
      "witnesses",
    ]);
    expect(parts[0].component.type).toBe(4); // text input
    expect(parts[2].component.type).toBe(5); // user select, the member picker
    // Discord errors on a disabled component inside a modal.
    expect(JSON.stringify(parts)).not.toContain("disabled");
  });

  it("omits quantity for a type that does not take one", async () => {
    const res = await handleComponent(pick("club-ride"));
    const parts = res.data?.components as { component: { custom_id: string } }[];
    expect(parts.map((p) => p.component.custom_id)).toEqual([
      "description",
      "witnesses",
    ]);
  });

  it("refuses a retired category and an unlinked clicker", async () => {
    const retired = await handleComponent(pick("retired-op"));
    expect(retired.data?.content).toContain("no longer active");

    const stranger = await handleComponent(pick("drug-sale", { id: "D-nobody" }));
    expect(stranger.data?.content).toContain("/link");
  });
});

describe("filing from the card", () => {
  function submit(fields: ReturnType<typeof label>[]) {
    return {
      type: 5,
      guild_id: "G1",
      data: { custom_id: `panelform:${ORG}:drug-sale`, components: fields },
      member: { user: MEMBER },
    };
  }

  it("files the ticket and records witnesses picked from the server", async () => {
    const res = await handleModalSubmit(
      submit([
        label("quantity", "20"),
        label("description", "moved product across the docks"),
        // The admin is linked and rides with this club, so they resolve.
        label("witnesses", undefined, [ADMIN.id]),
      ]),
    );
    expect(res.data?.content).toContain("Ticket filed: Drug Sale ×20");
    expect(res.data?.content).not.toContain("could not be recorded");

    const activities = await orgRef(ORG).collection("activities").get();
    expect(activities.size).toBe(1);
    expect(activities.docs[0].data()).toMatchObject({
      memberId: "m-member",
      entries: [{ typeId: "drug-sale", statKey: "drugSales", quantity: 20 }],
      description: "moved product across the docks",
      witnesses: ["m-admin"], // the Discord id became a club member id
      status: "pending",
    });
  });

  it("says so when a picked witness cannot be recorded", async () => {
    const res = await handleModalSubmit(
      submit([
        label("quantity", "1"),
        label("description", "a quiet night on the corner"),
        label("witnesses", undefined, [ADMIN.id, "D-stranger"]),
      ]),
    );
    expect(res.data?.content).toContain("1 witness could not be recorded");
    const activities = await orgRef(ORG).collection("activities").get();
    expect(activities.docs[0].data().witnesses).toEqual(["m-admin"]);
  });

  it("files with no witnesses at all", async () => {
    const res = await handleModalSubmit(
      submit([label("quantity", "2"), label("description", "worked alone tonight")]),
    );
    expect(res.data?.content).toContain("Ticket filed");
    const activities = await orgRef(ORG).collection("activities").get();
    expect(activities.docs[0].data().witnesses).toEqual([]);
  });

  it("applies the website's own validation", async () => {
    const short = await handleModalSubmit(
      submit([label("quantity", "1"), label("description", "short")]),
    );
    expect(short.data?.content).toContain("Describe what happened");

    const junk = await handleModalSubmit(
      submit([label("quantity", "lots"), label("description", "counting is hard")]),
    );
    expect(junk.data?.content).toContain("whole number");
    expect((await orgRef(ORG).collection("activities").get()).size).toBe(0);
  });
});
