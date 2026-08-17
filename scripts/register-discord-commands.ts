/**
 * Register the bot's slash commands with Discord. Re-run after any change to
 * src/lib/discord/commands.ts; each PUT REPLACES the whole command set for its
 * scope, so removals deploy too.
 *
 * Two scopes:
 *
 *   npm run register-discord              guild-scoped (DISCORD_GUILD_ID)
 *   npm run register-discord -- --global  every server the bot is in
 *
 * Guild commands appear INSTANTLY, which is what you want while developing,
 * but they exist only in that one server: adding the bot to a second server
 * leaves it mute until you register there too. Global commands are registered
 * once and work in every server the bot joins, now and later, at the cost of
 * taking up to an hour to show up the first time.
 *
 * Going global also CLEARS the guild set, because Discord shows guild and
 * global commands side by side: leaving both would list every command twice
 * in the development server.
 *
 * Needs in .env.local (all from the Discord Developer Portal):
 *   DISCORD_APPLICATION_ID  the app's id
 *   DISCORD_BOT_TOKEN       Bot → Token (used only by this script, never the site)
 *   DISCORD_GUILD_ID        the development server's id (guild scope only)
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { DISCORD_COMMANDS } from "../src/lib/discord/commands";

const APP_ID = process.env.DISCORD_APPLICATION_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const GLOBAL = process.argv.includes("--global");

if (!APP_ID || !BOT_TOKEN) {
  console.error("Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in .env.local first.");
  process.exit(1);
}
if (!GLOBAL && !GUILD_ID) {
  console.error(
    "Set DISCORD_GUILD_ID in .env.local, or pass --global to register everywhere.",
  );
  process.exit(1);
}

const headers = {
  Authorization: `Bot ${BOT_TOKEN}`,
  "Content-Type": "application/json",
  // Discord blocks requests without a recognizable agent (error 40333).
  "User-Agent": "DiscordBot (https://github.com/brotherhood-portal, 1.0)",
};

async function put(url: string, body: unknown): Promise<{ name: string }[]> {
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Discord rejected the commands: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  return (await res.json()) as { name: string }[];
}

// Wrapped rather than top-level await: tsx compiles these scripts to CJS,
// which rejects top-level await outright.
async function main() {
  const base = `https://discord.com/api/v10/applications/${APP_ID}`;

  if (!GLOBAL) {
    const commands = await put(`${base}/guilds/${GUILD_ID}/commands`, DISCORD_COMMANDS);
    console.log(
      `Registered ${commands.length} command(s) in guild ${GUILD_ID}: ` +
        commands.map((c) => `/${c.name}`).join(", "),
    );
    console.log(
      "Guild scope: these work in that ONE server. Use --global to cover every " +
        "server the bot is in.",
    );
    return;
  }

  const commands = await put(`${base}/commands`, DISCORD_COMMANDS);
  console.log(
    `Registered ${commands.length} command(s) GLOBALLY: ` +
      commands.map((c) => `/${c.name}`).join(", "),
  );

  // Otherwise the dev server lists everything twice, once per scope.
  if (GUILD_ID) {
    await put(`${base}/guilds/${GUILD_ID}/commands`, []);
    console.log(`Cleared the guild-scoped copies in ${GUILD_ID} so nothing is listed twice.`);
  }

  console.log(
    "Global commands can take up to an hour to appear the first time. They then " +
      "work in every server the bot joins, with no re-registration.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
