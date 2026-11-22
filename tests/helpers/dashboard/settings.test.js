const assert = require("node:assert/strict");
const test = require("node:test");

const LOGS_PATH = require.resolve("../../../commands/utility/logs");
const TICKET_PATH = require.resolve("../../../commands/utility/ticket");

/* Both command modules persist immediately — `updateGuildLogsConfig` awaits a
   write and `setGuildConfig` queues one — so requiring the real ones here would
   write test guilds into helpers/data. They are stubbed instead, which also
   makes the log-access assertions deterministic. */
const logsState = { config: {} };
const ticketState = { config: {}, tickets: [] };

require.cache[LOGS_PATH] = {
  id: LOGS_PATH,
  filename: LOGS_PATH,
  loaded: true,
  exports: {
    getGuildLogsConfig: (guildId) => logsState.config[guildId] || null,
    updateGuildLogsConfig: async (guildId, config) => {
      logsState.config[guildId] = { ...logsState.config[guildId], ...config };
    },
  },
};

require.cache[TICKET_PATH] = {
  id: TICKET_PATH,
  filename: TICKET_PATH,
  loaded: true,
  exports: {
    getGuildConfig: (guildId) => ticketState.config[guildId] || null,
    setGuildConfig: (guildId, config) => {
      ticketState.config[guildId] = config;
    },
    getGuildTickets: (guildId, status = null) =>
      ticketState.tickets.filter((ticket) => ticket.guildId === guildId && (!status || ticket.status === status)),
  },
};

const { readGuildSettings, applyGuildSettings, liveHooks, EQ_BAND_COUNT } = require("../../../helpers/dashboard/settings");
const djStore = require("../../../helpers/dj/store");
const { resetGuildState, getGuildState } = require("../../../helpers/guildState");
const { getEqualizerState, clearEqualizerState } = require("../../../helpers/lavalink/equalizerStore");

const GUILD = "910000000000000091";

function fakeClient() {
  return {
    guilds: {
      cache: new Map([[GUILD, {
        id: GUILD,
        channels: {
          cache: new Map([
            ["c1", { id: "c1", name: "music", type: 0 }],
            ["100000000000000001", { id: "100000000000000001", name: "tickets", type: 0 }],
            ["300000000000000003", { id: "300000000000000003", name: "logs", type: 5 }],
            ["500000000000000005", { id: "500000000000000005", name: "Lounge", type: 2 }],
          ]),
        },
        roles: {
          cache: new Map([
            ["r1", { id: "r1", name: "DJ", managed: false }],
            ["200000000000000002", { id: "200000000000000002", name: "Mods", managed: false }],
            ["600000000000000006", { id: "600000000000000006", name: "Booster", managed: true }],
            [GUILD, { id: GUILD, name: "@everyone", managed: false }],
          ]),
        },
      }]]),
    },
  };
}

/* A client whose category and log channels record every permission edit, so a
   test can assert the overwrite actually reached Discord rather than only the
   stored list. `failFor` makes one role's edit throw. */
function fakeLoggingClient({ failFor = null } = {}) {
  const edits = [];
  const makeChannel = (id) => ({
    id,
    permissionOverwrites: {
      edit: async (roleId, update) => {
        if (roleId === failFor) throw new Error("Missing Permissions");
        edits.push({ channelId: id, roleId, view: update.ViewChannel });
      },
    },
  });

  const channels = new Map([
    ["cat", makeChannel("cat")],
    ["ch-message", makeChannel("ch-message")],
    ["ch-voice", makeChannel("ch-voice")],
    ["ch-server", makeChannel("ch-server")],
    ["ch-bot", makeChannel("ch-bot")],
  ]);

  return {
    edits,
    client: {
      guilds: {
        cache: new Map([[GUILD, {
          id: GUILD,
          channels: { cache: channels, fetch: async (id) => channels.get(id) || null },
          roles: {
            cache: new Map([["400000000000000004", { id: "400000000000000004", name: "Staff", managed: false }]]),
          },
        }]]),
      },
    },
  };
}

function seedLogs(overrides = {}) {
  logsState.config[GUILD] = {
    enabled: true,
    categoryId: "cat",
    channels: { message: "ch-message", voice: "ch-voice", server: "ch-server", bot: "ch-bot" },
    accessRoles: [],
    categories: { message: true, voice: true, server: true, bot: true },
    ...overrides,
  };
  return logsState.config[GUILD];
}

