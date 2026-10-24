const fs = require("node:fs/promises");
const path = require("node:path");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Status } = require("discord.js");
const PACKAGE_VERSION = require("../../package.json").version;
const { BRAND, getPresenceLines, pickPresenceLine } = require("../brand");
const { getGuildState, updateGuildState } = require("../guildState");
const Log = require("../logs/log");

const PATCH_NOTES_FILE = path.join(__dirname, "..", "data", "patchNotes.json");
const GITHUB_REPO = "https://github.com/Marczelloo/NeoBeat-Buddy";

let patchNotesCache = null;
let currentVersion = PACKAGE_VERSION;
let presenceTimer = null;
let recentPresences = [];
const PRESENCE_INTERVAL_MIN_MS = 20 * 1000;
const PRESENCE_INTERVAL_MAX_MS = 30 * 1000;
const PRESENCE_HISTORY_LIMIT = 12;

/**
 * Initialize announcer system and load patch notes
 */
async function init() {
  try {
    // Get current version from package.json
    const packageJson = JSON.parse(await fs.readFile(path.join(__dirname, "..", "..", "package.json"), "utf-8"));
    currentVersion = packageJson.version;

    // Load patch notes
    const patchNotesData = await fs.readFile(PATCH_NOTES_FILE, "utf-8");
    patchNotesCache = JSON.parse(patchNotesData);

    Log.success(`Announcer initialized`, "", `version=${currentVersion}`);
  } catch (err) {
    Log.error("Failed to initialize announcer", err);
    patchNotesCache = {};
  }
}

/**
 * Get current bot version
 * @returns {string} Current version
 */
function getCurrentVersion() {
  return currentVersion || PACKAGE_VERSION;
}

/**
 * Get patch notes for a specific version
 * @param {string} version - Version to get notes for (defaults to current)
 * @returns {Object|null} Patch notes object
 */
function getPatchNotes(version = null) {
  const targetVersion = version || getCurrentVersion();
  return patchNotesCache?.[targetVersion] || null;
}

/**
 * Get all available versions sorted by date (newest first)
 * @returns {Array<string>} Array of version strings
 */
function getAllVersions() {
  if (!patchNotesCache) return [];
  return Object.keys(patchNotesCache).sort((a, b) => {
    // Sort by version number (semantic versioning)
    const aParts = a.split(".").map(Number);
    const bParts = b.split(".").map(Number);

    for (let i = 0; i < 3; i++) {
      if (aParts[i] !== bParts[i]) {
        return bParts[i] - aParts[i]; // Descending order
      }
    }
    return 0;
  });
}

/**
 * Build patch notes embed for a specific version
 * @param {string} version - Version to build embed for
 * @param {number} pageIndex - Current page index (0-based)
 * @param {number} totalPages - Total number of pages
 * @returns {EmbedBuilder} Formatted embed
 */
