import "server-only";
import { officerChannelFor } from "@/lib/discord/guilds";
import { TREASURY_BOOK_LABEL, formatMoney } from "@/lib/constants";
import type { TreasuryBook, TreasuryTxKind } from "@/lib/types";

/**
 * Outbound Discord messages: the officer channel's heads-up when a ticket is
 * filed, whichever surface filed it. This is the one place the app SENDS to
 * Discord (the interactions route only answers), so it needs the bot token;
 * with no token or channel configured the whole feature is quietly off, and a
 * delivery failure is logged but NEVER fails the submission it rides behind.
 * The channel is the club's own: its guild binding first, the single-club
 * env fallback second (see officerChannelFor).
 */

export interface TicketNotice {
  activityId: string;
  /** The club the ticket belongs to. Rides in the button ids because one
   *  server can host several clubs, so the guild cannot say which. */
  orgId: string;
  /** `"Reaper" Marcus Vane` */
  memberLabel: string;
  /** `Drug Sale ×20 · Felony` — describeActivity's line. */
  summary: string;
  description: string;
}

/** The message payload, split out pure so tests can pin the shape. */
export function buildTicketMessage(input: TicketNotice): Record<string, unknown> {
  const description =
    input.description.length > 500
      ? `${input.description.slice(0, 500)}...`
      : input.description;
  return {
    content: [
      `**New ticket** from ${input.memberLabel}`,
      input.summary,
      `> ${description}`,
    ].join("\n"),
    // Member-typed text rides in this message; without this a description
    // containing @everyone would ping the whole channel.
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 1, // action row
        components: [
          {
            type: 2, // button
            style: 3, // success (green)
            label: "Approve",
            custom_id: `review:approve:${input.orgId}:${input.activityId}`,
          },
          {
            type: 2,
            style: 4, // danger (red)
            label: "Deny",
            custom_id: `review:deny:${input.orgId}:${input.activityId}`,
          },
        ],
      },
    ],
  };
}

export interface TreasuryNotice {
  txId: string;
  /** Same reason the ticket buttons carry it: one server, several clubs. */
  orgId: string;
  kind: TreasuryTxKind;
  /** Which book approving it would move. On the notice because it changes the
   *  decision: the reviewer should not have to open the site to find out. */
  book: TreasuryBook;
  amount: number;
  /** `"Reaper" Marcus Vane` — whose movement it is. */
  memberLabel: string;
  note: string;
}

const TREASURY_KIND_LABEL: Record<TreasuryTxKind, string> = {
  dues: "Dues payment",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
};

/** The money-ticket payload, split out pure so tests can pin the shape. */
export function buildTreasuryMessage(input: TreasuryNotice): Record<string, unknown> {
  const note = input.note.length > 300 ? `${input.note.slice(0, 300)}...` : input.note;
  const book = TREASURY_BOOK_LABEL[input.book].toLowerCase();
  return {
    content: [
      `**${TREASURY_KIND_LABEL[input.kind]}** of ${formatMoney(input.amount)} from ${input.memberLabel} · ${book} book`,
      ...(note ? [`> ${note}`] : []),
      "Admins and the Treasurer rule on the bank.",
    ].join("\n"),
    // Member-typed note: never let an @everyone in it ping the channel.
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 1, // action row
        components: [
          {
            type: 2, // button
            style: 3, // success (green)
            label: "Approve",
            custom_id: `treasury:approve:${input.orgId}:${input.txId}`,
          },
          {
            type: 2,
            style: 4, // danger (red)
            label: "Deny",
            custom_id: `treasury:deny:${input.orgId}:${input.txId}`,
          },
        ],
      },
    ],
  };
}

/** Post a money movement to the club's officer channel. Same silent-skip and
 *  never-fails contract as the activity notification it mirrors. */
export async function notifyTreasurySubmitted(
  orgId: string,
  input: TreasuryNotice,
): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;
  const channel = await officerChannelFor(orgId);
  if (!channel) return;

  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channel}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildTreasuryMessage(input)),
      },
    );
    if (!res.ok) {
      console.error(`Discord treasury notify failed: ${res.status} ${await res.text()}`);
    }
  } catch (e) {
    console.error("Discord treasury notify failed:", e);
  }
}

