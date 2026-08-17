/**
 * The Admin SDK app the scripts run against.
 *
 * Every live script guards on "FIREBASE_SERVICE_ACCOUNT_B64 or
 * GOOGLE_APPLICATION_CREDENTIALS is set", but `initializeApp({ projectId })`
 * only ever reads the second one: with no `credential` the SDK falls back to
 * Application Default Credentials, and ADC does not know about the base64
 * variable. So the b64 path passed the guard and then failed at the first
 * write with "Could not load the default credentials", which points at
 * something the operator did not do wrong.
 *
 * The base64 variable is the one people already have, because it is what the
 * hosting environment needs. This decodes it into a real credential so the
 * guard and the behaviour agree.
 *
 * The runtime has its own copy of this in `src/lib/firebase/admin.ts`. They are
 * separate on purpose: that module is `server-only` and cannot be imported from
 * a script.
 */
import {
  cert,
  getApps,
  initializeApp,
  type App,
  type AppOptions,
} from "firebase-admin/app";

/**
 * True when this process is pointed at the emulator suite, in which case no
 * credential is needed or wanted.
 */
export function usingEmulators(): boolean {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST);
}

/** True when a live run has something to authenticate with. */
export function hasLiveCredentials(): boolean {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_B64 ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
  );
}

/**
 * Initialize (or reuse) the Admin app for a script.
 *
 * Against emulators this needs no credential. Against live it prefers the
 * decoded service account and otherwise leaves ADC to find
 * GOOGLE_APPLICATION_CREDENTIALS.
 */
export function scriptApp(projectId: string): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const options: AppOptions = { projectId };
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (b64 && !usingEmulators()) {
    options.credential = cert(readServiceAccount(b64));
  }
  return initializeApp(options);
}

/** Decode the service account key, or say what is wrong with it. */
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