function buildPatchNotesEmbed(version, pageIndex = 0, totalPages = 1) {
  const notes = getPatchNotes(version);

  if (!notes) {
    return new EmbedBuilder()
      .setColor("#FF0000")
      .setTitle("❌ Patch Notes Not Found")
      .setDescription(`No patch notes available for version ${version}`)
      .setTimestamp();
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND.colors.primary)
    .setTitle(`📢 ${BRAND.name} ${notes.version} - ${notes.title}`)
    .setDescription(`Released on ${notes.date}`)
    .setTimestamp();

  // Add features section
  if (notes.features && notes.features.length > 0) {
    const featuresText = notes.features.map((f) => `✨ ${f}`).join("\n");
    // Discord limit: 1024 characters per field value
    if (featuresText.length > 1024) {
      // Split into multiple fields if too long
      const chunks = [];
      let currentChunk = "";

      for (const feature of notes.features) {
        const line = `✨ ${feature}\n`;
        if ((currentChunk + line).length > 1024) {
          chunks.push(currentChunk.trim());
          currentChunk = line;
        } else {
          currentChunk += line;
        }
      }
      if (currentChunk) chunks.push(currentChunk.trim());

      // Add first chunk with title
      embed.addFields({
        name: "🆕 New Features",
        value: chunks[0],
        inline: false,
      });

      // Add remaining chunks without title
      for (let i = 1; i < chunks.length; i++) {
        embed.addFields({
          name: "\u200b", // Zero-width space
          value: chunks[i],
          inline: false,
        });
      }
    } else {
      embed.addFields({
        name: "🆕 New Features",
        value: featuresText,
        inline: false,
      });
    }
  }

  // Add fixes section
  if (notes.fixes && notes.fixes.length > 0) {
    const fixesText = notes.fixes.map((f) => `🔧 ${f}`).join("\n");
    // Discord limit: 1024 characters per field value
    if (fixesText.length > 1024) {
      const chunks = [];
      let currentChunk = "";

      for (const fix of notes.fixes) {
        const line = `🔧 ${fix}\n`;
        if ((currentChunk + line).length > 1024) {
          chunks.push(currentChunk.trim());
          currentChunk = line;
        } else {
          currentChunk += line;
        }
      }
      if (currentChunk) chunks.push(currentChunk.trim());

      embed.addFields({
        name: "🐛 Bug Fixes",
        value: chunks[0],
        inline: false,
      });

      for (let i = 1; i < chunks.length; i++) {
        embed.addFields({
          name: "\u200b",
          value: chunks[i],
          inline: false,
        });
      }
    } else {
      embed.addFields({
        name: "🐛 Bug Fixes",
        value: fixesText,
        inline: false,
      });
    }
  }

  // Add changes section
  if (notes.changes && notes.changes.length > 0) {
    const changesText = notes.changes.map((c) => `⚡ ${c}`).join("\n");
    // Discord limit: 1024 characters per field value
    if (changesText.length > 1024) {
      const chunks = [];
      let currentChunk = "";

      for (const change of notes.changes) {
        const line = `⚡ ${change}\n`;
        if ((currentChunk + line).length > 1024) {
          chunks.push(currentChunk.trim());
          currentChunk = line;
        } else {
          currentChunk += line;
        }
      }
      if (currentChunk) chunks.push(currentChunk.trim());

      embed.addFields({
        name: "📝 Changes & Improvements",
        value: chunks[0],
        inline: false,
      });

      for (let i = 1; i < chunks.length; i++) {
        embed.addFields({
          name: "\u200b",
          value: chunks[i],
          inline: false,
        });
      }
    } else {
      embed.addFields({
        name: "📝 Changes & Improvements",
        value: changesText,
        inline: false,
      });
    }
  }

  // Add footer with version and page info
  if (totalPages > 1) {
    embed.setFooter({
      text: `Version ${version} • Page ${pageIndex + 1} of ${totalPages}`,
    });
  } else {
    embed.setFooter({
      text: `Version ${version}`,
    });
  }

  return embed;
}

/**
 * Build action buttons for patch notes message
 * @param {string} version - Current version being displayed
 * @param {boolean} showDismiss - Whether to show dismiss button
 * @returns {ActionRowBuilder} Button row
 */
function buildPatchNotesButtons(version, showDismiss = false) {
  const buttons = [
    new ButtonBuilder()
      .setLabel("View Full Changelog")
      .setStyle(ButtonStyle.Link)
      .setURL(`${GITHUB_REPO}/commits/main`)
      .setEmoji("📜"),
    new ButtonBuilder()
      .setLabel("Report Bug")
      .setStyle(ButtonStyle.Link)
      .setURL(`${GITHUB_REPO}/issues/new`)
      .setEmoji("🐛"),
  ];

  if (showDismiss) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("announce:dismiss")
        .setLabel("Dismiss")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("✖️")
    );
  }

  return new ActionRowBuilder().addComponents(buttons);
}

/**
 * Check if guild has been announced for this version
 * @param {string} guildId - Guild ID
 * @returns {boolean} True if already announced
 */
function hasBeenAnnounced(guildId) {
  const state = getGuildState(guildId);
  return state?.lastAnnouncedVersion === getCurrentVersion();
}

/**
 * Mark guild as announced for current version
 * @param {string} guildId - Guild ID
 */
function markAsAnnounced(guildId) {
  updateGuildState(guildId, {
    lastAnnouncedVersion: getCurrentVersion(),
  });
}

/**
 * Check if announcements are enabled for a guild
 * @param {string} guildId - Guild ID
 * @returns {boolean} True if enabled
 */
function areAnnouncementsEnabled(guildId) {
  const state = getGuildState(guildId);
  return state?.announcementsEnabled !== false; // Default to true
}

/**
 * Get announcement channel for a guild
 * @param {string} guildId - Guild ID
 * @returns {string|null} Channel ID or null
 */
function getAnnouncementChannel(guildId) {
  const state = getGuildState(guildId);
  return state?.announcementChannel || null;
}

/**
 * Send announcement to a guild
 * @param {Object} client - Discord client
 * @param {string} guildId - Guild ID
 * @param {string} fallbackChannelId - Fallback channel if announcement channel not set
 * @returns {Promise<boolean>} True if sent successfully
 */
