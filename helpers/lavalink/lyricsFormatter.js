const { lyricsEmbed } = require("../embeds");
const { getPlayer } = require("./players");
const { isAwaitingAudio, playbackState } = require("./state");

const MAX_EMBED_DESCRIPTION = 1900;
const MAX_EMBEDS = 10;
const SYNCED_LINES_BEFORE = 2; // Lines to show before current
const SYNCED_LINES_AFTER = 3; // Lines to show after current
const UPDATE_INTERVAL = 250; // Check every 250ms for responsive updates
// Lavalink position is the server-side audio clock; Discord listeners hear
// that stream a little later. A small negative offset prevents lyrics from
// anticipating the line the room is actually hearing. It remains adjustable
// for hosts whose voice path has materially different latency.
const LYRICS_SYNC_OFFSET_MS = Math.max(-2_000, Math.min(2_000, Number(process.env.LYRICS_SYNC_OFFSET_MS ?? -450) || 0));

/**
 * Get accurate interpolated position for the player
 * Lavalink only sends position updates every ~5 seconds, so we interpolate
 * based on elapsed time since last update
 */
function isPlayerPaused(player) {
  return player?.isPaused === true || player?.paused === true;
}

function getInterpolatedPosition(player, now = Date.now(), lookaheadMs = LYRICS_SYNC_OFFSET_MS) {
  if (!player) return 0;

  const state = playbackState.get(player.guildId);
  // Use the anchored position while paused. Poru exposes this as isPaused;
  // state.paused also covers the short period between the command and the
  // next Lavalink playerUpdate packet.
  if (isPlayerPaused(player) || state?.paused || isAwaitingAudio(state, now)) {
    return Math.max(0, Number(state?.lastPosition ?? player.position ?? 0));
  }

  const lastKnownPosition = Number(state?.lastPosition ?? player.position ?? 0);
  const lastUpdateTime = state?.lastTimestamp ?? now;
  const elapsed = Math.max(0, now - lastUpdateTime);
  // Interpolate: current position = last known + time elapsed since update
  // Add a small lookahead offset (300ms) so lyrics appear slightly before the audio
  // This compensates for Discord message edit latency
  const interpolated = lastKnownPosition + elapsed + lookaheadMs;
  // Clamp to track duration
  const maxDuration = player.currentTrack?.info?.length || Infinity;
  return Math.min(interpolated, maxDuration);
}

function chunkLyrics(text, chunkSize = MAX_EMBED_DESCRIPTION) {
  if (!text) return [];

  const lines = text.split("\n");
  const chunks = [];
  let current = "";

  const flush = () => {
    if (current) {
      chunks.push(current);
      current = "";
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const candidate = current ? `${current}\n${line}` : line;

    if (candidate.length <= chunkSize) {
      current = candidate;
      continue;
    }

    flush();

    if (!line) {
      continue;
    }

    if (line.length <= chunkSize) {
      current = line;
      continue;
    }

    for (let i = 0; i < line.length; i += chunkSize) {
      chunks.push(line.slice(i, i + chunkSize));
    }
  }

  flush();

  return chunks;
}

function buildLyricsResponse({ text, provider, trackTitle }) {
  const chunks = chunkLyrics(text);

  if (chunks.length === 0) {
    return { embeds: [], content: undefined };
  }

  const totalPages = chunks.length;
  const visibleChunks = chunks.slice(0, MAX_EMBEDS);

  const embeds = visibleChunks.map((chunk, index) => {
    const pageLabel = totalPages > 1 ? `Page ${index + 1}/${totalPages}` : null;
    const footerParts = [provider ? `Provider - ${provider}` : null, pageLabel].filter(Boolean);
    const footer = footerParts.length ? footerParts.join(" | ") : undefined;
    const title = totalPages > 1 ? `${trackTitle} (Part ${index + 1})` : trackTitle;

    return lyricsEmbed(`Lyrics - ${title}`, chunk, footer);
  });

  const content =
    chunks.length > MAX_EMBEDS ? `Showing the first ${MAX_EMBEDS} parts out of ${chunks.length}.` : undefined;

  return { embeds, content };
}

/**
 * Find current line index based on player position
 */
function findCurrentLine(lines, position) {
  if (!lines || lines.length === 0) return -1;

  // Find the last line whose timestamp is <= current position
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].timestamp <= position) {
      return i;
    }
  }

  return -1; // Before first line
}

/**
 * Build synced lyrics display with highlighted current line
 */
function buildSyncedLyricsEmbed({ lines, currentIndex, trackTitle, provider }) {
  const start = Math.max(0, currentIndex - SYNCED_LINES_BEFORE);
  const end = Math.min(lines.length, currentIndex + SYNCED_LINES_AFTER + 1);

  const visibleLines = [];

  for (let i = start; i < end; i++) {
    const line = lines[i];
    const isCurrent = i === currentIndex;

    // Format: "[MM:SS] Line text" or "▶ [MM:SS] Line text" for current
    const minutes = Math.floor(line.timestamp / 60000);
    const seconds = Math.floor((line.timestamp % 60000) / 1000);
    const timeStr = `${minutes}:${String(seconds).padStart(2, "0")}`;

    const prefix = isCurrent ? "▶ " : "  ";
    const formattedLine = `${prefix}\`[${timeStr}]\` ${line.line || ""}`;

    visibleLines.push(formattedLine);
  }

  const description = visibleLines.join("\n") || "No lyrics at this position";

  const progress = currentIndex >= 0 ? `${currentIndex + 1}/${lines.length}` : `0/${lines.length}`;
  const footer = [provider ? `Provider - ${provider}` : null, `🎵 Live Synced`, progress].filter(Boolean).join(" | ");

  return lyricsEmbed(`Lyrics - ${trackTitle}`, description, footer);
}

