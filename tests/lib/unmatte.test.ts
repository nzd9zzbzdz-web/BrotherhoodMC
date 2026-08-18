import { describe, expect, it } from "vitest";
import { stripWhiteMatte } from "@/lib/unmatte";

const W = 64;
const H = 64;

/** A blank RGBA canvas filled with one colour. */
function canvas(r: number, g: number, b: number, a = 255): Buffer {
  const buf = Buffer.alloc(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    buf[p * 4] = r;
    buf[p * 4 + 1] = g;
    buf[p * 4 + 2] = b;
    buf[p * 4 + 3] = a;
  }
  return buf;
}

function fill(buf: Buffer, x0: number, y0: number, x1: number, y1: number, rgba: number[]) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * W + x) * 4;
      buf[o] = rgba[0];
      buf[o + 1] = rgba[1];
      buf[o + 2] = rgba[2];
      buf[o + 3] = rgba[3] ?? 255;
    }
  }
}

const alphaAt = (buf: Buffer, x: number, y: number) => buf[(y * W + x) * 4 + 3];

describe("stripWhiteMatte", () => {
  it("clears a white matte and keeps the artwork", () => {
    const buf = canvas(255, 255, 255);
    fill(buf, 16, 16, 48, 48, [180, 40, 30]);

    expect(stripWhiteMatte(buf, W, H)).toBe(true);
    expect(alphaAt(buf, 0, 0)).toBe(0);
    expect(alphaAt(buf, W - 1, H - 1)).toBe(0);
    expect(alphaAt(buf, 32, 32)).toBe(255);
  });

  it("keeps white that the border cannot reach", () => {
    // A ring of artwork with a white centre: a global white key would punch
    // the middle out, which is what eats a bone-coloured skull emblem.
    const buf = canvas(255, 255, 255);
    fill(buf, 12, 12, 52, 52, [90, 90, 90]);
    fill(buf, 24, 24, 40, 40, [255, 255, 255]);

    expect(stripWhiteMatte(buf, W, H)).toBe(true);
    expect(alphaAt(buf, 0, 0)).toBe(0); // outside cleared
    expect(alphaAt(buf, 16, 16)).toBe(255); // the ring itself
    expect(alphaAt(buf, 32, 32)).toBe(255); // enclosed white SURVIVES
  });

  it("passes through transparent padding to reach the matte", () => {
    // What a `contain` resize produces: transparent bars, then the matte.
    const buf = canvas(0, 0, 0, 0);
    fill(buf, 8, 0, 56, H, [255, 255, 255]);
    fill(buf, 24, 24, 40, 40, [20, 120, 60]);

    expect(stripWhiteMatte(buf, W, H)).toBe(true);
    expect(alphaAt(buf, 16, 8)).toBe(0); // matte inside the padding, cleared
    expect(alphaAt(buf, 32, 32)).toBe(255); // art kept
  });

  it("declines when the border is not a matte", () => {
    const buf = canvas(20, 30, 25);
    fill(buf, 16, 16, 48, 48, [255, 255, 255]);

    expect(stripWhiteMatte(buf, W, H)).toBe(false);
    expect(alphaAt(buf, 0, 0)).toBe(255); // untouched
    expect(alphaAt(buf, 32, 32)).toBe(255);
  });

  it("declines rather than erase an image that is almost all matte", () => {
    const buf = canvas(255, 255, 255);
    fill(buf, 31, 31, 32, 32, [0, 0, 0]); // a single dark pixel

    expect(stripWhiteMatte(buf, W, H)).toBe(false);
    expect(alphaAt(buf, 0, 0)).toBe(255);
  });

  it("declines on a buffer that is too small to be the stated size", () => {
    expect(stripWhiteMatte(Buffer.alloc(16), W, H)).toBe(false);
  });
});