test.beforeEach(() => {
  logsState.config = {};
  ticketState.config = {};
  ticketState.tickets = [];
  clearEqualizerState(GUILD);
  resetGuildState(GUILD);
  djStore.setGuildConfig(GUILD, { enabled: false, roleId: null });
});

/* ------------------------------------------------------------- existing --- */

test("settings read back the current store values and the picker options", () => {
  djStore.setGuildConfig(GUILD, { enabled: false, roleId: null, skipMode: "vote", voteThreshold: 0.5, strictMode: false });

  const settings = readGuildSettings(fakeClient(), GUILD);
  assert.equal(settings.source.defaultSource, "deezer");
  assert.equal(settings.player.autoplay, false);
  assert.equal(settings.dj.skipMode, "vote");
  // Voice channels are not offered; canPost is false for a channel the fake
  // cannot answer permission questions about.
  assert.deepEqual(settings.options.channels, [
    { id: "c1", name: "music", canPost: false },
    { id: "100000000000000001", name: "tickets", canPost: false },
    { id: "300000000000000003", name: "logs", canPost: false },
  ]);
  assert.deepEqual(settings.options.roles.map((role) => role.id), ["r1", "200000000000000002"]);
});

test("applying player settings writes through guildState", async () => {
  await applyGuildSettings(GUILD, { player: { playerChannel: "100000000000000001", autoplay: true, radio247: true } });
  const state = getGuildState(GUILD);
  assert.equal(state.playerChannel, "100000000000000001");
  assert.equal(state.autoplay, true);
  assert.equal(state.radio247, true);
});

test("a null player channel clears the setting", async () => {
  await applyGuildSettings(GUILD, { player: { playerChannel: "100000000000000001" } });
  await applyGuildSettings(GUILD, { player: { playerChannel: null } });
  assert.equal(getGuildState(GUILD).playerChannel, null);
});

test("an unknown search source is rejected with 400", async () => {
  await assert.rejects(
    () => applyGuildSettings(GUILD, { source: { defaultSource: "napster" } }),
    (error) => error.statusCode === 400
  );
});

test("every supported search source is accepted", async () => {
  for (const source of ["deezer", "youtube", "spotify", "soundcloud"]) {
    await applyGuildSettings(GUILD, { source: { defaultSource: source } });
    assert.equal(getGuildState(GUILD).defaultSource, source);
  }
});

test("an unknown skip mode is rejected with 400", async () => {
  await assert.rejects(
    () => applyGuildSettings(GUILD, { dj: { skipMode: "coinflip" } }),
    (error) => error.statusCode === 400
  );
});

test("the vote threshold is rejected outside 0.1 to 1.0", async () => {
  for (const value of [0, 1.5, "half"]) {
    await assert.rejects(
      () => applyGuildSettings(GUILD, { dj: { voteThreshold: value } }),
      (error) => error.statusCode === 400
    );
  }
});

test("DJ settings write through djStore", async () => {
  await applyGuildSettings(GUILD, {
    dj: { enabled: true, roleId: "200000000000000002", skipMode: "hybrid", voteThreshold: 0.75, strictMode: true },
  });
  const config = djStore.getGuildConfig(GUILD);
  assert.equal(config.enabled, true);
  assert.equal(config.roleId, "200000000000000002");
  assert.equal(config.skipMode, "hybrid");
  assert.equal(config.voteThreshold, 0.75);
  assert.equal(config.strictMode, true);
});

test("announcement settings write through guildState", async () => {
  await applyGuildSettings(GUILD, {
    announcements: { announcementChannel: "100000000000000001", announcementsEnabled: false },
  });
  const state = getGuildState(GUILD);
  assert.equal(state.announcementChannel, "100000000000000001");
  assert.equal(state.announcementsEnabled, false);
});

test("applying settings returns the full refreshed shape and a warnings list", async () => {
  const result = await applyGuildSettings(GUILD, { player: { autoplay: true } }, fakeClient());
  assert.equal(result.settings.player.autoplay, true);
  assert.ok(result.settings.options);
  assert.deepEqual(result.warnings, []);
});

test("an unknown section is ignored rather than throwing", async () => {
  await assert.doesNotReject(() => applyGuildSettings(GUILD, { nonsense: { x: 1 } }));
});

/* ----------------------------------------------------------------- logs --- */