/**
 * Active synced lyrics sessions (guildId -> interval)
 */
const activeLyricsSessions = new Map();
const activeLyricsMessages = new Map();

function registerLyricsMessage(guildId, message) {
  if (!guildId || !message || typeof message.delete !== "function") return message;

  const messages = activeLyricsMessages.get(guildId) ?? new Set();
  messages.add(message);
  activeLyricsMessages.set(guildId, messages);
  return message;
}

async function deleteLyricsMessages(guildId) {
  const messages = activeLyricsMessages.get(guildId);
  activeLyricsMessages.delete(guildId);

  if (!messages?.size) return;

  await Promise.allSettled([...messages].map((message) => message.delete().catch(() => null)));
}

async function stopLyricsSession(guildId, { deleteMessage = true } = {}) {
  const session = activeLyricsSessions.get(guildId);

  if (session) {
    clearInterval(session.interval);
    if (session.cleanupTimeout) clearTimeout(session.cleanupTimeout);
    activeLyricsSessions.delete(guildId);
  }

  if (deleteMessage) await deleteLyricsMessages(guildId);
}

function pauseLyricsSession(guildId, position) {
  const session = activeLyricsSessions.get(guildId);
  if (!session) return;

  session.paused = true;
  session.pausedPosition = Math.max(0, Number(position) || 0);
}

function resumeLyricsSession(guildId) {
  const session = activeLyricsSessions.get(guildId);
  if (!session) return;

  session.paused = false;
  // Force the first post-resume tick to use the new Lavalink anchor.
  session.lastIndex = null;
  session.lastUpdateTime = 0;
}

function resyncLyricsSession(guildId) {
  const session = activeLyricsSessions.get(guildId);
  if (!session) return;

  session.lastIndex = null;
  session.lastUpdateTime = 0;
}

/**
 * Build and maintain live synced lyrics display
 */
async function buildSyncedLyricsDisplay({ interaction, player, payload, trackTitle }) {
  const guildId = interaction.guildId;

  // Clear any existing session for this guild
  await stopLyricsSession(guildId);

  const lines = payload.lines;
  const provider = payload.source || "unknown";

  // Initial display
  const currentPosition = getInterpolatedPosition(player);
  const currentIndex = findCurrentLine(lines, currentPosition);

  const embed = buildSyncedLyricsEmbed({
    lines,
    currentIndex,
    trackTitle,
    provider,
  });

  const message = await interaction.editReply({
    embeds: [embed],
    content: "🎵 **Live Synced Lyrics** - Updates automatically as the song plays",
  });
  registerLyricsMessage(guildId, message);

  // Update loop - fast checking, rate-limited Discord updates
  const MIN_UPDATE_DELAY = 800; // Minimum 800ms between Discord API calls
  const updateInterval = setInterval(async () => {
    try {
      const currentPlayer = getPlayer(guildId);
      const session = activeLyricsSessions.get(guildId);

      if (!session || session.interval !== updateInterval) {
        clearInterval(updateInterval);
        return;
      }

      // Stop if player is gone or track changed
      if (!currentPlayer || currentPlayer.currentTrack?.info?.identifier !== player.currentTrack?.info?.identifier) {
        await stopLyricsSession(guildId);
        return;
      }

      // Do not advance lyrics while paused. The position is anchored by the
      // pause command and re-read after resume, preventing cumulative drift.
      if (session.paused || isPlayerPaused(currentPlayer)) {
        return;
      }

      // Use interpolated position for accuracy
      const position = getInterpolatedPosition(currentPlayer);
      const newIndex = findCurrentLine(lines, position);

      // Only update Discord if line changed and enough time has passed
      const now = Date.now();
      if (newIndex !== session.lastIndex && now - session.lastUpdateTime >= MIN_UPDATE_DELAY) {
        session.lastIndex = newIndex;
        session.lastUpdateTime = now;

        const updatedEmbed = buildSyncedLyricsEmbed({
          lines,
          currentIndex: newIndex,
          trackTitle,
          provider,
        });

        await message.edit({
          embeds: [updatedEmbed],
          content: "🎵 **Live Synced Lyrics** - Updates automatically as the song plays",
        });
      }
    } catch {
      // Message deleted or other error - stop updating
      await stopLyricsSession(guildId);
    }
  }, UPDATE_INTERVAL);

  const session = {
    interval: updateInterval,
    message,
    paused: isPlayerPaused(player),
    pausedPosition: currentPosition,
    lastIndex: currentIndex,
    lastUpdateTime: Date.now(),
    cleanupTimeout: null,
  };
  activeLyricsSessions.set(guildId, session);

  // Auto-cleanup after track duration + 10 seconds
  const trackDuration = player.currentTrack?.info?.length || 300000; // Default 5 min
  session.cleanupTimeout = setTimeout(() => {
    if (activeLyricsSessions.get(guildId)?.interval === updateInterval) {
      void stopLyricsSession(guildId);
    }
  }, trackDuration + 10000);
  session.cleanupTimeout.unref?.();
}

module.exports = {
  MAX_EMBED_DESCRIPTION,
  MAX_EMBEDS,
  LYRICS_SYNC_OFFSET_MS,
  chunkLyrics,
  buildLyricsResponse,
  getInterpolatedPosition,
  isPlayerPaused,
  buildSyncedLyricsDisplay,
  findCurrentLine,
  registerLyricsMessage,
  stopLyricsSession,
  pauseLyricsSession,
  resumeLyricsSession,
  resyncLyricsSession,
};
