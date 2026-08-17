import "server-only";
import {
  EngineError,
  SubmissionError,
  approveActivityTx,
  denyActivityCore,
  submitActivityCore,
} from "@/lib/activities-core";
import { describeActivity } from "@/lib/activity-entries";
import { expireOrgTags } from "@/lib/cache";
import {
  CRIMINAL_RECORD_ROWS,
  PATCH_LADDERS,
  STAT_LABELS,
  TREASURY_BOOK_LABEL,
  formatMoney,
} from "@/lib/constants";
import { bindClub, clubsInGuild, setBankPanel } from "@/lib/discord/guilds";
import {
  BANK_MODAL_PREFIX,
  BANK_SELECT_PREFIX,
  buildBankModal,
  buildBankPanelMessage,
  isTxKind,
  parseBankChoice,
} from "@/lib/discord/bank-panel";
import {
  consumeLinkCode,
  findUserByDiscordId,
  resolveWitnesses,
  unlinkDiscordId,
} from "@/lib/discord/link";
import {
  PANEL_MODAL_PREFIX,
  PANEL_SELECT_PREFIX,
  buildPanelMessage,
  buildPanelModal,
  hexToInt,
} from "@/lib/discord/panel";
import {
  notifyTicketSubmitted,
  notifyTreasurySubmitted,
  postPanel,
  updateBankPanel,
} from "@/lib/discord/notify";
import { composeLeaderboard, type LeaderboardCategory } from "@/lib/leaderboard";
import {
  getActivity,
  getMember,
  getTreasuryBalances,
  getTreasuryTx,
  listActivityTypes,
  listAwardsByMember,
  listMembers,
  listPatches,
  listRanks,
  listTreasuryLedger,
} from "@/lib/queries";
import { getBranding, getOrgById, getOrgBySlug, listActiveOrgs } from "@/lib/tenant";
import { submitActivitySchema } from "@/lib/schemas/activity";
import { submitTreasuryTxSchema } from "@/lib/schemas/treasury";
import {
  TreasuryError,
  approveTreasuryTxCore,
  bookOf,
  canReviewTreasury,
  denyTreasuryTxCore,
  insufficientFundsMessage,
  isDuesCurrent,
  memberRankFresh,
  submitTreasuryTxCore,
} from "@/lib/treasury-core";
import type {
  Member,
  Organization,
  StatKey,
  SystemRole,
  TreasuryBook,
  TreasuryTxKind,
} from "@/lib/types";

/**
 * The Discord transport's command dispatch, kept apart from the HTTP route so
 * tests can drive commands without signing requests. Reads come from the same
 * cached queries the portal pages use. Writes are the account-linking ones in
 * src/lib/discord/link.ts and TICKET SUBMISSION via submitActivityCore, the
 * exact pipeline the website's Server Action wraps: same validation, same
 * denormalized entries, same 20-a-day rate-limit pool (keyed by uid, so the
 * two surfaces share one allowance). Submission needs no cache invalidation:
 * pending tickets are read via the deliberately-uncached listActivities.
 * Nothing here may import an action module (the updateTag rule).
 */

/** The slice of Discord's wire protocol this bot speaks. Not a client library. */
export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  Autocomplete: 4,
  ModalSubmit: 5,
} as const;
export const ResponseType = {
  Pong: 1,
  ChannelMessage: 4,
  UpdateMessage: 7,
  Autocomplete: 8,
  Modal: 9,
} as const;
const EPHEMERAL = 64; // message flag: only the invoker sees the reply

interface DiscordUser {
  id: string;
  username?: string;
  global_name?: string;
}

export interface DiscordInteraction {
  type: number;
  data?: {
    name?: string;
    /** Modal submits: which form came back, e.g. "ticket:drug-sale". */
    custom_id?: string;
    options?: {
      name: string;
      type: number;
      value?: string | number | boolean;
      /** Autocomplete: the option the user is currently typing. */
      focused?: boolean;
    }[];
    /** Select menus: which options were chosen. */
    values?: string[];
    /**
     * Modal submits. Two shapes: a Label (type 18) wrapping ONE input in
     * `component`, which is the current form, and the deprecated Action Row
     * (type 1) holding inputs in `components`. Both are read.
     */
    components?: {
      type: number;
      custom_id?: string;
      value?: string;
      values?: string[];
      component?: {
        type: number;
        custom_id?: string;
        value?: string;
        values?: string[];
      };
      components?: {
        type: number;
        custom_id?: string;
        value?: string;
        values?: string[];
      }[];
    }[];
  };
  /** Present when invoked in a server; `user` when invoked from a DM. */
  member?: { user?: DiscordUser };
  user?: DiscordUser;
  /** Component clicks: the message the button lives on. */
  message?: { content?: string };
  /** The server the interaction came from; absent in DMs. Signed, so it is
   *  Discord's word on WHERE, the way `member.user` is its word on WHO. */
  guild_id?: string;
  /** The channel the interaction came from. Signed like guild_id, which is
   *  what lets /bankpanel record where it posted the card. */
  channel_id?: string;
}

export interface InteractionResponse {
  type: number;
  data?: Record<string, unknown> & { content?: string; flags?: number };
}

function reply(content: string): InteractionResponse {
  return { type: ResponseType.ChannelMessage, data: { content, flags: EPHEMERAL } };
}

/** Who ran the command, straight from the signed payload. */
function invoker(interaction: DiscordInteraction): DiscordUser | null {
  return interaction.member?.user ?? interaction.user ?? null;
}

