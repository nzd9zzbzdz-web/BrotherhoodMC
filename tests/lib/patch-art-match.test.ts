/**
 * Filename → patch matching for the bulk art upload. Pure, no emulator.
 *
 * The risk worth pinning is a silent WRONG match: art landing on a patch it
 * wasn't meant for is far worse than a file being reported unmatched, because
 * the first is invisible and the second is on screen before anything is written.
 */
import { describe, expect, it } from "vitest";
import { matchFiles, slugFromFileName } from "@/lib/patch-art-match";
import { CRIMINAL_PATCH_SEEDS } from "@/lib/constants";

const PATCHES = [
  { id: "corner-boy", name: "Corner Boy" },
  { id: "the-cook", name: "The Cook" },
  { id: "held-overnight", name: "Did a Stretch" },
  { id: "presidents-citation", name: "President's Citation" },
  { id: "merchant-of-death", name: "Merchant of Death" },
];

const none = () => false;

describe("slugFromFileName", () => {
  it("normalises the shapes an export folder actually produces", () => {
    expect(slugFromFileName("corner-boy.png")).toBe("corner-boy");
    expect(slugFromFileName("Corner Boy.PNG")).toBe("corner-boy");
    expect(slugFromFileName("corner_boy.webp")).toBe("corner-boy");
    expect(slugFromFileName("04 - Corner Boy.jpg")).toBe("corner-boy");
    expect(slugFromFileName("12_corner boy.png")).toBe("corner-boy");
    expect(slugFromFileName("  Corner   Boy .png")).toBe("corner-boy");
  });

  it("drops apostrophes so possessives survive a round trip", () => {
    expect(slugFromFileName("President's Citation.png")).toBe("presidents-citation");
    expect(slugFromFileName("President’s Citation.png")).toBe("presidents-citation");
  });
});

describe("matchFiles", () => {
  it("matches on id and on display name", () => {
    const r = matchFiles(
      ["corner-boy.png", "The Cook.png", "Did a Stretch.webp"],
      PATCHES,
      none,
    );
    expect(r.matched.map((m) => m.patchId)).toEqual([
      "corner-boy",
      "the-cook",
      // Renamed rung: the file says "Did a Stretch", the id is still the old one.
      "held-overnight",
    ]);
    expect(r.unmatched).toHaveLength(0);
  });

  it("reports a near miss rather than guessing", () => {
    // "cornerboy" and "corner-boys" are close, and both are wrong.
    const r = matchFiles(["cornerboy.png", "corner-boys.png"], PATCHES, none);
    expect(r.matched).toHaveLength(0);
    expect(r.unmatched.map((u) => u.tried)).toEqual(["cornerboy", "corner-boys"]);
  });

  it("keeps the first file when two claim the same patch", () => {
    const r = matchFiles(["corner-boy.png", "Corner Boy.webp"], PATCHES, none);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].fileName).toBe("corner-boy.png");
    expect(r.duplicates).toEqual([{ fileName: "Corner Boy.webp", patchId: "corner-boy" }]);
  });

  it("flags which uploads would replace existing art", () => {
    const r = matchFiles(
      ["corner-boy.png", "the-cook.png"],
      PATCHES,
      (id) => id === "corner-boy",
    );
    expect(r.matched.map((m) => [m.patchId, m.replaces])).toEqual([
      ["corner-boy", true],
      ["the-cook", false],
    ]);
  });

  it("resolves every shipped emblem from its own id", () => {
    // A folder named straight off the manifest must match 55 for 55.
    const targets = CRIMINAL_PATCH_SEEDS.map((p) => ({ id: p.id, name: p.name }));
    const r = matchFiles(
      CRIMINAL_PATCH_SEEDS.map((p) => `${p.id}.png`),
      targets,
      none,
    );
    expect(r.matched).toHaveLength(CRIMINAL_PATCH_SEEDS.length);
    expect(r.unmatched).toHaveLength(0);
    expect(r.duplicates).toHaveLength(0);
  });

  it("resolves every shipped emblem from its display name too", () => {
    const targets = CRIMINAL_PATCH_SEEDS.map((p) => ({ id: p.id, name: p.name }));
    const r = matchFiles(
      CRIMINAL_PATCH_SEEDS.map((p) => `${p.name}.png`),
      targets,
      none,
    );
    expect(r.unmatched).toHaveLength(0);
    // Every file lands on the patch whose name it carries.
    for (const m of r.matched) {
      expect(slugFromFileName(m.fileName)).toBe(slugFromFileName(m.patchName));
    }
  });
});
