"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrgRole } from "@/lib/auth/session";
import { createLinkCode, formatCode, unlinkUid } from "@/lib/discord/link";
import type { ActionResult } from "./activities";

const orgIdSchema = z.string().min(1);

/**
 * Mint a Discord link code for the signed-in account. The code is shown once
 * on the dashboard and proves the website half of the handshake; /link in
 * Discord proves the other half. Nothing to revalidate: minting a code
 * changes no rendered data.
 */
export async function createDiscordLinkCode(
  rawOrgId: string,
): Promise<ActionResult<{ code: string; expiresAtMs: number }>> {
  const parsed = orgIdSchema.safeParse(rawOrgId);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  try {
    const access = await requireOrgRole(parsed.data, "member");
    const { code, expiresAtMs } = await createLinkCode(access.user.uid, parsed.data);
    return { ok: true, data: { code: formatCode(code), expiresAtMs } };
  } catch (e) {
    return failure(e);
  }
}

/** Sever the signed-in account's Discord link from the website side. */
export async function unlinkDiscord(rawOrgId: string): Promise<ActionResult> {
  const parsed = orgIdSchema.safeParse(rawOrgId);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  try {
    const access = await requireOrgRole(parsed.data, "member");
    await unlinkUid(access.user.uid, parsed.data);
    // The dashboard shows link status; no org-cached read carries it, so the
    // page revalidate alone is the whole story.
    revalidatePath(`/[orgSlug]/portal`, "page");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

function failure(e: unknown): { ok: false; error: string } {
  if (e instanceof Error && e.name === "AuthError") {
    return { ok: false, error: e.message === "unauthenticated" ? "Sign in required" : "Not permitted" };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong" };
}
