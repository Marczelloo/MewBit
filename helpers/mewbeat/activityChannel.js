const { randomBytes } = require("node:crypto");
const Log = require("../logs/log");
const { audioKeyOf, trackFromAudioKey } = require("./audioKey");
const { summarizeCharts } = require("./chartSummary");
const { createLiveBoard } = require("./liveBoard");
const { isPrivatePlace } = require("./places");
const { createRanking } = require("./ranking");
const { judgeablePartsOf, recomputeRun } = require("./recompute");
const { RULES_VERSION, boardKeyOf, loadClientModifiers } = require("./rules");
const { DIFFICULTIES: ROOM_DIFFICULTIES, MAX_PLAYERS, createRooms } = require("./rooms");
const { deriveRunStats } = require("./runStats");
const { createSoloTracks } = require("./soloTracks");

const DIFFICULTIES = ["easy", "normal", "hard", "hell"];
const MAX_ID_LENGTH = 40;
const MAX_URI_LENGTH = 1000;
const MAX_SOURCE_LENGTH = 40;
// A resolved search result is reused this long (and at most this many are kept).
const RESOLVE_CACHE_MS = 10 * 60_000;
// "Chart this map": songs one player may have queued at once, and how long the answer for a map that failed is kept.
const CHART_MAP_PER_PLAYER = 3;
const CHART_MAP_MEMORY_MS = 10 * 60_000;
const RESOLVE_CACHE_MAX = 200;
const MODES = ["live", "solo", "room"];
const MAX_EVENTS = 20000;
const MAX_FEVERS = 200;
// A run counts for the board when its first judgement is within this long of the first note.
const LATE_JOIN_MS = 2000;
const MIN_JUDGED_SHARE = 0.5;
const SERVER_TOP = 5;
const BOARD_LIMIT = 50;
const PLAYED_LIMIT = 500;
const RANKING_LIMIT = 100;
// Rows of the profile's recent and best lists.
const PROFILE_ROWS = 8;
// Runs the bug report window offers to pick from for a map problem.
const REPORT_RUNS = 20;
// The stats card lists the maps with the highest max combo; a player with 2000 maps would otherwise get them all.
const STATS_MAPS = 50;
// More key presses than this in one run is a bogus count, not a very fast player.
const MAX_PRESSES = 200000;
const GRADES = ["S", "A", "B", "C", "D"];
const INVITE_COOLDOWN_MS = 60_000;
const INVITE_LINK_TTL_MS = 6 * 60 * 60 * 1000;
const ROUND_PHASES = ["loading", "countdown", "playing"];

function errorReply(message) {
  return { type: "error", error: message };
}

