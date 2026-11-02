const Log = require("../logs/log");
const { audioKeyOf } = require("./audioKey");
const { starsOf } = require("./charts/stars");
const { createLiveBoard } = require("./liveBoard");
const { judgeablePartsOf, recomputeRun } = require("./recompute");
const { DIFFICULTIES: ROOM_DIFFICULTIES, MAX_PLAYERS, createRooms } = require("./rooms");
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
const INVITE_COOLDOWN_MS = 60_000;
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
// scoreStore and historyStore keep boards and play history; loadScoring
// replaces the import of the client's scoring module in tests. The rooms push
// their state with broadcast(guildId, userIds, payload) and run their phases
// on setTimer/clearTimer, so tests can drive them with a fake clock; the live
// board pushes and expires its entries the same way. postInvite({ guildId,
// userId, username, avatarUrl, room }) -> { ok } | { ok: false, reason } posts
// the lobby invite in the inviter's voice channel chat (room says what is on:
// song, seats, queue; or null); the channel only rate-limits it.
// warmAudio(audioKey, track, node) starts rendering a room song's audio when it
// is queued, so the round's loading window doesn't pay for a cold render.
function createMewbeatChannel({
  readPlayback,
  chartStore,
  isUnlocked,
  now = Date.now,
  audioLatencyMs = 0,
  resolveTrack,
  soloTracks = createSoloTracks(),
  scoreStore, historyStore, loadScoring,
  postInvite,
  warmAudio = () => {},
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

  // Resolves a song, registers it by audioKey and starts its charts (unless
  // only a preview was asked for). Throws an error with `reason` when the song
  // can't be used.
  async function prepareSong(guildId, { uri, source }, { chart = true } = {}) {
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
    if (!isUnlocked(userId)) return fail("locked");

    try {
      const { audioKey, track } = await prepareSong(guildId, { uri, source }, { chart: !preview });
      // The song's highlight, when its charts already exist (song select previews start there).
      const highlightMs = highlightOf(peekChartsOf(soloTracks.get(audioKey)?.track));
      return { type: "mewbeat_solo_prepare", id, status: "ok", audioKey, track, highlightMs };
    } catch (error) {
      if (!error.reason) throw error;
      return fail(error.reason);
    }
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
    if (!isUnlocked(userId)) return null;
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
        const { spectate } = message;
        // No `ready` keeps the current state: a difficulty-only or spectate-only change.
        if (ready !== undefined && typeof ready !== "boolean") return reply({ ok: false, reason: "bad_request" });
        if (spectate !== undefined && typeof spectate !== "boolean") return reply({ ok: false, reason: "bad_request" });
        if (difficulty !== undefined && !ROOM_DIFFICULTIES.includes(difficulty)) return reply({ ok: false, reason: "bad_difficulty" });
        return reply(rooms.ready(guildId, userId, { ready, difficulty, spectate }));
      }
      case "mewbeat_room_start": return reply(rooms.start(guildId, userId));
      case "mewbeat_room_loaded":
        if (typeof message.audioKey !== "string") return reply({ ok: false, reason: "bad_request" });
        return reply(rooms.loaded(guildId, userId, message.audioKey));
      case "mewbeat_room_invite": return invite(guildId, userId, type, id, profile);
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

  // The highlight is the same for every difficulty; any charted one has it.
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

  // The scores key of the chart in use now (stored chart version), else the
  // newest version anyone has a score for.
  function chartKeyFor(audioKey, difficulty) {
    const stored = peekChartsOf(trackFromAudioKey(audioKey))?.[difficulty];
    if (stored && Number.isFinite(stored.version)) return `${audioKey}|${difficulty}|${stored.version}`;
    return scoreStore.latestChartKey(audioKey, difficulty);
  }

  const starsFor = (chart) => (chart ? chart.stars ?? starsOf(chart) : null);
  const noteCountOf = (chart) => (chart ? chart.notes.length : null);

  function clampedLimit(value, fallback, max) {
    const limit = Number(value);
    return Number.isInteger(limit) && limit >= 1 ? Math.min(limit, max) : fallback;
  }

  async function submit(guildId, userId, message, profile) {
    const { id, mode, audioKey, difficulty, chartVersion, events, fevers, flags, round } = message;
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
    if (!isUnlocked(userId)) return fail("locked");
    if (!scoreStore || !historyStore) return fail("unavailable");
    if (!DIFFICULTIES.includes(difficulty)) return fail("bad_difficulty");
    if (!Array.isArray(events) || events.length === 0) return fail("no_events");
    if (events.length > MAX_EVENTS) return fail("too_many_events");
    if (fevers != null && (!Array.isArray(fevers) || fevers.length > MAX_FEVERS)) return fail("bad_event");

    // The song fell out of the registry (6 h, or pushed out by newer ones).
    const source = trackFor(guildId, audioKey);
    if (!source) return fail("stale_chart");
    const stored = peekChartsOf(source.track)?.[difficulty];
    if (!stored) return fail("unknown_chart");
    storedVersion = stored.version;
    // The client played another version of the chart than the one on record
    // (it was regenerated since); the events can't be judged against these notes.
    if (chartVersion !== stored.version) return fail("stale_chart");

    let run;
    try {
      run = await recomputeRun({ chart: stored, events, fevers: fevers ?? [], loadScoring });
    } catch (error) {
      if (!error.code) throw error;
      return fail(error.code);
    }

    const calibration = Boolean(flags?.calibration) || stored.calibration === true;
    const firstNoteMs = stored.notes.reduce((first, note) => Math.min(first, note.t), Infinity);
    // The earliest judged note by the chart's own time, not the client's `t`.
    const firstJudgedMs = events.reduce((first, event) => Math.min(first, stored.notes[event.n].t), Infinity);
    const ranked = !calibration
      && !flags?.autoplay
      && !flags?.difficultyChanged
      && firstJudgedMs <= firstNoteMs + LATE_JOIN_MS
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
    // A room round counts for the room only when it is the round being played
    // now, for the song in it, and the run was a real one. Anything else is
    // scored and stored like a solo run.
    if (mode === "room" && !flags?.autoplay) {
      const room = rooms.snapshot(guildId);
      if (room && room.phase === "playing" && room.current?.audioKey === audioKey && Number.isInteger(round) && round === room.round) {
        rooms.submitted(guildId, userId, { score: run.score, accuracy: run.accuracy, grade: run.grade, difficulty });
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
        ? Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, starsFor(charts[difficulty])]))
        : null;
      const notes = charts
        ? Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, noteCountOf(charts[difficulty])]))
        : {};
      const bests = {};
      for (const difficulty of DIFFICULTIES) {
        const chartKey = chartKeyFor(track.audioKey, difficulty);
        const best = chartKey && scoreStore.bestOf(chartKey, userId);
        if (best) bests[difficulty] = { score: best.score, grade: best.grade };
      }
      return { ...track, stars, notes, bests, highlightMs: highlightOf(charts) };
    });
    return { type: "mewbeat_played", id, tracks };
  }

  // Per difficulty: stars, note count and the player's best. `null` stats means
  // no charts are known yet (a chart that is missing has null stars and notes).
  function songStats(guildId, userId, message) {
    const { id, audioKey } = message;
    const fail = (reason) => ({ type: "mewbeat_song_stats", id, status: "error", reason });
    if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH) return errorReply("Bad mewbeat song stats.");
    if (!isUnlocked(userId)) return fail("locked");
    if (!scoreStore) return fail("unavailable");
    if (typeof audioKey !== "string" || audioKey.length > MAX_URI_LENGTH) return fail("bad_request");

    const charts = peekChartsOf(trackFromAudioKey(audioKey));
    if (!charts) return { type: "mewbeat_song_stats", id, status: "ok", stats: null };
    const stats = {};
    for (const difficulty of DIFFICULTIES) {
      const chartKey = chartKeyFor(audioKey, difficulty);
      const best = chartKey ? scoreStore.bestOf(chartKey, userId) : null;
      stats[difficulty] = {
        stars: starsFor(charts[difficulty]),
        notes: noteCountOf(charts[difficulty]),
        best: best ? { score: best.score, grade: best.grade } : null,
      };
    }
    return { type: "mewbeat_song_stats", id, status: "ok", stats };
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
        case "mewbeat_song_stats": return songStats(guildId, userId, message);
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