test("logs read as unconfigured until /logs setup has created the channels", () => {
  const settings = readGuildSettings(fakeClient(), GUILD);
  assert.equal(settings.logs.configured, false);
  assert.equal(settings.logs.enabled, false);
  assert.deepEqual(settings.logs.accessRoles, []);
  assert.deepEqual(Object.keys(settings.logs.categories).sort(), ["bot", "message", "server", "voice"]);
});

test("a logs patch is refused while logging has never been set up", async () => {
  await assert.rejects(
    () => applyGuildSettings(GUILD, { logs: { enabled: true } }, fakeClient()),
    (error) => error.statusCode === 400 && /logs setup/.test(error.message)
  );
});

test("log categories and channels write through the command's own store", async () => {
  seedLogs();
  const { settings } = await applyGuildSettings(
    GUILD,
    { logs: { categories: { voice: false }, channels: { message: "300000000000000003" } } },
    fakeClient()
  );

  assert.equal(settings.logs.categories.voice, false);
  assert.equal(settings.logs.categories.message, true);
  assert.equal(settings.logs.channels.message, "300000000000000003");
  assert.equal(logsState.config[GUILD].channels.message, "300000000000000003");
});

test("turning every category off also turns logging off, matching /logs disable", async () => {
  seedLogs();
  const { settings } = await applyGuildSettings(
    GUILD,
    { logs: { categories: { message: false, voice: false, server: false, bot: false } } },
    fakeClient()
  );

  assert.equal(settings.logs.enabled, false);
  assert.equal(logsState.config[GUILD].enabled, false);
});

test("clearing a log channel is refused rather than silently disabling that category", async () => {
  seedLogs();
  await assert.rejects(
    () => applyGuildSettings(GUILD, { logs: { channels: { message: null } } }, fakeClient()),
    (error) => error.statusCode === 400
  );
});

test("granting log access edits the category and every log channel", async () => {
  seedLogs();
  const { edits, client } = fakeLoggingClient();

  const { settings } = await applyGuildSettings(GUILD, { logs: { accessRoles: ["400000000000000004"] } }, client);

  assert.deepEqual(settings.logs.accessRoles, ["400000000000000004"]);
  // The category plus four channels.
  assert.equal(edits.length, 5);
  assert.ok(edits.every((edit) => edit.roleId === "400000000000000004" && edit.view === true));
});

test("revoking log access clears the stored role and flips the overwrite", async () => {
  seedLogs({ accessRoles: ["400000000000000004"] });
  const { edits, client } = fakeLoggingClient();

  const { settings } = await applyGuildSettings(GUILD, { logs: { accessRoles: [] } }, client);

  assert.deepEqual(settings.logs.accessRoles, []);
  assert.ok(edits.every((edit) => edit.view === false));
});

test("a role Discord refuses is warned about and never recorded as having access", async () => {
  // The stored list has to stay truthful: claiming access that Discord did not
  // grant is worse than reporting the failure.
  seedLogs();
  const { client } = fakeLoggingClient({ failFor: "400000000000000004" });

  const { settings, warnings } = await applyGuildSettings(
    GUILD,
    { logs: { accessRoles: ["400000000000000004"] } },
    client
  );

  assert.deepEqual(settings.logs.accessRoles, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Could not grant log access/);
});

test("an unchanged access list touches no Discord permissions at all", async () => {
  seedLogs({ accessRoles: ["400000000000000004"] });
  const { edits, client } = fakeLoggingClient();

  await applyGuildSettings(GUILD, { logs: { accessRoles: ["400000000000000004"] } }, client);

  assert.equal(edits.length, 0);
});

/* -------------------------------------------------------------- tickets --- */

test("ticket settings write through the command's store and report the open count", async () => {
  ticketState.tickets = [
    { guildId: GUILD, status: "open" },
    { guildId: GUILD, status: "closed" },
    { guildId: "another", status: "open" },
  ];

  const { settings } = await applyGuildSettings(
    GUILD,
    { tickets: { channelId: "100000000000000001", roleId: "200000000000000002", enabled: true } },
    fakeClient()
  );

  assert.equal(settings.tickets.enabled, true);
  assert.equal(settings.tickets.channelId, "100000000000000001");
  assert.equal(settings.tickets.roleId, "200000000000000002");
  assert.equal(settings.tickets.openCount, 1);
  assert.equal(settings.tickets.totalCount, 2);
  assert.deepEqual(ticketState.config[GUILD], {
    channelId: "100000000000000001",
    roleId: "200000000000000002",
    enabled: true,
  });
});

