import { describe, expect, it } from "vitest";
import { PLATFORM_PRESET, PRESET_SLUGS, clubPreset } from "@/lib/clubs";
import { defaultAssetsFor, defaultBrandingFor } from "@/lib/branding-defaults";
import { resolveBranding } from "@/lib/branding-resolve";
import { BRANDING_ASSET_KEYS } from "@/lib/types";

/**
 * The property this whole preset layer exists for: a club with no preset and
 * no saved branding must inherit NOTHING from another club.
 *
 * Isolation used to hold in Firestore and leak through the fallbacks. Every
 * unset field resolved to whichever club WAS the global default, so a second
 * club that had not uploaded a logo rendered the first club's patch. These
 * tests are what stops that regressing.
 *
 * This deployment ships no presets at all, so the property is stated directly
 * rather than against a second club's values: every resolved field of a
 * preset-less club must come from PLATFORM_PRESET and nowhere else. A
 * re-introduced global default fails here, because its value would differ from
 * the blank preset's.
 */

const NEW_CLUB = "blue-wolves";

/** Every string a resolved branding value can render, flattened. */
function renderedStrings(slug: string): string[] {
  const out: string[] = [];
  for (const surface of ["public", "portal"] as const) {
    const r = resolveBranding(null, surface, { slug });
    out.push(
      r.name,
      r.shortName,
      r.location,
      r.addressLine,
      r.tagline,
      r.mission,
      r.chainTitle,
      r.chainBlurb,
      r.anthemVideoId,
      ...Object.values(r.colors),
      ...Object.values(r.assets),
    );
  }
  const preset = clubPreset(slug);
  out.push(
    ...preset.copy.story,
    ...preset.copy.storyTitles,
    ...preset.copy.creed,
    ...preset.copy.values.flat(),
    ...preset.copy.pillars.flatMap((p) => [p.title, p.body]),
    preset.copy.closingHeading,
    preset.copy.closingBody,
    preset.contact.venue,
    ...preset.contact.addressLines,
    ...preset.contact.hours,
    preset.plateArt ?? "",
    preset.heroVideo ?? "",
  );
  return out.filter(Boolean);
}

describe("club presets", () => {
  it("an unknown slug gets the blank platform preset", () => {
    expect(clubPreset(NEW_CLUB)).toBe(PLATFORM_PRESET);
    expect(clubPreset(undefined)).toBe(PLATFORM_PRESET);
    expect(clubPreset("")).toBe(PLATFORM_PRESET);
  });

  it("any club that DOES ship a preset resolves to its own, not a neighbour's", () => {
    // Empty today. Written as a loop so it keeps holding the moment a preset
    // is added, rather than needing a new test written alongside it.
    for (const slug of PRESET_SLUGS) {
      const preset = clubPreset(slug);
      expect(preset.slug).toBe(slug);
      expect(preset).not.toBe(PLATFORM_PRESET);
    }
  });
});

