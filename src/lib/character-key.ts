/**
 * Character-render background keying — shared by the website upload action
 * and the scripts/add-character.ts CLI.
 *
 * Removes light, near-gray backgrounds (checkerboard "fake transparency",
 * white/gray studio backdrops) by flood-filling from the image edges, so
 * light pixels INSIDE the figure (skin highlights, watch faces) survive.
 * Operates in place on RGBA data.
 */

/** True when enough border pixels are opaque that the image needs keying. */
export function needsBackgroundKeying(
  data: Uint8Array,
  width: number,
  height: number,
): boolean {
  let borderOpaque = 0;
  for (let x = 0; x < width; x += 4) {
    if (data[x * 4 + 3] > 250) borderOpaque++;
    if (data[((height - 1) * width + x) * 4 + 3] > 250) borderOpaque++;
  }
  return borderOpaque > width / 8;
}

/** Flood-fill light background to transparent; feather the cut edge. */
export function keyOutLightBackground(
  data: Uint8Array,
  width: number,
  height: number,
): { cleared: number } {
  const isLight = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mn > 170 && mx - mn < 18;
  };

  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (visited[idx] || !isLight(x, y)) return;
    visited[idx] = 1;
    stack.push(idx);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }

  let cleared = 0;
  while (stack.length) {
    const idx = stack.pop()!;
    const x = idx % width, y = (idx - x) / width;
    data[idx * 4 + 3] = 0;
    cleared++;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // Feather the cut edge so the figure doesn't look razor-clipped.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (data[idx * 4 + 3] === 0) continue;
      if (visited[idx - 1] || visited[idx + 1] || visited[idx - width] || visited[idx + width]) {
        data[idx * 4 + 3] = 150;
      }
    }
  }
  return { cleared };
}
