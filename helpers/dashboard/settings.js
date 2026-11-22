const djStore = require("../dj/store");
const { getGuildState, updateGuildState } = require("../guildState");
const { EQUALIZER_PRESETS } = require("../lavalink/constants");
const { getEqualizerState, setEqualizerState } = require("../lavalink/equalizerStore");
const { FILTER_PRESETS, getFilterPreset } = require("../lavalink/filterPresets");
const {
  buildEqualizerFilters,
  lavalinkSetEqualizer,
  lavalinkSetFilterPreset,
  lavalinkResetEffects,
  EFFECT_FILTER_KEYS,
  SAFE_EQ_MIN_GAIN,
  SAFE_EQ_MAX_GAIN,
} = require("../lavalink/filters");
const Log = require("../logs/log");
const statsStore = require("../stats/store");
const { channelCanPost } = require("./channels");

const SOURCES = Object.freeze(["deezer", "youtube", "spotify", "soundcloud"]);
const SKIP_MODES = Object.freeze(["dj", "vote", "hybrid"]);
const LOG_CATEGORY_KEYS = Object.freeze(["message", "voice", "server", "bot"]);
const EQ_BAND_COUNT = 15;
const TEXT_CHANNEL_TYPES = new Set([0, 5]);
const SNOWFLAKE = /^\d{5,25}$/;

/* The command modules own these two stores and are already required this way
   by the event handlers, so the dashboard reads them there rather than keeping
   a second copy of the shape. Required lazily: both kick off an async loader at
   module load, and the gateway must not depend on winning that race. */
function logsCommand() {
  return require("../../commands/utility/logs");
}

function ticketCommand() {
  return require("../../commands/utility/ticket");
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function has(object, key) {
  return object && Object.prototype.hasOwnProperty.call(object, key);
}

function liveGuild(client, guildId) {
  return client?.guilds?.cache?.get(guildId) || null;
}

/* With a live guild, a snowflake is not enough: it has to be a text channel of
   *this* server. Without one (unit tests, a guild the bot has left) only the
   format can be checked. An empty value still means "clear". */
function readChannelId(value, label, guild = null) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !SNOWFLAKE.test(value)) throw badRequest(`${label} must be a channel id.`);
  if (guild) {
    const channel = guild.channels?.cache?.get(value);
    if (!channel || !TEXT_CHANNEL_TYPES.has(channel.type)) throw badRequest(`${label} must be a text channel in this server.`);
  }
  return value;
}

function readRoleId(value, label, guild = null) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !SNOWFLAKE.test(value)) throw badRequest(`${label} must be a role id.`);
  if (guild) {
    const role = guild.roles?.cache?.get(value);
    if (!role || role.managed || value === guild.id) throw badRequest(`${label} must be a role in this server.`);
  }
  return value;
}

function readBoolean(value, label) {
  if (typeof value !== "boolean") throw badRequest(`${label} must be true or false.`);
  return value;
}

function readOptions(client, guildId) {
  const guild = client?.guilds?.cache?.get(guildId);
  if (!guild) return { channels: [], roles: [] };

  const channels = [...(guild.channels?.cache?.values?.() || [])]
    .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type))
    .map((channel) => ({ id: channel.id, name: channel.name, canPost: channelCanPost(guild, channel) }));

  const roles = [...(guild.roles?.cache?.values?.() || [])]
    .filter((role) => !role.managed && role.name !== "@everyone" && role.id !== guild.id)
    .map((role) => ({ id: role.id, name: role.name }));

  return { channels, roles };
}

/* ---------------------------------------------------------------- reads --- */

function readLogsSettings(guildId) {
  const config = logsCommand().getGuildLogsConfig(guildId) || null;

  // `configured` is the distinction the UI needs. Logging cannot be switched on
  // from here without channels to write into, and creating a category plus four
  // channels is a provisioning step that wants Manage Channels — not a setting.
  return {
    configured: Boolean(config?.channels),
    enabled: Boolean(config?.enabled),
    categoryId: config?.categoryId ?? null,
    categories: Object.fromEntries(LOG_CATEGORY_KEYS.map((key) => [key, Boolean(config?.categories?.[key])])),
    channels: Object.fromEntries(LOG_CATEGORY_KEYS.map((key) => [key, config?.channels?.[key] ?? null])),
    accessRoles: Array.isArray(config?.accessRoles) ? [...config.accessRoles] : [],
  };
}

