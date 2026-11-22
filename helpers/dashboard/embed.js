const { EmbedBuilder, PermissionsBitField } = require("discord.js");
const { BRAND } = require("../brand");
const Log = require("../logs/log");
const { channelCanPost } = require("./channels");

/**
 * Sending a custom embed from the dashboard.
 *
 * This is the one endpoint that acts rather than configures — it posts a
 * message to a Discord channel as the bot — so it validates far more than a
 * settings write does. `/embed` is protected in Discord by requiring Manage
 * Messages; here the gate is dashboard access, which is owner-granted and
 * therefore at least as narrow.
 *
 * Limits mirror Discord's own, checked here so a rejection is a clear message
 * rather than a 400 from the API with an opaque body.
 */

const LIMITS = Object.freeze({
  title: 256,
  description: 4000,
  footer: 2048,
  author: 256,
});

// The same swatches the slash command offers, so the two produce the same
// embeds rather than drifting into different palettes.
const COLORS = Object.freeze({
  "#5865F2": "Blurple",
  "#57F287": "Green",
  "#ED4245": "Red",
  "#FEE75C": "Yellow",
  "#EB459E": "Fuchsia",
  "#FFFFFF": "White",
  "#2C2F33": "Dark",
  [BRAND.colors.primary]: "MewBit cyan",
  [BRAND.colors.secondary]: "MewBit magenta",
});

const TEXT_CHANNEL_TYPES = new Set([0, 5]);
const SNOWFLAKE = /^\d{5,25}$/;

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function readText(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw badRequest(`${field} is required.`);
    return null;
  }
  if (typeof value !== "string") throw badRequest(`${field} must be text.`);
  const text = value.trim();
  if (!text && required) throw badRequest(`${field} is required.`);

  const limit = LIMITS[field.toLowerCase()];
  if (Number.isFinite(limit) && text.length > limit) {
    throw badRequest(`${field} is longer than Discord allows (${limit} characters).`);
  }
  return text || null;
}

/**
 * Only http(s), and never a bare host the bot would then fetch on someone's
 * behalf. Discord fetches these itself, so the risk is what the URL points at
 * rather than what we request.
 */
function readImageUrl(value, field) {
  if (!value) return null;
  if (typeof value !== "string") throw badRequest(`${field} must be a URL.`);
  const text = value.trim();
  if (!text) return null;

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw badRequest(`${field} is not a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw badRequest(`${field} must be an http or https URL.`);
  }
  return parsed.toString();
}

function readColor(value) {
  if (!value) return BRAND.colors.primary;
  if (typeof value !== "string") throw badRequest("Colour must be a hex code.");
  const text = value.trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(text)) throw badRequest("Colour must be a hex code like #19E6FF.");
  return text;
}

function listChannels(client, guildId) {
  const guild = client?.guilds?.cache?.get(guildId);
  if (!guild) return [];

  return [...(guild.channels?.cache?.values?.() || [])]
    .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type))
    .map((channel) => ({ id: channel.id, name: channel.name, canPost: channelCanPost(guild, channel) }));
}

function describeEmbedOptions(client, guildId) {
  return {
    channels: listChannels(client, guildId),
    colors: Object.entries(COLORS).map(([value, label]) => ({ value, label })),
    // Sent rather than repeated in the browser: this is the bot's brand colour,
    // and a second copy would silently diverge the day BRAND changes.
    defaultColor: BRAND.colors.primary.toUpperCase(),
    limits: LIMITS,
  };
}

async function sendDashboardEmbed(client, guildId, payload = {}) {
  const guild = client?.guilds?.cache?.get(guildId);
  if (!guild) throw Object.assign(new Error("MewBit is not in this server."), { statusCode: 404 });

  const channelId = payload.channelId;
  if (typeof channelId !== "string" || !SNOWFLAKE.test(channelId)) throw badRequest("Choose a channel to post in.");

  const channel = guild.channels?.cache?.get(channelId);
  // Resolved from this guild's own cache, so a channel id from another server
  // cannot be used to post through a guild the visitor does have access to.
  if (!channel || !TEXT_CHANNEL_TYPES.has(channel.type)) throw badRequest("That channel is not a text channel in this server.");

  const me = guild.members?.me;
  const permissions = me && typeof channel.permissionsFor === "function" ? channel.permissionsFor(me) : null;
  if (
    !permissions?.has?.(PermissionsBitField.Flags.SendMessages) ||
    !permissions?.has?.(PermissionsBitField.Flags.EmbedLinks)
  ) {
    throw badRequest(`MewBit needs Send Messages and Embed Links in #${channel.name}.`);
  }

  const title = readText(payload.title, "Title", { required: true });
  const description = readText(payload.description, "Description", { required: true });
  const footer = readText(payload.footer, "Footer");
  const author = readText(payload.author, "Author");
  const image = readImageUrl(payload.image, "Image");
  const thumbnail = readImageUrl(payload.thumbnail, "Thumbnail");
  const color = readColor(payload.color);

  const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
  if (image) embed.setImage(image);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (footer) embed.setFooter({ text: footer });
  if (author) embed.setAuthor({ name: author });
  if (payload.timestamp === true) embed.setTimestamp();

  let message;
  try {
    message = await channel.send({ embeds: [embed] });
  } catch (error) {
    Log.error("Dashboard embed send failed", error, `guild=${guildId}`, `channel=${channelId}`);
    throw Object.assign(new Error(`Discord refused the message: ${error.message}`), { statusCode: 502 });
  }

  Log.info("Embed sent from the dashboard", `#${channel.name}`, `guild=${guildId}`);

  return {
    messageId: message.id,
    url: message.url,
    channelName: channel.name,
  };
}

module.exports = { describeEmbedOptions, sendDashboardEmbed, LIMITS, COLORS };
