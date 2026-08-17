/**
 * Match uploaded filenames to patch ids.
 *
 * Pure and framework-free so the bulk uploader can preview matches in the
 * browser before anything is written, and so the rules are testable without
 * spinning up Firestore.
 *
 * Deliberately forgiving. Art comes out of whatever the designer used, so
 * "Corner Boy.png", "corner_boy.PNG" and "04 - corner-boy.webp" all mean the
 * same patch — refusing them would just make someone rename 62 files by hand.
 * What it will NOT do is guess: anything that doesn't resolve exactly is
 * reported unmatched rather than attached to a near-miss.
 */

export interface PatchTarget {
  id: string;
  name: string;
}

export interface MatchedFile {
  fileName: string;
  patchId: string;
  patchName: string;
  /** True when this patch already has art, so the preview can warn. */
  replaces: boolean;
}

export interface MatchReport {
  matched: MatchedFile[];
  /** Files that resolved to nothing, with the slug that was tried. */
  unmatched: { fileName: string; tried: string }[];
  /** Files that resolved to a patch another file already claimed. */
  duplicates: { fileName: string; patchId: string }[];
}

/** "04 - Corner Boy.PNG" → "corner-boy". Extension, index prefix and case go. */
export function slugFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "") // extension
    .replace(/^\s*\d+\s*[-_.)]\s*/, "") // "04 - ", "12_", "3."
    .toLowerCase()
    .replace(/['’]/g, "") // President's → presidents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function matchFiles(
  fileNames: string[],
  patches: PatchTarget[],
  hasArt: (patchId: string) => boolean,
): MatchReport {
  const byId = new Map(patches.map((p) => [p.id, p]));
  // Fall back to the display name so "Did a Stretch.png" still finds the rung
  // whose id is still `held-overnight` from before it was renamed.
  const byName = new Map(patches.map((p) => [slugFromFileName(p.name), p]));

  const matched: MatchedFile[] = [];
  const unmatched: MatchReport["unmatched"] = [];
  const duplicates: MatchReport["duplicates"] = [];
  const claimed = new Set<string>();

  for (const fileName of fileNames) {
    const slug = slugFromFileName(fileName);
    const patch = byId.get(slug) ?? byName.get(slug);
    if (!patch) {
      unmatched.push({ fileName, tried: slug });
      continue;
    }
    if (claimed.has(patch.id)) {
      duplicates.push({ fileName, patchId: patch.id });
      continue;
    }
    claimed.add(patch.id);
    matched.push({
      fileName,
      patchId: patch.id,
      patchName: patch.name,
      replaces: hasArt(patch.id),
    });
  }

  return { matched, unmatched, duplicates };
}
