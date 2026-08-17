/**
 * Discord command handler and interactions route against the Firestore
 * emulator (Admin SDK). Requires emulators running. Isolated org and project
 * id, same pattern as the engine tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { NextRequest } from "next/server";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "discord-test-isolated";
process.env.DISCORD_ORG_ID = "discord-test-org";

// Import AFTER env vars so the Admin SDK connects to the emulator.
const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { handleDiscordCommand } = await import("@/lib/discord/interactions");
const { POST } = await import("@/app/api/discord/interactions/route");

const ORG = "discord-test-org";

function cmd(
  name: string,
  options?: { name: string; type: number; value?: string | number | boolean }[],
) {
  return { type: 2, data: { name, options } };
}

beforeAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  const org = orgRef(ORG);
  await org.set({
    name: "Discord Test MC",
    slug: ORG,
    status: "active",
    memberCount: 1,
  });
  await org.collection("ranks").doc("president").set({
    name: "President",
    order: 1,
    isOfficer: true,
  });
  await org.collection("members").doc("m1").set({
    uid: "u1",
    displayName: "Marcus Vane",
    roadName: "Reaper",
    rankId: "president",
    status: "patched",
    joinDate: Timestamp.now(),
    memberNumber: 1,
    stats: {
      crimesCommitted: 187,
      dirtyMoneyEarned: 2_400_000,
      jailTimeMonths: 96,
      clubRuns: 31,
    },
    patchCount: 3,
    createdAt: Timestamp.now(),
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  delete process.env.DISCORD_PUBLIC_KEY;
});

describe("handleDiscordCommand", () => {
  it("answers ping", async () => {
    const res = await handleDiscordCommand(cmd("ping"));
    expect(res.type).toBe(4);
    expect(res.data?.content).toContain("Pong");
  });

  it("returns a member's record by road name, case-insensitively", async () => {
    const res = await handleDiscordCommand(
      cmd("mystats", [{ name: "member", type: 3, value: "reaper" }]),
    );
    const content = res.data?.content ?? "";
    expect(content).toContain('"Reaper" Marcus Vane');
    expect(content).toContain("Discord Test MC");
    expect(content).toContain("Rank: President");
    expect(content).toContain("Patches earned: 3");
    expect(content).toContain("Crimes Committed: 187");
    // The character screen's formatters, verbatim.
    expect(content).toContain("Dirty Money Earned: $2.4M");
    expect(content).toContain("Jail Time Served: 96 mo");
    expect(content).toContain("Club Runs: 31");
    // Ephemeral: only the invoker sees their lookup.
    expect(res.data?.flags).toBe(64);
  });

  it("finds a member by display name as a fallback", async () => {
    const res = await handleDiscordCommand(
      cmd("mystats", [{ name: "member", type: 3, value: "marcus vane" }]),
    );
    expect(res.data?.content).toContain('"Reaper" Marcus Vane');
  });

  it("says who it could not find", async () => {
    const res = await handleDiscordCommand(
      cmd("mystats", [{ name: "member", type: 3, value: "Ghost" }]),
    );
    expect(res.data?.content).toContain('No member named "Ghost"');
    expect(res.data?.content).toContain("Discord Test MC");
  });

  it("points at road-name lookup until linking exists", async () => {
    const res = await handleDiscordCommand(cmd("mystats"));
    expect(res.data?.content).toContain("road name");
  });

  it("fails closed when no org is configured", async () => {
    const saved = process.env.DISCORD_ORG_ID;
    delete process.env.DISCORD_ORG_ID;
    try {
      const res = await handleDiscordCommand(
        cmd("mystats", [{ name: "member", type: 3, value: "Reaper" }]),
      );
      expect(res.data?.content).toContain("not connected");
    } finally {
      process.env.DISCORD_ORG_ID = saved;
    }
  });

  it("rejects an unknown command", async () => {
    const res = await handleDiscordCommand(cmd("selfdestruct"));
    expect(res.data?.content).toBe("Unknown command.");
  });
});

describe("interactions route", () => {
  const keys = generateKeyPairSync("ed25519");
  const publicHex = keys.publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("hex");

  function signedRequest(rawBody: string, sigOverride?: string): NextRequest {
    const timestamp = "1723400000";
    const sig =
      sigOverride ??
      sign(null, Buffer.from(timestamp + rawBody), keys.privateKey).toString("hex");
    return new NextRequest("http://localhost/api/discord/interactions", {
      method: "POST",
      body: rawBody,
      headers: { "x-signature-ed25519": sig, "x-signature-timestamp": timestamp },
    });
  }

  it("fails closed when DISCORD_PUBLIC_KEY is not set", async () => {
    delete process.env.DISCORD_PUBLIC_KEY;
    const res = await POST(signedRequest('{"type":1}'));
    expect(res.status).toBe(503);
  });

  it("rejects a bad signature", async () => {
    process.env.DISCORD_PUBLIC_KEY = publicHex;
    const res = await POST(signedRequest('{"type":1}', "ab".repeat(64)));
    expect(res.status).toBe(401);
  });

  it("rejects an unsigned request", async () => {
    process.env.DISCORD_PUBLIC_KEY = publicHex;
    const res = await POST(
      new NextRequest("http://localhost/api/discord/interactions", {
        method: "POST",
        body: '{"type":1}',
      }),
    );
    expect(res.status).toBe(401);
  });

  it("answers Discord's validation handshake", async () => {
    process.env.DISCORD_PUBLIC_KEY = publicHex;
    const res = await POST(signedRequest('{"type":1}'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it("routes a signed slash command through the handler", async () => {
    process.env.DISCORD_PUBLIC_KEY = publicHex;
    const res = await POST(signedRequest('{"type":2,"data":{"name":"ping"}}'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.type).toBe(4);
    expect(json.data.content).toContain("Pong");
  });

  it("routes a signed autocomplete request", async () => {
    process.env.DISCORD_PUBLIC_KEY = publicHex;
    const res = await POST(
      signedRequest(
        '{"type":4,"data":{"name":"ticket","options":[{"name":"type","type":3,"value":"","focused":true}]}}',
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).type).toBe(8);
  });

  it("routes a signed component click", async () => {
    process.env.DISCORD_PUBLIC_KEY = publicHex;
    const res = await POST(
      signedRequest('{"type":3,"data":{"custom_id":"not-review"}}'),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.type).toBe(4);
    expect(json.data.content).toBe("Unsupported button.");
  });

  it("routes a signed modal submit", async () => {
    process.env.DISCORD_PUBLIC_KEY = publicHex;
    const res = await POST(
      signedRequest('{"type":5,"data":{"custom_id":"not-ours","components":[]}}'),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.type).toBe(4);
    expect(json.data.content).toBe("Unsupported form.");
  });
});