/**
 * Post the Activity Logger card into a channel and pin it.
 *
 * Unlike the ticket notification this REPORTS its outcome instead of
 * swallowing it: an admin who asked for a card needs to know it did not
 * arrive. Pinning is best-effort and reported separately, because it needs
 * Manage Messages, which the bot may not have been granted; an unpinned card
 * still works, it just scrolls away.
 */
export type PanelPostResult =
  | { ok: true; pinned: boolean; messageId: string }
  | { ok: false; reason: string };

export async function postPanel(
  channelId: string,
  payload: Record<string, unknown>,
): Promise<PanelPostResult> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, reason: "the bot is not configured" };
  const headers = {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  };

  let messageId: string;
  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      { method: "POST", headers, body: JSON.stringify(payload) },
    );
    if (!res.ok) {
      const detail = await res.text();
      console.error(`Discord panel post failed: ${res.status} ${detail}`);
      return {
        ok: false,
        reason:
          res.status === 403
            ? "the bot cannot post in that channel"
            : `Discord refused the card (${res.status})`,
      };
    }
    messageId = ((await res.json()) as { id: string }).id;
  } catch (e) {
    console.error("Discord panel post failed:", e);
    return { ok: false, reason: "Discord could not be reached" };
  }

  try {
    const pin = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/pins/${messageId}`,
      { method: "PUT", headers },
    );
    return { ok: true, pinned: pin.ok, messageId };
  } catch {
    return { ok: true, pinned: false, messageId };
  }
}

/**
 * Re-render the pinned Club Bank card with the current balance of both books.
 *
 * Called after every approved movement, from BOTH transports. Best-effort in
 * the same spirit as notifyTicketSubmitted: a failed edit leaves a stale
 * number on a card, which must never be allowed to fail the approval that
 * already committed. No card bound ⇒ nothing to do.
 */
export async function updateBankPanel(orgId: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;

  try {
    const [{ getClubBinding }, { getTreasuryBalances }, { getOrgById, getBranding }] =
      await Promise.all([
        import("@/lib/discord/guilds"),
        import("@/lib/queries"),
        import("@/lib/tenant"),
      ]);
    const binding = await getClubBinding(orgId);
    const panel = binding?.bankPanel;
    if (!panel) return;

    const [balances, org, branding] = await Promise.all([
      getTreasuryBalances(orgId),
      getOrgById(orgId),
      getBranding(orgId, "portal"),
    ]);
    const { buildBankPanelMessage } = await import("@/lib/discord/bank-panel");
    const { hexToInt } = await import("@/lib/discord/panel");

    const res = await fetch(
      `https://discord.com/api/v10/channels/${panel.channelId}/messages/${panel.messageId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildBankPanelMessage({
            orgId,
            orgName: org?.name ?? orgId,
            balances,
            accentColor: hexToInt(branding?.colors?.primary),
          }),
        ),
      },
    );
    if (!res.ok) {
      console.error(`Discord bank panel refresh failed: ${res.status} ${await res.text()}`);
    }
  } catch (e) {
    console.error("Discord bank panel refresh failed:", e);
  }
}

/** Post the ticket to the club's officer channel. Skips silently when the
 *  feature is unconfigured or this club has no channel to receive it. */
export async function notifyTicketSubmitted(
  orgId: string,
  input: TicketNotice,
): Promise<void> {
  // Token first: without one there is nothing to send with, and the channel
  // lookup below is a Firestore read the submission should not pay for.
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;
  const channel = await officerChannelFor(orgId);
  if (!channel) return;

  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channel}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildTicketMessage(input)),
      },
    );
    if (!res.ok) {
      console.error(`Discord notify failed: ${res.status} ${await res.text()}`);
    }
  } catch (e) {
    console.error("Discord notify failed:", e);
  }
}
