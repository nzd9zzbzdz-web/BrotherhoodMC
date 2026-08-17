import "server-only";
import {
  initializeApp,
  getApps,
  cert,
  type App,
  type AppOptions,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-brotherhood-portal";

function buildOptions(): AppOptions {
  // Against emulators the Admin SDK needs no credentials — it auto-detects
  // FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST.
  const options: AppOptions = {
    projectId: PROJECT_ID,
    storageBucket:
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
      `${PROJECT_ID}.appspot.com`,
  };
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (b64 && !process.env.FIRESTORE_EMULATOR_HOST) {
    options.credential = cert(readServiceAccount(b64));
  }
  return options;
}

/**
 * Decode the service account key, or explain what is wrong with it.
 *
 * This runs at import time, so a bad value fails `next build` during "Collecting
 * page data" with whatever error escapes here. A raw `JSON.parse` throws
 * "Unexpected end of JSON input", which names neither the variable nor the
 * cause; the usual cause is a placeholder that survived a copy/paste, and a
 * placeholder decodes to an empty string because it holds no base64 characters.
 */
function readServiceAccount(b64: string): Record<string, unknown> {
  const json = Buffer.from(b64, "base64").toString("utf8").trim();
  const fail = (why: string): never => {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT_B64 is set but ${why}. It must be the whole ` +
        `service account JSON file, base64 encoded, on one line. ` +
        `PowerShell: [Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))`,
    );
  };
  if (!json) fail("decodes to nothing, so it is not base64 (a leftover placeholder does this)");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fail("does not decode to JSON, so it is truncated or not base64");
  }
  if (!parsed || typeof parsed !== "object") fail("decodes to JSON that is not an object");
  const account = parsed as Record<string, unknown>;
  if (!account.project_id || !account.private_key) {
    fail("decodes to JSON without project_id and private_key, so it is not a service account key");
  }
  return account;
}

function getAdminApp(): App {
  return getApps()[0] ?? initializeApp(buildOptions());
}

export const adminApp = getAdminApp();
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
export const adminStorage = getStorage(adminApp);
export { FieldPath, FieldValue, Timestamp };

/** Root doc ref for an org. All org-scoped paths derive from here so a forged
 *  document id can never escape its tenant. */
export function orgRef(orgId: string) {
  return adminDb.collection("organizations").doc(orgId);
}