test("the ticket system cannot be turned on without somewhere to deliver tickets", async () => {
  await assert.rejects(
    () => applyGuildSettings(GUILD, { tickets: { enabled: true } }, fakeClient()),
    (error) => error.statusCode === 400 && /channel/.test(error.message)
  );
});

test("clearing the ticket channel while the system is on is refused", async () => {
  ticketState.config[GUILD] = { channelId: "100000000000000001", roleId: null, enabled: true };
  await assert.rejects(
    () => applyGuildSettings(GUILD, { tickets: { channelId: null } }, fakeClient()),
    (error) => error.statusCode === 400
  );
});

test("the ticket ping role can be cleared on its own", async () => {
  ticketState.config[GUILD] = { channelId: "100000000000000001", roleId: "200000000000000002", enabled: true };
  const { settings } = await applyGuildSettings(GUILD, { tickets: { roleId: null } }, fakeClient());
  assert.equal(settings.tickets.roleId, null);
  assert.equal(settings.tickets.enabled, true);
});

/* ------------------------------------------------------------ equalizer --- */

test("the equalizer reads back a flat fifteen-band default", () => {
  const settings = readGuildSettings(fakeClient(), GUILD);
  assert.equal(settings.equalizer.preset, "flat");
  assert.equal(settings.equalizer.bands.length, EQ_BAND_COUNT);
  assert.ok(settings.equalizer.bands.every((gain) => gain === 0));
  assert.ok(settings.equalizer.presets.includes("bassboost"));
});

test("an equalizer preset persists as stored state so the next session restores it", async () => {
  const { settings } = await applyGuildSettings(GUILD, { equalizer: { preset: "bassboost" } }, fakeClient());

  assert.equal(settings.equalizer.preset, "bassboost");
  assert.ok(settings.equalizer.bands.some((gain) => gain > 0));
  // playback.js reads this on player create; a dashboard change is worthless
  // if it only ever touched a live player.
  assert.equal(getEqualizerState(GUILD).preset, "bassboost");
});

test("raw bands are clamped to the safe gain range rather than rejected", async () => {
  const bands = new Array(EQ_BAND_COUNT).fill(0);
  bands[0] = 5;
  bands[1] = -5;

  const { settings } = await applyGuildSettings(GUILD, { equalizer: { bands } }, fakeClient());

  assert.equal(settings.equalizer.preset, "custom");
  assert.equal(settings.equalizer.bands[0], settings.equalizer.maxGain);
  assert.equal(settings.equalizer.bands[1], settings.equalizer.minGain);
});

test("an unknown preset and a malformed band list are both rejected with 400", async () => {
  await assert.rejects(
    () => applyGuildSettings(GUILD, { equalizer: { preset: "spaceship" } }, fakeClient()),
    (error) => error.statusCode === 400
  );
  await assert.rejects(
    () => applyGuildSettings(GUILD, { equalizer: { bands: [1, 2, 3] } }, fakeClient()),
    (error) => error.statusCode === 400
  );
  await assert.rejects(
    () => applyGuildSettings(GUILD, { equalizer: { bands: new Array(EQ_BAND_COUNT).fill("loud") } }, fakeClient()),
    (error) => error.statusCode === 400
  );
});

test("going back to flat drops the preamp the boost had added", async () => {
  await applyGuildSettings(GUILD, { equalizer: { preset: "bassboost" } }, fakeClient());
  assert.equal(getEqualizerState(GUILD).eqPreamp, true);

  await applyGuildSettings(GUILD, { equalizer: { preset: "flat" } }, fakeClient());
  const stored = getEqualizerState(GUILD);
  assert.equal(stored.eqPreamp, undefined);
  assert.equal(stored.volume, undefined);
});

/* ---------------------------------------------------------------- stats --- */

test("a server with no listening history reports zeroes rather than nulls", () => {
  const { stats } = readGuildSettings(fakeClient(), GUILD);
  assert.equal(stats.hasData, false);
  assert.equal(stats.songsPlayed, 0);
  assert.equal(stats.msPlayed, 0);
  assert.deepEqual(stats.topSources, []);
});

/* --------------------------------------------- guild-checked pickers --- */

