import { NextRequest, NextResponse } from "next/server";
import { verifyDiscordSignature } from "@/lib/discord/verify";
import {
  InteractionType,
  ResponseType,
  handleAutocomplete,
  handleComponent,
  handleDiscordCommand,
  handleModalSubmit,
  type DiscordInteraction,
} from "@/lib/discord/interactions";

/**
 * Discord Interactions endpoint (HTTP webhook, not a gateway bot). Discord
 * POSTs every slash command here, Ed25519-signed; running it inside the
 * existing Next deployment means the bot shares the Admin SDK, the cached
 * read layer and the club's data with the website, and needs no second host.
 *
 * Unauthenticated by design (Discord is the caller, the signature is the
 * auth), which is exactly why it must stay read-only and must never import an
 * action module: the updateTag cache layer is Server-Actions-only.
 */
export async function POST(req: NextRequest) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    // Not configured in this environment: fail closed, loudly.
    return NextResponse.json({ error: "discord not configured" }, { status: 503 });
  }

  // Verification signs the RAW body; read it before any JSON parsing.
  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");
  const rawBody = await req.text();
  if (
    !signature ||
    !timestamp ||
    !verifyDiscordSignature(publicKey, signature, timestamp, rawBody)
  ) {
    return NextResponse.json({ error: "invalid request signature" }, { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "malformed body" }, { status: 400 });
  }

  // Discord's endpoint-validation handshake.
  if (interaction.type === InteractionType.Ping) {
    return NextResponse.json({ type: ResponseType.Pong });
  }

  if (interaction.type === InteractionType.ApplicationCommand) {
    return NextResponse.json(await handleDiscordCommand(interaction));
  }

  if (interaction.type === InteractionType.MessageComponent) {
    return NextResponse.json(await handleComponent(interaction));
  }

  if (interaction.type === InteractionType.Autocomplete) {
    return NextResponse.json(await handleAutocomplete(interaction));
  }

  if (interaction.type === InteractionType.ModalSubmit) {
    return NextResponse.json(await handleModalSubmit(interaction));
  }

  return NextResponse.json({
    type: ResponseType.ChannelMessage,
    data: { content: "Unsupported interaction.", flags: 64 },
  });
}
