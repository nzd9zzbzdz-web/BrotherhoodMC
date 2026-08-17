/**
 * Multi-club support: /connect bringing clubs into ONE network server, club
 * resolution from the caller's own membership, per-club officer permissions
 * and channels, and the cross-club global leaderboard.
 *
 * The shape this models is the real one: a single Discord server with a
 * private category per club, which is why almost every case here puts both
 * clubs in the same guild. Against the Firestore emulator; isolated project.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "discord-guild-test-isolated";
delete process.env.DISCORD_ORG_ID; // a bound network server needs no env pin

// Import AFTER env vars so the Admin SDK connects to the emulator.
const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { handleDiscordCommand, handleComponent, handleAutocomplete, handleModalSubmit } =
  await import("@/lib/discord/interactions");
const { getClubBinding, officerChannelFor } = await import("@/lib/discord/guilds");

const ORG_A = "org-a";
const ORG_B = "org-b";
const NETWORK = "G-NET"; // the one server both clubs ride in

function cmd(
  name: string,
  opts: {
    guildId?: string;
    options?: { name: string; type: number; value?: string }[];
    user?: { id: string };
  } = {},
) {
  return {
    type: 2,
    data: { name, options: opts.options },
    ...(opts.guildId ? { guild_id: opts.guildId } : {}),
    member: opts.user ? { user: opts.user } : undefined,
  };
}

async function wipe(collection: string) {
  const snap = await adminDb.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function seedMember(
  orgId: string,
  id: string,
  n: number,
  roadName: string,
  drugSales: number,
  status = "patched",
) {
  await orgRef(orgId).collection("members").doc(id).set({
    uid: `u-${id}`,
    displayName: `Rider ${roadName}`,
    roadName,
    rankId: "president",
    status,
    joinDate: Timestamp.now(),
    memberNumber: n,
    stats: { drugSales },
    patchCount: 0,
    createdAt: Timestamp.now(),
  });
}

async function seedUser(
  uid: string,
  discordId: string,
  memberships: Record<string, { memberId: string; role: string }>,
) {
  await adminDb.collection("users").doc(uid).set({
    email: `${uid}@test.rp`,
    displayName: uid,
    memberships,
    discordId,
    createdAt: Timestamp.now(),
  });
}

/** Put both clubs in the network server, the layout this feature is for. */
async function bindBothToNetwork() {
  await adminDb.collection("discordClubs").doc(ORG_A).set({
    guildId: NETWORK,
    officerChannelId: "C-ravens-review",
  });
  await adminDb.collection("discordClubs").doc(ORG_B).set({
    guildId: NETWORK,
    officerChannelId: "C-bravo-review",
  });
}

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG_A));
  await adminDb.recursiveDelete(orgRef(ORG_B));
  await wipe("users");
  await wipe("discordClubs");

  await orgRef(ORG_A).set({
    name: "Alpha MC",
    slug: ORG_A,
    status: "active",
    memberCount: 2,
  });
  await orgRef(ORG_B).set({
    name: "Bravo MC",
    slug: ORG_B,
    status: "active",
    memberCount: 2,
  });

  await seedMember(ORG_A, "ma", 1, "Alpha One", 100);
  await seedMember(ORG_A, "ma2", 2, "Alpha Two", 50);
  await seedMember(ORG_B, "mb", 1, "Bravo One", 70);
  await seedMember(ORG_B, "mb-gone", 2, "Bravo Ghost", 999, "retired");

  for (const orgId of [ORG_A, ORG_B]) {
    await orgRef(orgId).collection("activityTypes").doc("drug-sale").set({
      name: "Drug Sale",
      statKey: "drugSales",
      requiresProof: false,
      allowQuantity: true,
      defaultQuantity: 1,
      icon: "pill",
      active: true,
      order: 1,
    });
  }

  // DA administers Alpha; DB officers Bravo; DM is a plain Alpha member.
  await seedUser("uA", "DA", { [ORG_A]: { memberId: "ma", role: "admin" } });
  await seedUser("uB", "DB", { [ORG_B]: { memberId: "mb", role: "officer" } });
  await seedUser("uM", "DM", { [ORG_A]: { memberId: "ma2", role: "member" } });

  await orgRef(ORG_B).collection("activities").doc("b1").set({
    memberId: "mb",
    entries: [{ typeId: "drug-sale", statKey: "drugSales", quantity: 5 }],
    date: Timestamp.now(),
    description: "bravo business",
    witnesses: [],
    status: "pending",
    createdAt: Timestamp.now(),
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG_A));
  await adminDb.recursiveDelete(orgRef(ORG_B));
  await wipe("users");
  await wipe("discordClubs");
});