test("a voice channel or a channel from another server is refused when the guild is known", async () => {
  for (const channelId of ["500000000000000005", "700000000000000007"]) {
    await assert.rejects(
      () => applyGuildSettings(GUILD, { player: { playerChannel: channelId } }, fakeClient()),
      (error) => error.statusCode === 400 && error.message === "Player channel must be a text channel in this server."
    );
  }
  await assert.rejects(
    () => applyGuildSettings(GUILD, { announcements: { announcementChannel: "500000000000000005" } }, fakeClient()),
    (error) => error.statusCode === 400 && /text channel in this server/.test(error.message)
  );
  await assert.rejects(
    () => applyGuildSettings(GUILD, { tickets: { channelId: "700000000000000007" } }, fakeClient()),
    (error) => error.statusCode === 400 && /text channel in this server/.test(error.message)
  );
});

test("a news channel is accepted and clearing still works with a guild present", async () => {
  await applyGuildSettings(GUILD, { player: { playerChannel: "300000000000000003" } }, fakeClient());
  assert.equal(getGuildState(GUILD).playerChannel, "300000000000000003");
  await applyGuildSettings(GUILD, { player: { playerChannel: null } }, fakeClient());
  assert.equal(getGuildState(GUILD).playerChannel, null);
});

test("managed roles, @everyone and unknown roles are refused when the guild is known", async () => {
  for (const roleId of ["600000000000000006", GUILD, "800000000000000008"]) {
    await assert.rejects(
      () => applyGuildSettings(GUILD, { tickets: { roleId } }, fakeClient()),
      (error) => error.statusCode === 400 && error.message === "Ticket ping role must be a role in this server."
    );
  }
  await assert.rejects(
    () => applyGuildSettings(GUILD, { dj: { roleId: "800000000000000008" } }, fakeClient()),
    (error) => error.statusCode === 400 && /DJ role must be a role in this server/.test(error.message)
  );
});

test("log access roles and log channels get the same guild check", async () => {
  seedLogs();
  const { client } = fakeLoggingClient();
  await assert.rejects(
    () => applyGuildSettings(GUILD, { logs: { accessRoles: ["800000000000000008"] } }, client),
    (error) => error.statusCode === 400 && /Access role must be a role in this server/.test(error.message)
  );
  await assert.rejects(
    () => applyGuildSettings(GUILD, { logs: { channels: { voice: "700000000000000007" } } }, client),
    (error) => error.statusCode === 400 && /voice log channel must be a text channel in this server/.test(error.message)
  );
});

test("channel options report whether MewBit can post in them", () => {
  const { PermissionsBitField } = require("discord.js");
  const canPost = {
    has: (flag) => flag === PermissionsBitField.Flags.SendMessages || flag === PermissionsBitField.Flags.EmbedLinks,
  };
  const readOnly = { has: (flag) => flag === PermissionsBitField.Flags.SendMessages };

  const client = {
    guilds: {
      cache: new Map([[GUILD, {
        id: GUILD,
        members: { me: { id: "bot" } },
        channels: {
          cache: new Map([
            ["c1", { id: "c1", name: "open", type: 0, permissionsFor: () => canPost }],
            ["c2", { id: "c2", name: "readonly", type: 0, permissionsFor: () => readOnly }],
          ]),
        },
        roles: { cache: new Map() },
      }]]),
    },
  };

  assert.deepEqual(readGuildSettings(client, GUILD).options.channels, [
    { id: "c1", name: "open", canPost: true },
    { id: "c2", name: "readonly", canPost: false },
  ]);
});

/* ------------------------------------------------------------------ DJ --- */

test("DJ mode cannot be turned on without a role", async () => {
  await assert.rejects(
    () => applyGuildSettings(GUILD, { dj: { enabled: true } }, fakeClient()),
    (error) => error.statusCode === 400 && error.message === "Choose a DJ role before turning DJ mode on."
  );
  assert.equal(djStore.getGuildConfig(GUILD).enabled, false);

  const { settings } = await applyGuildSettings(GUILD, { dj: { enabled: true, roleId: "200000000000000002" } }, fakeClient());
  assert.equal(settings.dj.enabled, true);
  assert.equal(settings.dj.roleId, "200000000000000002");
});