function readTicketSettings(guildId) {
  const command = ticketCommand();
  const config = command.getGuildConfig(guildId) || null;

  return {
    enabled: Boolean(config?.enabled),
    channelId: config?.channelId ?? null,
    roleId: config?.roleId ?? null,
    openCount: (command.getGuildTickets(guildId, "open") || []).length,
    totalCount: (command.getGuildTickets(guildId) || []).length,
  };
}

function readEqualizerSettings(guildId) {
  const stored = getEqualizerState(guildId) || {};
  const bands = new Array(EQ_BAND_COUNT).fill(0);

  for (const entry of Array.isArray(stored.equalizer) ? stored.equalizer : []) {
    const band = Number(entry?.band);
    if (Number.isInteger(band) && band >= 0 && band < EQ_BAND_COUNT) bands[band] = Number(entry.gain) || 0;
  }

  return {
    preset: stored.preset || "flat",
    bands,
    presets: Object.keys(EQUALIZER_PRESETS),
    // Sent rather than hardcoded in the browser. The Activity once shipped its
    // own copy of this list and drifted from the real Lavalink bands, which is
    // a bug nobody can see — the sliders simply lie about what they change.
    frequencies: [...require("../equalizer/panel").BAND_FREQUENCIES],
    minGain: SAFE_EQ_MIN_GAIN,
    maxGain: SAFE_EQ_MAX_GAIN,
  };
}

function readEffectSettings(guildId) {
  const stored = getEqualizerState(guildId) || {};

  return {
    effect: stored.filterPreset || "off",
    options: Object.entries(FILTER_PRESETS).map(([name, preset]) => ({ name, description: preset.description })),
  };
}

function readStats(guildId) {
  const stats = statsStore.getGuildStats(guildId);
  const num = (value) => Number(value) || 0;

  return {
    hasData: Boolean(stats),
    songsPlayed: num(stats?.songsPlayed),
    msPlayed: num(stats?.msPlayed),
    songsSkipped: num(stats?.songsSkipped),
    streamsPlayed: num(stats?.streamsPlayed),
    playlistsAdded: num(stats?.playlistsAdded),
    totalSessions: num(stats?.totalSessions),
    peakListeners: num(stats?.peakListeners),
    uniqueListeners: num(stats?.uniqueUserCount),
    averageSessionMs: num(stats?.averageSessionLength),
    firstPlayedAt: stats?.firstPlayedAt ?? null,
    lastPlayedAt: stats?.lastPlayedAt ?? null,
    topSources: statsStore.getTopSources(guildId, 4) || [],
    mostActiveHour: statsStore.getMostActiveHour(guildId),
  };
}

function readGuildSettings(client, guildId) {
  const state = getGuildState(guildId);
  const dj = djStore.getGuildConfig(guildId);

  return {
    player: {
      playerChannel: state.playerChannel ?? null,
      autoplay: Boolean(state.autoplay),
      radio247: Boolean(state.radio247),
    },
    source: { defaultSource: state.defaultSource || "deezer" },
    announcements: {
      announcementChannel: state.announcementChannel ?? null,
      announcementsEnabled: state.announcementsEnabled !== false,
    },
    dj: {
      enabled: Boolean(dj.enabled),
      roleId: dj.roleId ?? null,
      skipMode: dj.skipMode,
      voteThreshold: dj.voteThreshold,
      strictMode: Boolean(dj.strictMode),
    },
    logs: readLogsSettings(guildId),
    tickets: readTicketSettings(guildId),
    equalizer: readEqualizerSettings(guildId),
    effects: readEffectSettings(guildId),
    stats: readStats(guildId),
    options: readOptions(client, guildId),
  };
}

