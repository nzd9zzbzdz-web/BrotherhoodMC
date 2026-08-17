import "server-only";
import { TREASURY_BOOK_LABEL, formatMoney } from "@/lib/constants";
import type { TreasuryBalances, TreasuryBook, TreasuryTxKind } from "@/lib/types";

/**
 * The in-channel Club Bank card, and the forms it opens.
 *
 * Same split as the Activity Logger (see panel.ts) and for the same reason:
 * Discord cannot take typed text inside a channel message, so the CARD holds
 * the choice a dropdown can make and the DIALOG holds everything typed.
 *
 * Unlike the logger card, this one carries live data: the balance is baked
 * into the message and the card is edited in place whenever a movement is
 * approved (updateBankPanel in notify.ts). That makes it a standing balance
 * board rather than a button, which is the whole point of pinning it. If an
 * edit ever fails the card goes stale rather than wrong, and the dropdown's
 * own balance option always reads live.
 */

export const BANK_SELECT_PREFIX = "bank:";
export const BANK_MODAL_PREFIX = "bankform:";

/** Message flag IS_COMPONENTS_V2 (1 << 15). */
const COMPONENTS_V2 = 32768;

const CONTAINER = 17;
const TEXT_DISPLAY = 10;
const SEPARATOR = 14;
const ACTION_ROW = 1;
const STRING_SELECT = 3;
const TEXT_INPUT = 4;
const LABEL = 18;

/**
 * The dropdown's jobs: each movement once per book, then the readout.
 *
 * The book rides in the DROPDOWN rather than in the form because of the split
 * this module already lives by: the card holds what a dropdown can choose and
 * the dialog holds what has to be typed. It also means the member picks the
 * book while looking at both balances, which is the moment they can tell
 * which one they meant.
 */
export const BANK_ACTIONS = [
  { value: "dues:clean", label: "Pay Dues (clean)", description: "Your club dues, money that can be shown" },
  { value: "dues:dirty", label: "Pay Dues (dirty)", description: "Your club dues, money that cannot" },
  { value: "deposit:clean", label: "Deposit (clean)", description: "Money in, and the club can account for it" },
  { value: "deposit:dirty", label: "Deposit (dirty)", description: "Money in, and it cannot be shown" },
  { value: "withdrawal:clean", label: "Withdrawal (clean)", description: "Money out of the clean book" },
  { value: "withdrawal:dirty", label: "Withdrawal (dirty)", description: "Money out of the dirty book" },
  { value: "balance", label: "Balance and ledger", description: "Read both books" },
] as const;

export function isTxKind(value: string): value is TreasuryTxKind {
  return value === "dues" || value === "deposit" || value === "withdrawal";
}

/**
 * Read a dropdown value back into the movement it names. A bare kind with no
 * book ("deposit") still resolves, to the clean book: cards posted before the
 * split are live messages in real channels and their dropdowns keep working.
 */
export function parseBankChoice(
  value: string,
): { kind: TreasuryTxKind; book: TreasuryBook } | null {
  const [kind, book] = value.split(":");
  if (!isTxKind(kind)) return null;
  return { kind, book: book === "dirty" ? "dirty" : "clean" };
}

/**
 * The permanent card. Posted by /bankpanel and re-rendered on every approval,
 * so `balance` is always the number the message should currently show.
 */
export function buildBankPanelMessage(opts: {
  orgId: string;
  orgName: string;
  balances: TreasuryBalances;
  accentColor: number | null;
}): Record<string, unknown> {
  return {
    flags: COMPONENTS_V2,
    components: [
      {
        type: CONTAINER,
        ...(opts.accentColor !== null ? { accent_color: opts.accentColor } : {}),
        components: [
          {
            type: TEXT_DISPLAY,
            content:
              `## 🏦 Club Bank\n` +
              `### ${formatMoney(opts.balances.clean)} clean · ${formatMoney(opts.balances.dirty)} dirty\n` +
              `**${opts.orgName}** · an admin or the Treasurer rules on every movement.`,
          },
          { type: SEPARATOR, divider: true, spacing: 1 },
          {
            type: ACTION_ROW,
            components: [
              {
                type: STRING_SELECT,
                // The club rides in the id: one server can host several.
                custom_id: `${BANK_SELECT_PREFIX}${opts.orgId}`,
                placeholder: "Choose a movement",
                options: BANK_ACTIONS.map((a) => ({
                  label: a.label,
                  value: a.value,
                  description: a.description,
                })),
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * The form for one movement. Dues describe themselves, so their note is
 * optional; money in or out has to say what for, matching the web form and
 * the schema's own rule.
 */
export function buildBankModal(
  orgId: string,
  kind: TreasuryTxKind,
  book: TreasuryBook,
): Record<string, unknown> {
  const title =
    kind === "dues" ? "Pay Dues" : kind === "deposit" ? "Log a Deposit" : "Request a Withdrawal";

  return {
    // The book rides in the id, like the club does: the dropdown that chose
    // it is gone by the time this comes back.
    custom_id: `${BANK_MODAL_PREFIX}${orgId}:${kind}:${book}`,
    title: `${title} · ${TREASURY_BOOK_LABEL[book]}`,
    components: [
      {
        type: LABEL,
        label: "Amount",
        // Names the book again inside the dialog: the dropdown that chose it
        // is no longer on screen, and this is the last chance to notice.
        description: `Whole dollars, on the ${TREASURY_BOOK_LABEL[book].toLowerCase()} book. No minus signs.`,
        component: {
          type: TEXT_INPUT,
          custom_id: "amount",
          style: 1, // short
          required: true,
          max_length: 12,
          placeholder: "500",
        },
      },
      {
        type: LABEL,
        label: kind === "dues" ? "Note" : "What for",
        description:
          kind === "dues"
            ? "Optional. Anything the Treasurer should know."
            : kind === "withdrawal"
              ? "Say what the money is for."
              : "Say where the money came from.",
        component: {
          type: TEXT_INPUT,
          custom_id: "note",
          style: 2, // paragraph
          required: kind !== "dues",
          max_length: 300,
          ...(kind === "dues" ? {} : { min_length: 3 }),
        },
      },
    ],
  };
}