describe("/connect", () => {
  it("brings a club into the server for its admin, and audits it", async () => {
    const res = await handleDiscordCommand(
      cmd("connect", { guildId: NETWORK, user: { id: "DA" } }),
    );
    expect(res.data?.content).toContain("Alpha MC");

    expect(await getClubBinding(ORG_A)).toEqual({ orgId: ORG_A, guildId: NETWORK });

    const audits = await orgRef(ORG_A)
      .collection("auditLogs")
      .where("action", "==", "discord.connect")
      .get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0].data().actorUid).toBe("uA");
  });

  it("gives each club its own officer channel in the same server", async () => {
    await handleDiscordCommand(
      cmd("connect", {
        guildId: NETWORK,
        user: { id: "DA" },
        options: [{ name: "channel", type: 7, value: "C-ravens-review" }],
      }),
    );
    await adminDb.collection("discordClubs").doc(ORG_B).set({
      guildId: NETWORK,
      officerChannelId: "C-bravo-review",
    });

    expect(await officerChannelFor(ORG_A)).toBe("C-ravens-review");
    expect(await officerChannelFor(ORG_B)).toBe("C-bravo-review");
  });

  it("names the clubs already here when another joins", async () => {
    await adminDb.collection("discordClubs").doc(ORG_B).set({ guildId: NETWORK });
    const res = await handleDiscordCommand(
      cmd("connect", { guildId: NETWORK, user: { id: "DA" } }),
    );
    expect(res.data?.content).toContain("Also here: Bravo MC (org-b)");
  });

  it("turns away non-admins and DMs", async () => {
    const member = await handleDiscordCommand(
      cmd("connect", { guildId: NETWORK, user: { id: "DM" } }),
    );
    expect(member.data?.content).toContain("Only a club admin");

    const officer = await handleDiscordCommand(
      cmd("connect", { guildId: NETWORK, user: { id: "DB" } }),
    );
    expect(officer.data?.content).toContain("Only a club admin");

    const dm = await handleDiscordCommand(cmd("connect", { user: { id: "DA" } }));
    expect(dm.data?.content).toContain("inside the server");
    expect(await getClubBinding(ORG_A)).toBeNull();
  });
});