/* --------------------------------------------------------------- writes --- */

/* A patch is applied in two phases. Every `plan*` function below does all the
   reading and validating for its section and returns a `commit` function (or
   null when the section has nothing to do); nothing is written while planning.
   `applyGuildSettings` plans every section first, so a refused patch leaves all
   stores exactly as they were, and only then runs the commits. */

/**
 * Mirrors `/logs access`: the stored role list and the Discord permission
 * overwrites have to move together. A role is recorded only once its overwrite
 * actually landed, so the list never claims access Discord did not grant.
 *
 * Preparing resolves the category and channels (and refuses if the category is
 * gone) without touching permissions; the returned function does the edits.
 */
async function prepareLogAccess(client, guildId, config, nextRoles) {
  const current = new Set(Array.isArray(config.accessRoles) ? config.accessRoles : []);
  const wanted = new Set(nextRoles);
  const granted = nextRoles.filter((roleId) => !current.has(roleId));
  const revoked = [...current].filter((roleId) => !wanted.has(roleId));
  if (!granted.length && !revoked.length) return async () => [...current];

  const guild = client?.guilds?.cache?.get(guildId);
  const category = config.categoryId ? await guild?.channels?.fetch(config.categoryId).catch(() => null) : null;
  if (!category) throw badRequest("The log category is missing. Run /logs setup again before changing access.");

  const targets = [category];
  for (const channelId of Object.values(config.channels || {})) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel) targets.push(channel);
  }

  const changes = [...granted.map((id) => [id, true]), ...revoked.map((id) => [id, false])];

  return async (warnings) => {
    const applied = new Set(current);

    for (const [roleId, allow] of changes) {
      const update = allow
        ? { ViewChannel: true, ReadMessageHistory: true, SendMessages: false, AddReactions: false }
        : { ViewChannel: false };

      try {
        for (const target of targets) {
          await target.permissionOverwrites.edit(roleId, update);
        }
        if (allow) applied.add(roleId);
        else applied.delete(roleId);
      } catch (error) {
        // Report rather than fail the whole patch: the stored list stays truthful
        // because the role is simply not recorded, and the other settings in this
        // request are unrelated and already valid.
        warnings.push(`Could not ${allow ? "grant" : "revoke"} log access for that role: ${error.message}`);
        Log.warning("Dashboard log access change failed", "", `guild=${guildId}`, `role=${roleId}`, `error=${error.message}`);
      }
    }

    return [...applied];
  };
}

async function planLogsPatch(client, guildId, patch) {
  const command = logsCommand();
  const config = command.getGuildLogsConfig(guildId);

  if (!config?.channels) throw badRequest("Logging is not set up in this server yet. Run /logs setup first.");

  const next = {
    ...config,
    categories: { ...(config.categories || {}) },
    channels: { ...(config.channels || {}) },
  };

  if (has(patch, "enabled")) next.enabled = readBoolean(patch.enabled, "Logging");

  if (patch.categories) {
    for (const key of LOG_CATEGORY_KEYS) {
      if (has(patch.categories, key)) next.categories[key] = readBoolean(patch.categories[key], `${key} logs`);
    }
  }

  if (patch.channels) {
    for (const key of LOG_CATEGORY_KEYS) {
      if (!has(patch.channels, key)) continue;
      const channelId = readChannelId(patch.channels[key], `${key} log channel`, liveGuild(client, guildId));
      if (!channelId) throw badRequest(`A channel is required for ${key} logs.`);
      next.channels[key] = channelId;
    }
  }

  let syncAccess = null;
  if (has(patch, "accessRoles")) {
    if (!Array.isArray(patch.accessRoles)) throw badRequest("Access roles must be a list of role ids.");
    const guild = liveGuild(client, guildId);
    const roles = patch.accessRoles.map((value) => readRoleId(value, "Access role", guild)).filter(Boolean);
    syncAccess = await prepareLogAccess(client, guildId, config, [...new Set(roles)]);
  }

  return async (warnings) => {
    if (syncAccess) next.accessRoles = await syncAccess(warnings);

    // `/logs disable` treats "every category off" as logging off. Match it, or the
    // dashboard leaves behind a config the slash commands consider inconsistent.
    if (next.enabled && !LOG_CATEGORY_KEYS.some((key) => next.categories[key])) next.enabled = false;

    await command.updateGuildLogsConfig(guildId, next);
  };
}

