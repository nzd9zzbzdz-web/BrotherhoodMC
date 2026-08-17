/**
 * /leaderboard: the club standings as Discord text, riding composeLeaderboard
 * with none of the website's imagery reads. Against the Firestore emulator;
 * isolated project and org.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "discord-board-test-isolated";
process.env.DISCORD_ORG_ID = "discord-board-test-org";

// Import AFTER env vars so the Admin SDK connects to the emulator.
const { adminDb, orgRef, Timestamp } = await import("@/lib/firebase/admin");
const { handleDiscordCommand, handleAutocomplete } = await import(
  "@/lib/discord/interactions"
);

const ORG = "discord-board-test-org";

function boardCmd(category?: string) {
  return {
    type: 2,
    data: {
      name: "leaderboard",
      options: category
        ? [{ name: "category", type: 3, value: category }]
        : undefined,
    },
    member: { user: { id: "D-anyone" } },
  };
}

function member(
  id: string,
  n: number,
  roadName: string,
  displayName: string,
  drugSales: number,
  status = "patched",
) {
  return orgRef(ORG).collection("members").doc(id).set({
    uid: `u-${id}`,
    displayName,
    roadName,
    rankId: "president",
    status,
    joinDate: Timestamp.now(),
    memberNumber: n,
    stats: { drugSales, heistsCompleted: 0 },
    patchCount: 0,
    createdAt: Timestamp.now(),
  });
}

function emblem(id: string, name: string, statKey: string, threshold: number) {
  return orgRef(ORG).collection("patches").doc(id).set({
    name,
    category: "activity",
    description: `${threshold} of ${statKey}`,
    tier: 1,
    requirement: { statKey, threshold },
    manual: false,
    active: true,
    emblem: true,
    defaultPlacement: { surface: "back", u: 0.5, v: 0.5, scale: 0.8, rotationDeg: 0 },
  });
}

beforeEach(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
  await orgRef(ORG).set({
    name: "Board Test MC",
    slug: ORG,
    status: "active",
    memberCount: 4,
  });

  // Two ladders: drug sales (two rungs) and heists (one rung). PATCH_LADDERS
  // order puts heists first, so it is the default board.
  await emblem("drug-1", "Street Dealer", "drugSales", 10);
  await emblem("drug-2", "Kingpin", "drugSales", 50);
  await emblem("heist-1", "First Score", "heistsCompleted", 5);

  await member("m1", 1, "Reaper", "Marcus Vane", 40);
  await member("m2", 2, "Six", "Dana Cross", 40); // ties with Reaper
  await member("m3", 3, "Ledger", "Ray Books", 5);
  await member("m4", 4, "Ghost", "Gone Away", 999, "retired"); // sits out

  // Reaper has climbed the first drug rung.
  await orgRef(ORG).collection("awardedPatches").doc("m1_drug-1").set({
    memberId: "m1",
    patchId: "drug-1",
    awardedAt: Timestamp.now(),
    awardedBy: "system",
  });
});

afterAll(async () => {
  await adminDb.recursiveDelete(orgRef(ORG));
});

describe("/leaderboard", () => {
  it("defaults to the first board and answers publicly", async () => {
    const res = await handleDiscordCommand(boardCmd());
    expect(res.type).toBe(4);
    expect(res.data?.content).toContain("**Heists Completed** standings · Board Test MC");
    expect(res.data?.flags).toBeUndefined(); // public: standings are banter
  });

  it("ranks a chosen board with shared medals for ties", async () => {
    const res = await handleDiscordCommand(boardCmd("drugSales"));
    const content = res.data?.content ?? "";

    expect(content).toContain("**Drug Sales** standings · Board Test MC");
    const lines = content.split("\n");
    // Value decides rank, member number orders the tie. Olympic convention:
    // two golds skip the silver, so the next value down takes bronze at rank 3.
    expect(lines[1]).toBe('🥇 "Reaper" Marcus Vane · 40 · Street Dealer (1/2)');
    expect(lines[2]).toBe('🥇 "Six" Dana Cross · 40');
    expect(lines[3]).toBe('🥉 "Ledger" Ray Books · 5');
    // Retired colors sit out, however high the number.
    expect(content).not.toContain("Ghost");
  });

  it("matches a hand-typed label as a courtesy", async () => {
    const res = await handleDiscordCommand(boardCmd("drug sales"));
    expect(res.data?.content).toContain("**Drug Sales** standings");
  });

  it("names the board it cannot find", async () => {
    const res = await handleDiscordCommand(boardCmd("Vibes"));
    expect(res.data?.content).toContain('No standings board named "Vibes"');
  });

  it("truncates a long board and counts the rest", async () => {
    await Promise.all(
      Array.from({ length: 17 }, (_, i) =>
        member(`x${i}`, 10 + i, `Rider${i}`, `Extra ${i}`, 100 + i),
      ),
    );
    const res = await handleDiscordCommand(boardCmd("drugSales"));
    const content = res.data?.content ?? "";
    // 20 riding members, 15 shown.
    expect(content).toContain("... and 5 more on the website");
    expect(content.split("\n")).toHaveLength(17); // header + 15 rows + overflow
  });
});

describe("category autocomplete", () => {
  it("suggests boards matching the fragment", async () => {
    const res = await handleAutocomplete({
      type: 4,
      data: {
        name: "leaderboard",
        options: [{ name: "category", type: 3, value: "dru", focused: true }],
      },
    });
    expect(res.type).toBe(8);
    expect(res.data?.choices).toEqual([{ name: "Drug Sales", value: "drugSales" }]);
  });

  it("lists every board for an empty fragment", async () => {
    const res = await handleAutocomplete({
      type: 4,
      data: {
        name: "leaderboard",
        options: [{ name: "category", type: 3, value: "", focused: true }],
      },
    });
    const names = (res.data?.choices as { name: string }[]).map((c) => c.name);
    expect(names.sort()).toEqual(["Drug Sales", "Heists Completed"]);
  });
});