async function sendAnnouncement(client, guildId, fallbackChannelId = null) {
  try {
    // Check if already announced
    if (hasBeenAnnounced(guildId)) {
      Log.debug("Guild already announced for this version", "", `guild=${guildId}`, `version=${getCurrentVersion()}`);
      return false;
    }

    // Check if announcements are enabled
    if (!areAnnouncementsEnabled(guildId)) {
      Log.debug("Announcements disabled for guild", "", `guild=${guildId}`);
      return false;
    }

    // Get announcement channel
    let channelId = getAnnouncementChannel(guildId) || fallbackChannelId;

    if (!channelId) {
      Log.debug("No announcement channel configured", "", `guild=${guildId}`);
      return false;
    }

    // Fetch channel
    const channel = await client.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
      Log.warning("Could not fetch announcement channel", "", `guild=${guildId}`, `channel=${channelId}`);
      return false;
    }

    // Build and send announcement
    const embed = buildPatchNotesEmbed(getCurrentVersion());
    const buttons = buildPatchNotesButtons(getCurrentVersion(), true);

    await channel.send({
      content: `## 🎉 New Update Available: v${getCurrentVersion()}!\n> Use \`/changelog\` to view this and previous updates anytime.`,
      embeds: [embed],
      components: [buttons],
    });

    // Mark as announced
    markAsAnnounced(guildId);

    Log.success("Announcement sent", "", `guild=${guildId}`, `version=${getCurrentVersion()}`, `channel=${channelId}`);
    return true;
  } catch (err) {
    // A stale channel ID or revoked permission should not create a red
    // Recent Errors entry every time the bot starts. Treat it as a skipped
    // announcement for this version; the next release will retry normally.
    if (err?.code === 50001 || err?.code === 50013) {
      markAsAnnounced(guildId);
      Log.warning("Announcement skipped: bot has no access to the configured channel", "", `guild=${guildId}`);
      return false;
    }

    Log.error("Failed to send announcement", err, `guild=${guildId}`);
    return false;
  }
}

/**
 * Update bot status to show new version available
 * @param {Object} client - Discord client
 */
function updateBotStatus(client) {
  try {
    if (presenceTimer) clearTimeout(presenceTimer);

    const rotatePresence = () => {
      // discord.js holds every gateway send made while a shard is reconnecting
      // and replays them once it is back. A rotation every 20-30 s queued a
      // dozen stale lines through any outage of a few minutes, which is what
      // tripped the WebSocketShard listener warning. A missed line costs nothing.
      if (!client.ws?.shards?.size || client.ws.shards.some((shard) => shard.status !== Status.Ready)) return;

      // A random member seed also randomizes the personalized half of the pool;
      // without it those templates would otherwise follow the member cache order.
      const presenceLines = getPresenceLines(client, Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
      const tagline = pickPresenceLine(presenceLines, recentPresences);
      if (!tagline) return;

      recentPresences.unshift(tagline);
      if (recentPresences.length > PRESENCE_HISTORY_LIMIT) {
        recentPresences.length = PRESENCE_HISTORY_LIMIT;
      }

      // Keep the Discord presence compact: the rotating line itself carries
      // the branding, while command hints and version text make it noisy.
      client.user.setActivity(tagline.slice(0, 128), {
        type: 2, // LISTENING
      });
    };

    rotatePresence();
    const scheduleNextPresence = () => {
      const intervalRange = PRESENCE_INTERVAL_MAX_MS - PRESENCE_INTERVAL_MIN_MS + 1;
      const delay = PRESENCE_INTERVAL_MIN_MS + Math.floor(Math.random() * intervalRange);
      presenceTimer = setTimeout(() => {
        rotatePresence();
        scheduleNextPresence();
      }, delay);
      presenceTimer.unref?.();
    };
    scheduleNextPresence();

    Log.info(
      "Bot status rotation started",
      "",
      `version=${getCurrentVersion()}`,
      `interval=${PRESENCE_INTERVAL_MIN_MS}-${PRESENCE_INTERVAL_MAX_MS}ms`,
      `variants=${BRAND.presence.length}+personalized`
    );
  } catch (err) {
    Log.error("Failed to update bot status", err);
  }
}

module.exports = {
  init,
  getCurrentVersion,
  getPatchNotes,
  getAllVersions,
  buildPatchNotesEmbed,
  buildPatchNotesButtons,
  hasBeenAnnounced,
  markAsAnnounced,
  areAnnouncementsEnabled,
  getAnnouncementChannel,
  sendAnnouncement,
  updateBotStatus,
};
