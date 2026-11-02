const Log = require("../logs/log");
const { audioKeyOf } = require("./audioKey");
const { starsOf } = require("./charts/stars");
const { createLiveBoard } = require("./liveBoard");
const { judgeablePartsOf, recomputeRun } = require("./recompute");
const { DIFFICULTIES: ROOM_DIFFICULTIES, createRooms } = require("./rooms");
const { createSoloTracks } = require("./soloTracks");

const DIFFICULTIES = ["easy", "normal", "hard", "hell"];
const MAX_ID_LENGTH = 40;
const MAX_URI_LENGTH = 1000;
const MAX_SOURCE_LENGTH = 40;
const MODES = ["live", "solo", "room"];
const MAX_EVENTS = 20000;
const MAX_FEVERS = 200;
// A run counts for the board when its first judgement is within this long of the first note.
const LATE_JOIN_MS = 2000;
const MIN_JUDGED_SHARE = 0.5;
const SERVER_TOP = 5;
const BOARD_LIMIT = 50;
const PLAYED_LIMIT = 100;

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
// scoreStore and historyStore keep boards and play history; loadScoring
// replaces the import of the client's scoring module in tests. The rooms push
// their state with broadcast(guildId, userIds, payload) and run their phases
// on setTimer/clearTimer, so tests can drive them with a fake clock; the live
// board pushes and expires its entries the same way.
function createMewbeatChannel({
  readPlayback,
  chartStore,
  isUnlocked,
  now = Date.now,
  audioLatencyMs = 0,
  resolveTrack,
  soloTracks = createSoloTracks(),
  scoreStore, historyStore, loadScoring,
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

  async function chart(guildId, userId, message) {
    const { audioKey, difficulty } = message;
    if (!isUnlocked(userId)) return errorReply("Unlock mewbeat first.");
    if (!DIFFICULTIES.includes(difficulty)) return errorReply("Unknown mewbeat difficulty.");

    let source = typeof audioKey === "string" ? soloTracks.get(audioKey) : null;
    if (!source) {
      const playback = readPlayback(guildId);
      if (!playback || !audioKey || audioKeyOf(playback.track) !== audioKey) {
        return { type: "mewbeat_chart", audioKey, difficulty, status: "stale" };
      }
      source = playback;
    }

    const result = await chartStore.getCharts(source.track, source.node);
    const reply = { type: "mewbeat_chart", audioKey, difficulty, status: result.status };
    if (result.reason !== undefined) reply.reason = result.reason;
    if (result.status === "ready") reply.chart = result.charts[difficulty];
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

  // Resolves a song, registers it by audioKey and starts its charts. Throws an
  // error with `reason` when the song can't be used.
  async function prepareSong(guildId, { uri, source }) {
    const refuse = (reason) => Object.assign(new Error(reason), { reason });
    if (typeof uri !== "string" || !uri.trim() || uri.length > MAX_URI_LENGTH) throw refuse("bad_uri");
    if (source != null && (typeof source !== "string" || source.length > MAX_SOURCE_LENGTH)) throw refuse("bad_source");

    let resolved;
    try {
      resolved = await resolveTrack(guildId, { uri: uri.trim(), source: source || "" });
    } catch (error) {
      log.warning("mewbeat solo resolve failed", error?.message);
      throw refuse("resolve_failed");
    }
    if (!resolved?.track) throw refuse("not_found");

    const audioKey = audioKeyOf(resolved.track);
    if (!audioKey) throw refuse("unsupported");

    const info = resolved.info ?? trackInfoOf(resolved.track);
    soloTracks.put(audioKey, { track: resolved.track, node: resolved.node, info });
    // Charting starts now so it is usually done by the time Play is pressed.
    Promise.resolve(chartStore.getCharts(resolved.track, resolved.node))
      .catch((error) => log.warning("mewbeat solo chart failed", error?.message));
    return { audioKey, track: info };
  }

  async function soloPrepare(guildId, userId, message) {
    const { id, uri, source } = message;
    const fail = (reason) => ({ type: "mewbeat_solo_prepare", id, status: "error", reason });
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat prepare.");
    if (!isUnlocked(userId)) return fail("locked");

    try {
      const { audioKey, track } = await prepareSong(guildId, { uri, source });
      return { type: "mewbeat_solo_prepare", id, status: "ok", audioKey, track };
    } catch (error) {
      if (!error.reason) throw error;
      return fail(error.reason);
    }
  }

  const rooms = createRooms({
    now,
    setTimer,
    clearTimer,
    prepareTrack: ({ guildId, uri, source }) => prepareSong(guildId, { uri, source }),
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
    if (!isUnlocked(userId)) return null;
    liveBoard.update(guildId, userId, profile, message);
    return null;
  }

  // Room requests answer the sender with { type, id, status, reason }; the
  // room itself reaches every member as a mewbeat_room push.
  async function roomRequest(guildId, userId, message, profile) {
    const { type, id } = message;
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat room request.");
    const reply = (result) => (result.ok
      ? { type, id, status: "ok" }
      : { type, id, status: "error", reason: result.reason });
    if (!isUnlocked(userId)) return reply({ ok: false, reason: "locked" });

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
      case "mewbeat_room_queue_remove": return reply(rooms.queueRemove(guildId, userId, message.index));
      case "mewbeat_room_ready": {
        const { ready, difficulty } = message;
        if (typeof ready !== "boolean") return reply({ ok: false, reason: "bad_request" });
        if (difficulty !== undefined && !ROOM_DIFFICULTIES.includes(difficulty)) return reply({ ok: false, reason: "bad_difficulty" });
        return reply(rooms.ready(guildId, userId, { ready, difficulty }));
      }
      case "mewbeat_room_start": return reply(rooms.start(guildId, userId));
      case "mewbeat_room_loaded":
        if (typeof message.audioKey !== "string") return reply({ ok: false, reason: "bad_request" });
        return reply(rooms.loaded(guildId, userId, message.audioKey));
      case "mewbeat_room_invite": return reply({ ok: false, reason: "not_implemented" });
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

  // A key is source:identifier:length, so a stored chart can be looked up
  // without the original track (after a restart, for old history).
  function trackFromAudioKey(audioKey) {
    if (typeof audioKey !== "string") return null;
    const first = audioKey.indexOf(":");
    const last = audioKey.lastIndexOf(":");
    if (first <= 0 || last <= first) return null;
    return {
      info: {
        sourceName: audioKey.slice(0, first),
        identifier: audioKey.slice(first + 1, last),
        length: Number(audioKey.slice(last + 1)),
      },
    };
  }

  // The stored charts of a song, or null while none are known. Never generates.
  function peekChartsOf(track) {
    if (!track) return null;
    const verdict = chartStore.peekCharts?.(track);
    return verdict?.status === "ready" ? verdict.charts : null;
  }

  // The scores key of the chart in use now (stored chart version), else the
  // newest version anyone has a score for.
  function chartKeyFor(audioKey, difficulty) {
    const stored = peekChartsOf(trackFromAudioKey(audioKey))?.[difficulty];
    if (stored && Number.isFinite(stored.version)) return `${audioKey}|${difficulty}|${stored.version}`;
    return scoreStore.latestChartKey(audioKey, difficulty);
  }

  function clampedLimit(value, fallback, max) {
    const limit = Number(value);
    return Number.isInteger(limit) && limit >= 1 ? Math.min(limit, max) : fallback;
  }

  async function submit(guildId, userId, message, profile) {
    const { id, mode, audioKey, difficulty, chartVersion, events, fevers, flags } = message;
    const fail = (reason) => ({ type: "mewbeat_submit", id, status: "error", reason });
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat submit.");
    if (!isUnlocked(userId)) return fail("locked");
    if (!scoreStore || !historyStore) return fail("unavailable");
    if (!DIFFICULTIES.includes(difficulty)) return fail("bad_difficulty");
    if (!Array.isArray(events) || events.length === 0) return fail("no_events");
    if (events.length > MAX_EVENTS) return fail("too_many_events");
    if (fevers != null && (!Array.isArray(fevers) || fevers.length > MAX_FEVERS)) return fail("bad_event");

    const source = trackFor(guildId, audioKey);
    const stored = source && peekChartsOf(source.track)?.[difficulty];
    if (!stored) return fail("unknown_chart");

    let run;
    try {
      run = await recomputeRun({ chart: stored, events, fevers: fevers ?? [], loadScoring });
    } catch (error) {
      if (!error.code) throw error;
      return fail(error.code);
    }

    const calibration = Boolean(flags?.calibration) || stored.calibration === true;
    const firstNoteMs = stored.notes.reduce((first, note) => Math.min(first, note.t), Infinity);
    const ranked = !calibration
      && !flags?.autoplay
      && !flags?.difficultyChanged
      && chartVersion === stored.version
      && events[0].t <= firstNoteMs + LATE_JOIN_MS
      && run.judged >= judgeablePartsOf(stored) * MIN_JUDGED_SHARE;

    const chartKey = `${audioKey}|${difficulty}|${stored.version}`;
    let newBest = false;
    if (ranked) {
      newBest = scoreStore.submit({
        chartKey,
        userId,
        guildId,
        profile,
        score: run.score,
        accuracy: run.accuracy,
        grade: run.grade,
        maxCombo: run.maxCombo,
        difficulty,
      }).newBest;
    }
    // A room round counts for the room only when it is the song being played.
    if (mode === "room" && rooms.snapshot(guildId)?.current?.audioKey === audioKey) {
      rooms.submitted(guildId, userId, { score: run.score, accuracy: run.accuracy, grade: run.grade, difficulty });
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
        guildId,
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
        newBest,
        best: scoreStore.bestOf(chartKey, userId),
        rank: {
          server: scoreStore.rankOf({ chartKey, userId, guildId }),
          global: scoreStore.rankOf({ chartKey, userId, guildId: null }),
        },
        serverTop: scoreStore.board({ chartKey, guildId, limit: SERVER_TOP }),
      },
    };
  }

  function board(guildId, userId, message) {
    const { id, audioKey, difficulty, scope } = message;
    const fail = (reason) => ({ type: "mewbeat_board", id, status: "error", reason });
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat board.");
    if (!isUnlocked(userId)) return fail("locked");
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
    if (!isUnlocked(userId)) return fail("locked");
    if (!scoreStore || !historyStore) return fail("unavailable");
    if (scope !== "server" && scope !== "global") return fail("bad_scope");

    const limit = clampedLimit(message.limit, 50, PLAYED_LIMIT);
    const tracks = historyStore.played({ guildId: scope === "server" ? guildId : null, limit }).map((track) => {
      const charts = peekChartsOf(trackFromAudioKey(track.audioKey));
      const stars = charts
        ? Object.fromEntries(DIFFICULTIES.map((difficulty) => [
          difficulty,
          charts[difficulty] ? charts[difficulty].stars ?? starsOf(charts[difficulty]) : null,
        ]))
        : null;
      const bests = {};
      for (const difficulty of DIFFICULTIES) {
        const chartKey = chartKeyFor(track.audioKey, difficulty);
        const best = chartKey && scoreStore.bestOf(chartKey, userId);
        if (best) bests[difficulty] = { score: best.score, grade: best.grade };
      }
      return { ...track, stars, bests };
    });
    return { type: "mewbeat_played", id, tracks };
  }

  return {
    // The reply, or a promise of it; `profile` is { id, username, avatarUrl }.
    async handle(guildId, userId, message, profile) {
      switch (message?.type) {
        case "mewbeat_sync": return sync(guildId, message);
        case "mewbeat_chart": return chart(guildId, userId, message);
        case "mewbeat_solo_prepare": return soloPrepare(guildId, userId, message);
        case "mewbeat_submit": return submit(guildId, userId, message, profile);
        case "mewbeat_board": return board(guildId, userId, message);
        case "mewbeat_played": return played(guildId, userId, message);
        case "mewbeat_live": return live(guildId, userId, message, profile);
        default:
          if (message?.type?.startsWith("mewbeat_room_")) return roomRequest(guildId, userId, message, profile);
          return errorReply("Unknown mewbeat message.");
      }
    },
    // Called once the user's last socket in the guild is gone.
    disconnect(guildId, userId) {
      rooms.leave(guildId, userId);
      liveBoard.remove(guildId, userId);
    },
  };
}

module.exports = { createMewbeatChannel };
