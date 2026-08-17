import "server-only";
import type { ActivityType } from "@/lib/types";

/**
 * The in-channel Activity Logger: a card that lives permanently in a club's
 * tickets channel, and the form dialog it opens.
 *
 * Discord cannot take typed text inside a channel message (Text Input is
 * modal-only), so the split is forced and deliberate: the CARD holds the
 * choice a dropdown can make, and the DIALOG holds everything that needs
 * typing. The dialog is built per activity type, which is what lets the
 * quantity box appear only for the types that carry an amount.
 *
 * Payload shapes are the current ones: Components V2 for the card (flag
 * 32768, which disables `content`/`embeds` and moves all text into Text
 * Display), and Label-wrapped inputs for the dialog. Action Rows around modal
 * inputs are deprecated, so nothing here uses them.
 */

export const PANEL_SELECT_PREFIX = "panel:";
export const PANEL_MODAL_PREFIX = "panelform:";

/** Message flag IS_COMPONENTS_V2 (1 << 15). */
const COMPONENTS_V2 = 32768;

// Component type ids, named so the payloads below read as intent.
const CONTAINER = 17;
const TEXT_DISPLAY = 10;
const SEPARATOR = 14;
const ACTION_ROW = 1;
const STRING_SELECT = 3;
const TEXT_INPUT = 4;
const USER_SELECT = 5;
const LABEL = 18;

/** Discord's select ceiling; the club would need 26 live types to hit it. */
const MAX_OPTIONS = 25;

/** "#8B0000" → 9109504. Anything else (rgba, hsl, absent) → null, and the
 *  card renders without an accent rather than with a wrong one. */
export function hexToInt(css: string | undefined): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec((css ?? "").trim());
  return match ? parseInt(match[1], 16) : null;
}

/** The permanent card. Posted once per club by /panel. */
export function buildPanelMessage(opts: {
  orgId: string;
  orgName: string;
  types: ActivityType[];
  accentColor: number | null;
}): Record<string, unknown> {
  const options = opts.types.slice(0, MAX_OPTIONS).map((t) => ({
    label: t.name.slice(0, 100),
    value: t.id,
    ...(t.allowQuantity ? { description: "Takes an amount" } : {}),
  }));

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
              `## Activity Logger\n` +
              `Record and submit completed activities for review.\n` +
              `**${opts.orgName}** · an officer reviews every submission.`,
          },
          { type: SEPARATOR, divider: true, spacing: 1 },
          {
            type: ACTION_ROW,
            components: [
              {
                type: STRING_SELECT,
                // The club rides in the id: one server can host several, and
                // a panel belongs to the channel it was posted in.
                custom_id: `${PANEL_SELECT_PREFIX}${opts.orgId}`,
                placeholder: "Choose a category to log",
                options,
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * The form for one category. Three fields at most, well under Discord's cap
 * of five, and the quantity field exists only when the type takes an amount.
 */
export function buildPanelModal(
  orgId: string,
  type: ActivityType,
): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];

  if (type.allowQuantity) {
    components.push({
      type: LABEL,
      label: "How many".slice(0, 45),
      description: `The amount for ${type.name}`.slice(0, 100),
      component: {
        type: TEXT_INPUT,
        custom_id: "quantity",
        style: 1, // short
        value: String(type.defaultQuantity || 1),
        required: true,
        max_length: 12,
      },
    });
  }

  components.push({
    type: LABEL,
    label: "What happened",
    description: "Give the officer enough to go on.",
    component: {
      type: TEXT_INPUT,
      custom_id: "description",
      style: 2, // paragraph
      min_length: 10,
      max_length: 2000,
      required: true,
      placeholder: "Describe the run...",
    },
  });

  components.push({
    type: LABEL,
    label: "Witnesses",
    description: "Optional. Only linked members can be recorded.",
    component: {
      type: USER_SELECT,
      custom_id: "witnesses",
      max_values: 5,
      // Modal selects may set `required`; they must never set `disabled`.
      required: false,
    },
  });

  return {
    custom_id: `${PANEL_MODAL_PREFIX}${orgId}:${type.id}`,
    title: `Log: ${type.name}`.slice(0, 45),
    components,
  };
}