test("clearing the DJ role while DJ mode is on is refused", async () => {
  await applyGuildSettings(GUILD, { dj: { enabled: true, roleId: "200000000000000002" } }, fakeClient());
  await assert.rejects(
    () => applyGuildSettings(GUILD, { dj: { roleId: null } }, fakeClient()),
    (error) => error.statusCode === 400 && /Choose a DJ role/.test(error.message)
  );
  // Turning it off and clearing the role together is fine.
  const { settings } = await applyGuildSettings(GUILD, { dj: { enabled: false, roleId: null } }, fakeClient());
  assert.equal(settings.dj.enabled, false);
  assert.equal(settings.dj.roleId, null);
});

test("a legacy DJ config without a role stays editable through its other fields", async () => {
  djStore.setGuildConfig(GUILD, { enabled: true, roleId: null });
  const { settings } = await applyGuildSettings(GUILD, { dj: { strictMode: true, skipMode: "vote" } }, fakeClient());
  assert.equal(settings.dj.strictMode, true);
  assert.equal(settings.dj.enabled, true);
});

/* -------------------------------------------------------------- effects --- */

test("effects read as off with every preset listed", () => {
  const { effects } = readGuildSettings(fakeClient(), GUILD);
  assert.equal(effects.effect, "off");
  const nightcore = effects.options.find((option) => option.name === "nightcore");
  assert.ok(nightcore && typeof nightcore.description === "string" && nightcore.description.length > 0);
  assert.deepEqual(Object.keys(nightcore).sort(), ["description", "name"]);
});

test("an audio effect persists its name and filters for the next session", async () => {
  const { settings } = await applyGuildSettings(GUILD, { effects: { effect: "nightcore" } }, fakeClient());

  assert.equal(settings.effects.effect, "nightcore");
  const stored = getEqualizerState(GUILD);
  assert.equal(stored.filterPreset, "nightcore");
  assert.deepEqual(stored.timescale, { speed: 1.18, pitch: 1.08, rate: 1 });
});

test("switching effect replaces the old effect's filters and keeps the equalizer", async () => {
  await applyGuildSettings(GUILD, { equalizer: { preset: "bassboost" } }, fakeClient());
  const bands = getEqualizerState(GUILD).equalizer;

  await applyGuildSettings(GUILD, { effects: { effect: "nightcore" } }, fakeClient());
  await applyGuildSettings(GUILD, { effects: { effect: "wobble" } }, fakeClient());
  const swapped = getEqualizerState(GUILD);
  assert.equal(swapped.filterPreset, "wobble");
  assert.equal(swapped.timescale, undefined);
  assert.ok(swapped.tremolo);

  const { settings } = await applyGuildSettings(GUILD, { effects: { effect: "off" } }, fakeClient());
  const stored = getEqualizerState(GUILD);
  assert.equal(settings.effects.effect, "off");
  assert.equal(stored.filterPreset, undefined);
  assert.equal(stored.tremolo, undefined);
  assert.deepEqual(stored.equalizer, bands);
  assert.equal(stored.preset, "bassboost");
  assert.equal(settings.equalizer.preset, "bassboost");
});

test("an unknown audio effect is rejected with 400", async () => {
  for (const effect of ["spaceship", 5, null]) {
    await assert.rejects(
      () => applyGuildSettings(GUILD, { effects: { effect } }, fakeClient()),
      (error) => error.statusCode === 400 && error.message === "Unknown audio effect."
    );
  }
});

test("an equalizer change keeps the stored audio effect", async () => {
  await applyGuildSettings(GUILD, { effects: { effect: "vaporwave" } }, fakeClient());
  const { settings } = await applyGuildSettings(GUILD, { equalizer: { preset: "bassboost" } }, fakeClient());

  assert.equal(settings.effects.effect, "vaporwave");
  assert.equal(getEqualizerState(GUILD).filterPreset, "vaporwave");
  assert.ok(getEqualizerState(GUILD).timescale);
});

/* ---------------------------------------------------- live side effects --- */

/* The real hooks load the lavalink, buttons and announcer modules, which start
   timers and loaders. Tests replace them so nothing here can keep the process
   alive or touch Discord. */
function stubHooks(overrides = {}) {
  const original = { ...liveHooks };
  const calls = { refresh: [], resume: [], announce: [] };
  Object.assign(liveHooks, {
    getPlayer: () => null,
    refreshNowPlaying: async (client, guildId, player) => { calls.refresh.push({ guildId, player }); },
    resumeRadio: async (player, guildId) => { calls.resume.push({ guildId, player }); },
    sendAnnouncement: async (client, guildId, channelId) => { calls.announce.push({ guildId, channelId }); },
    ...overrides,
  });
  return { calls, restore: () => Object.assign(liveHooks, original) };
}