function planTicketsPatch(client, guildId, patch) {
  const guild = liveGuild(client, guildId);
  const command = ticketCommand();
  const config = command.getGuildConfig(guildId) || {};
  const next = {
    channelId: config.channelId ?? null,
    roleId: config.roleId ?? null,
    enabled: Boolean(config.enabled),
  };

  if (has(patch, "channelId")) next.channelId = readChannelId(patch.channelId, "Ticket channel", guild);
  if (has(patch, "roleId")) next.roleId = readRoleId(patch.roleId, "Ticket ping role", guild);
  if (has(patch, "enabled")) next.enabled = readBoolean(patch.enabled, "Ticket system");

  // A ticket has nowhere to be delivered without a channel, and the command
  // requires one at setup. Refuse rather than storing a system that reads as on
  // while silently dropping every submission.
  if (next.enabled && !next.channelId) throw badRequest("Choose a channel before turning the ticket system on.");

  return () => command.setGuildConfig(guildId, next);
}

/**
 * Settles a live-player push after the stored state was already written:
 * "no player" is the normal quiet case, a thrown error or any other non-ok
 * status becomes a warning. Shared by the equalizer and the audio effect.
 */
async function reportLivePush(push, warnings) {
  const result = await Promise.resolve(push).catch((error) => {
    warnings.push(`Saved for the next session, but the live player did not accept it: ${error.message}`);
    return null;
  });
  if (result && result.status !== "ok" && result.status !== "no_player") {
    warnings.push("Saved for the next session, but the live player rejected the change.");
  }
}

function planEqualizerPatch(guildId, patch) {
  let request = null;

  if (has(patch, "bands")) {
    if (!Array.isArray(patch.bands)) throw badRequest("Equalizer bands must be a list of gains.");
    if (patch.bands.length !== EQ_BAND_COUNT) throw badRequest(`Expected ${EQ_BAND_COUNT} equalizer bands.`);
    request = patch.bands.map((gain, band) => {
      const value = Number(gain);
      if (!Number.isFinite(value)) throw badRequest("Every equalizer band must be a number.");
      return { band, gain: value };
    });
  } else if (has(patch, "preset")) {
    if (typeof patch.preset !== "string" || !EQUALIZER_PRESETS[patch.preset]) throw badRequest("Unknown equalizer preset.");
    request = patch.preset;
  } else {
    return null;
  }

  const nextFilters = buildEqualizerFilters(getEqualizerState(guildId) || {}, request);
  if (!nextFilters) throw badRequest("Unknown equalizer preset.");

  return async (warnings) => {
    // Persist first. This is the server's stored equalizer and it has to hold
    // whether or not anyone happens to be listening right now — playback.js
    // restores it the next time a player is created.
    setEqualizerState(guildId, nextFilters);

    // Then, if a player is live, push the identical filters so the change is
    // audible immediately rather than at the start of the next session.
    await reportLivePush(lavalinkSetEqualizer(guildId, request), warnings);
  };
}

