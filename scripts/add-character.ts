/**
 * Add (or replace) a member's character render for the character screen.
 *
 *   npm run add-character -- <image> <memberId> [orgId]
 *   e.g. npm run add-character -- "C:\renders\six.png" m-six
 *
 * Accepts any PNG/JPG/WebP. If the image has a baked-in checkerboard or a
 * light studio background, it is keyed out automatically (flood fill from the
 * edges, so light areas inside the figure survive). Output lands at
 * public/brand/members/<memberId>.webp — the convention the seed picks up —
 * and the live member doc's photoPath is updated when Firestore is reachable.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import sharp from "sharp";
import {
  keyOutLightBackground,
  needsBackgroundKeying,
} from "../src/lib/character-key";

const [, , inputPath, memberId, orgIdArg] = process.argv;
const ORG_ID = orgIdArg ?? "brotherhood";

if (!inputPath || !memberId) {
  console.error('Usage: npm run add-character -- <image> <memberId> [orgId]');
  process.exit(1);
}

const OUT = `public/brand/members/${memberId}.webp`;

async function main() {
  const src = sharp(inputPath).ensureAlpha();
  const { data, info } = await src
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  if (needsBackgroundKeying(pixels, width, height)) {
    const { cleared } = keyOutLightBackground(pixels, width, height);
    console.log(`keyed out ${cleared} background pixels (${Math.round((cleared / (width * height)) * 100)}%)`);
  } else {
    console.log("image already has transparency — skipping background keying");
  }

  await sharp(data, { raw: { width, height, channels: 4 } })
    .resize({ height: Math.min(height, 1254), fit: "inside" })
    .webp({ quality: 88 })
    .toFile(OUT);
  console.log(`wrote ${OUT}`);

  // Best effort: point the live member doc at the new art (emulator or live).
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
    try {
      const { initializeApp, getApps } = await import("firebase-admin/app");
      const { getFirestore } = await import("firebase-admin/firestore");
      const projectId =
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-brotherhood-portal";
      const app = getApps()[0] ?? initializeApp({ projectId });
      const db = getFirestore(app);
      const ref = db.doc(`organizations/${ORG_ID}/members/${memberId}`);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.update({ photoPath: `/brand/members/${memberId}.webp` });
        console.log(`updated ${ORG_ID}/${memberId} photoPath in Firestore`);
      } else {
        console.log(`member ${memberId} not found in Firestore — run npm run seed (the convention picks the file up)`);
      }
    } catch (e) {
      console.log(`Firestore update skipped (${(e as Error).message}) — re-seed to apply`);
    }
  } else {
    console.log("no Firestore configured — file written; npm run seed will pick it up");
  }
}

main();
