const DIFFICULTIES = ["easy", "normal", "hard", "hell"];
const DEFAULT_DIFFICULTY = "normal";
const MAX_PLAYERS = 10;
// Watching costs little, but the list is bounded so one room can't grow forever.
const MAX_MEMBERS = 50;
const MAX_QUEUE = 20;
const LOADING_MS = 20_000;
const COUNTDOWN_MS = 5_000;
// A round that nobody finishes ends this long after the song would have.
const RESULTS_GRACE_MS = 5_000;
const INTERMISSION_MS = 15_000;
// Between rounds, spectators can take free player seats.
const IDLE_PHASES = ["lobby", "intermission"];
const ROUND_PHASES = ["loading", "countdown", "playing"];

const ok = () => ({ ok: true });
const fail = (reason) => ({ ok: false, reason });

// The server's rooms: one per Discord server, created by the first join and
// deleted with the last member. All state is in memory; a restart just means
// the clients join again. Time and timers are injected so the phase machine
// can be tested with a fake clock.
//
// prepareTrack({ guildId, uri, source }) -> Promise<{ audioKey, track }>
// rejects with an error carrying `reason` when the song can't be used.
// broadcast(guildId, userIds, payload) pushes to those users' sockets.
function createRooms({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  prepareTrack,
  broadcast = () => {},
  log = {},
} = {}) {
  const rooms = new Map(); // guildId -> room

  const playersOf = (room) => room.members.filter((member) => !member.spectator);
  const findMember = (room, userId) => room.members.find((member) => member.userId === userId);

  function snapshotOf(room) {
    return {
      hostId: room.hostId,
      phase: room.phase,
      members: room.members.map((member) => ({
        userId: member.userId,
        username: member.username,
        avatarUrl: member.avatarUrl,
        difficulty: member.difficulty,
        ready: member.ready,
        loaded: member.loaded,
        spectator: member.spectator,
        submitted: member.submitted,
      })),
      queue: room.queue.map((entry) => ({ ...entry })),
      current: room.current ? { ...room.current } : null,
      startAt: room.startAt,
      nextAt: room.nextAt,
      results: room.results.map((entry) => ({ ...entry })),
      serverNow: now(),
    };
  }

  function push(room) {
    try {
      broadcast(room.guildId, room.members.map((member) => member.userId), { type: "mewbeat_room", room: snapshotOf(room) });
    } catch (error) {
      log.warning?.("mewbeat room broadcast failed", error?.message);
    }
  }

  // Tells a user who just left that there is no room for them any more.
  function pushGone(guildId, userId) {
    try {
      broadcast(guildId, [userId], { type: "mewbeat_room", room: null });
    } catch (error) {
      log.warning?.("mewbeat room broadcast failed", error?.message);
    }
  }

  function clearTimers(room) {
    for (const handle of Object.values(room.timers)) clearTimer(handle);
    room.timers = {};
  }

  // Timers belong to a room phase; a callback that fires for a room that was
  // deleted or moved on is ignored.
  function after(room, name, ms, phase, run) {
    if (room.timers[name] !== undefined) clearTimer(room.timers[name]);
    room.timers[name] = setTimer(() => {
      delete room.timers[name];
      if (rooms.get(room.guildId) !== room || !phase.includes(room.phase)) return;
      run();
      push(room);
    }, ms);
  }

  function promoteSpectators(room) {
    for (const member of room.members) {
      if (playersOf(room).length >= MAX_PLAYERS) return;
      if (member.spectator) member.spectator = false;
    }
  }

  function sortedResults(room) {
    // Includes players who finished and then left.
    const finished = [...room.roundResults.values()];
    const mixed = new Set(finished.map((entry) => entry.difficulty)).size > 1;
    // Scores aren't comparable across difficulties; accuracy is.
    return finished.sort((a, b) => (mixed
      ? b.accuracy - a.accuracy || b.score - a.score
      : b.score - a.score || b.accuracy - a.accuracy));
  }

  // Back to a waiting phase: the next song is queued -> intermission with an
  // auto-start timer, else the lobby. `current` and `results` stay for the
  // results screen until the next round starts.
  function settle(room, { auto = true } = {}) {
    clearTimers(room);
    room.startAt = null;
    promoteSpectators(room);
    if (auto && room.queue.length && playersOf(room).length) {
      room.phase = "intermission";
      room.nextAt = now() + INTERMISSION_MS;
      after(room, "intermission", INTERMISSION_MS, ["intermission"], () => startRound(room));
    } else {
      room.phase = "lobby";
      room.nextAt = null;
    }
  }

  function endRound(room) {
    room.results = sortedResults(room);
    settle(room);
  }

  // The song never got going (nobody loaded it, everybody left): it goes back
  // to the front of the queue.
  function abortRound(room) {
    if (room.current) room.queue.unshift(room.current);
    room.current = null;
    room.results = [];
    // No auto-start: that would loop straight into the same failing song.
    settle(room, { auto: false });
  }

  function startRound(room) {
    if (!room.queue.length || !playersOf(room).length) return settle(room);
    clearTimers(room);
    room.current = room.queue.shift();
    room.phase = "loading";
    room.startAt = null;
    room.nextAt = null;
    room.results = [];
    room.roundResults.clear();
    for (const member of room.members) {
      member.loaded = false;
      member.submitted = false;
    }
    after(room, "loading", LOADING_MS, ["loading"], () => beginCountdown(room));
  }

  function beginCountdown(room) {
    if (!playersOf(room).some((member) => member.loaded)) return abortRound(room);
    clearTimers(room);
    room.phase = "countdown";
    room.startAt = now() + COUNTDOWN_MS;
    const durationMs = Math.max(0, Number(room.current?.durationMs) || 0);
    after(room, "play", COUNTDOWN_MS, ["countdown"], () => {
      room.phase = "playing";
      checkFinished(room);
    });
    after(room, "end", COUNTDOWN_MS + durationMs + RESULTS_GRACE_MS, ["countdown", "playing"], () => endRound(room));
  }

  // Everyone who loaded the song is expected to play it; players whose audio
  // never arrived don't hold the round up.
  function checkFinished(room) {
    if (room.phase !== "playing") return;
    const expected = playersOf(room).filter((member) => member.loaded || member.submitted);
    if (expected.every((member) => member.submitted)) endRound(room);
  }

  function checkLoaded(room) {
    if (room.phase !== "loading") return;
    const players = playersOf(room);
    if (!players.length) return abortRound(room);
    if (players.every((member) => member.loaded)) beginCountdown(room);
  }

  function destroy(room) {
    clearTimers(room);
    rooms.delete(room.guildId);
  }

  function join(guildId, profile) {
    const userId = profile?.id;
    if (typeof userId !== "string" || !userId) return fail("bad_profile");
    let room = rooms.get(guildId);
    if (!room) {
      room = {
        guildId,
        hostId: userId,
        phase: "lobby",
        members: [],
        queue: [],
        current: null,
        startAt: null,
        nextAt: null,
        results: [],
        roundResults: new Map(), // userId -> result of the round in progress
        timers: {},
      };
      rooms.set(guildId, room);
    }

    const existing = findMember(room, userId);
    if (existing) {
      existing.username = profile.username ?? existing.username;
      existing.avatarUrl = profile.avatarUrl ?? existing.avatarUrl;
    } else {
      if (room.members.length >= MAX_MEMBERS) return fail("room_full");
      room.members.push({
        userId,
        username: profile.username || userId,
        avatarUrl: profile.avatarUrl ?? null,
        difficulty: DEFAULT_DIFFICULTY,
        ready: false,
        loaded: false,
        // Someone who arrives while a song is on, or after the seats are
        // taken, watches until the next round.
        spectator: ROUND_PHASES.includes(room.phase) || playersOf(room).length >= MAX_PLAYERS,
        submitted: false,
      });
    }
    push(room);
    return ok();
  }

  function leave(guildId, userId) {
    const room = rooms.get(guildId);
    const index = room ? room.members.findIndex((member) => member.userId === userId) : -1;
    if (index < 0) return fail("not_in_room");

    room.members.splice(index, 1);
    pushGone(guildId, userId);
    if (!room.members.length) {
      destroy(room);
      return ok();
    }
    if (room.hostId === userId) room.hostId = room.members[0].userId;
    if (IDLE_PHASES.includes(room.phase)) {
      promoteSpectators(room);
      if (room.phase === "intermission" && !playersOf(room).length) settle(room);
    } else if (room.phase === "loading") {
      checkLoaded(room);
    } else if (room.phase === "countdown" || room.phase === "playing") {
      if (!playersOf(room).length) endRound(room);
      else checkFinished(room);
    }
    push(room);
    return ok();
  }

  async function queueAdd(guildId, userId, { uri, source } = {}) {
    const room = rooms.get(guildId);
    if (!room || !findMember(room, userId)) return fail("not_in_room");
    if (room.queue.length >= MAX_QUEUE) return fail("queue_full");

    let prepared;
    try {
      prepared = await prepareTrack({ guildId, uri, source });
    } catch (error) {
      return fail(error?.reason || "prepare_failed");
    }
    if (!prepared?.audioKey || !prepared.track) return fail("prepare_failed");

    // The room may have changed while the song was being resolved.
    if (rooms.get(guildId) !== room || !findMember(room, userId)) return fail("not_in_room");
    if (room.queue.length >= MAX_QUEUE) return fail("queue_full");
    const { track } = prepared;
    room.queue.push({
      audioKey: prepared.audioKey,
      title: track.title,
      artist: track.artist ?? "",
      durationMs: Number(track.durationMs) || 0,
      artworkUrl: track.artworkUrl ?? null,
      uri: track.uri ?? uri,
      source: track.source ?? source ?? "",
      addedBy: userId,
    });
    push(room);
    return ok();
  }

  // The index counts the waiting queue; the song being played is not in it.
  function queueRemove(guildId, userId, index) {
    const room = rooms.get(guildId);
    if (!room || !findMember(room, userId)) return fail("not_in_room");
    if (!Number.isInteger(index) || index < 0 || index >= room.queue.length) return fail("bad_index");
    if (room.hostId !== userId && room.queue[index].addedBy !== userId) return fail("forbidden");

    room.queue.splice(index, 1);
    // An intermission with nothing left to start becomes the lobby.
    if (room.phase === "intermission" && !room.queue.length) settle(room);
    push(room);
    return ok();
  }

  function ready(guildId, userId, { ready: isReady, difficulty } = {}) {
    const room = rooms.get(guildId);
    const member = room && findMember(room, userId);
    if (!member) return fail("not_in_room");
    if (difficulty !== undefined && !DIFFICULTIES.includes(difficulty)) return fail("bad_difficulty");
    if (difficulty !== undefined) member.difficulty = difficulty;
    if (typeof isReady === "boolean") member.ready = isReady;
    push(room);
    return ok();
  }

  function start(guildId, userId) {
    const room = rooms.get(guildId);
    if (!room || !findMember(room, userId)) return fail("not_in_room");
    if (room.hostId !== userId) return fail("not_host");
    if (!IDLE_PHASES.includes(room.phase)) return fail("wrong_phase");
    if (!room.queue.length) return fail("empty_queue");
    promoteSpectators(room);
    if (!playersOf(room).length) return fail("no_players");

    startRound(room);
    push(room);
    return ok();
  }

  function loaded(guildId, userId, audioKey) {
    const room = rooms.get(guildId);
    const member = room && findMember(room, userId);
    if (!member) return fail("not_in_room");
    if (room.phase !== "loading") return fail("wrong_phase");
    if (member.spectator) return fail("spectator");
    if (audioKey !== room.current?.audioKey) return fail("wrong_track");

    member.loaded = true;
    checkLoaded(room);
    push(room);
    return ok();
  }

  function submitted(guildId, userId, { score, accuracy, grade, difficulty } = {}) {
    const room = rooms.get(guildId);
    const member = room && findMember(room, userId);
    if (!member) return fail("not_in_room");
    if (room.phase !== "playing" && room.phase !== "countdown") return fail("wrong_phase");
    if (member.spectator) return fail("spectator");
    if (member.submitted) return fail("already_submitted");
    if (!Number.isFinite(score) || !Number.isFinite(accuracy) || typeof grade !== "string") return fail("bad_result");

    member.submitted = true;
    room.roundResults.set(userId, {
      userId,
      username: member.username,
      score,
      accuracy,
      grade,
      difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : member.difficulty,
    });
    checkFinished(room);
    push(room);
    return ok();
  }

  function snapshot(guildId) {
    const room = rooms.get(guildId);
    return room ? snapshotOf(room) : null;
  }

  return { join, leave, queueAdd, queueRemove, ready, start, loaded, submitted, snapshot };
}

module.exports = { createRooms, DIFFICULTIES, MAX_PLAYERS, MAX_QUEUE, LOADING_MS, COUNTDOWN_MS, INTERMISSION_MS };