function planEffectsPatch(guildId, patch) {
  if (!has(patch, "effect")) return null;

  const requested = patch.effect;
  // Own preset names only; getFilterPreset enforces it, so "constructor" and
  // "__proto__" are unknown rather than persisted as an effect name.
  const preset = requested === "off" ? null : typeof requested === "string" ? getFilterPreset(requested) : null;
  if (requested !== "off" && !preset) throw badRequest("Unknown audio effect.");

  return async (warnings) => {
    // Persist first, on top of the stored filters (read at commit time, so an
    // equalizer change in the same patch is kept), so the equalizer bands and
    // their preamp survive an effect change untouched. playback.js restores this
    // whole object on the next player.
    const next = { ...(getEqualizerState(guildId) || {}) };
    EFFECT_FILTER_KEYS.forEach((key) => delete next[key]);
    delete next.filterPreset;
    if (preset) Object.assign(next, preset.filters, { filterPreset: preset.name });
    setEqualizerState(guildId, next);

    await reportLivePush(preset ? lavalinkSetFilterPreset(guildId, preset.name) : lavalinkResetEffects(guildId), warnings);
  };
}

function planStatePatch(guildId, patch, guild) {
  const stateUpdates = {};

  if (patch.player) {
    if (has(patch.player, "playerChannel")) {
      stateUpdates.playerChannel = readChannelId(patch.player.playerChannel, "Player channel", guild);
    }
    if (has(patch.player, "autoplay")) stateUpdates.autoplay = readBoolean(patch.player.autoplay, "Autoplay");
    if (has(patch.player, "radio247")) stateUpdates.radio247 = readBoolean(patch.player.radio247, "24/7 radio");
  }

  if (patch.source && has(patch.source, "defaultSource")) {
    if (!SOURCES.includes(patch.source.defaultSource)) throw badRequest("Unknown search source.");
    stateUpdates.defaultSource = patch.source.defaultSource;
  }

  if (patch.announcements) {
    if (has(patch.announcements, "announcementChannel")) {
      stateUpdates.announcementChannel = readChannelId(patch.announcements.announcementChannel, "Announcement channel", guild);
    }
    if (has(patch.announcements, "announcementsEnabled")) {
      stateUpdates.announcementsEnabled = readBoolean(patch.announcements.announcementsEnabled, "Announcements");
    }
  }

  if (Object.keys(stateUpdates).length === 0) return null;
  return () => updateGuildState(guildId, stateUpdates);
}

function planDjPatch(guildId, patch, guild) {
  const djUpdates = {};
  if (has(patch, "enabled")) djUpdates.enabled = readBoolean(patch.enabled, "DJ mode");
  if (has(patch, "strictMode")) djUpdates.strictMode = readBoolean(patch.strictMode, "Strict mode");
  if (has(patch, "roleId")) djUpdates.roleId = readRoleId(patch.roleId, "DJ role", guild);

  if (has(patch, "skipMode")) {
    if (!SKIP_MODES.includes(patch.skipMode)) throw badRequest("Unknown skip mode.");
    djUpdates.skipMode = patch.skipMode;
  }

  if (has(patch, "voteThreshold")) {
    const parsed = Number(patch.voteThreshold);
    if (!Number.isFinite(parsed) || parsed < 0.1 || parsed > 1) {
      throw badRequest("Vote threshold must be between 0.1 and 1.");
    }
    djUpdates.voteThreshold = parsed;
  }

  // DJ mode with nobody allowed to be the DJ locks everyone out of playback
  // controls. Checked only when this patch touches the pair, so a legacy
  // stored config stays readable and editable through its other fields.
  if (has(djUpdates, "enabled") || has(djUpdates, "roleId")) {
    const current = djStore.getGuildConfig(guildId);
    const enabled = has(djUpdates, "enabled") ? djUpdates.enabled : Boolean(current.enabled);
    const roleId = has(djUpdates, "roleId") ? djUpdates.roleId : current.roleId ?? null;
    if (enabled && !roleId) throw badRequest("Choose a DJ role before turning DJ mode on.");
  }

  if (Object.keys(djUpdates).length === 0) return null;
  return () => djStore.setGuildConfig(guildId, djUpdates);
}

/* ------------------------------------------------------ live side effects --- */

/* Settings are stored first and are the source of truth; these only make a
   running bot notice. Each is best-effort and required lazily — the lavalink,
   button and announcer modules start timers and loaders at load, and the
   gateway must not depend on winning that race. Exposed as `liveHooks` so tests
   can stub them instead of loading the real modules. */
