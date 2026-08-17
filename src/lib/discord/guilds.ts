import "server-only";
import { cache } from "react";
import { FieldValue, adminDb, orgRef } from "@/lib/firebase/admin";
import { getOrgById } from "@/lib/tenant";
import type { Organization } from "@/lib/types";

/**
 * Which clubs a Discord server hosts, and where each one's tickets land.
 *
 * ONE SERVER CAN HOST SEVERAL CLUBS: a network server gives each club its own
 * private category, so the binding is per CLUB (doc id = orgId) rather than
 * per server. That also makes the two lookups this module owes cheap and
 * direct: a club's officer channel is one document read, and "which clubs
 * live in this server" is one indexed query.
 *
 * A club belongs to at most one server — its Discord home — so binding it
 * again simply moves it.
 *
 * Written only by /connect, which demands the club's ADMIN role through the
 * account link. Root collection `discordClubs`, server-only in rules like
 * invites and link codes.
 *
 * Deliberately not cross-request cached: one doc read per Discord command is
 * noise next to a portal page, and a stale binding would misroute a club.
 * React cache() dedupes within a single interaction.
 */

export interface ClubBinding {
  orgId: string;
  guildId: string;
  /** Where this club's tickets land for review. Absent ⇒ env fallback. */
  officerChannelId?: string;
  /** Where this club's Activity Logger card lives, so /connect can post it
   *  and a later reconnect knows where it went. */
  ticketChannelId?: string;
  /** The pinned Club Bank card, so every approval can edit its balance in
   *  place. Absent ⇒ no card posted, and the refresh is a no-op. */
  bankPanel?: { channelId: string; messageId: string };
}

function toBinding(
  orgId: string,
  data: FirebaseFirestore.DocumentData,
): ClubBinding | null {
  if (typeof data.guildId !== "string") return null;
  return {
    orgId,
    guildId: data.guildId,
    ...(typeof data.officerChannelId === "string"
      ? { officerChannelId: data.officerChannelId }
      : {}),
    ...(typeof data.ticketChannelId === "string"
      ? { ticketChannelId: data.ticketChannelId }
      : {}),
    ...(typeof data.bankPanel?.channelId === "string" &&
    typeof data.bankPanel?.messageId === "string"
      ? { bankPanel: { channelId: data.bankPanel.channelId, messageId: data.bankPanel.messageId } }
      : {}),
  };
}

/** Remember where the Club Bank card was posted, so approvals can edit it. */
export async function setBankPanel(
  orgId: string,
  panel: { channelId: string; messageId: string },
): Promise<void> {
  await adminDb
    .collection("discordClubs")
    .doc(orgId)
    .set({ bankPanel: panel, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** One club's Discord home, or null when it has never been connected. */
export const getClubBinding = cache(
  async (orgId: string): Promise<ClubBinding | null> => {
    const snap = await adminDb.collection("discordClubs").doc(orgId).get();
    const data = snap.data();
    return data ? toBinding(orgId, data) : null;
  },
);

/** Every club this server hosts, in binding order. Empty for an unbound
 *  server, which then falls back to the DISCORD_ORG_ID pin. */
export const clubsInGuild = cache(
  async (guildId: string): Promise<Organization[]> => {
    const snap = await adminDb
      .collection("discordClubs")
      .where("guildId", "==", guildId)
      .get();
    const orgs = await Promise.all(snap.docs.map((d) => getOrgById(d.id)));
    return orgs.filter((o): o is Organization => o !== null);
  },
);

/** Bind a club to a server (merge: rebinding without a channel keeps the old
 *  channel). Audited in the club's own log. */
export async function bindClub(opts: {
  orgId: string;
  guildId: string;
  officerChannelId?: string;
  ticketChannelId?: string;
  connectedBy: string;
}): Promise<void> {
  await adminDb
    .collection("discordClubs")
    .doc(opts.orgId)
    .set(
      {
        guildId: opts.guildId,
        ...(opts.officerChannelId
          ? { officerChannelId: opts.officerChannelId }
          : {}),
        ...(opts.ticketChannelId
          ? { ticketChannelId: opts.ticketChannelId }
          : {}),
        connectedBy: opts.connectedBy,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  await orgRef(opts.orgId).collection("auditLogs").add({
    actorUid: opts.connectedBy,
    action: "discord.connect",
    targetPath: `discordClubs/${opts.orgId}`,
    detail: opts.officerChannelId
      ? `guild ${opts.guildId}, officer channel ${opts.officerChannelId}`
      : `guild ${opts.guildId}`,
    at: FieldValue.serverTimestamp(),
  });
}

/**
 * Where a club's ticket notifications go: its own bound channel, or the
 * single-club env fallback when this org is the env-pinned one.
 */
export async function officerChannelFor(orgId: string): Promise<string | null> {
  const binding = await getClubBinding(orgId);
  if (binding?.officerChannelId) return binding.officerChannelId;
  if (
    process.env.DISCORD_OFFICER_CHANNEL_ID &&
    orgId === process.env.DISCORD_ORG_ID
  ) {
    return process.env.DISCORD_OFFICER_CHANNEL_ID;
  }
  return null;
}