describe("club resolution in a shared server", () => {
  beforeEach(bindBothToNetwork);

  it("uses the caller's own club without them naming it", async () => {
    // DM rides with Alpha only, so /mystats means Alpha wherever they stand.
    const res = await handleDiscordCommand(
      cmd("mystats", { guildId: NETWORK, user: { id: "DM" } }),
    );
    expect(res.data?.content).toContain('"Alpha Two"');
    expect(res.data?.content).toContain("Alpha MC");

    // DB rides with Bravo, same server, same command, different club.
    const bravo = await handleDiscordCommand(
      cmd("mystats", { guildId: NETWORK, user: { id: "DB" } }),
    );
    expect(bravo.data?.content).toContain('"Bravo One"');
    expect(bravo.data?.content).toContain("Bravo MC");
  });

  it("asks which club when someone rides with two, then honors the slug", async () => {
    await seedUser("uBoth", "DX", {
      [ORG_A]: { memberId: "ma", role: "member" },
      [ORG_B]: { memberId: "mb", role: "member" },
    });

    const vague = await handleDiscordCommand(
      cmd("mystats", { guildId: NETWORK, user: { id: "DX" } }),
    );
    expect(vague.data?.content).toContain("Name the club: /mystats club:<slug>");
    expect(vague.data?.content).toContain("Alpha MC (org-a)");
    expect(vague.data?.content).toContain("Bravo MC (org-b)");

    const named = await handleDiscordCommand(
      cmd("mystats", {
        guildId: NETWORK,
        user: { id: "DX" },
        options: [{ name: "club", type: 3, value: ORG_B }],
      }),
    );
    expect(named.data?.content).toContain("Bravo MC");
  });

  it("rejects a club that is not in this server", async () => {
    await adminDb.collection("discordClubs").doc(ORG_B).delete();
    const res = await handleDiscordCommand(
      cmd("mystats", {
        guildId: NETWORK,
        user: { id: "DM" },
        options: [{ name: "club", type: 3, value: ORG_B }],
      }),
    );
    expect(res.data?.content).toContain("This server hosts: Alpha MC (org-a)");
  });

  it("suggests the server's clubs for the club option", async () => {
    const res = await handleAutocomplete({
      type: 4,
      guild_id: NETWORK,
      data: {
        name: "ticket",
        options: [{ name: "club", type: 3, value: "", focused: true }],
      },
    });
    const names = (res.data?.choices as { name: string }[]).map((c) => c.name);
    expect(names.sort()).toEqual(["Alpha MC", "Bravo MC"]);
  });

  // The club picker is keyed on the FOCUSED OPTION, not on a list of command
  // names. It used to sit behind such a list, and every command missing from
  // it suggested nothing at all: /mystats and /bankpanel were both dead that
  // way. Every command that declares a club option belongs here.
  it.each(["mystats", "ticket", "leaderboard", "panel", "bankpanel", "bank", "dues", "deposit", "withdraw"])(
    "suggests clubs for /%s",
    async (name) => {
      const res = await handleAutocomplete({
        type: 4,
        guild_id: NETWORK,
        data: { name, options: [{ name: "club", type: 3, value: "al", focused: true }] },
      });
      const choices = res.data?.choices as { name: string; value: string }[];
      expect(choices).toEqual([{ name: "Alpha MC", value: ORG_A }]);
    },
  );

  it("falls back to the env-pinned club in a server with no bindings", async () => {
    // The single-club deployment: nothing was ever /connect'd, so the guild
    // query is empty, but every command still resolves the pinned club. The
    // picker has to agree, or it reads as broken.
    await adminDb.collection("discordClubs").doc(ORG_A).delete();
    await adminDb.collection("discordClubs").doc(ORG_B).delete();
    // Restored in a finally: a leaked env pin would quietly change how every
    // later test in this file resolves its club.
    process.env.DISCORD_ORG_ID = ORG_A;
    try {
      const res = await handleAutocomplete({
        type: 4,
        guild_id: NETWORK,
        data: { name: "bankpanel", options: [{ name: "club", type: 3, value: "", focused: true }] },
      });
      expect(res.data?.choices).toEqual([{ name: "Alpha MC", value: ORG_A }]);
    } finally {
      delete process.env.DISCORD_ORG_ID;
    }
  });

  it("suggests nothing for a command with no club option", async () => {
    const res = await handleAutocomplete({
      type: 4,
      guild_id: NETWORK,
      data: { name: "ping", options: [] },
    });
    expect(res.data?.choices).toEqual([]);
  });
});