const liveHooks = {
  getPlayer(guildId) {
    return require("../lavalink/players").getPlayer(guildId);
  },
  async refreshNowPlaying(client, guildId, player) {
    return require("../buttons").refreshNowPlayingMessage(client, guildId, player);
  },
  async resumeRadio(player, guildId) {
    const { playbackState } = require("../lavalink/state");
    const { queueAutoplayTrack } = require("../lavalink/autoplay");
    const history = playbackState.get(guildId)?.history;
    const lastTrack = history?.[history.length - 1];
    if (!lastTrack) return;
    const state = getGuildState(guildId);
    await queueAutoplayTrack(player, lastTrack, state.nowPlayingChannel || state.playerChannel);
  },
  async sendAnnouncement(client, guildId, channelId) {
    return require("../announcements/announcer").sendAnnouncement(client, guildId, channelId);
  },
};

async function runLiveEffects(client, guildId, before, patch, warnings) {
  const after = getGuildState(guildId);
  const attempt = async (what, task) => {
    try {
      await task();
    } catch (error) {
      warnings.push(`Saved, but ${what} could not be updated right now: ${error.message}`);
      Log.warning("Dashboard live side effect failed", "", `guild=${guildId}`, `what=${what}`, `error=${error.message}`);
    }
  };

  const autoplayChanged = has(patch.player, "autoplay") && Boolean(before.autoplay) !== Boolean(after.autoplay);
  const radioTurnedOn = has(patch.player, "radio247") && !before.radio247 && Boolean(after.radio247);

  if (autoplayChanged || radioTurnedOn) {
    await attempt("the live player", async () => {
      const player = liveHooks.getPlayer(guildId);
      if (!player) return; // armed for later: nothing is playing to update
      if (autoplayChanged && client) await liveHooks.refreshNowPlaying(client, guildId, player);
      // Mirrors /247: with nothing queued or playing, start from the last track.
      if (radioTurnedOn && player.queue?.length === 0 && !player.currentTrack) {
        await liveHooks.resumeRadio(player, guildId);
      }
    });
  }

  // Like /setup announcements channel: deliver a pending update right away, but
  // only when something actually changed — a channel re-sent unchanged, or an
  // enable toggle that was already on, must not send again.
  const channelChanged =
    has(patch.announcements, "announcementChannel") && before.announcementChannel !== after.announcementChannel;
  const switchedOn =
    has(patch.announcements, "announcementsEnabled") &&
    before.announcementsEnabled === false &&
    after.announcementsEnabled !== false;
  if (client && after.announcementChannel && after.announcementsEnabled !== false && (channelChanged || switchedOn)) {
    await attempt("the announcement", () => liveHooks.sendAnnouncement(client, guildId, after.announcementChannel));
  }
}

async function applyGuildSettings(guildId, patch = {}, client = null) {
  const warnings = [];
  const guild = liveGuild(client, guildId);
  const stateBefore = { ...getGuildState(guildId) };

  // Plan everything first: any refusal throws here, before a single store has
  // been written, so a rejected patch is a no-op.
  const commits = [
    planStatePatch(guildId, patch, guild),
    patch.dj ? planDjPatch(guildId, patch.dj, guild) : null,
    patch.logs ? await planLogsPatch(client, guildId, patch.logs) : null,
    patch.tickets ? planTicketsPatch(client, guildId, patch.tickets) : null,
    patch.equalizer ? planEqualizerPatch(guildId, patch.equalizer) : null,
    patch.effects ? planEffectsPatch(guildId, patch.effects) : null,
  ].filter(Boolean);

  for (const commit of commits) await commit(warnings);

  await runLiveEffects(client, guildId, stateBefore, patch, warnings);

  return { settings: readGuildSettings(client, guildId), warnings };
}

module.exports = {
  readGuildSettings,
  applyGuildSettings,
  liveHooks,
  SOURCES,
  SKIP_MODES,
  LOG_CATEGORY_KEYS,
  EQ_BAND_COUNT,
};