test("changing autoplay refreshes the player message only when a player exists", async () => {
  const player = { queue: [1], currentTrack: { title: "x" } };
  const none = stubHooks();
  try {
    await applyGuildSettings(GUILD, { player: { autoplay: true } }, fakeClient());
    assert.equal(none.calls.refresh.length, 0);
  } finally { none.restore(); }

  const live = stubHooks({ getPlayer: () => player });
  try {
    await applyGuildSettings(GUILD, { player: { autoplay: false } }, fakeClient());
    assert.equal(live.calls.refresh.length, 1);
    assert.equal(live.calls.refresh[0].player, player);
    // Unchanged value: nothing to refresh.
    await applyGuildSettings(GUILD, { player: { autoplay: false } }, fakeClient());
    assert.equal(live.calls.refresh.length, 1);
  } finally { live.restore(); }
});

test("turning 24/7 on with an idle player resumes from history, otherwise it is just stored", async () => {
  const idle = { queue: [], currentTrack: null };
  const busy = { queue: [], currentTrack: { title: "playing" } };

  const a = stubHooks({ getPlayer: () => idle });
  try {
    const { warnings } = await applyGuildSettings(GUILD, { player: { radio247: true } }, fakeClient());
    assert.deepEqual(warnings, []);
    assert.equal(a.calls.resume.length, 1);
    assert.equal(getGuildState(GUILD).radio247, true);
  } finally { a.restore(); }

  resetGuildState(GUILD);
  const b = stubHooks({ getPlayer: () => busy });
  try {
    await applyGuildSettings(GUILD, { player: { radio247: true } }, fakeClient());
    assert.equal(b.calls.resume.length, 0);
  } finally { b.restore(); }

  resetGuildState(GUILD);
  const c = stubHooks();
  try {
    await applyGuildSettings(GUILD, { player: { radio247: true } }, fakeClient());
    assert.equal(c.calls.resume.length, 0);
    assert.equal(getGuildState(GUILD).radio247, true);
  } finally { c.restore(); }
});

test("setting an announcement channel while enabled sends the pending announcement", async () => {
  const hooks = stubHooks();
  try {
    await applyGuildSettings(GUILD, { announcements: { announcementChannel: "100000000000000001" } }, fakeClient());
    assert.deepEqual(hooks.calls.announce, [{ guildId: GUILD, channelId: "100000000000000001" }]);

    await applyGuildSettings(GUILD, { announcements: { announcementChannel: null } }, fakeClient());
    await applyGuildSettings(
      GUILD,
      { announcements: { announcementChannel: "100000000000000001", announcementsEnabled: false } },
      fakeClient()
    );
    // Cleared, then disabled: neither sends.
    assert.equal(hooks.calls.announce.length, 1);

    // No client: stored, not sent.
    await applyGuildSettings(GUILD, { announcements: { announcementChannel: "100000000000000001", announcementsEnabled: true } });
    assert.equal(hooks.calls.announce.length, 1);
  } finally { hooks.restore(); }
});

test("a failing live side effect becomes a warning and never fails the patch", async () => {
  const hooks = stubHooks({
    getPlayer: () => ({ queue: [], currentTrack: null }),
    refreshNowPlaying: async () => { throw new Error("message gone"); },
    sendAnnouncement: async () => { throw new Error("no access"); },
  });
  try {
    const { settings, warnings } = await applyGuildSettings(
      GUILD,
      { player: { autoplay: true }, announcements: { announcementChannel: "100000000000000001" } },
      fakeClient()
    );
    assert.equal(settings.player.autoplay, true);
    assert.equal(settings.announcements.announcementChannel, "100000000000000001");
    assert.equal(warnings.length, 2);
    assert.match(warnings.join(" "), /message gone/);
    assert.match(warnings.join(" "), /no access/);
  } finally { hooks.restore(); }
});

