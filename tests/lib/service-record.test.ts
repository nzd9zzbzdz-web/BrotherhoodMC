/**
 * The Service Record composer. Pure — no emulator needed.
 *
 * The panel is a derived view over three sources the club already records, so
 * the risks worth pinning are ordering, the mixed Timestamp/Date shapes coming
 * out of Firestore, and never rendering a row with a broken date.
 */
import { describe, expect, it } from "vitest";
import { composeServiceRecord } from "@/lib/service-record";
import type { AwardedPatch, Patch, ServiceRecordEntry } from "@/lib/types";

/** Stand-in for a firebase-admin Timestamp. */
const ts = (iso: string) => ({ toDate: () => new Date(iso) });

const patch = (id: string, name: string, description = ""): Patch =>
  ({ id, name, description }) as Patch;

const award = (
  id: string,
  patchId: string,
  at: string,
  reason?: string,
): AwardedPatch => ({ id, patchId, awardedAt: ts(at), reason }) as unknown as AwardedPatch;

const career = (
  id: string,
  title: string,
  at: string,
  kind: ServiceRecordEntry["kind"] = "promotion",
): ServiceRecordEntry => ({ id, kind, title, at: ts(at) }) as unknown as ServiceRecordEntry;

const base = {
  memberNumber: 4,
  joinDate: ts("2026-01-10T12:00:00Z"),
  awards: [],
  patchById: new Map<string, Patch>(),
  career: [],
};

