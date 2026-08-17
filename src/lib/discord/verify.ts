import "server-only";
import { createPublicKey, verify as edVerify } from "node:crypto";

/**
 * Discord signs every interaction POST with the application's Ed25519 key:
 * signature over `timestamp + rawBody`, both key and signature sent as hex.
 * Discord rejects an endpoint that fails to enforce this, and it is the only
 * thing standing between the route and anyone who learns the URL.
 *
 * Dependency-free on purpose: node:crypto verifies Ed25519 natively; it just
 * wants the key as SPKI DER rather than Discord's 32 raw bytes, and the SPKI
 * wrapper for an Ed25519 key is a constant 12-byte prefix.
 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  rawBody: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return edVerify(
      null,
      Buffer.from(timestamp + rawBody),
      key,
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    // Malformed hex or a key of the wrong size is a bad request, not a crash.
    return false;
  }
}