test("re-sending the same announcement channel does not send again, switching on does", async () => {
  const hooks = stubHooks();
  const channel = "100000000000000001";
  try {
    await applyGuildSettings(GUILD, { announcements: { announcementChannel: channel } }, fakeClient());
    assert.equal(hooks.calls.announce.length, 1);

    // Same channel again, and an unrelated toggle that leaves it enabled.
    await applyGuildSettings(GUILD, { announcements: { announcementChannel: channel } }, fakeClient());
    await applyGuildSettings(GUILD, { announcements: { announcementChannel: channel, announcementsEnabled: true } }, fakeClient());
    assert.equal(hooks.calls.announce.length, 1);

    // Off, then back on with the channel still set: one send for the switch.
    await applyGuildSettings(GUILD, { announcements: { announcementsEnabled: false } }, fakeClient());
    assert.equal(hooks.calls.announce.length, 1);
    await applyGuildSettings(GUILD, { announcements: { announcementsEnabled: true } }, fakeClient());
    assert.deepEqual(hooks.calls.announce, [
      { guildId: GUILD, channelId: channel },
      { guildId: GUILD, channelId: channel },
    ]);

    // A different channel is a change.
    await applyGuildSettings(GUILD, { announcements: { announcementChannel: "300000000000000003" } }, fakeClient());
    assert.equal(hooks.calls.announce.length, 3);
  } finally { hooks.restore(); }
});

/* ---------------------------------------------------- refused patches --- */

test("a refused patch leaves every store untouched", async () => {
  await applyGuildSettings(GUILD, { player: { playerChannel: "100000000000000001" } }, fakeClient());

  // Valid player/source/ticket/effect changes alongside DJ on with no role.
  await assert.rejects(
    () =>
      applyGuildSettings(
        GUILD,
        {
          player: { playerChannel: "300000000000000003", autoplay: true },
          source: { defaultSource: "spotify" },
          tickets: { channelId: "100000000000000001", enabled: true },
          effects: { effect: "nightcore" },
          dj: { enabled: true },
        },
        fakeClient()
      ),
    (error) => error.statusCode === 400 && /DJ role/.test(error.message)
  );

  const state = getGuildState(GUILD);
  assert.equal(state.playerChannel, "100000000000000001");
  assert.equal(state.autoplay, false);
  assert.equal(state.defaultSource, "deezer");
  assert.equal(ticketState.config[GUILD], undefined);
  assert.equal(getEqualizerState(GUILD)?.filterPreset, undefined);
  assert.equal(djStore.getGuildConfig(GUILD).enabled, false);
});

test("a later section's refusal, in either order, still writes nothing", async () => {
  // The ticket rule and a bad effect name are checked after the state section.
  await assert.rejects(
    () => applyGuildSettings(GUILD, { player: { autoplay: true }, tickets: { enabled: true } }, fakeClient()),
    (error) => error.statusCode === 400
  );
  await assert.rejects(
    () => applyGuildSettings(GUILD, { player: { autoplay: true }, effects: { effect: "spaceship" } }, fakeClient()),
    (error) => error.statusCode === 400
  );
  await assert.rejects(
    () => applyGuildSettings(GUILD, { player: { autoplay: true }, equalizer: { preset: "spaceship" } }, fakeClient()),
    (error) => error.statusCode === 400
  );
  assert.equal(getGuildState(GUILD).autoplay, false);
});

test("prototype keys are not audio effects and write nothing", async () => {
  await applyGuildSettings(GUILD, { effects: { effect: "nightcore" } }, fakeClient());
  const stored = JSON.stringify(getEqualizerState(GUILD));

  for (const effect of ["constructor", "__proto__", "toString", "hasOwnProperty", "CONSTRUCTOR"]) {
    await assert.rejects(
      () => applyGuildSettings(GUILD, { effects: { effect } }, fakeClient()),
      (error) => error.statusCode === 400 && error.message === "Unknown audio effect."
    );
  }
  assert.equal(JSON.stringify(getEqualizerState(GUILD)), stored);

  // From a clean slate nothing is written either.
  clearEqualizerState(GUILD);
  await assert.rejects(
    () => applyGuildSettings(GUILD, { effects: { effect: "constructor" } }, fakeClient()),
    (error) => error.statusCode === 400
  );
  assert.equal(getEqualizerState(GUILD)?.filterPreset, undefined);
});

test("getFilterPreset only resolves its own preset names", () => {
  const { getFilterPreset } = require("../../../helpers/lavalink/filterPresets");
  assert.equal(getFilterPreset("constructor"), null);
  assert.equal(getFilterPreset("__proto__"), null);
  assert.equal(getFilterPreset("Nightcore").name, "nightcore");
});