describe("a preset-less club inherits nothing but the blank preset", () => {
  it("resolves every colour from the blank preset", () => {
    const blank = new Set([
      ...Object.values(PLATFORM_PRESET.colors.portal),
      ...Object.values(PLATFORM_PRESET.colors.public),
    ]);
    for (const surface of ["public", "portal"] as const) {
      const resolved = resolveBranding(null, surface, { slug: NEW_CLUB });
      expect(resolved.colors).toMatchObject(PLATFORM_PRESET.colors[surface]);
      // Nothing may appear that the blank preset did not put there.
      for (const value of Object.values(resolved.colors)) {
        expect(blank.has(value), value).toBe(true);
      }
    }
  });

  it("points at no artwork outside the platform's own placeholder set", () => {
    for (const surface of ["public", "portal"] as const) {
      const { assets } = resolveBranding(null, surface, { slug: NEW_CLUB });
      for (const key of BRANDING_ASSET_KEYS) {
        if (key === "plateArt") continue; // "nothing" is the real answer here
        // Placeholder art, or the shared silhouette: it depicts a person and
        // carries no club marks, so it is platform art rather than a club's.
        expect(assets[key], key).toMatch(/^\/brand\/(_platform\/|members\/silhouette)/);
      }
    }
  });

  it("names itself after nobody", () => {
    const resolved = resolveBranding(null, "public", { slug: NEW_CLUB });
    expect(resolved.name).toBe(PLATFORM_PRESET.identity.publicName);
    // Every rendered string traces back to the blank preset. Trivially true
    // while it is the only preset, and the line that starts failing the moment
    // a shared default is reintroduced above it.
    const blank = new Set(renderedStrings(NEW_CLUB));
    for (const value of renderedStrings(NEW_CLUB)) {
      expect(blank.has(value), value).toBe(true);
    }
  });

  it("has no hierarchy plate, so it cannot wear another club's engraving", () => {
    expect(clubPreset(NEW_CLUB).plateArt).toBeNull();
    // In the asset map that answer is spelled "", and it must survive
    // resolution: a truthy fallback here would be another club's plate leaking.
    expect(defaultAssetsFor(NEW_CLUB).plateArt).toBe("");
    expect(resolveBranding(null, "portal", { slug: NEW_CLUB }).assets.plateArt).toBe("");
  });

  it("resolves every asset slot to something renderable", () => {
    const assets = defaultAssetsFor(NEW_CLUB);
    for (const key of BRANDING_ASSET_KEYS) {
      // The plate is the one slot where "nothing" is the real answer.
      if (key === "plateArt") continue;
      expect(assets[key], key).toMatch(/^\/[\w\-./]+\.(webp|png|jpg|svg)$/);
    }
  });
});

describe("the branding chain still works on top of the blank preset", () => {
  it("keeps the public and portal surfaces distinct where they always were", () => {
    const pub = defaultBrandingFor(NEW_CLUB, "public");
    const portal = defaultBrandingFor(NEW_CLUB, "portal");
    expect(pub.tagline).toBe(PLATFORM_PRESET.identity.publicTagline);
    expect(portal.tagline).toBe(PLATFORM_PRESET.identity.portalTagline);
  });

  it("the org record's own name beats the preset placeholder", () => {
    // A bootstrapped-but-unbranded club: the organization document knows the
    // real name before anyone opens Admin, and the site must say it.
    const resolved = resolveBranding(null, "portal", {
      slug: NEW_CLUB,
      name: "Blue Wolves MC",
    });
    expect(resolved.name).toBe("Blue Wolves MC");
  });

  it("a stored branding document still overrides the preset", () => {
    const resolved = resolveBranding(
      {
        colors: { ...PLATFORM_PRESET.colors.portal, primary: "#1E5FD9" },
        fonts: PLATFORM_PRESET.fonts,
        orgDisplayName: "Azure Wolves MC",
        chainTitle: "The Table",
        chainBlurb: "",
        assets: {
          clubPatch: "/api/orgs/x/branding/clubPatch?v=1",
          plateArt: "/api/orgs/x/branding/plateArt?v=1",
        },
      },
      "portal",
      { slug: NEW_CLUB },
    );
    expect(resolved.colors.primary).toBe("#1E5FD9");
    expect(resolved.name).toBe("Azure Wolves MC");
    expect(resolved.chainTitle).toBe("The Table");
    // An empty blurb is a choice and survives; an empty TITLE would not.
    expect(resolved.chainBlurb).toBe("");
    expect(resolved.assets.clubPatch).toBe("/api/orgs/x/branding/clubPatch?v=1");
    expect(resolved.assets.plateArt).toBe("/api/orgs/x/branding/plateArt?v=1");
    expect(resolved.customAssets.has("clubPatch")).toBe(true);
    // Untouched slots still come from the preset.
    expect(resolved.assets.characterStage).toBe(PLATFORM_PRESET.assets.characterStage);
  });
});