describe("per-club officer power in a shared server", () => {
  beforeEach(bindBothToNetwork);

  it("files a ticket to the caller's own club", async () => {
    const modal = await handleDiscordCommand(
      cmd("ticket", {
        guildId: NETWORK,
        user: { id: "DM" },
        options: [{ name: "type", type: 3, value: "drug-sale" }],
      }),
    );
    // The modal names the club so the submit cannot land on the wrong one.
    expect(modal.data?.custom_id).toBe(`ticket:${ORG_A}:drug-sale`);

    const res = await handleModalSubmit({
      type: 5,
      guild_id: NETWORK,
      member: { user: { id: "DM" } },
      data: {
        custom_id: `ticket:${ORG_A}:drug-sale`,
        components: [
          { type: 1, components: [{ type: 4, custom_id: "quantity", value: "3" }] },
          {
            type: 1,
            components: [
              { type: 4, custom_id: "description", value: "worked the corner all night" },
            ],
          },
        ],
      },
    });
    expect(res.data?.content).toContain("Ticket filed");

    // Alpha got the ticket; Bravo's queue is untouched.
    const alpha = await orgRef(ORG_A).collection("activities").get();
    expect(alpha.size).toBe(1);
    expect(alpha.docs[0].data().memberId).toBe("ma2");
    const bravo = await orgRef(ORG_B).collection("activities").get();
    expect(bravo.size).toBe(1); // just the seeded b1
  });

  it("scopes officer buttons to the ticket's own club", async () => {
    // Alpha's ADMIN cannot approve a Bravo ticket, same server, same button.
    const foreign = await handleComponent({
      type: 3,
      guild_id: NETWORK,
      data: { custom_id: `review:approve:${ORG_B}:b1` },
      member: { user: { id: "DA" } },
    });
    expect(foreign.data?.content).toContain("no member record with Bravo MC");
    const untouched = await orgRef(ORG_B).collection("activities").doc("b1").get();
    expect(untouched.data()?.status).toBe("pending");

    // Bravo's own officer lands it.
    const home = await handleComponent({
      type: 3,
      guild_id: NETWORK,
      data: { custom_id: `review:approve:${ORG_B}:b1` },
      member: { user: { id: "DB" } },
    });
    expect(home.type).toBe(7);
    const approved = await orgRef(ORG_B).collection("activities").doc("b1").get();
    expect(approved.data()?.status).toBe("approved");
  });

  it("still honors buttons posted before clubs rode in the id", async () => {
    // Two-part custom_id from an older message, clicked in a server that now
    // hosts two clubs: the clicker's own membership decides.
    const res = await handleComponent({
      type: 3,
      guild_id: NETWORK,
      data: { custom_id: "review:approve:b1" },
      member: { user: { id: "DB" } },
    });
    expect(res.type).toBe(7);
    const approved = await orgRef(ORG_B).collection("activities").doc("b1").get();
    expect(approved.data()?.status).toBe("approved");
  });
});

describe("single-club deployment still works", () => {
  it("falls back to the env pin when no club is bound", async () => {
    process.env.DISCORD_ORG_ID = ORG_A;
    try {
      const res = await handleDiscordCommand(
        cmd("mystats", {
          guildId: "G-UNBOUND",
          user: { id: "DM" },
          options: [{ name: "member", type: 3, value: "Alpha One" }],
        }),
      );
      expect(res.data?.content).toContain("Alpha MC");
    } finally {
      delete process.env.DISCORD_ORG_ID;
    }
  });
});

describe("global standings", () => {
  beforeEach(bindBothToNetwork);

  it("ranks every riding member of every club on one board", async () => {
    const res = await handleDiscordCommand(
      cmd("leaderboard", {
        guildId: NETWORK,
        user: { id: "DM" },
        options: [
          { name: "scope", type: 3, value: "global" },
          { name: "category", type: 3, value: "drugSales" },
        ],
      }),
    );
    const lines = (res.data?.content ?? "").split("\n");
    expect(lines[0]).toBe("**Drug Sales** global standings · 2 clubs");
    expect(lines[1]).toBe('🥇 "Alpha One" Rider Alpha One · Alpha MC · 100');
    expect(lines[2]).toBe('🥈 "Bravo One" Rider Bravo One · Bravo MC · 70');
    expect(lines[3]).toBe('🥉 "Alpha Two" Rider Alpha Two · Alpha MC · 50');
    // Retired colors sit out of global competition too.
    expect(res.data?.content).not.toContain("Bravo Ghost");
  });

  it("suggests the standard stats when scope is global", async () => {
    const res = await handleAutocomplete({
      type: 4,
      guild_id: NETWORK,
      data: {
        name: "leaderboard",
        options: [
          { name: "scope", type: 3, value: "global" },
          { name: "category", type: 3, value: "dirty", focused: true },
        ],
      },
    });
    expect(res.data?.choices).toEqual([
      { name: "Dirty Money Earned", value: "dirtyMoneyEarned" },
      { name: "Dirty Money Cleaned", value: "dirtyMoneyCleaned" },
    ]);
  });
});