function stringOption(
  interaction: DiscordInteraction,
  name: string,
): string | null {
  const value = interaction.data?.options?.find((o) => o.name === name)?.value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integerOption(
  interaction: DiscordInteraction,
  name: string,
): number | null {
  const value = interaction.data?.options?.find((o) => o.name === name)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Which club an interaction speaks to.
 *
 * A network server hosts several clubs, one private category each, so the
 * server alone no longer names a club. Precedence:
 *   1. an explicit `club:<slug>` option, checked against this server's clubs
 *   2. the only club this server hosts
 *   3. the only one of this server's clubs the CALLER rides with — which is
 *      what makes the common case invisible: a member of one club never
 *      types a slug, wherever in the server they are
 *   4. the DISCORD_ORG_ID pin, for a server with no bindings at all and for
 *      DMs (the single-club deployment keeps working untouched)
 * Anything still undecided comes back `ambiguous`, carrying the candidates so
 * the reply can name them.
 *
 * A suspended club resolves to nothing: its portal is frozen for everyone, and
 * the bot follows requireOrgRole's lead by reading as disconnected.
 */
type OrgPick =
  | { kind: "ok"; org: Organization }
  | { kind: "none" }
  | { kind: "unknown_club"; orgs: Organization[] }
  | { kind: "ambiguous"; orgs: Organization[] };

async function pickOrg(interaction: DiscordInteraction): Promise<OrgPick> {
  const hosted = interaction.guild_id
    ? (await clubsInGuild(interaction.guild_id)).filter(
        (o) => o.status !== "suspended",
      )
    : [];

  // An unbound server (or a DM) falls back to the env pin.
  if (hosted.length === 0) {
    const orgId = process.env.DISCORD_ORG_ID;
    const org = orgId ? await getOrgById(orgId) : null;
    return org && org.status !== "suspended" ? { kind: "ok", org } : { kind: "none" };
  }

  const slug = stringOption(interaction, "club");
  if (slug) {
    const needle = slug.toLowerCase();
    const named = hosted.find(
      (o) => o.slug.toLowerCase() === needle || o.id.toLowerCase() === needle,
    );
    return named
      ? { kind: "ok", org: named }
      : { kind: "unknown_club", orgs: hosted };
  }

  if (hosted.length === 1) return { kind: "ok", org: hosted[0] };

  // Narrow to the caller's own clubs before giving up.
  const user = invoker(interaction);
  const linked = user?.id ? await findUserByDiscordId(user.id) : null;
  const mine = linked
    ? hosted.filter((o) => Boolean(linked.memberships?.[o.id]))
    : [];
  if (mine.length === 1) return { kind: "ok", org: mine[0] };
  return { kind: "ambiguous", orgs: mine.length > 1 ? mine : hosted };
}

/** "Ravens of Death MC (ravens), Ninth Circle (ninth-circle)" */
function clubChoices(orgs: Organization[]): string {
  return orgs.map((o) => `${o.name} (${o.slug})`).join(", ");
}

/**
 * Resolve an interaction to a club AND the caller's member record in it, the
 * shape every member-scoped command needs. Returns a ready-made reply for
 * every failure so the commands stay about their own work.
 */
type ClubContext =
  | { kind: "ok"; org: Organization; uid: string; member: Member; role: SystemRole }
  | { kind: "fail"; response: InteractionResponse };

async function resolveContext(
  interaction: DiscordInteraction,
  command: string,
  /** Appended to the "not linked yet" reply, where a command has a way to be
   *  useful without a link (looking a member up by road name). */
  unlinkedHint?: string,
): Promise<ClubContext> {
  const pick = await pickOrg(interaction);
  if (pick.kind === "none") {
    return { kind: "fail", response: reply("This bot is not connected to a club yet.") };
  }
  if (pick.kind === "unknown_club") {
    return {
      kind: "fail",
      response: reply(`This server hosts: ${clubChoices(pick.orgs)}.`),
    };
  }
  if (pick.kind === "ambiguous") {
    return {
      kind: "fail",
      response: reply(
        `Name the club: /${command} club:<slug>. Here: ${clubChoices(pick.orgs)}.`,
      ),
    };
  }

  const org = pick.org;
  const resolved = await resolveLinkedMember(org, interaction);
  if (resolved.kind === "unlinked") {
    return {
      kind: "fail",
      response: reply(
        "Link your Discord account first: generate a code on the portal " +
          "dashboard, then run /link code:<your code>." +
          (unlinkedHint ? ` ${unlinkedHint}` : ""),
      ),
    };
  }
  if (resolved.kind === "no_member") {
    return {
      kind: "fail",
      response: reply(`Your portal account has no member record with ${org.name}.`),
    };
  }
  return { kind: "ok", org, uid: resolved.uid, member: resolved.member, role: resolved.role };
}

/**
 * Resolve the invoker to their member record in ONE club through the account
 * link. The memberships mirror on users/{uid} is what custom claims are built
 * FROM (syncUserClaims), so trusting it here matches the website's authority.
 */
type LinkedMember =
  | { kind: "ok"; uid: string; member: Member; role: SystemRole }
  | { kind: "unlinked" }
  | { kind: "no_member" };

async function resolveLinkedMember(
  org: Organization,
  interaction: DiscordInteraction,
): Promise<LinkedMember> {
  const user = invoker(interaction);
  const linked = user?.id ? await findUserByDiscordId(user.id) : null;
  if (!linked) return { kind: "unlinked" };
  const membership = linked.memberships?.[org.id];
  const member = membership ? await getMember(org.id, membership.memberId) : null;
  if (!membership || !member) return { kind: "no_member" };
  return { kind: "ok", uid: linked.uid, member, role: membership.role };
}

// ── Slash commands ─────────────────────────────────────────────────────

export async function handleDiscordCommand(
  interaction: DiscordInteraction,
): Promise<InteractionResponse> {
  const command = interaction.data?.name;

  if (command === "ping") {
    // The one public reply: proving the bot is up is worth the channel seeing.
    return {
      type: ResponseType.ChannelMessage,
      data: { content: "Pong. The clubhouse is listening." },
    };
  }

  if (command === "mystats") return myStats(interaction);
  if (command === "link") return link(interaction);
  if (command === "unlink") return unlink(interaction);
  if (command === "ticket") return ticket(interaction);
  if (command === "leaderboard") return leaderboard(interaction);
  if (command === "connect") return connect(interaction);
  if (command === "panel") return panelCommand(interaction);
  if (command === "bank") return bank(interaction);
  if (command === "bankpanel") return bankPanelCommand(interaction);
  if (command === "dues") return moneyTicket(interaction, "dues");
  if (command === "deposit") return moneyTicket(interaction, "deposit");
  if (command === "withdraw") return moneyTicket(interaction, "withdrawal");

  return reply("Unknown command.");
}

// ── /panel: the permanent Activity Logger card ─────────────────────────

/**
 * Post the club's logger card into this channel. Admin-only like /connect,
 * because the card is club furniture rather than a personal action, and it is
 * bound to whichever club the runner administers.
 */
async function panelCommand(
  interaction: DiscordInteraction,
): Promise<InteractionResponse> {
  if (!interaction.guild_id) {
    return reply("Run /panel in the channel where the card should live.");
  }
  const pick = await pickOrg(interaction);
  if (pick.kind === "none") return reply("This bot is not connected to a club yet.");
  if (pick.kind !== "ok") {
    return reply(`Name the club: /panel club:<slug>. Here: ${clubChoices(pick.orgs)}.`);
  }
  const org = pick.org;

  const resolved = await resolveLinkedMember(org, interaction);
  if (resolved.kind === "unlinked") {
    return reply(
      "Link your Discord account first: generate a code on the portal " +
        "dashboard, then run /link code:<your code>.",
    );
  }
  if (resolved.kind === "no_member") {
    return reply(`Your portal account has no member record with ${org.name}.`);
  }
  if (resolved.role !== "admin") {
    return reply("Only a club admin can post the logger card.");
  }

  const types = (await listActivityTypes(org.id)).filter((t) => t.active);
  if (types.length === 0) {
    return reply(
      "This club has no active activity types yet. Add them in Admin, Activity Types.",
    );
  }

  // The card wears the club's own colour; anything not a plain hex falls back
  // to no accent rather than to another club's red.
  const branding = await getBranding(org.id, "portal");
  const message = buildPanelMessage({
    orgId: org.id,
    orgName: org.name,
    types,
    accentColor: hexToInt(branding?.colors?.primary),
  });
  return { type: ResponseType.ChannelMessage, data: message };
}

/** The card's dropdown: open the form for the chosen category. */
async function panelSelect(
  interaction: DiscordInteraction,
): Promise<InteractionResponse> {
  const orgId = (interaction.data?.custom_id ?? "").slice(PANEL_SELECT_PREFIX.length);
  const typeId = interaction.data?.values?.[0];
  if (!orgId || !typeId) return reply("Pick a category and try again.");

  const org = await getOrgById(orgId);
  if (!org || org.status === "suspended") {
    return reply("That club is no longer taking tickets.");
  }

  const resolved = await resolveLinkedMember(org, interaction);
  if (resolved.kind === "unlinked") {
    return reply(
      "Link your Discord account first: generate a code on the portal " +
        "dashboard, then run /link code:<your code>.",
    );
  }
  if (resolved.kind === "no_member") {
    return reply(`Your portal account has no member record with ${org.name}.`);
  }

  const type = (await listActivityTypes(org.id)).find(
    (t) => t.id === typeId && t.active,
  );
  if (!type) return reply("That category is no longer active.");

  return { type: ResponseType.Modal, data: buildPanelModal(org.id, type) };
}

// ── /connect: bind this guild to a club (multi-group) ──────────────────

/**
 * Run inside a server by a linked club ADMIN, this binds ONE club to this
 * server and names the channel its tickets land in. Run it once per club: a
 * network server hosting five clubs has five bindings, each with its own
 * officer channel, and members are told apart by their own memberships.
 * The admin role is proven the same way officer clicks are: signed invoker →
 * account link → membership role.
 */
async function connect(interaction: DiscordInteraction): Promise<InteractionResponse> {
  const guildId = interaction.guild_id;
  if (!guildId) {
    return reply("Run /connect inside the server you want to bind your club to.");
  }

  const user = invoker(interaction);
  const linked = user?.id ? await findUserByDiscordId(user.id) : null;
  if (!linked) {
    return reply(
      "Link your Discord account first: generate a code on the portal " +
        "dashboard, then run /link code:<your code>.",
    );
  }

  const adminOrgIds = Object.entries(linked.memberships ?? {})
    .filter(([, m]) => m.role === "admin")
    .map(([orgId]) => orgId);
  if (adminOrgIds.length === 0) {
    return reply("Only a club admin can connect a server.");
  }

  const slug = stringOption(interaction, "club");
  let orgId: string;
  if (slug) {
    const named = await getOrgBySlug(slug);
    if (!named || !adminOrgIds.includes(named.id)) {
      return reply(`You are not an admin of a club with the slug "${slug}".`);
    }
    orgId = named.id;
  } else if (adminOrgIds.length === 1) {
    orgId = adminOrgIds[0];
  } else {
    return reply(
      "You are an admin of several clubs. Name one: /connect club:<slug>",
    );
  }

  const channelId = stringOption(interaction, "channel");
  const ticketChannelId = stringOption(interaction, "tickets");
  await bindClub({
    orgId,
    guildId,
    ...(channelId ? { officerChannelId: channelId } : {}),
    ...(ticketChannelId ? { ticketChannelId } : {}),
    connectedBy: linked.uid,
  });

  const org = await getOrgById(orgId);
  const lines = [`Connected. ${org?.name ?? orgId} now rides in this server.`];

  lines.push(
    channelId
      ? `New tickets land in <#${channelId}> for review.`
      : "Set an officer channel with /connect channel:<channel> to receive tickets.",
  );

  // Naming a tickets channel puts the logger card there in the same breath,
  // so setting a club up is one command rather than two.
  if (ticketChannelId) {
    lines.push(await postLoggerCard(orgId, org?.name ?? orgId, ticketChannelId));
  } else {
    lines.push(
      "Add tickets:<channel> to have the Activity Logger card posted for members.",
    );
  }

  const hosted = await clubsInGuild(guildId);
  const others = hosted.filter((o) => o.id !== orgId);
  if (others.length) {
    lines.push(
      `Also here: ${clubChoices(others)}. Members are told apart by their own club, so nobody types a slug unless they ride with two.`,
    );
  }
  return reply(lines.join("\n"));
}

/** Build and post the club's logger card, reporting what actually happened. */
async function postLoggerCard(
  orgId: string,
  orgName: string,
  channelId: string,
): Promise<string> {
  const types = (await listActivityTypes(orgId)).filter((t) => t.active);
  if (types.length === 0) {
    return (
      `No card posted in <#${channelId}>: this club has no active activity ` +
      "types yet. Add them in Admin, Activity Types, then run /panel there."
    );
  }
  const branding = await getBranding(orgId, "portal");
  const result = await postPanel(
    channelId,
    buildPanelMessage({
      orgId,
      orgName,
      types,
      accentColor: hexToInt(branding?.colors?.primary),
    }),
  );
  if (!result.ok) {
    return `Could not post the Activity Logger card in <#${channelId}>: ${result.reason}. Run /panel in that channel to retry.`;
  }
  return result.pinned
    ? `Activity Logger card posted and pinned in <#${channelId}>.`
    : `Activity Logger card posted in <#${channelId}>. It could not be pinned (the bot needs Manage Messages there), so it will scroll away as the channel fills.`;
}

async function myStats(interaction: DiscordInteraction): Promise<InteractionResponse> {
  const query = stringOption(interaction, "member");

  // No argument: the caller means themselves, resolved through the link.
  if (!query) {
    const ctx = await resolveContext(
      interaction,
      "mystats",
      "You can also ask by road name: /mystats member:<road name>",
    );
    if (ctx.kind === "fail") return ctx.response;
    return recordReply(ctx.org, ctx.member);
  }

  // Looking someone else up needs a club but not a membership.
  const pick = await pickOrg(interaction);
  if (pick.kind === "none") return reply("This bot is not connected to a club yet.");
  if (pick.kind !== "ok") {
    return reply(
      `Name the club: /mystats club:<slug> member:${query}. ` +
        `Here: ${clubChoices(pick.orgs)}.`,
    );
  }
  const org = pick.org;

  const members = await listMembers(org.id);
  const needle = query.toLowerCase();
  const member =
    members.find((m) => m.roadName.toLowerCase() === needle) ??
    members.find((m) => m.displayName.toLowerCase() === needle);
  if (!member) {
    return reply(`No member named "${query}" rides with ${org.name}.`);
  }
  return recordReply(org, member);
}

async function link(interaction: DiscordInteraction): Promise<InteractionResponse> {
  const user = invoker(interaction);
  if (!user?.id) {
    return reply("Could not read your Discord account from this request.");
  }
  const code = stringOption(interaction, "code");
  if (!code) {
    return reply("Bring the code from the portal dashboard: /link code:<your code>");
  }

  const result = await consumeLinkCode(code, {
    id: user.id,
    username: user.username,
  });
  if (!result.ok) {
    return reply(
      result.reason === "taken"
        ? "This Discord account is already linked to a different portal account. Run /unlink first to move it."
        : "That code is not valid or has expired. Generate a fresh one on the portal dashboard.",
    );
  }

  // Confirm with the club identity the link now resolves to.
  const [org, linked] = await Promise.all([
    getOrgById(result.orgId),
    findUserByDiscordId(user.id),
  ]);
  const membership = linked?.memberships?.[result.orgId];
  const member =
    org && membership ? await getMember(org.id, membership.memberId) : null;
  return reply(
    org && member
      ? `Linked. You ride with ${org.name} as "${member.roadName}" ${member.displayName}. Try /mystats.`
      : "Linked. Try /mystats.",
  );
}

async function unlink(interaction: DiscordInteraction): Promise<InteractionResponse> {
  const user = invoker(interaction);
  if (!user?.id) {
    return reply("Could not read your Discord account from this request.");
  }
  const severed = await unlinkDiscordId(user.id);
  return reply(
    severed
      ? "Unlinked. This Discord account no longer opens your club record."
      : "This Discord account is not linked to anything.",
  );
}

// ── /ticket: command → modal → submission ──────────────────────────────

const TICKET_PREFIX = "ticket:";

/** /ticket type:<id> answers with a modal asking for the details. */
async function ticket(interaction: DiscordInteraction): Promise<InteractionResponse> {
  const ctx = await resolveContext(interaction, "ticket");
  if (ctx.kind === "fail") return ctx.response;
  const org = ctx.org;

  const typeValue = stringOption(interaction, "type");
  const types = await listActivityTypes(org.id);
  // Autocomplete submits the id; a hand-typed name is matched as a courtesy.
  const type = typeValue
    ? types.find((t) => t.active && t.id === typeValue) ??
      types.find((t) => t.active && t.name.toLowerCase() === typeValue.toLowerCase())
    : undefined;
  if (!type) {
    return reply("Pick an activity type from the suggestions and try again.");
  }

  // Same dialog the channel panel opens, so the two ways in cannot drift.
  // The club rides in the id: a modal submit is its own interaction, and in a
  // network server the guild alone cannot say which club it belongs to.
  const modal = buildPanelModal(org.id, type);
  return {
    type: ResponseType.Modal,
    data: { ...modal, custom_id: `${TICKET_PREFIX}${org.id}:${type.id}` },
  };
}

/**
 * Answers out of a modal submit, keyed by custom_id. Handles both shapes: a
 * Label wrapping one input (`component`) and the deprecated Action Row
 * holding several (`components`). Selects answer in `values`, text in
 * `value`, so both are carried.
 */
interface ModalAnswer {
  value?: string;
  values?: string[];
}

function modalFields(interaction: DiscordInteraction): Map<string, ModalAnswer> {
  const fields = new Map<string, ModalAnswer>();
  const take = (input?: {
    custom_id?: string;
    value?: string;
    values?: string[];
  }) => {
    if (!input?.custom_id) return;
    fields.set(input.custom_id, { value: input.value, values: input.values });
  };
  for (const entry of interaction.data?.components ?? []) {
    take(entry.component);
    for (const input of entry.components ?? []) take(input);
    // A bare input at top level, defensively.
    if (!entry.component && !entry.components) take(entry);
  }
  return fields;
}

/** Convenience: the text a field carries, or "". */
function textField(fields: Map<string, ModalAnswer>, key: string): string {
  return fields.get(key)?.value ?? "";
}

/** The returned ticket modal: validate with the website's schema, submit
 *  through the same core the Server Action wraps. */
export async function handleModalSubmit(
  interaction: DiscordInteraction,
): Promise<InteractionResponse> {
  const customId = interaction.data?.custom_id ?? "";

  // The bank's own form is a separate pipeline from the activity ticket's.
  if (customId.startsWith(BANK_MODAL_PREFIX)) {
    // "bankform:{orgId}:{kind}:{book}". A two-part id from a card posted
    // before the books split still opens, on the clean book, the same way an
    // unlabelled row reads clean.
    const [bankOrgId = "", kind = "", rawBook] = customId
      .slice(BANK_MODAL_PREFIX.length)
      .split(":");
    if (!bankOrgId || !isTxKind(kind)) return reply("Unsupported form.");
    const book: TreasuryBook = rawBook === "dirty" ? "dirty" : "clean";

    const org = await getOrgById(bankOrgId);
    if (!org || org.status === "suspended") return reply("That club's bank is closed.");
    const resolved = await resolveLinkedMember(org, interaction);
    if (resolved.kind === "unlinked") {
      return reply("Link your Discord account first, then file it again.");
    }
    if (resolved.kind === "no_member") {
      return reply(`Your portal account has no member record with ${org.name}.`);
    }
    return fileBankForm(interaction, org, resolved.uid, resolved.member, kind, book);
  }

  // Both ways in open the same dialog; only the id prefix differs.
  const prefix = customId.startsWith(PANEL_MODAL_PREFIX)
    ? PANEL_MODAL_PREFIX
    : customId.startsWith(TICKET_PREFIX)
      ? TICKET_PREFIX
      : null;
  if (!prefix) return reply("Unsupported form.");
  // "{orgId}:{typeId}", or a bare typeId from a modal opened before clubs
  // rode along in the id.
  const rest = customId.slice(prefix.length);
  const split = rest.indexOf(":");
  const modalOrgId = split === -1 ? null : rest.slice(0, split);
  const typeId = split === -1 ? rest : rest.slice(split + 1);

  const org = modalOrgId ? await getOrgById(modalOrgId) : null;
  if (modalOrgId && (!org || org.status === "suspended")) {
    return reply("That club is no longer taking tickets.");
  }
  // The modal names its club; older ones fall back to the usual resolution.
  const resolved = org
    ? await resolveLinkedMember(org, interaction)
    : ({ kind: "unlinked" } as LinkedMember);
  if (!org) {
    const ctx = await resolveContext(interaction, "ticket");
    if (ctx.kind === "fail") return ctx.response;
    return fileTicket(interaction, ctx.org, ctx.uid, ctx.member, typeId);
  }
  if (resolved.kind === "unlinked") {
    return reply("Link your Discord account first, then file the ticket again.");
  }
  if (resolved.kind === "no_member") {
    return reply(`Your portal account has no member record with ${org.name}.`);
  }

  return fileTicket(interaction, org, resolved.uid, resolved.member, typeId);
}

/** The shared tail of a modal submit: validate, file, notify, confirm. */
async function fileTicket(
  interaction: DiscordInteraction,
  org: Organization,
  uid: string,
  member: Member,
  typeId: string,
): Promise<InteractionResponse> {
  const fields = modalFields(interaction);
  const quantityRaw = (textField(fields, "quantity") || "1").replace(/[,\s]/g, "");
  const quantity = Number(quantityRaw);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return reply("Quantity must be a whole number of at least 1.");
  }

  // Witnesses come back as Discord user ids from the member picker; only the
  // ones linked to this club resolve to a member id worth recording.
  const pickedWitnesses = fields.get("witnesses")?.values ?? [];
  const witnesses = pickedWitnesses.length
    ? await resolveWitnesses(org.id, pickedWitnesses)
    : [];

  const parsed = submitActivitySchema.safeParse({
    orgId: org.id,
    entries: [{ typeId, quantity }],
    // Discord tickets are logged as of now; pick a date on the website form.
    date: new Date(),
    description: textField(fields, "description"),
    witnesses,
  });
  if (!parsed.success) {
    return reply(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  let filed: Awaited<ReturnType<typeof submitActivityCore>>;
  try {
    filed = await submitActivityCore({ uid, memberId: member.id }, parsed.data);
  } catch (e) {
    if (e instanceof SubmissionError) {
      // Same phrasing as the website's action, so the two surfaces agree.
      if (e.code === "daily_limit") return reply("Daily submission limit reached");
      if (e.code === "type_disabled") {
        return reply(`${e.detail ?? "This activity type"} is disabled`);
      }
      return reply("Unknown activity type");
    }
    console.error(e);
    return reply("Something went wrong filing the ticket.");
  }

  const types = await listActivityTypes(org.id);
  const typeById = new Map(types.map((t) => [t.id, t.name]));
  const summary = describeActivity({ entries: filed.entries }, (id) =>
    typeById.get(id),
  );

  // Officer-channel heads-up; never blocks or fails the filing.
  await notifyTicketSubmitted(org.id, {
    activityId: filed.activityId,
    orgId: org.id,
    memberLabel: `"${member.roadName}" ${member.displayName}`,
    summary,
    description: parsed.data.description,
  });

  // Say so when a picked witness could not be recorded, rather than dropping
  // them silently: the member expects the name they chose to be on the ticket.
  const dropped = pickedWitnesses.length - witnesses.length;
  const witnessNote =
    dropped > 0
      ? ` ${dropped} witness${dropped === 1 ? "" : "es"} could not be recorded (not linked to this club).`
      : "";

  return reply(
    `Ticket filed: ${summary}.${witnessNote} An officer will review it; approvals land on your record automatically.`,
  );
}

// ── The club bank: /bank, /dues, /deposit, /withdraw ───────────────────

const TREASURY_PREFIX = "treasury:";

const KIND_VERB: Record<TreasuryTxKind, string> = {
  dues: "Dues payment",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
};

/** How many settled movements /bank shows before pointing at the website. */
const BANK_ROWS = 8;

/**
 * The club's account at a glance: balance, dues currency, recent settled
 * movements. Ephemeral like /mystats — the bank is club business, and channel
 * membership is not club membership in a network server.
 */
async function bank(interaction: DiscordInteraction): Promise<InteractionResponse> {
  const ctx = await resolveContext(interaction, "bank");
  if (ctx.kind === "fail") return ctx.response;
  return reply(await bankReadout(ctx.org));
}

/** The account as Discord markdown. Shared by /bank and the card's dropdown,
 *  so the two can never disagree about what the books say. */
async function bankReadout(org: Organization): Promise<string> {
  const [balances, ledger, members] = await Promise.all([
    getTreasuryBalances(org.id),
    listTreasuryLedger(org.id),
    listMembers(org.id),
  ]);
  const memberById = new Map(members.map((m) => [m.id, m]));

  // Dues currency across the riding club — same rule as the portal's Dues
  // Roll (approved dues payment inside the current calendar month).
  const riding = members.filter(
    (m) => m.status !== "retired" && m.status !== "exiled",
  );
  const paid = riding.filter((m) => isDuesCurrent(m)).length;

  const rows = ledger
    .filter((t) => t.status === "approved")
    .slice(0, BANK_ROWS)
    .map((t) => {
      const sign = t.kind === "withdrawal" ? "-" : "+";
      const who = memberById.get(t.memberId)?.roadName ?? "unknown";
      const when = (t.reviewedAt as { toDate?: () => Date })?.toDate?.();
      const date = when
        ? when.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "";
      const note =
        t.kind === "dues"
          ? ""
          : ` · ${t.note.length > 40 ? `${t.note.slice(0, 40)}...` : t.note}`;
      const book = TREASURY_BOOK_LABEL[bookOf(t)].toLowerCase();
      return `${sign}${formatMoney(t.amount)} ${book} · ${KIND_VERB[t.kind]} · "${who}"${note}${date ? ` · ${date}` : ""}`;
    });

  return [
    `**Club Bank** · ${org.name}`,
    `Clean: **${formatMoney(balances.clean)}** · Dirty: **${formatMoney(balances.dirty)}**`,
    `Both books: ${formatMoney(balances.total)}`,
    `Dues this month: ${paid} of ${riding.length} paid`,
    ...(rows.length ? ["", "**Recent movements**", ...rows] : ["", "No settled movements yet."]),
  ].join("\n");
}

/**
 * Post the club's Club Bank card into this channel, and remember where it
 * went so every approval can edit its balance in place. Admin-only like
 * /panel: the card is club furniture, not a personal action.
 */
async function bankPanelCommand(
  interaction: DiscordInteraction,
): Promise<InteractionResponse> {
  if (!interaction.guild_id) {
    return reply("Run /bankpanel in the channel where the card should live.");
  }
  const pick = await pickOrg(interaction);
  if (pick.kind === "none") return reply("This bot is not connected to a club yet.");
  if (pick.kind !== "ok") {
    return reply(`Name the club: /bankpanel club:<slug>. Here: ${clubChoices(pick.orgs)}.`);
  }
  const org = pick.org;

  const resolved = await resolveLinkedMember(org, interaction);
  if (resolved.kind === "unlinked") {
    return reply(
      "Link your Discord account first: generate a code on the portal " +
        "dashboard, then run /link code:<your code>.",
    );
  }
  if (resolved.kind === "no_member") {
    return reply(`Your portal account has no member record with ${org.name}.`);
  }
  if (resolved.role !== "admin") {
    return reply("Only a club admin can post the Club Bank card.");
  }

  const channelId = interaction.channel_id;
  if (!channelId) {
    return reply("Could not read which channel this is. Try again in a text channel.");
  }

  const [balances, branding] = await Promise.all([
    getTreasuryBalances(org.id),
    getBranding(org.id, "portal"),
  ]);
  // Posted through the REST route rather than returned as the interaction
  // response, because the card has to be a message we can find and edit later.
  const result = await postPanel(
    channelId,
    buildBankPanelMessage({
      orgId: org.id,
      orgName: org.name,
      balances,
      accentColor: hexToInt(branding?.colors?.primary),
    }),
  );
  if (!result.ok) {
    return reply(`Could not post the Club Bank card: ${result.reason}.`);
  }
  await setBankPanel(org.id, { channelId, messageId: result.messageId });

  return reply(
    `Club Bank card posted${result.pinned ? " and pinned" : ""}. Its balance updates itself on every approval.` +
      (result.pinned
        ? ""
        : " It could not be pinned (the bot needs Manage Messages here), so it will scroll away as the channel fills."),
  );
}

/** The card's dropdown: open a form, or read the account back. */
async function bankSelect(
  interaction: DiscordInteraction,
): Promise<InteractionResponse> {
  const orgId = (interaction.data?.custom_id ?? "").slice(BANK_SELECT_PREFIX.length);
  const choice = interaction.data?.values?.[0];
  if (!orgId || !choice) return reply("Pick a movement and try again.");

  const org = await getOrgById(orgId);
  if (!org || org.status === "suspended") {
    return reply("That club's bank is closed.");
  }

  const resolved = await resolveLinkedMember(org, interaction);
  if (resolved.kind === "unlinked") {
    return reply(
      "Link your Discord account first: generate a code on the portal " +
        "dashboard, then run /link code:<your code>.",
    );
  }
  if (resolved.kind === "no_member") {
    return reply(`Your portal account has no member record with ${org.name}.`);
  }

  if (choice === "balance") return reply(await bankReadout(org));
  const movement = parseBankChoice(choice);
  if (!movement) return reply("Pick a movement and try again.");

  return {
    type: ResponseType.Modal,
    data: buildBankModal(org.id, movement.kind, movement.book),
  };
}

/** The returned bank form: validate with the website's schema, file through
 *  the same core the Server Action wraps. */
async function fileBankForm(
  interaction: DiscordInteraction,
  org: Organization,
  uid: string,
  member: Member,
  kind: TreasuryTxKind,
  book: TreasuryBook,
): Promise<InteractionResponse> {
  const fields = modalFields(interaction);
  const rawAmount = textField(fields, "amount").replace(/[,$\s]/g, "");
  if (!/^\d+$/.test(rawAmount)) {
    return reply("The amount must be a whole number of dollars.");
  }

  const parsed = submitTreasuryTxSchema.safeParse({
    orgId: org.id,
    kind,
    book,
    amount: Number(rawAmount),
    note: textField(fields, "note"),
  });
  if (!parsed.success) {
    return reply(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  let txId: string;
  try {
    ({ txId } = await submitTreasuryTxCore(
      { uid, memberId: member.id },
      {
        orgId: org.id,
        kind,
        book,
        amount: parsed.data.amount,
        note: parsed.data.note.trim(),
        subjectMemberId: member.id,
      },
    ));
  } catch (e) {
    if (e instanceof TreasuryError && e.code === "daily_limit") {
      return reply("Daily submission limit reached");
    }
    console.error(e);
    return reply("Something went wrong filing that.");
  }

  await notifyTreasurySubmitted(org.id, {
    txId,
    orgId: org.id,
    kind,
    book,
    amount: parsed.data.amount,
    memberLabel: `"${member.roadName}" ${member.displayName}`,
    note: parsed.data.note.trim(),
  });

  return reply(
    `${KIND_VERB[kind]} of ${formatMoney(parsed.data.amount)} filed on the ${TREASURY_BOOK_LABEL[book].toLowerCase()} book. It lands once a treasury reviewer approves it.`,
  );
}

/** /dues, /deposit and /withdraw all file the same money ticket. */
async function moneyTicket(
  interaction: DiscordInteraction,
  kind: TreasuryTxKind,
): Promise<InteractionResponse> {
  const command = kind === "withdrawal" ? "withdraw" : kind;
  const ctx = await resolveContext(interaction, command);
  if (ctx.kind === "fail") return ctx.response;
  const org = ctx.org;

  // Same schema the website's action parses, so the two ways in cannot drift.
  // `book` is a required choice option, so Discord itself guarantees one of
  // the two values arrives; the schema is still what rules on it.
  const parsed = submitTreasuryTxSchema.safeParse({
    orgId: org.id,
    kind,
    book: stringOption(interaction, "book") ?? "clean",
    amount: integerOption(interaction, "amount") ?? 0,
    note: stringOption(interaction, "note") ?? "",
  });
  if (!parsed.success) {
    return reply(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  let txId: string;
  try {
    ({ txId } = await submitTreasuryTxCore(
      { uid: ctx.uid, memberId: ctx.member.id },
      {
        orgId: org.id,
        kind,
        book: parsed.data.book,
        amount: parsed.data.amount,
        note: parsed.data.note.trim(),
        // Discord always files for the caller; naming someone else is a
        // website flow for treasury reviewers.
        subjectMemberId: ctx.member.id,
      },
    ));
  } catch (e) {
    if (e instanceof TreasuryError && e.code === "daily_limit") {
      return reply("Daily submission limit reached");
    }
    console.error(e);
    return reply("Something went wrong filing the ticket.");
  }

  // Officer-channel heads-up; never blocks or fails the filing.
  await notifyTreasurySubmitted(org.id, {
    txId,
    orgId: org.id,
    kind,
    book: parsed.data.book,
    amount: parsed.data.amount,
    memberLabel: `"${ctx.member.roadName}" ${ctx.member.displayName}`,
    note: parsed.data.note.trim(),
  });

  const verb =
    kind === "withdrawal"
      ? "Withdrawal request filed"
      : kind === "deposit"
        ? "Deposit logged"
        : "Dues payment filed";
  return reply(
    `${verb}: ${formatMoney(parsed.data.amount)} on the ${TREASURY_BOOK_LABEL[parsed.data.book].toLowerCase()} book. It lands once a treasury reviewer approves it.`,
  );
}

/**
 * A click on the treasury Approve/Deny buttons. Same permission chain as the
 * activity review buttons (signed click → account link → membership), but the
 * gate is the treasury's own: portal admins and the Treasurer seat, checked
 * by canReviewTreasury against the clicker's rank on their member doc. The
 * core's transaction settles racing reviewers; the channel message is stamped
 * and its buttons retired.
 */
async function handleTreasuryButton(
  interaction: DiscordInteraction,
): Promise<InteractionResponse> {
  // "treasury:{decision}:{orgId}:{txId}" — no legacy short form to honour.
  const parts = (interaction.data?.custom_id ?? "").split(":");
  const decision = parts[1];
  const buttonOrgId = parts[2];
  const txId = parts.slice(3).join(":");
  if ((decision !== "approve" && decision !== "deny") || !buttonOrgId || !txId) {
    return reply("Unsupported button.");
  }

  const org = await getOrgById(buttonOrgId);
  if (!org || org.status === "suspended") {
    return reply("That club is no longer taking reviews.");
  }

  const resolved = await resolveLinkedMember(org, interaction);
  if (resolved.kind === "unlinked") {
    return reply(
      "Link your Discord account first: generate a code on the portal " +
        "dashboard, then run /link code:<your code>.",
    );
  }
  if (resolved.kind === "no_member") {
    return reply(`Your portal account has no member record with ${org.name}.`);
  }
  // The rank comes off a FRESH member read: money authority must not outlive
  // a demotion by a cache TTL (resolved.member came through getMember).
  const rankId = canReviewTreasury(resolved.role, undefined)
    ? undefined
    : await memberRankFresh(org.id, resolved.member.id);
  if (!canReviewTreasury(resolved.role, rankId)) {
    return reply("Only an admin or the Treasurer can rule on the bank.");
  }

  // Friendly pre-check for stale buttons; the core's transaction is the real
  // authority when two reviewers race past this read together.
  const movement = await getTreasuryTx(org.id, txId);
  if (!movement) return reply("That transaction no longer exists.");
  if (movement.status !== "pending") {
    return reply(`This transaction was already ${movement.status}.`);
  }

  const reviewer = `"${resolved.member.roadName}" ${resolved.member.displayName}`;
  let stamp: string;
  try {
    if (decision === "approve") {
      const result = await approveTreasuryTxCore(org.id, txId, resolved.uid);
      // The balance moved and dues stamp the member doc; expire both tags
      // route-handler-style so the website reads fresh on its next request.
      expireOrgTags(org.id, "treasury", "members");
      // The pinned card carries the balance, so it is now a message telling
      // the channel the wrong number. Best-effort; never fails the approval.
      await updateBankPanel(org.id);
      stamp = `✅ **Approved** by ${reviewer} · ${TREASURY_BOOK_LABEL[result.book].toLowerCase()} book ${formatMoney(result.balance)}`;
    } else {
      await denyTreasuryTxCore(org.id, txId, resolved.uid);
      // Settled movements land on the cached ledger even when denied — the
      // same reason the web action's deny path revalidates the treasury tag.
      expireOrgTags(org.id, "treasury");
      stamp = `⛔ **Denied** by ${reviewer}`;
    }
  } catch (e) {
    if (e instanceof TreasuryError) {
      if (e.code === "not_pending") {
        return reply("This transaction was already reviewed.");
      }
      if (e.code === "insufficient_funds") {
        return reply(`${insufficientFundsMessage(e)}.`);
      }
      return reply("That transaction no longer exists.");
    }
    console.error(e);
    return reply("Something went wrong applying the decision.");
  }

  // Stamp the decision onto the channel message and retire its buttons.
  const original = interaction.message?.content;
  return {
    type: ResponseType.UpdateMessage,
    data: {
      content: original ? `${original}\n\n${stamp}` : stamp,
      components: [],
    },
  };
}

// ── Officer review buttons ─────────────────────────────────────────────

const REVIEW_PREFIX = "review:";

/**
 * A click on the officer-channel Approve/Deny buttons, live: the permission
 * chain runs first (signed click → account link → membership role, the same
 * mirror custom claims are built from), then the decision goes through the
 * SAME core the website's action wraps. Approval runs the patch engine, so
 * duplicate clicks and racing officers are settled by its transaction: the
 * first commit wins, everyone else gets "already reviewed". After an
 * approval the members/awards cache tags are expired route-handler-style
 * (expireOrgTags), so the website shows the moved stats on its next request.
 * The channel message itself is updated in place: decision stamped, buttons
 * removed, which is every officer's signal that the ticket is settled.
 */
export async function handleComponent(
  interaction: DiscordInteraction,
): Promise<InteractionResponse> {
  const customId = interaction.data?.custom_id ?? "";
  // The logger card's dropdown and the bank's buttons share this entry point.
  if (customId.startsWith(PANEL_SELECT_PREFIX)) return panelSelect(interaction);
  if (customId.startsWith(BANK_SELECT_PREFIX)) return bankSelect(interaction);
  if (customId.startsWith(TREASURY_PREFIX)) return handleTreasuryButton(interaction);
  if (!customId.startsWith(REVIEW_PREFIX)) return reply("Unsupported button.");
  // "review:{decision}:{orgId}:{activityId}", or the two-part form from
  // messages posted before clubs rode along in the id.
  const parts = customId.split(":");
  const decision = parts[1];
  const buttonOrgId = parts.length >= 4 ? parts[2] : null;
  const activityId = parts.length >= 4 ? parts.slice(3).join(":") : parts[2];
  if ((decision !== "approve" && decision !== "deny") || !activityId) {
    return reply("Unsupported button.");
  }

  // The button names its club; older messages fall back to resolution.
  let org: Organization | null = null;
  if (buttonOrgId) {
    org = await getOrgById(buttonOrgId);
    if (!org || org.status === "suspended") {
      return reply("That club is no longer taking reviews.");
    }
  } else {
    const pick = await pickOrg(interaction);
    if (pick.kind !== "ok") return reply("This bot is not connected to a club yet.");
    org = pick.org;
  }

  const resolved = await resolveLinkedMember(org, interaction);
  if (resolved.kind === "unlinked") {
    return reply(
      "Link your Discord account first: generate a code on the portal " +
        "dashboard, then run /link code:<your code>.",
    );
  }
  if (resolved.kind === "no_member") {
    return reply(`Your portal account has no member record with ${org.name}.`);
  }
  if (resolved.role !== "officer" && resolved.role !== "admin") {
    return reply("Officers only. Your account holds the member role.");
  }

  // Friendly pre-check for stale buttons; the engine's transaction is the
  // real authority when two officers race past this read together.
  const activity = await getActivity(org.id, activityId);
  if (!activity) return reply("That ticket no longer exists.");
  if (activity.status !== "pending") {
    return reply(`This ticket was already ${activity.status}.`);
  }

  const officer = `"${resolved.member.roadName}" ${resolved.member.displayName}`;
  let stamp: string;
  try {
    if (decision === "approve") {
      const result = await approveActivityTx(org.id, activityId, resolved.uid);
      // The engine moved cached data; expire it the route-handler-safe way.
      expireOrgTags(org.id, "members", "awards");

      stamp = `✅ **Approved** by ${officer}`;
      if (result.awardedPatchIds.length) {
        const patches = await listPatches(org.id);
        const names = result.awardedPatchIds.map(
          (id) => patches.find((p) => p.id === id)?.name ?? id,
        );
        stamp += `\nAwarded: ${names.join(", ")}`;
      }
    } else {
      await denyActivityCore(org.id, activityId, resolved.uid);
      stamp = `⛔ **Denied** by ${officer}`;
    }
  } catch (e) {
    if (e instanceof EngineError) {
      if (e.code === "not_pending") return reply("This ticket was already reviewed.");
      if (e.code === "activity_not_found") return reply("That ticket no longer exists.");
      return reply("Member record not found");
    }
    console.error(e);
    return reply("Something went wrong applying the decision.");
  }

  // Stamp the decision onto the channel message and retire its buttons.
  const original = interaction.message?.content;
  return {
    type: ResponseType.UpdateMessage,
    data: {
      content: original ? `${original}\n\n${stamp}` : stamp,
      components: [],
    },
  };
}

/** Live suggestions: the club picker on any command that has one, /ticket's
 *  activity types, and /leaderboard's categories. */
export async function handleAutocomplete(
  interaction: DiscordInteraction,
): Promise<InteractionResponse> {
  const empty = { type: ResponseType.Autocomplete, data: { choices: [] } };
  const command = interaction.data?.name;
  if (!command) return empty;

  const focused = interaction.data?.options?.find((o) => o.focused);
  const partial =
    typeof focused?.value === "string" ? focused.value.trim().toLowerCase() : "";

  // The `club` picker is answered FIRST, for every command that carries one.
  // It used to sit behind a hardcoded allowlist of command names, which meant
  // a new command with a club option silently suggested nothing until someone
  // remembered to add it — /mystats and /bankpanel were both dead that way.
  // Keyed on the FOCUSED OPTION rather than the command, so it cannot rot
  // again. Needs no club resolved: it is the thing resolving one.
  if (focused?.name === "club") {
    let hosted = interaction.guild_id
      ? (await clubsInGuild(interaction.guild_id)).filter(
          (o) => o.status !== "suspended",
        )
      : [];
    // Mirror pickOrg's precedence: an unbound server (or a DM) falls back to
    // the DISCORD_ORG_ID pin. Without this the picker is empty on every
    // single-club deployment that never ran /connect, which reads as broken
    // even though every command resolves that club perfectly well.
    if (hosted.length === 0 && process.env.DISCORD_ORG_ID) {
      const pinned = await getOrgById(process.env.DISCORD_ORG_ID);
      if (pinned && pinned.status !== "suspended") hosted = [pinned];
    }
    const choices = hosted
      .filter((o) => o.name.toLowerCase().includes(partial) || o.slug.includes(partial))
      .slice(0, 25)
      .map((o) => ({ name: o.name, value: o.slug }));
    return { type: ResponseType.Autocomplete, data: { choices } };
  }

  // Everything below suggests something OTHER than a club, and only these two
  // commands have such an option.
  if (command !== "ticket" && command !== "leaderboard") return empty;

  // Global boards span every club, so they need no club resolved — and must
  // not go silent in a network server where the caller's club is ambiguous.
  if (command === "leaderboard" && stringOption(interaction, "scope") === "global") {
    const choices = GLOBAL_STATS.filter((k) =>
      (STAT_LABELS[k] ?? k).toLowerCase().includes(partial),
    )
      .slice(0, 25)
      .map((k) => ({ name: STAT_LABELS[k] ?? k, value: k }));
    return { type: ResponseType.Autocomplete, data: { choices } };
  }

  const pick = await pickOrg(interaction);
  const org = pick.kind === "ok" ? pick.org : null;
  if (!org) return empty;

  if (command === "ticket") {
    const types = await listActivityTypes(org.id);
    const choices = types
      .filter((t) => t.active && t.name.toLowerCase().includes(partial))
      .slice(0, 25) // Discord's ceiling
      .map((t) => ({ name: t.name, value: t.id }));
    return { type: ResponseType.Autocomplete, data: { choices } };
  }

  // Club boards suggest the club's own live emblem ladders (global boards
  // were answered above, before any club had to be resolved).
  const boards = await loadBoards(org.id);
  const choices = boards
    .filter((b) => b.label.toLowerCase().includes(partial))
    .slice(0, 25)
    .map((b) => ({ name: b.label, value: b.statKey }));
  return { type: ResponseType.Autocomplete, data: { choices } };
}

// ── /leaderboard: the club standings as channel banter ─────────────────

/**
 * The standings with none of the imagery: Discord renders text, so the
 * render-existence and art-version reads the website's loader makes are
 * skipped entirely. Three org-cached reads, all shared with the portal pages,
 * so a warm cache serves this for zero Firestore documents.
 */
async function loadBoards(orgId: string): Promise<LeaderboardCategory[]> {
  const [members, awardsByMember, patches] = await Promise.all([
    listMembers(orgId),
    listAwardsByMember(orgId),
    listPatches(orgId),
  ]);
  return composeLeaderboard({
    members,
    awardsByMember,
    patches,
    artUrlFor: () => null,
    imageFor: () => ({ url: "", hasRender: false }),
  });
}

async function leaderboard(
  interaction: DiscordInteraction,
): Promise<InteractionResponse> {
  // Global spans every club, so it needs no club resolution at all.
  if (stringOption(interaction, "scope") === "global") {
    return globalBoard(stringOption(interaction, "category"));
  }

  const pick = await pickOrg(interaction);
  if (pick.kind === "none") return reply("This bot is not connected to a club yet.");
  if (pick.kind !== "ok") {
    return reply(
      `Name the club: /leaderboard club:<slug>. Here: ${clubChoices(pick.orgs)}.`,
    );
  }
  const org = pick.org;

  const boards = await loadBoards(org.id);
  if (!boards.length) {
    return reply("No standings yet. Earn some emblems first.");
  }

  const query = stringOption(interaction, "category");
  const board = query
    ? boards.find((b) => b.statKey === query) ??
      boards.find((b) => b.label.toLowerCase() === query.toLowerCase())
    : boards[0];
  if (!board) {
    return reply(
      `No standings board named "${query}". Pick one from the suggestions.`,
    );
  }

  // Standings are club banter: the one reply besides /ping the whole channel
  // gets to see. Same data any member reads on the Standings page.
  return {
    type: ResponseType.ChannelMessage,
    data: { content: formatLeaderboard(org, board) },
  };
}

const MEDALS = ["🥇", "🥈", "🥉"];
const BOARD_ROWS = 15;

/** One board as Discord markdown. Ties share a medal, just like the website
 *  shares a rank (1, 2, 2, 4). */
export function formatLeaderboard(
  org: Organization,
  board: LeaderboardCategory,
): string {
  const lines = board.rows.slice(0, BOARD_ROWS).map((row) => {
    const lead = row.rank <= 3 ? MEDALS[row.rank - 1] : `${row.rank}.`;
    const emblem = row.topEmblem
      ? ` · ${row.topEmblem.name} (${row.level}/${row.levelTotal})`
      : "";
    return `${lead} "${row.roadName}" ${row.displayName} · ${row.valueLabel}${emblem}`;
  });
  const overflow = board.rows.length - BOARD_ROWS;
  return [
    `**${board.label}** standings · ${org.name}`,
    ...lines,
    ...(overflow > 0 ? [`... and ${overflow} more on the website`] : []),
  ].join("\n");
}

// ── Global standings: every club in the database, one board ────────────

/** Global boards run on the standard criminal-record stats, in record order.
 *  Per-club emblem ladders differ by design, so levels stay club-side. */
const GLOBAL_STATS: StatKey[] = PATCH_LADDERS.map((l) => l.statKey);

function resolveGlobalStat(query: string | null): StatKey | null {
  if (!query) return GLOBAL_STATS[0] ?? null;
  return (
    GLOBAL_STATS.find((k) => k === query) ??
    GLOBAL_STATS.find(
      (k) => (STAT_LABELS[k] ?? k).toLowerCase() === query.toLowerCase(),
    ) ??
    null
  );
}

/**
 * All clubs, one ranking: every riding member of every active org in this
 * database, ranked on one stat with their club's name on the line. Reads are
 * the per-org cached member lists, so a warm cache pays nothing extra.
 */
async function globalBoard(query: string | null): Promise<InteractionResponse> {
  const statKey = resolveGlobalStat(query);
  if (!statKey) {
    return reply(`No global board named "${query}". Pick one from the suggestions.`);
  }

  const orgs = await listActiveOrgs();
  const memberLists = await Promise.all(orgs.map((o) => listMembers(o.id)));
  const rows = orgs.flatMap((org, i) =>
    memberLists[i]
      .filter((m) => m.status !== "retired" && m.status !== "exiled")
      .map((m) => ({
        roadName: m.roadName,
        displayName: m.displayName,
        orgName: org.name,
        value: m.stats?.[statKey] ?? 0,
      })),
  );
  if (!rows.length) return reply("No clubs are riding yet.");

  // Same competition ranking as the club boards; road name breaks display
  // ties because member numbers only mean something inside one club.
  rows.sort((a, b) => b.value - a.value || a.roadName.localeCompare(b.roadName));
  const ranks = rows.map((row, i) =>
    i > 0 && rows[i - 1].value === row.value ? 0 : i + 1,
  );
  for (let i = 1; i < ranks.length; i++) if (ranks[i] === 0) ranks[i] = ranks[i - 1];

  const format =
    CRIMINAL_RECORD_ROWS.find((r) => r.statKey === statKey)?.format ??
    ((n: number) => n.toLocaleString("en-US"));
  const lines = rows.slice(0, BOARD_ROWS).map((row, i) => {
    const lead = ranks[i] <= 3 ? MEDALS[ranks[i] - 1] : `${ranks[i]}.`;
    return `${lead} "${row.roadName}" ${row.displayName} · ${row.orgName} · ${format(row.value)}`;
  });
  const overflow = rows.length - BOARD_ROWS;
  const clubs = orgs.length === 1 ? "1 club" : `${orgs.length} clubs`;

  return {
    type: ResponseType.ChannelMessage,
    data: {
      content: [
        `**${STAT_LABELS[statKey] ?? statKey}** global standings · ${clubs}`,
        ...lines,
        ...(overflow > 0 ? [`... and ${overflow} more riders`] : []),
      ].join("\n"),
    },
  };
}

// ── Record formatting ──────────────────────────────────────────────────

/** A member's record as an ephemeral reply, rank resolved. */
async function recordReply(
  org: Organization,
  member: Member,
): Promise<InteractionResponse> {
  const ranks = await listRanks(org.id);
  const rankName = ranks.find((r) => r.id === member.rankId)?.name;
  return reply(formatMemberStats(org, member, rankName));
}

/** The character screen's record, retold as Discord markdown. */
export function formatMemberStats(
  org: Organization,
  member: Member,
  rankName: string | undefined,
): string {
  const headline = [
    org.name,
    rankName ? `Rank: ${rankName}` : null,
    `Member #${member.memberNumber}`,
    `Status: ${member.status}`,
  ]
    .filter(Boolean)
    .join(" · ");

  // Same rows, labels and formatting as the character screen, so the two
  // surfaces can never disagree about someone's record.
  const record = CRIMINAL_RECORD_ROWS.map((row) => {
    const value = member.stats?.[row.statKey] ?? 0;
    return `${row.label}: ${row.format ? row.format(value) : value.toLocaleString("en-US")}`;
  });

  const service: string[] = [];
  const clubRuns = member.stats?.clubRuns ?? 0;
  const church = member.stats?.churchAttendance ?? 0;
  if (clubRuns) service.push(`Club Runs: ${clubRuns.toLocaleString("en-US")}`);
  if (church) service.push(`Church Attendance: ${church.toLocaleString("en-US")}`);

  return [
    `**"${member.roadName}" ${member.displayName}**`,
    headline,
    `Patches earned: ${member.patchCount ?? 0}`,
    "",
    "**Criminal Record**",
    ...record,
    ...(service.length ? ["", "**Club Service**", ...service] : []),
  ].join("\n");
}
