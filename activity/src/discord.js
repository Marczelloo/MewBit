import { DiscordSDK } from "@discord/embedded-app-sdk";

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID || "1418000096221466715";
const devGuildId = import.meta.env.VITE_ACTIVITY_DEV_GUILD_ID || "demo";
const configuredGateway = String(import.meta.env.VITE_ACTIVITY_GATEWAY_URL || "").replace(/\/$/, "");
const isDevPreview = import.meta.env.DEV && String(import.meta.env.VITE_ACTIVITY_DEV_MODE || "true") !== "false";
const ACTIVITY_SCOPE = "rpc.activities.write";

function readGuildId(sdk) {
  return resolveGuild(sdk).guildId;
}

/* A DM or group DM has no guild at all, and the fallback below quietly turned
   that into the string "demo" — so the gateway answered "the bot is not
   connected to this Discord server", which is true of a server that does not
   exist but tells the person nothing. `inGuild` keeps the two apart. */
function resolveGuild(sdk) {
  const query = new URLSearchParams(window.location.search);
  const real = sdk?.guildId || query.get("guild_id") || query.get("guildId") || null;
  return { guildId: real || devGuildId, inGuild: Boolean(real) };
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Discord SDK handshake timed out.")), timeoutMs)),
  ]);
}

async function readJsonResponse(response, context) {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    // Names the host actually serving this build. It used to name one
    // deployment's domain, which sent people to the wrong place the moment
    // the Activity moved hosts.
    const origin = typeof window === "undefined" ? "the Activity host" : window.location.origin;
    throw new Error(`${context} returned non-JSON data (${response.status}). ${origin} is serving HTML where the gateway should answer — check the Activity URL mapping and the reverse proxy.`);
  }
}

function activityUrl(path) {
  return `${configuredGateway}${path}`;
}

export async function setupDiscord() {
  if (!clientId || isDevPreview) {
    return {
      mode: "local",
      guildId: devGuildId,
      inGuild: true,
      accessToken: null,
      user: { id: "local-user", username: "Local Listener" },
      sdk: null,
      reason: !clientId
        ? "Missing VITE_DISCORD_CLIENT_ID"
        : "Local preview enabled",
    };
  }

  const sdk = new DiscordSDK(clientId);
  await withTimeout(sdk.ready(), 7000);

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "guilds", "applications.commands", ACTIVITY_SCOPE],
  });

  const response = await fetch(activityUrl("/api/token"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const tokenPayload = await readJsonResponse(response, "Discord token exchange");
  if (!response.ok || !tokenPayload.access_token) {
    throw new Error(tokenPayload.error_description || tokenPayload.error || "Discord token exchange failed.");
  }

  const auth = await sdk.commands.authenticate({ access_token: tokenPayload.access_token });
  if (!auth) throw new Error("Discord Activity authentication failed.");

  const guild = resolveGuild(sdk);

  return {
    mode: "discord",
    guildId: guild.guildId,
    inGuild: guild.inGuild,
    accessToken: tokenPayload.access_token,
    user: auth.user || { id: "discord-user", username: "Discord user" },
    sdk,
    instanceId: sdk.instanceId,
  };
}

export async function openExternalLink(sdk, url) {
  const target = String(url || "").trim();
  if (!/^https?:\/\//i.test(target)) throw new Error("That track does not have a safe external link.");

  if (sdk?.commands?.openExternalLink) {
    await sdk.commands.openExternalLink({ url: target });
    return;
  }

  const opened = window.open(target, "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("Your browser blocked the new tab. Allow pop-ups for MewBit and try again.");
}

function cleanPresenceText(value, fallback, limit = 128) {
  const text = String(value || fallback).replace(/\s+/g, " ").trim();
  return text.slice(0, limit);
}

/**
 * Reflect the shared MewBit player in the Discord user's Rich Presence.
 * Discord automatically removes this when the Activity closes.
 */
export async function setMewbitPresence(sdk, player) {
  if (!sdk?.commands?.setActivity) return;

  const track = player?.currentTrack;
  const isPlaying = Boolean(track && player?.playing && !player?.paused && !player?.buffering);
  const positionMs = Math.max(0, Number(player?.positionMs) || 0);
  const durationMs = Math.max(positionMs, Number(player?.durationMs || track?.durationMs) || 0);
  const start = Date.now() - positionMs;
  const artwork = track?.artworkUrl || track?.artworkFallbackUrl;
  const details = track
    ? cleanPresenceText(track?.title, "MewBit")
    : "Choosing the next track";
  const state = track
    ? cleanPresenceText(`${track?.author || "Unknown artist"}${player?.paused ? " · paused" : ""}`, "Unknown artist")
    : undefined;

  await sdk.commands.setActivity({
    activity: {
      // Discord only reliably renders a "Listening" presence when it has a
      // concrete recording. The empty-room state is an app Activity instead,
      // so it remains visible while a listener browses or searches.
      type: track ? 2 : 0,
      instance: true,
      details,
      state,
      timestamps: track && isPlaying
        ? { start, end: durationMs ? start + durationMs : undefined }
        : undefined,
      assets: artwork && /^https?:\/\//i.test(artwork)
        ? { large_image: artwork }
        : undefined,
    },
  });
}
