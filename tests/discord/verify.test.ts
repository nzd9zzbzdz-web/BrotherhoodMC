/**
 * Ed25519 signature verification for Discord interactions. Pure crypto, no
 * emulator: a generated keypair stands in for Discord's application key.
 */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyDiscordSignature } from "@/lib/discord/verify";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
// Discord hands out the 32 raw key bytes as hex; SPKI DER ends with exactly those.
const publicHex = publicKey
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("hex");

const timestamp = "1723400000";
const body = '{"type":1}';
const goodSig = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");

describe("verifyDiscordSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifyDiscordSignature(publicHex, goodSig, timestamp, body)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyDiscordSignature(publicHex, goodSig, timestamp, '{"type":2}')).toBe(false);
  });

  it("rejects a shifted timestamp", () => {
    expect(verifyDiscordSignature(publicHex, goodSig, "1723400001", body)).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const other = generateKeyPairSync("ed25519");
    const otherSig = sign(null, Buffer.from(timestamp + body), other.privateKey).toString("hex");
    expect(verifyDiscordSignature(publicHex, otherSig, timestamp, body)).toBe(false);
  });

  it("returns false on malformed inputs instead of throwing", () => {
    expect(verifyDiscordSignature("zz", goodSig, timestamp, body)).toBe(false);
    expect(verifyDiscordSignature(publicHex, "not-hex", timestamp, body)).toBe(false);
    expect(verifyDiscordSignature("", "", timestamp, body)).toBe(false);
  });
});