// The mewbeat half of the Activity socket. It owns no state: playback and the
// chart store are injected, so the server decides where they come from.
// audioLatencyMs is how long the player position runs ahead of what Discord
// listeners hear (send queue plus voice transport); the anchor says the
// position is heard that much later.
//
// resolveTrack(guildId, { uri, source }) -> { track, node, info? } | null turns a
// search result into an encoded track; soloTracks remembers it by audioKey so
// charts and audio can be served for songs the bot is not playing.
// scoreStore and historyStore keep boards and play history, statsStore the
// player's totals (the profile messages need it); loadScoring
// replaces the import of the client's scoring module in tests. The rooms push
// their state with broadcast(guildId, userIds, payload) and run their phases
// on setTimer/clearTimer, so tests can drive them with a fake clock; the live
// board pushes and expires its entries the same way. postInvite({ guildId,
// userId, username, avatarUrl, room }) -> { ok } | { ok: false, reason } posts
// the lobby invite in the inviter's voice channel chat (room says what is on:
// song, seats, queue; or null); the channel only rate-limits it.
// warmAudio(audioKey, track, node) starts rendering a room song's audio when it
// is queued, so the round's loading window doesn't pay for a cold render.
// tourSongs.state() (tourSongs.js) is what the first-run tour is told about its two songs: both warm, or null.
function createMewbeatChannel({
  readPlayback,
  chartStore,
  now = Date.now,
  audioLatencyMs = 0,
  resolveTrack,
  soloTracks = createSoloTracks(),
  scoreStore, historyStore, statsStore, loadScoring,
  postInvite,
  newInviteCode = () => randomBytes(8).toString("base64url"),
  warmAudio = () => {},
  tourSongs = null,
  // eslint-disable-next-line no-unused-vars
  broadcast = () => {}, sendToUser,
  setTimer = setTimeout, clearTimer = clearTimeout,
  log = Log,
}) {
  function sync(guildId, message) {
    const { id, clientSentAt } = message;
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH || !Number.isFinite(clientSentAt)) {
      return errorReply("Bad mewbeat sync.");
    }

    const playback = readPlayback(guildId);
    const serverNow = now();
    const audioKey = playback ? audioKeyOf(playback.track) : null;
    const anchor = audioKey
      ? {
        audioKey,
        positionMs: Math.round(playback.positionMs),
        at: serverNow + audioLatencyMs,
        paused: Boolean(playback.paused),
        durationMs: playback.durationMs,
      }
      : null;
    return { type: "mewbeat_sync", id, clientSentAt, serverNow, anchor };
  }

  // A chart reply carries the request id when it has one (the sockets of the link match chart replies by key and
  // difficulty and send none; the first-run tour asks through request(), which matches by id).
  async function chart(guildId, userId, message) {
    const { audioKey, difficulty } = message;
    const echo = typeof message.id === "string" && message.id && message.id.length <= MAX_ID_LENGTH ? { id: message.id } : null;
    if (!DIFFICULTIES.includes(difficulty)) return errorReply("Unknown mewbeat difficulty.");

    let source = typeof audioKey === "string" ? soloTracks.get(audioKey) : null;
    if (!source) {
      const playback = readPlayback(guildId);
      if (!playback || !audioKey || audioKeyOf(playback.track) !== audioKey) {
        return { type: "mewbeat_chart", ...echo, audioKey, difficulty, status: "stale" };
      }
      source = playback;
    }

    const result = await chartStore.getCharts(source.track, source.node, { retry: message.retry === true });
    const reply = { type: "mewbeat_chart", ...echo, audioKey, difficulty, status: result.status };
    if (result.reason !== undefined) reply.reason = result.reason;
    if (result.status === "ready") {
      reply.chart = result.charts[difficulty];
      const chartKey = scoreStore ? chartKeyFor(audioKey, difficulty) : null;
      const best = chartKey ? scoreStore.bestOf(chartKey, userId) : null;
      if (best) reply.best = { score: best.score, grade: best.grade };
    }
    return reply;
  }

  function trackInfoOf(track) {
    const info = track.info || {};
    return {
      title: info.title || "Unknown title",
      artist: info.author || "",
      durationMs: Number(info.length) || 0,
      artworkUrl: info.artworkUrl || null,
      uri: info.uri || null,
      source: String(info.sourceName || "").toLowerCase(),
    };
  }

  // Resolving a search result asks Lavalink, which can take seconds. The answer is kept for a while and shared by
  // concurrent callers, so picking the same result again (or the preview and then Play) asks only once. A failure or
  // an empty answer is not kept.
  const resolvedByUri = new Map(); // key -> { value, expiresAt }, oldest first
  const resolvingByUri = new Map(); // key -> promise
  function resolveCached(guildId, query) {
    const key = `${guildId}\n${query.source}\n${query.uri}`;
    const hit = resolvedByUri.get(key);
    if (hit && hit.expiresAt > now()) return Promise.resolve(hit.value);
    resolvedByUri.delete(key);
    const flying = resolvingByUri.get(key);
    if (flying) return flying;
    const request = Promise.resolve(resolveTrack(guildId, query))
      .then((value) => {
        if (value?.track) {
          resolvedByUri.set(key, { value, expiresAt: now() + RESOLVE_CACHE_MS });
          while (resolvedByUri.size > RESOLVE_CACHE_MAX) resolvedByUri.delete(resolvedByUri.keys().next().value);
        }
        return value;
      })
      .finally(() => resolvingByUri.delete(key));
    resolvingByUri.set(key, request);
    return request;
  }

  // Resolves a song, registers it by audioKey and starts its charts (unless
  // only a preview was asked for). A song the bot already knows by audioKey
  // (soloTracks) is used as it is, without asking Lavalink again. Throws an
  // error with `reason` when the song can't be used.
  async function prepareSong(guildId, { uri, source, audioKey: knownKey }, { chart = true } = {}) {
    const refuse = (reason) => Object.assign(new Error(reason), { reason });
    const known = typeof knownKey === "string" && knownKey && knownKey.length <= MAX_URI_LENGTH ? soloTracks.get(knownKey) : null;
    if (known?.track) {
      if (chart) {
        Promise.resolve(chartStore.getCharts(known.track, known.node))
          .catch((error) => log.warning("mewbeat solo chart failed", error?.message));
      }
      return { audioKey: knownKey, track: known.info ?? trackInfoOf(known.track) };
    }

    if (typeof uri !== "string" || !uri.trim() || uri.length > MAX_URI_LENGTH) throw refuse("bad_uri");
    if (source != null && (typeof source !== "string" || source.length > MAX_SOURCE_LENGTH)) throw refuse("bad_source");

    let resolved;
    try {
      resolved = await resolveCached(guildId, { uri: uri.trim(), source: source || "" });
    } catch (error) {
      log.warning("mewbeat solo resolve failed", error?.message);
      throw refuse("resolve_failed");
    }
    if (!resolved?.track) throw refuse("not_found");

    const audioKey = audioKeyOf(resolved.track);
    if (!audioKey) throw refuse("unsupported");

    const info = resolved.info ?? trackInfoOf(resolved.track);
    soloTracks.put(audioKey, { track: resolved.track, node: resolved.node, info });
    // Charting starts now so it is usually done by the time Play is pressed. A
    // song-select preview doesn't chart: browsing would analyse every row.
    if (chart) {
      Promise.resolve(chartStore.getCharts(resolved.track, resolved.node))
        .catch((error) => log.warning("mewbeat solo chart failed", error?.message));
    }
    return { audioKey, track: info };
  }

  async function soloPrepare(guildId, userId, message) {
    const { id, uri, source } = message;
    const preview = message.preview === true;
    const fail = (reason) => ({ type: "mewbeat_solo_prepare", id, status: "error", reason });
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat prepare.");

    try {
      const { audioKey, track } = await prepareSong(guildId, { uri, source, audioKey: message.audioKey }, { chart: !preview });
      // The song's highlight, when its charts already exist (song select previews start there).
      const highlightMs = highlightOf(peekSummaryOf(soloTracks.get(audioKey)?.track));
      return { type: "mewbeat_solo_prepare", id, status: "ok", audioKey, track, highlightMs };
    } catch (error) {
      if (!error.reason) throw error;
      return fail(error.reason);
    }
  }

  // The first-run tour's two songs, prepared by the bot on its own (tourSongs.js): their keys and info, or not_ready while
  // either is still being found, charted or rendered. The client never sends a search.
  function tourSongsReply(message) {
    const { id } = message;
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat tour songs.");
    const state = tourSongs?.state?.() ?? null;
    if (!state) return { type: "mewbeat_tour_songs", id, status: "not_ready" };
    return { type: "mewbeat_tour_songs", id, status: "ok", heavy: state.heavy, calm: state.calm };
  }

  const rooms = createRooms({
    now,
    setTimer,
    clearTimer,
    prepareTrack: async ({ guildId, uri, source }) => {
      const prepared = await prepareSong(guildId, { uri, source });
      const entry = soloTracks.get(prepared.audioKey);
      if (entry) {
        Promise.resolve()
          .then(() => warmAudio(prepared.audioKey, entry.track, entry.node))
          .catch((error) => log.warning("mewbeat room audio warm-up failed", error?.message));
      }
      return prepared;
    },
    broadcast,
    log,
  });

  // Live standings are pushed to the session's players; the room's members
  // (spectators included) come from the room itself.
  const liveBoard = createLiveBoard({
    now,
    setTimer,
    clearTimer,
    broadcast,
    membersOf: (guildId) => rooms.snapshot(guildId)?.members ?? [],
    log,
  });

  // A progress update from a running game; nothing is sent back, the board
  // reaches everyone as a mewbeat_live_board push.
  function live(guildId, userId, message, profile) {
    liveBoard.update(guildId, userId, profile, message);
    return null;
  }

  const inviteCooldownUntil = new Map();

  // What the invite shows of the room: the song being played, else the one up next.
  function inviteRoomOf(guildId) {
    const room = rooms.snapshot(guildId);
    if (!room) return null;
    const inRound = ROUND_PHASES.includes(room.phase);
    const song = (inRound ? room.current : null) ?? room.queue[0] ?? null;
    return {
      title: song?.title ?? null,
      artist: song?.artist ?? "",
      artworkUrl: song?.artworkUrl ?? null,
      players: room.members.filter((member) => !member.spectator).length,
      maxPlayers: MAX_PLAYERS,
      queued: room.queue.length,
      inRound,
    };
  }

  // One invite per guild per minute. The slot is taken before the post so two
  // quick requests can't both go out, and given back when nothing was posted.
  async function invite(guildId, userId, type, id, profile) {
    const fail = (reason, extra) => ({ type, id, status: "error", reason, ...extra });
    if (!rooms.snapshot(guildId)?.members.some((member) => member.userId === userId)) return fail("not_in_room");
    if (isPrivatePlace(guildId)) return fail("no_voice_channel"); // the bot can't post in a DM; the client shares a link instead
    if (typeof postInvite !== "function") return fail("send_failed");

    const until = inviteCooldownUntil.get(guildId) ?? 0;
    if (now() < until) return fail("cooldown", { retryInMs: until - now() });
    inviteCooldownUntil.set(guildId, now() + INVITE_COOLDOWN_MS);

    let result;
    try {
      result = await postInvite({
        guildId,
        userId,
        username: profile?.username,
        avatarUrl: profile?.avatarUrl ?? null,
        room: inviteRoomOf(guildId),
      });
    } catch (error) {
      log.warning("mewbeat invite failed", error?.message);
      result = { ok: false, reason: "send_failed" };
    }
    if (!result?.ok) {
      inviteCooldownUntil.delete(guildId);
      return fail(result?.reason === "no_voice_channel" ? "no_voice_channel" : "send_failed");
    }
    return { type, id, status: "ok" };
  }

  // A code for a link that brings anyone into this room, wherever they open it from. One per room while it lasts.
  const inviteLinks = new Map(); // code -> { room, expiresAt }

  function inviteLink(guildId, userId, type, id) {
    if (!rooms.snapshot(guildId)?.members.some((member) => member.userId === userId)) {
      return { type, id, status: "error", reason: "not_in_room" };
    }
    for (const [code, link] of inviteLinks) if (link.expiresAt <= now()) inviteLinks.delete(code);
    let code = [...inviteLinks].find(([, link]) => link.room === guildId)?.[0];
    if (!code) {
      code = newInviteCode();
      inviteLinks.set(code, { room: guildId, expiresAt: now() + INVITE_LINK_TTL_MS });
    }
    return { type, id, status: "ok", code };
  }

  function roomOfInvite(code) {
    const link = typeof code === "string" ? inviteLinks.get(code) : null;
    return link && link.expiresAt > now() && rooms.snapshot(link.room) ? link.room : null;
  }

  // Joining through a link moves the socket into that room: session.roomScope is what later room messages go to.
  async function joinByInvite(guildId, userId, message, profile, session) {
    const { type, id } = message;
    const room = roomOfInvite(message.invite);
    if (!room) return { type, id, status: "error", reason: "invite_expired" };
    const previous = session.roomScope ?? guildId;
    if (previous !== room) {
      rooms.leave(previous, userId);
      liveBoard.remove(previous, userId, "room");
    }
    const reply = await roomRequest(room, userId, message, profile);
    session.roomScope = reply.status === "ok" && room !== guildId ? room : undefined;
    return reply;
  }

  // Room requests answer the sender with { type, id, status, reason }; the
  // room itself reaches every member as a mewbeat_room push.
  async function roomRequest(guildId, userId, message, profile) {
    const { type, id } = message;
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat room request.");
    const reply = (result) => (result.ok
      ? { type, id, status: "ok" }
      : { type, id, status: "error", reason: result.reason });

    switch (type) {
      case "mewbeat_room_join":
        return reply(rooms.join(guildId, { id: userId, username: profile?.username, avatarUrl: profile?.avatarUrl }));
      case "mewbeat_room_leave": {
        // The room first: its board goes to whoever is still a member.
        const result = rooms.leave(guildId, userId);
        liveBoard.remove(guildId, userId, "room");
        return reply(result);
      }
      case "mewbeat_room_queue_add":
        return reply(await rooms.queueAdd(guildId, userId, { uri: message.uri, source: message.source }));
      case "mewbeat_room_queue_remove": return reply(rooms.queueRemove(guildId, userId, message.index, message.audioKey));
      case "mewbeat_room_queue_move": return reply(rooms.queueMove(guildId, userId, message.from, message.to, message.audioKey));
      case "mewbeat_room_ready": {
        const { ready, difficulty } = message;
        const { spectate } = message;
        // No `ready` keeps the current state: a difficulty-only or spectate-only change.
        if (ready !== undefined && typeof ready !== "boolean") return reply({ ok: false, reason: "bad_request" });
        if (spectate !== undefined && typeof spectate !== "boolean") return reply({ ok: false, reason: "bad_request" });
        if (difficulty !== undefined && !ROOM_DIFFICULTIES.includes(difficulty)) return reply({ ok: false, reason: "bad_difficulty" });
        // The modifiers a player will play the round with, shown to the room; the run's own list is checked again at submit.
        let modifiers;
        if (message.modifiers !== undefined) {
          const { normalizeModifiers } = await loadClientModifiers();
          const checked = normalizeModifiers(message.modifiers, { mode: "room" });
          if (!checked.ok) return reply({ ok: false, reason: checked.reason });
          modifiers = checked.modifiers;
        }
        return reply(rooms.ready(guildId, userId, { ready, difficulty, spectate, modifiers }));
      }
      case "mewbeat_room_start": return reply(rooms.start(guildId, userId));
      case "mewbeat_room_loaded":
        if (typeof message.audioKey !== "string") return reply({ ok: false, reason: "bad_request" });
        return reply(rooms.loaded(guildId, userId, message.audioKey));
      case "mewbeat_room_invite":
        return message.link === true ? inviteLink(guildId, userId, type, id) : invite(guildId, userId, type, id, profile);
      default: return errorReply("Unknown mewbeat message.");
    }
  }

  // The track a submit is about: a prepared solo song, or what the bot plays now.
  function trackFor(guildId, audioKey) {
    const entry = typeof audioKey === "string" ? soloTracks.get(audioKey) : null;
    if (entry) return { track: entry.track, info: entry.info ?? trackInfoOf(entry.track) };
    const playback = readPlayback(guildId);
    if (playback && audioKey && audioKeyOf(playback.track) === audioKey) {
      return { track: playback.track, info: trackInfoOf(playback.track) };
    }
    return null;
  }

  // The highlight is the same for every difficulty; any charted one has it. Takes the summary of the song's charts.
  function highlightOf(charts) {
    if (!charts) return null;
    for (const difficulty of DIFFICULTIES) {
      const value = charts[difficulty]?.highlightMs;
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  // The stored charts of a song, or null while none are known. Never generates.
  function peekChartsOf(track) {
    if (!track) return null;
    const verdict = chartStore.peekCharts?.(track);
    return verdict?.status === "ready" ? verdict.charts : null;
  }

  // The summary of a song's charts (chartSummary.js), which is all the lists and the rating read; the chart file is
  // not parsed for it. A reader looks up many songs at the cost of one read of the generator flags.
  function summaryReader() {
    return chartStore.summaryReader?.() ?? ((track) => summarizeCharts(peekChartsOf(track)));
  }
  const peekSummaryOf = (track) => summaryReader()(track);

  // The scores key of the chart in use now (stored chart version: a number, or
  // a string like "30-holds" while generator flags are on), else the newest
  // version anyone has a score for.
  function chartKeyFor(audioKey, difficulty, read = peekSummaryOf) {
    return currentChartKeyOf(audioKey, difficulty, read) ?? scoreStore.latestChartKey(audioKey, difficulty, RULES_VERSION);
  }

  // The scores key of the chart in use now; null while the song has no stored chart of that level.
  function currentChartKeyOf(audioKey, difficulty, read = peekSummaryOf) {
    const stored = read(trackFromAudioKey(audioKey))?.[difficulty];
    if (stored && (Number.isFinite(stored.version) || (typeof stored.version === "string" && stored.version))) return boardKeyOf(audioKey, difficulty, stored.version);
    return null;
  }

  // The rating table counts only scores on the chart version in use now, so a song without a stored chart
  // (and the latestChartKey fallback) adds nothing to it.
  let readSummary = peekSummaryOf; // the reader of the build in progress, so a build reads the flags once
  const ranking = scoreStore
    ? createRanking({
      walk: (visit) => {
        readSummary = summaryReader();
        scoreStore.forEachEntry(visit);
      },
      currentOf: (audioKey, difficulty) => {
        const chartKey = currentChartKeyOf(audioKey, difficulty, readSummary);
        return chartKey ? { chartKey, stars: readSummary(trackFromAudioKey(audioKey))[difficulty].stars } : null;
      },
      trackOf: (userId, audioKey) => historyStore?.firstTrackOf(userId, audioKey) ?? null,
      now,
    })
    : null;
  // With the scores in AtlasHub the store is empty until it has been read; the ranking built from it must be dropped then.
  scoreStore?.onHydrated?.(() => ranking?.invalidate());

  // The tempo of any stored difficulty of the song, normal first.
  function bpmOf(charts) {
    if (!charts) return null;
    for (const difficulty of ["normal", ...DIFFICULTIES]) {
      const bpm = charts[difficulty]?.bpm;
      if (Number.isFinite(bpm)) return bpm;
    }
    return null;
  }

  // A count from the client that goes into permanent totals: anything but a plausible whole number is 0.
  function pressCountOf(value) {
    return Number.isInteger(value) && value >= 0 && value <= MAX_PRESSES ? value : 0;
  }

  // How much of the song a run played: the chart time of its furthest judged note (a hold counts to its end),
  // never more than the song. A log with no usable note time falls back to the song's length times the share judged.
  function playedMsOf({ stored, events, durationMs, completion }) {
    let furthest = -Infinity;
    for (const event of events) {
      const note = stored.notes[event.n];
      const end = event.part === "tail" ? note.t + (note.len > 0 ? note.len : 0) : note.t;
      if (Number.isFinite(end)) furthest = Math.max(furthest, end);
    }
    if (!Number.isFinite(furthest)) return durationMs * completion;
    return durationMs > 0 ? Math.min(furthest, durationMs) : furthest;
  }

  function clampedLimit(value, fallback, max) {
    const limit = Number(value);
    return Number.isInteger(limit) && limit >= 1 ? Math.min(limit, max) : fallback;
  }

  // guildId is where the player runs the Activity, which is what the score counts for; room is the room they are in.
  async function submit(guildId, userId, message, profile, room = guildId) {
    const { id, mode, audioKey, difficulty, chartVersion, events, fevers, flags, round } = message;
    const place = isPrivatePlace(guildId) ? null : guildId;
    // Every refusal is logged with what the client claimed, so a run that
    // "didn't count" can be traced afterwards.
    let storedVersion = null;
    const clip = (value) => String(value).slice(0, 120);
    const refuse = (reason) => log.warning(
      "mewbeat submit refused",
      `${reason} mode=${clip(mode)} user=${userId} audioKey=${clip(audioKey)} chartVersion=${clip(chartVersion)} stored=${storedVersion ?? "-"}`,
    );
    const fail = (reason) => {
      refuse(reason);
      return { type: "mewbeat_submit", id, status: "error", reason };
    };
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) {
      refuse("bad_id");
      return errorReply("Bad mewbeat submit.");
    }
    if (!scoreStore || !historyStore) return fail("unavailable");
    if (!DIFFICULTIES.includes(difficulty)) return fail("bad_difficulty");
    if (!Array.isArray(events) || events.length === 0) return fail("no_events");
    if (events.length > MAX_EVENTS) return fail("too_many_events");
    if (fevers != null && (!Array.isArray(fevers) || fevers.length > MAX_FEVERS)) return fail("bad_event");
    // The same list the Activity offers; a speed modifier only counts in solo.
    const { normalizeModifiers } = await loadClientModifiers();
    const checked = normalizeModifiers(message.modifiers, { mode: MODES.includes(mode) ? mode : "live" });
    if (!checked.ok) return fail(checked.reason);
    const { modifiers } = checked;

    // The song fell out of the registry (6 h, or pushed out by newer ones).
    const source = trackFor(guildId, audioKey);
    if (!source) return fail("stale_chart");
    const stored = peekChartsOf(source.track)?.[difficulty];
    if (!stored) return fail("unknown_chart");
    storedVersion = stored.version;
    // The client played another version of the chart than the one on record
    // (it was regenerated since); the events can't be judged against these notes.
    if (chartVersion !== stored.version) return fail("stale_chart");

    // A calibration or an autoplay run can't be lost: nobody is playing it for a score.
    const calibration = Boolean(flags?.calibration) || stored.calibration === true;
    let run;
    try {
      run = await recomputeRun({
        chart: stored, events, fevers: fevers ?? [], modifiers, noFail: calibration || Boolean(flags?.autoplay), loadScoring,
      });
    } catch (error) {
      if (!error.code) throw error;
      return fail(error.code);
    }

    const firstNoteMs = stored.notes.reduce((first, note) => Math.min(first, note.t), Infinity);
    // The earliest judged note by the chart's own time, not the client's `t`.
    const firstJudgedMs = events.reduce((first, event) => Math.min(first, stored.notes[event.n].t), Infinity);
    // A failed run is not ranked: it ends where the player lost it.
    const ranked = !calibration
      && !run.failed
      && !flags?.autoplay
      && !flags?.difficultyChanged
      && firstJudgedMs <= firstNoteMs + LATE_JOIN_MS
      && run.judged >= judgeablePartsOf(stored) * MIN_JUDGED_SHARE;

    const parts = judgeablePartsOf(stored);
    const completion = parts > 0 ? Math.min(1, Math.round((run.judged / parts) * 10000) / 10000) : 1;
    const chartKey = boardKeyOf(audioKey, difficulty, stored.version);
    let newBest = false;
    if (ranked) {
      newBest = scoreStore.submit({
        chartKey,
        userId,
        guildId: place,
        profile,
        score: run.score,
        accuracy: run.accuracy,
        grade: run.grade,
        maxCombo: run.maxCombo,
        difficulty,
        track: { title: source.info.title, artist: source.info.artist ?? "", artworkUrl: source.info.artworkUrl ?? null },
        completion,
        modifiers,
      }).newBest;
      if (newBest) ranking.invalidate();
    }
    // A room round counts for the room only when it is the round being played
    // now, for the song in it, and the run was a real one. Anything else is
    // scored and stored like a solo run.
    if (mode === "room" && !flags?.autoplay) {
      const snapshot = rooms.snapshot(room);
      if (snapshot && snapshot.phase === "playing" && snapshot.current?.audioKey === audioKey && Number.isInteger(round) && round === snapshot.round) {
        rooms.submitted(room, userId, {
          score: run.score, accuracy: run.accuracy, grade: run.grade, difficulty, failed: run.failed, modifiers,
        });
      }
    }
    if (!calibration) {
      historyStore.add(userId, {
        audioKey,
        uri: source.info.uri ?? null,
        source: source.info.source ?? "",
        title: source.info.title,
        artist: source.info.artist ?? "",
        artworkUrl: source.info.artworkUrl ?? null,
        durationMs: source.info.durationMs ?? 0,
        difficulty,
        score: run.score,
        accuracy: run.accuracy,
        grade: run.grade,
        ranked,
        mode: MODES.includes(mode) ? mode : "live",
        guildId: place,
        chartVersion: stored.version,
        failed: run.failed,
        modifiers,
      });
    }
    // The player's totals take every real run that got at least half through, ranked or not; a calibration or an
    // autoplay run is nobody's play, and neither is a restart a few seconds in.
    if (statsStore && !calibration && !flags?.autoplay && completion >= MIN_JUDGED_SHARE) {
      const presses = pressCountOf(message.presses);
      statsStore.add(userId, {
        profile,
        audioKey,
        difficulty,
        track: { title: source.info.title, artist: source.info.artist ?? "", artworkUrl: source.info.artworkUrl ?? null },
        durationMs: playedMsOf({ stored, events, durationMs: source.info.durationMs ?? 0, completion }),
        accuracy: run.accuracy,
        counts: run.counts,
        maxCombo: run.maxCombo,
        parts,
        fevers: run.fevers,
        presses,
        // Empty presses are a share of the presses, so they can't outnumber them.
        emptyPresses: Math.min(pressCountOf(message.emptyPresses), presses),
        ...deriveRunStats({ chart: stored, events }),
      });
    }

    return {
      type: "mewbeat_submit",
      id,
      status: "ok",
      result: {
        score: run.score,
        accuracy: run.accuracy,
        grade: run.grade,
        maxCombo: run.maxCombo,
        counts: run.counts,
        ranked,
        failed: run.failed,
        modifiers,
        newBest,
        best: scoreStore.bestOf(chartKey, userId),
        rank: {
          server: scoreStore.rankOf({ chartKey, userId, guildId: place }),
          global: scoreStore.rankOf({ chartKey, userId, guildId: null }),
        },
        serverTop: scoreStore.board({ chartKey, guildId: place, limit: SERVER_TOP }),
      },
    };
  }

  function board(guildId, userId, message) {
    const { id, audioKey, difficulty, scope } = message;
    const fail = (reason) => ({ type: "mewbeat_board", id, status: "error", reason });
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat board.");
    if (!scoreStore) return fail("unavailable");
    if (!DIFFICULTIES.includes(difficulty) || typeof audioKey !== "string") return fail("bad_request");
    if (scope !== "server" && scope !== "global") return fail("bad_scope");

    const chartKey = chartKeyFor(audioKey, difficulty);
    const boardGuild = scope === "server" ? guildId : null;
    if (!chartKey) return { type: "mewbeat_board", id, entries: [], own: { rank: null, best: null } };
    return {
      type: "mewbeat_board",
      id,
      entries: scoreStore.board({ chartKey, guildId: boardGuild, limit: clampedLimit(message.limit, 10, BOARD_LIMIT) }),
      own: { rank: scoreStore.rankOf({ chartKey, userId, guildId: boardGuild }), best: scoreStore.bestOf(chartKey, userId) },
    };
  }

  function played(guildId, userId, message) {
    const { id, scope } = message;
    const fail = (reason) => ({ type: "mewbeat_played", id, status: "error", reason });
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat played.");
    if (!scoreStore || !historyStore) return fail("unavailable");
    if (scope !== "server" && scope !== "global" && scope !== "mine") return fail("bad_scope");

    const limit = clampedLimit(message.limit, 50, PLAYED_LIMIT);
    // "mine" is the songs you played anywhere, in no particular server.
    const query = scope === "mine" ? { userId, limit } : { guildId: scope === "server" ? guildId : null, limit };
    const read = summaryReader();
    const tracks = historyStore.played(query).map((track) => {
      const charts = read(trackFromAudioKey(track.audioKey));
      const stars = charts
        ? Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, charts[difficulty]?.stars ?? null]))
        : null;
      const notes = charts
        ? Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, charts[difficulty]?.notes ?? null]))
        : {};
      const bests = {};
      for (const difficulty of DIFFICULTIES) {
        const chartKey = chartKeyFor(track.audioKey, difficulty, read);
        const best = chartKey && scoreStore.bestOf(chartKey, userId);
        if (best) bests[difficulty] = { score: best.score, grade: best.grade };
      }
      return { ...track, stars, notes, bests, highlightMs: highlightOf(charts), bpm: bpmOf(charts) };
    });
    return { type: "mewbeat_played", id, tracks };
  }

  // The player a profile or stats request is about: yourself (no userId) or somebody else. Null when nobody
  // we know of has that id. A player with no totals yet still has a name from their score or this request.
  function playerFor(requesterId, requested, requesterProfile) {
    const userId = requested ?? requesterId;
    const summary = statsStore.summaryOf(userId);
    const rated = ranking?.playerOf(userId) ?? null;
    const known = summary || rated || historyStore?.recent(userId, 1).length > 0;
    if (!known && userId !== requesterId) return null;
    const own = userId === requesterId ? requesterProfile : null;
    return {
      userId,
      username: summary?.username || rated?.username || own?.username || "Unknown player",
      avatarUrl: summary?.avatarUrl ?? rated?.avatarUrl ?? own?.avatarUrl ?? null,
      firstAt: summary?.firstAt ?? null,
    };
  }

  // Shared start of the profile messages. Returns the reply to send, or { userId } to go on with.
  function profileTarget(type, message) {
    const { id, userId } = message;
    const fail = (reason) => ({ type, id, status: "error", reason });
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return { reply: errorReply(`Bad ${type}.`) };
    if (!statsStore || !scoreStore || !historyStore || !ranking) return { reply: fail("unavailable") };
    if (userId !== undefined && (typeof userId !== "string" || !userId || userId.length > MAX_ID_LENGTH)) return { reply: fail("bad_request") };
    return { fail, userId };
  }

  function playerProfile(guildId, requesterId, message, requesterProfile) {
    const { reply, fail, userId: requested } = profileTarget("mewbeat_profile", message);
    if (reply) return reply;
    const player = playerFor(requesterId, requested, requesterProfile);
    if (!player) return fail("not_found");

    const summary = statsStore.summaryOf(player.userId);
    const rated = ranking.playerOf(player.userId);
    const plays = rated?.plays ?? [];
    const bestGrades = Object.fromEntries(GRADES.map((grade) => [grade, 0]));
    for (const play of plays) {
      if (Object.hasOwn(bestGrades, play.grade)) bestGrades[play.grade] += 1;
    }
    return {
      type: "mewbeat_profile",
      id: message.id,
      status: "ok",
      player,
      rating: {
        pp: rated?.pp ?? 0,
        global: ranking.rankOf({ userId: player.userId, guildId: null }),
        server: ranking.rankOf({ userId: player.userId, guildId }),
      },
      summary: {
        plays: summary?.plays ?? 0,
        avgAccuracy: summary?.avgAccuracy ?? 0,
        songs: summary?.songs ?? 0,
        playMs: summary?.playMs ?? 0,
        bestGrades,
      },
      recent: historyStore.recent(player.userId, PROFILE_ROWS).map((round) => ({
        audioKey: round.audioKey,
        title: round.title,
        artist: round.artist ?? "",
        artworkUrl: round.artworkUrl ?? null,
        difficulty: round.difficulty,
        grade: round.grade,
        accuracy: round.accuracy,
        score: round.score,
        at: round.at,
      })),
      best: plays.slice(0, PROFILE_ROWS).map((play) => ({
        audioKey: play.audioKey,
        title: play.title,
        artist: play.artist,
        artworkUrl: play.artworkUrl,
        difficulty: play.difficulty,
        stars: play.stars,
        grade: play.grade,
        accuracy: play.accuracy,
        pp: play.pp,
      })),
    };
  }

  // The player's own latest runs, newest first, for the map problem report to name one. A report names its run by
  // audioKey, difficulty and at, which the server looks up again in the same history when the report comes in.
  function reportRuns(userId, message) {
    const { id } = message;
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat report runs.");
    if (!historyStore) return { type: "mewbeat_report_runs", id, status: "error", reason: "unavailable" };
    return {
      type: "mewbeat_report_runs",
      id,
      status: "ok",
      runs: historyStore.recent(userId, REPORT_RUNS).map((round) => ({
        audioKey: round.audioKey,
        difficulty: round.difficulty,
        at: round.at,
        title: round.title,
        artist: round.artist ?? "",
        grade: round.grade ?? null,
        accuracy: round.accuracy ?? null,
      })),
    };
  }

  function playerStats(_guildId, requesterId, message, requesterProfile) {
    const { reply, fail, userId: requested } = profileTarget("mewbeat_stats", message);
    if (reply) return reply;
    const player = playerFor(requesterId, requested, requesterProfile);
    if (!player) return fail("not_found");
    const stats = statsStore.summaryOf(player.userId);
    return { type: "mewbeat_stats", id: message.id, status: "ok", player, stats: stats && { ...stats, maps: stats.maps.slice(0, STATS_MAPS) } };
  }

  function rankingBoard(guildId, userId, message, requesterProfile) {
    const { id, scope } = message;
    const fail = (reason) => ({ type: "mewbeat_ranking", id, status: "error", reason });
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat ranking.");
    if (!ranking) return fail("unavailable");
    if (scope !== "server" && scope !== "global") return fail("bad_scope");

    const boardGuild = scope === "server" ? guildId : null;
    // Your own row is pinned under the list when you are further down, so it needs a name and a picture too.
    // Without a rated play you have no accuracy; the name and picture come from the request's profile then.
    const rated = ranking.playerOf(userId);
    return {
      type: "mewbeat_ranking",
      id,
      status: "ok",
      entries: ranking.rowsFor({ guildId: boardGuild, limit: clampedLimit(message.limit, 50, RANKING_LIMIT) }),
      own: {
        rank: ranking.rankOf({ userId, guildId: boardGuild }),
        pp: rated?.pp ?? 0,
        username: rated?.username ?? requesterProfile?.username ?? null,
        avatarUrl: rated?.avatarUrl ?? requesterProfile?.avatarUrl ?? null,
        accuracy: rated?.accuracy ?? null,
      },
    };
  }

  // Per difficulty: stars, note count and the player's best; null while no charts are known (a chart that is missing has
  // null stars and notes).
  function statsOfSong(audioKey, userId) {
    const read = summaryReader();
    const charts = read(trackFromAudioKey(audioKey));
    if (!charts) return null;
    const stats = {};
    for (const difficulty of DIFFICULTIES) {
      const chartKey = scoreStore ? chartKeyFor(audioKey, difficulty, read) : null;
      const best = chartKey ? scoreStore.bestOf(chartKey, userId) : null;
      stats[difficulty] = {
        stars: charts[difficulty]?.stars ?? null,
        notes: charts[difficulty]?.notes ?? null,
        best: best ? { score: best.score, grade: best.grade } : null,
      };
    }
    return stats;
  }

  // `null` stats means no charts are known yet.
  function songStats(guildId, userId, message) {
    const { id, audioKey } = message;
    const fail = (reason) => ({ type: "mewbeat_song_stats", id, status: "error", reason });
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat song stats.");
    if (!scoreStore) return fail("unavailable");
    if (typeof audioKey !== "string" || audioKey.length > MAX_URI_LENGTH) return fail("bad_request");
    return { type: "mewbeat_song_stats", id, status: "ok", stats: statsOfSong(audioKey, userId) };
  }

  // Search results: each track's audio key and, when that song already has charts, its stars per level (else null). The
  // charts are only looked up, never made, so a search starts no work.
  function chartInfoOf(tracks) {
    const read = summaryReader();
    return tracks.map((track) => {
      const audioKey = audioKeyOf(track);
      const charts = audioKey ? read(track) : null;
      const stars = charts ? Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, charts[difficulty]?.stars ?? null])) : null;
      return { audioKey, stars };
    });
  }

  // "Chart this map": a song with no charts is charted as background work (it queues behind everything a player waits for).
  // The request is idempotent and doubles as the status poll: it answers state "queued" (still going; ask again in a few
  // seconds) or "ready" (with the stats of the song), or an error with a reason. `retry: true` after a failure tries again.
  // A player may have CHART_MAP_PER_PLAYER maps queued at once; a map somebody else already queued is shared.
  const chartingMaps = new Map(); // audioKey -> { users: Set, outcome: null | { status, reason }, at }
  async function chartMap(guildId, userId, message) {
    const { id, uri, source } = message;
    const fail = (reason) => ({ type: "mewbeat_chart_map", id, status: "error", reason });
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat chart map.");

    let prepared;
    try {
      prepared = await prepareSong(guildId, { uri, source, audioKey: message.audioKey }, { chart: false });
    } catch (error) {
      if (!error.reason) throw error;
      return fail(error.reason);
    }
    const { audioKey } = prepared;
    const entry = soloTracks.get(audioKey);
    if (!entry?.track) return fail("not_found");

    const known = chartStore.peekCharts?.(entry.track);
    if (known?.status === "ready") {
      chartingMaps.delete(audioKey);
      return { type: "mewbeat_chart_map", id, status: "ok", state: "ready", audioKey, stats: statsOfSong(audioKey, userId) };
    }
    if (known?.status === "uncharted") return fail("uncharted");

    for (const [key, other] of chartingMaps) if (other.outcome && now() - other.at > CHART_MAP_MEMORY_MS) chartingMaps.delete(key);
    const retry = message.retry === true;
    const current = chartingMaps.get(audioKey);
    if (current?.outcome?.status === "failed" && !retry) return fail(current.outcome.reason);
    if (current && !current.outcome) {
      current.users.add(userId);
      return { type: "mewbeat_chart_map", id, status: "ok", state: "queued", audioKey };
    }

    const queued = [...chartingMaps.values()].filter((other) => !other.outcome && other.users.has(userId)).length;
    if (queued >= CHART_MAP_PER_PLAYER) return fail("too_many");
    const record = { users: new Set([userId]), outcome: null, at: now() };
    chartingMaps.set(audioKey, record);
    Promise.resolve()
      .then(() => chartStore.getCharts(entry.track, entry.node, { priority: "background", retry }))
      .then((result) => {
        if (result?.status === "ready") {
          chartingMaps.delete(audioKey);
          return;
        }
        // A pending result (the analysis was busy) is asked again by the next poll; the rest is a failure.
        if (result?.status === "pending") record.outcome = { status: "pending" };
        else record.outcome = { status: "failed", reason: result?.status === "full" ? "busy" : result?.status === "uncharted" ? "uncharted" : "failed" };
      })
      .catch((error) => {
        log.warning("mewbeat chart map failed", error?.message);
        record.outcome = { status: "failed", reason: "failed" };
      })
      .finally(() => {
        record.at = now();
      });
    return { type: "mewbeat_chart_map", id, status: "ok", state: "queued", audioKey };
  }

  return {
    // The reply, or a promise of it; `profile` is { id, username, avatarUrl }. `session` belongs to the socket and
    // holds roomScope once it joined another place's room through an invite link. A DM has no server board to read.
    async handle(guildId, userId, message, profile, session = {}) {
      const room = session.roomScope ?? guildId;
      const boards = isPrivatePlace(guildId) ? null : guildId;
      switch (message?.type) {
        case "mewbeat_sync": return sync(guildId, message);
        case "mewbeat_chart": return chart(guildId, userId, message);
        case "mewbeat_solo_prepare": return soloPrepare(guildId, userId, message);
        case "mewbeat_tour_songs": return tourSongsReply(message);
        case "mewbeat_submit": return submit(guildId, userId, message, profile, room);
        case "mewbeat_board": return board(boards, userId, message);
        case "mewbeat_song_stats": return songStats(guildId, userId, message);
        case "mewbeat_chart_map": return chartMap(guildId, userId, message);
        case "mewbeat_played": return played(boards, userId, message);
        case "mewbeat_profile": return playerProfile(boards, userId, message, profile);
        case "mewbeat_stats": return playerStats(guildId, userId, message, profile);
        case "mewbeat_report_runs": return reportRuns(userId, message);
        case "mewbeat_ranking": return rankingBoard(boards, userId, message, profile);
        case "mewbeat_live": return live(message.session === "room" ? room : guildId, userId, message, profile);
        default: {
          if (!message?.type?.startsWith("mewbeat_room_")) return errorReply("Unknown mewbeat message.");
          if (message.type === "mewbeat_room_join" && message.invite != null) return joinByInvite(guildId, userId, message, profile, session);
          const reply = await roomRequest(room, userId, message, profile);
          if (message.type === "mewbeat_room_leave") session.roomScope = undefined;
          return reply;
        }
      }
    },
    // { audioKey, stars } of each raw track of a search (see chartInfoOf).
    chartInfoOf,
    // Called once the user's last socket in the guild is gone.
    disconnect(guildId, userId) {
      rooms.leave(guildId, userId);
      liveBoard.remove(guildId, userId);
    },
  };
}

module.exports = { createMewbeatChannel };
