/**
 * Firestore security rules tests — multi-tenant isolation.
 * Requires the Firestore emulator running on 127.0.0.1:8080.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

let env: RulesTestEnvironment;

// Isolated project id — NEVER the app's demo project, so tests can't clobber
// seeded data (the emulator keys datastores by project id).
const TEST_PROJECT_ID = "rules-test-isolated";

const ORG_A = "rules-org-a";
const ORG_B = "rules-org-b";

/** Claims shape used across the app: orgs: { [orgId]: { r, m } } */
const memberOfA = { orgs: { [ORG_A]: { r: "member", m: "member-a1" } } };
const officerOfA = { orgs: { [ORG_A]: { r: "officer", m: "officer-a1" } } };
const memberOfB = { orgs: { [ORG_B]: { r: "member", m: "member-b1" } } };

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: TEST_PROJECT_ID,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8"),
    },
  });

  // Seed both orgs with admin privileges (bypasses rules).
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `organizations/${ORG_A}`), { name: "Org A", slug: ORG_A });
    await setDoc(doc(db, `organizations/${ORG_B}`), { name: "Org B", slug: ORG_B });
    await setDoc(doc(db, `organizations/${ORG_A}/members/member-a1`), {
      roadName: "Ace",
      uid: "uid-a1",
    });
    await setDoc(doc(db, `organizations/${ORG_A}/members/member-a1/notes/n1`), {
      body: "officer eyes only",
    });
    await setDoc(doc(db, `organizations/${ORG_B}/members/member-b1`), {
      roadName: "Raven",
      uid: "uid-b1",
    });
    await setDoc(doc(db, `organizations/${ORG_A}/activities/act1`), {
      memberId: "member-a1",
      status: "pending",
    });
    await setDoc(doc(db, `organizations/${ORG_A}/invites/i1`), { token: "secret" });
  });
});

afterAll(async () => {
  await env.cleanup();
});

describe("cross-org isolation", () => {
  it("org B member cannot read org A's org doc", async () => {
    const db = env.authenticatedContext("uid-b1", memberOfB).firestore();
    await assertFails(getDoc(doc(db, `organizations/${ORG_A}`)));
  });

  it("org B member cannot read org A members", async () => {
    const db = env.authenticatedContext("uid-b1", memberOfB).firestore();
    await assertFails(getDoc(doc(db, `organizations/${ORG_A}/members/member-a1`)));
  });

  it("org A member CAN read own org's members", async () => {
    const db = env.authenticatedContext("uid-a1", memberOfA).firestore();
    await assertSucceeds(getDoc(doc(db, `organizations/${ORG_A}/members/member-a1`)));
  });

  it("unauthenticated users are denied everywhere", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `organizations/${ORG_A}`)));
    await assertFails(getDoc(doc(db, `organizations/${ORG_A}/members/member-a1`)));
  });
});

describe("officer-only notes", () => {
  it("regular member cannot read officer notes", async () => {
    const db = env.authenticatedContext("uid-a1", memberOfA).firestore();
    await assertFails(
      getDoc(doc(db, `organizations/${ORG_A}/members/member-a1/notes/n1`)),
    );
  });

  it("officer can read officer notes", async () => {
    const db = env.authenticatedContext("uid-o1", officerOfA).firestore();
    await assertSucceeds(
      getDoc(doc(db, `organizations/${ORG_A}/members/member-a1/notes/n1`)),
    );
  });
});

describe("client writes", () => {
  it("clients cannot write activities directly", async () => {
    const db = env.authenticatedContext("uid-a1", memberOfA).firestore();
    await assertFails(
      setDoc(doc(db, `organizations/${ORG_A}/activities/hack`), {
        memberId: "member-a1",
        status: "approved", // trying to self-approve
      }),
    );
  });

  it("clients cannot write awardedPatches", async () => {
    const db = env.authenticatedContext("uid-a1", memberOfA).firestore();
    await assertFails(
      setDoc(doc(db, `organizations/${ORG_A}/awardedPatches/member-a1_fake`), {
        memberId: "member-a1",
        patchId: "fake",
      }),
    );
  });

});

describe("invites", () => {
  it("invites are never client-readable", async () => {
    const db = env.authenticatedContext("uid-a1", memberOfA).firestore();
    await assertFails(getDoc(doc(db, `organizations/${ORG_A}/invites/i1`)));
  });
});
