/**
 * The officer-channel notification: payload shape (pure) and the send gating
 * (fetch stubbed; nothing leaves the process). The channel now resolves
 * through guild bindings, so this file needs the emulator like its siblings.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "discord-notify-test-isolated";

// Import AFTER env vars so the Admin SDK connects to the emulator.
const { adminDb } = await import("@/lib/firebase/admin");
const { buildTicketMessage, notifyTicketSubmitted } = await import(
  "@/lib/discord/notify"
);

const NOTICE = {
  activityId: "a1",
  orgId: "org-1",
  memberLabel: '"Reaper" Marcus Vane',
  summary: "Drug Sale ×20",
  description: "moved product across the docks",
};

async function wipeGuilds() {
  const snap = await adminDb.collection("discordClubs").get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

describe("buildTicketMessage", () => {
  it("carries the summary, the club, and both review buttons", () => {
    const msg = buildTicketMessage(NOTICE) as {
      content: string;
      components: { components: { custom_id: string; label: string }[] }[];
    };
    expect(msg.content).toContain('"Reaper" Marcus Vane');
    expect(msg.content).toContain("Drug Sale ×20");
    expect(msg.content).toContain("> moved product across the docks");

    const buttons = msg.components[0].components;
    expect(buttons.map((b) => b.label)).toEqual(["Approve", "Deny"]);
    // The club rides in the id: one server can host several clubs, so the
    // guild a button is clicked in cannot say which club it belongs to.
    expect(buttons.map((b) => b.custom_id)).toEqual([
      "review:approve:org-1:a1",
      "review:deny:org-1:a1",
    ]);
  });

  it("truncates a run-on description", () => {
    const msg = buildTicketMessage({
      ...NOTICE,
      description: "x".repeat(600),
    }) as { content: string };
    expect(msg.content).toContain(`${"x".repeat(500)}...`);
    expect(msg.content).not.toContain("x".repeat(501));
  });
});

describe("notifyTicketSubmitted", () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  const savedEnv = { ...process.env };

  beforeEach(async () => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    process.env.DISCORD_BOT_TOKEN = "token";
    process.env.DISCORD_OFFICER_CHANNEL_ID = "chan-1";
    process.env.DISCORD_ORG_ID = "org-1";
    await wipeGuilds();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.DISCORD_BOT_TOKEN = savedEnv.DISCORD_BOT_TOKEN;
    process.env.DISCORD_OFFICER_CHANNEL_ID = savedEnv.DISCORD_OFFICER_CHANNEL_ID;
    process.env.DISCORD_ORG_ID = savedEnv.DISCORD_ORG_ID;
  });

  afterAll(wipeGuilds);

  it("posts to the env fallback channel for the pinned club", async () => {
    await notifyTicketSubmitted("org-1", NOTICE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://discord.com/api/v10/channels/chan-1/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bot token");
    expect(JSON.parse(init.body as string).content).toContain("Drug Sale ×20");
  });

  it("prefers the club's own bound officer channel", async () => {
    await adminDb.collection("discordClubs").doc("org-2").set({
      guildId: "G-2",
      officerChannelId: "chan-9",
    });
    await notifyTicketSubmitted("org-2", { ...NOTICE, orgId: "org-2" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://discord.com/api/v10/channels/chan-9/messages");
  });

  it("skips a club with no channel anywhere", async () => {
    await notifyTicketSubmitted("some-other-org", NOTICE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips silently without a bot token, before any lookup", async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    await notifyTicketSubmitted("org-1", NOTICE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws on a Discord failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    await expect(notifyTicketSubmitted("org-1", NOTICE)).resolves.toBeUndefined();
  });

  it("never throws on a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(notifyTicketSubmitted("org-1", NOTICE)).resolves.toBeUndefined();
  });
});