describe("composeServiceRecord", () => {
  it("always anchors on the day they joined", () => {
    const items = composeServiceRecord(base);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "joined",
      title: "Joined the club",
      detail: "Member #4.",
    });
  });

  it("merges all three sources newest first", () => {
    const items = composeServiceRecord({
      ...base,
      awards: [award("a1", "road-warrior", "2026-03-02T00:00:00Z")],
      patchById: new Map([["road-warrior", patch("road-warrior", "Road Warrior")]]),
      career: [career("c1", "Rank changed to Head Enforcer", "2026-06-20T00:00:00Z")],
    });

    expect(items.map((i) => i.kind)).toEqual(["promotion", "patch", "joined"]);
    expect(items[1].title).toBe('Earned the "Road Warrior" patch');
  });

  it("falls back to the patch description when an award has no reason", () => {
    const patchById = new Map([["x", patch("x", "Iron Horse", "Log 50 club rides.")]]);
    const [item] = composeServiceRecord({
      ...base,
      joinDate: undefined,
      awards: [award("a1", "x", "2026-03-02T00:00:00Z")],
      patchById,
    });
    expect(item.detail).toBe("Log 50 club rides.");

    const [withReason] = composeServiceRecord({
      ...base,
      joinDate: undefined,
      awards: [award("a1", "x", "2026-03-02T00:00:00Z", "Held the line at Sandy Shores.")],
      patchById,
    });
    expect(withReason.detail).toBe("Held the line at Sandy Shores.");
  });

  it("still names a patch that was retired out of the catalogue", () => {
    // Retired patches keep their doc, but a deleted one shouldn't crash a profile.
    const [item] = composeServiceRecord({
      ...base,
      joinDate: undefined,
      awards: [award("a1", "ghost-patch", "2026-03-02T00:00:00Z")],
    });
    expect(item.title).toBe('Earned the "ghost-patch" patch');
  });

  it("drops rows whose date never resolved rather than dating them to 1970", () => {
    // A serverTimestamp() write reads back null until the write lands.
    const items = composeServiceRecord({
      ...base,
      career: [{ id: "c1", kind: "promotion", title: "Pending", at: null } as never],
    });
    expect(items.map((i) => i.id)).toEqual(["joined"]);
  });

  it("accepts a plain Date as well as a Timestamp", () => {
    const items = composeServiceRecord({
      ...base,
      joinDate: new Date("2026-01-10T12:00:00Z"),
    });
    expect(items[0].dateISO).toBe("2026-01-10T12:00:00.000Z");
    expect(items[0].dateLabel).toContain("2026");
  });

  it("sinks the join row below anything sharing its date", () => {
    // Common: a patch awarded the day someone is patched in — and the seeded
    // demo club backdates every award to the join date. "Joined the club" on
    // top of its own consequences would read as if they joined last.
    const sameDay = "2026-01-10T12:00:00Z";
    const items = composeServiceRecord({
      ...base,
      joinDate: ts(sameDay),
      awards: [award("a1", "x", sameDay)],
      patchById: new Map([["x", patch("x", "Prospect")]]),
      career: [career("c1", "Rank changed to Patched Member", sameDay)],
    });
    expect(items.map((i) => i.kind)).toEqual(["promotion", "patch", "joined"]);
  });

  it("shows only the top rung of an emblem ladder", () => {
    // Emblems ship five-to-a-stat, so every rung would bury the rest of the
    // timeline. The Emblems tab keeps the full climb.
    const rung = (id: string, name: string, threshold: number): Patch =>
      ({
        id,
        name,
        description: "",
        emblem: true,
        requirement: { statKey: "drugSales", threshold },
      }) as Patch;

    const items = composeServiceRecord({
      ...base,
      awards: [
        award("a1", "t1", "2026-02-01T00:00:00Z"),
        award("a2", "t2", "2026-03-01T00:00:00Z"),
        award("a3", "t3", "2026-04-01T00:00:00Z"),
      ],
      patchById: new Map([
        ["t1", rung("t1", "Corner Boy", 1_000)],
        ["t2", rung("t2", "Slinger", 5_000)],
        ["t3", rung("t3", "Dealer", 15_000)],
      ]),
    });

    const patchRows = items.filter((i) => i.kind === "patch");
    expect(patchRows).toHaveLength(1);
    expect(patchRows[0].title).toBe('Earned the "Dealer" patch');
  });

  it("keeps every emblem ladder and every manual award separate", () => {
    const rung = (id: string, name: string, statKey: string, threshold: number): Patch =>
      ({
        id,
        name,
        description: "",
        emblem: true,
        requirement: { statKey, threshold },
      }) as Patch;

    const items = composeServiceRecord({
      ...base,
      awards: [
        award("a1", "d1", "2026-02-01T00:00:00Z"),
        award("a2", "d2", "2026-03-01T00:00:00Z"),
        award("a3", "h1", "2026-03-05T00:00:00Z"),
        award("a4", "manual", "2026-04-01T00:00:00Z", "Held the line."),
      ],
      patchById: new Map([
        ["d1", rung("d1", "Corner Boy", "drugSales", 1_000)],
        ["d2", rung("d2", "Slinger", "drugSales", 5_000)],
        ["h1", rung("h1", "First Job", "heistsCompleted", 3)],
        ["manual", patch("manual", "War Veteran")],
      ]),
    });

    // Top of drugSales + top of heists + the manual award = three rows.
    expect(items.filter((i) => i.kind === "patch").map((i) => i.title)).toEqual([
      'Earned the "War Veteran" patch',
      'Earned the "First Job" patch',
      'Earned the "Slinger" patch',
    ]);
  });

  it("never collapses patches worn on the cut", () => {
    // Road Warrior doesn't stop counting because Iron Rider followed it.
    const clubPatch = (id: string, name: string, threshold: number): Patch =>
      ({
        id,
        name,
        description: "",
        requirement: { statKey: "clubRuns", threshold },
      }) as Patch;

    const items = composeServiceRecord({
      ...base,
      awards: [
        award("a1", "rw", "2026-02-01T00:00:00Z"),
        award("a2", "ir", "2026-03-01T00:00:00Z"),
      ],
      patchById: new Map([
        ["rw", clubPatch("rw", "Road Warrior", 10)],
        ["ir", clubPatch("ir", "Iron Rider", 50)],
      ]),
    });

    expect(items.filter((i) => i.kind === "patch").map((i) => i.title)).toEqual([
      'Earned the "Iron Rider" patch',
      'Earned the "Road Warrior" patch',
    ]);
  });

  it("hangs the patch artwork on the row that earned it, and nothing else", () => {
    // Art is optional per patch: a club that uploaded one image shouldn't get
    // broken frames on the other rows, and joining/promotion rows never carry
    // artwork at all.
    const items = composeServiceRecord({
      ...base,
      awards: [
        award("a1", "rw", "2026-02-01T00:00:00Z"),
        award("a2", "no-art", "2026-03-01T00:00:00Z"),
      ],
      patchById: new Map([
        ["rw", patch("rw", "Road Warrior")],
        ["no-art", patch("no-art", "Iron Rider")],
      ]),
      career: [career("c1", "Rank changed to Enforcer", "2026-04-01T00:00:00Z")],
      artUrlFor: (patchId) => (patchId === "rw" ? "/api/art/rw?v=7" : null),
    });

    const byTitle = new Map(items.map((i) => [i.title, i.artUrl]));
    expect(byTitle.get('Earned the "Road Warrior" patch')).toBe("/api/art/rw?v=7");
    expect(byTitle.get('Earned the "Iron Rider" patch')).toBeUndefined();
    expect(byTitle.get("Rank changed to Enforcer")).toBeUndefined();
    expect(byTitle.get("Joined the club")).toBeUndefined();
  });

  it("leaves rows art-less when no resolver is supplied", () => {
    const items = composeServiceRecord({
      ...base,
      awards: [award("a1", "rw", "2026-02-01T00:00:00Z")],
      patchById: new Map([["rw", patch("rw", "Road Warrior")]]),
    });
    expect(items.every((i) => i.artUrl === undefined)).toBe(true);
  });
});
