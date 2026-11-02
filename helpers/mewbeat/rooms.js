const DIFFICULTIES = ["easy", "normal", "hard", "hell"];
const DEFAULT_DIFFICULTY = "normal";
const MAX_PLAYERS = 10;
// Watching costs little, but the list is bounded so one room can't grow forever.
const MAX_MEMBERS = 50;
const MAX_QUEUE = 20;
// One member can't fill the whole queue.
const MAX_QUEUE_PER_USER = 5;
const LOADING_MS = 20_000;
// A song nobody has yet may still be in analysis: with no player loaded the round waits this much longer.
const LOADING_LATE_MS = 120_000;
// The quiet stretch between the last player loading and the first note.
const ROUND_LEAD_MS = 3_000;
// The first Ready opens this long a wait for the others...
const READY_WINDOW_MS = 60_000;
// ...and everyone being ready cuts it down to this.
const FINAL_COUNTDOWN_MS = 5_000;
// A round that nobody finishes ends this long after the song would have; the
// slack also covers a slow client or a long server-side recompute.
const RESULTS_GRACE_MS = 10_000;
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
// Phases: lobby, loading, countdown, playing, intermission. There is no
// separate results phase. The snapshot carries `round` (0 before the first
// round, +1 for every round started) and `endedAt` (server ms when the last
// round ended, null while a round is on, after an aborted round and before
// the first one). The client shows a round's results while `results`/`current`
// are set and `endedAt != null`, in the lobby or the intermission phase.
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
        watching: member.watching,
        submitted: member.submitted,
      })),
      queue: room.queue.map((entry) => ({ ...entry })),
      current: room.current ? { ...room.current } : null,
      round: room.round,
      endedAt: room.endedAt,
      startAt: room.startAt,
      nextAt: room.nextAt,
      finalCountdown: room.finalAt != null,
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

  // Spectators who chose to watch stay put; only the ones kept out of a round
  // (or out of a full room) take the free seats.
  function promoteSpectators(room) {
    for (const member of room.members) {
      if (playersOf(room).length >= MAX_PLAYERS) return;
      if (member.spectator && !member.watching) member.spectator = false;
    }
  }

  function stopCountdown(room) {
    if (room.timers.next !== undefined) clearTimer(room.timers.next);
    delete room.timers.next;
    room.windowAt = null;
    room.finalAt = null;
    room.nextAt = null;
  }

  // Brings the clock of a waiting room in line with who is ready. The long wait
  // (`windowAt`) keeps running through every change; the final seconds (`finalAt`)
  // only last while everyone is ready and never go past the end of the long wait.
  function syncCountdown(room) {
    if (!IDLE_PHASES.includes(room.phase)) return;
    const players = playersOf(room);
    const readyCount = players.filter((member) => member.ready).length;
    const between = room.phase === "intermission"; // runs without anyone pressing Ready
    if (!room.queue.length || !players.length || (!between && !readyCount)) {
      stopCountdown(room);
      room.phase = "lobby";
      return;
    }
    room.windowAt ??= now() + READY_WINDOW_MS;
    if (readyCount === players.length) room.finalAt ??= Math.min(room.windowAt, now() + FINAL_COUNTDOWN_MS);
    else room.finalAt = null;
    const nextAt = room.finalAt ?? room.windowAt;
    if (nextAt === room.nextAt) return;
    room.nextAt = nextAt;
    after(room, "next", nextAt - now(), IDLE_PHASES, () => startRound(room));
  }

  // Someone came, left or switched to watching in a waiting phase: free seats
  // fill and the clock follows the new roster.
  function rosterChanged(room) {
    if (!IDLE_PHASES.includes(room.phase)) return;
    promoteSpectators(room);
    syncCountdown(room);
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

  // Back to a waiting phase: the next song is queued -> intermission with a
  // shorter wait that starts by itself, else the lobby. `current` and `results` stay for the
  // results screen until the next round starts.
  function settle(room, { auto = true } = {}) {
    clearTimers(room);
    stopCountdown(room);
    room.startAt = null;
    promoteSpectators(room);
    if (auto && room.queue.length && playersOf(room).length) {
      room.phase = "intermission";
      room.windowAt = now() + INTERMISSION_MS;
      syncCountdown(room);
    } else {
      room.phase = "lobby";
    }
  }

  function endRound(room) {
    room.results = sortedResults(room);
    room.endedAt = now();
    settle(room);
  }

  // The song never got going (nobody loaded it, everybody left): it goes back
  // to the front of the queue.
  function abortRound(room) {
    if (room.current) room.queue.unshift(room.current);
    // The aborted song may not push the queue past its cap: the tail yields.
    if (room.queue.length > MAX_QUEUE) room.queue.length = MAX_QUEUE;
    room.current = null;
    room.results = [];
    room.endedAt = null;
    // No auto-start: that would loop straight into the same failing song.
    settle(room, { auto: false });
  }

  function startRound(room) {
    if (!room.queue.length || !playersOf(room).length) return settle(room);
    clearTimers(room);
    room.current = room.queue.shift();
    room.round += 1;
    room.phase = "loading";
    room.loadingLate = false;
    room.startAt = null;
    stopCountdown(room);
    room.endedAt = null;
    room.results = [];
    room.roundResults.clear();
    for (const member of room.members) {
      member.loaded = false;
      member.submitted = false;
      // Ready is for the round that is about to start, not the next one.
      member.ready = false;
    }
    after(room, "loading", LOADING_MS, ["loading"], () => {
      if (playersOf(room).some((member) => member.loaded)) return beginCountdown(room);
      room.loadingLate = true;
      after(room, "loading", LOADING_LATE_MS, ["loading"], () => beginCountdown(room));
    });
    reprepare(room);
  }

  // The song may have fallen out of the registry since it was queued (the
  // registry is shared and bounded), so it is registered again as the round
  // starts. If that fails the entry is dropped and the next one is tried.
  async function reprepare(room) {
    const { round } = room;
    const entry = room.current;
    let prepared = null;
    try {
      prepared = await prepareTrack({ guildId: room.guildId, uri: entry.uri, source: entry.source });
    } catch (error) {
      log.warning?.("mewbeat queued song can't be prepared", error?.reason || error?.message);
    }
    // The round may have ended or the room changed while this was running.
    if (rooms.get(room.guildId) !== room || room.round !== round || room.phase !== "loading") return;
    if (prepared?.audioKey && prepared.track) return;

    room.current = null;
    room.results = [];
    if (room.queue.length && playersOf(room).length) startRound(room);
    else settle(room, { auto: false });
    push(room);
  }

  function beginCountdown(room) {
    if (!playersOf(room).some((member) => member.loaded)) return abortRound(room);
    clearTimers(room);
    room.phase = "countdown";
    room.startAt = now() + ROUND_LEAD_MS;
    const durationMs = Math.max(0, Number(room.current?.durationMs) || 0);
    after(room, "play", ROUND_LEAD_MS, ["countdown"], () => {
      room.phase = "playing";
      checkFinished(room);
    });
    after(room, "end", ROUND_LEAD_MS + durationMs + RESULTS_GRACE_MS, ["countdown", "playing"], () => endRound(room));
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
    if (players.every((member) => member.loaded) || (room.loadingLate && players.some((member) => member.loaded))) beginCountdown(room);
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
        round: 0,
        endedAt: null,
        pending: new Map(), // userId -> queue adds in flight
        startAt: null,
        nextAt: null,
        windowAt: null, // when the wait for the next round runs out
        finalAt: null, // when the final seconds run out, once everyone is ready
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
        // Chose to spectate (survives rounds), unlike `spectator`, which only means "not in this round".
        watching: false,
        submitted: false,
      });
    }
    rosterChanged(room);
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
      rosterChanged(room);
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
    // Adds still being resolved count too, so a flood doesn't start work that
    // can't fit.
    const inFlight = [...room.pending.values()].reduce((sum, count) => sum + count, 0);
    if (room.queue.length + inFlight >= MAX_QUEUE) return fail("queue_full");
    const own = room.queue.filter((entry) => entry.addedBy === userId).length + (room.pending.get(userId) ?? 0);
    if (own >= MAX_QUEUE_PER_USER) return fail("queue_full");

    room.pending.set(userId, (room.pending.get(userId) ?? 0) + 1);
    let prepared;
    try {
      prepared = await prepareTrack({ guildId, uri, source });
    } catch (error) {
      return fail(error?.reason || "prepare_failed");
    } finally {
      const left = (room.pending.get(userId) ?? 1) - 1;
      if (left > 0) room.pending.set(userId, left);
      else room.pending.delete(userId);
    }
    if (!prepared?.audioKey || !prepared.track) return fail("prepare_failed");

    // The room may have changed while the song was being resolved.
    if (rooms.get(guildId) !== room || !findMember(room, userId)) return fail("not_in_room");
    if (room.queue.length >= MAX_QUEUE) return fail("queue_full");
    if (room.queue.filter((entry) => entry.addedBy === userId).length >= MAX_QUEUE_PER_USER) return fail("queue_full");
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
    // A lobby that was waiting only for a song starts its clock now.
    syncCountdown(room);
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
    // A wait with nothing left to start ends.
    syncCountdown(room);
    push(room);
    return ok();
  }

  // `spectate: true` is a choice to watch (kept across rounds); `false` asks for
  // a seat, which a running round or a full room defers to the next promotion.
  function ready(guildId, userId, { ready: isReady, difficulty, spectate } = {}) {
    const room = rooms.get(guildId);
    const member = room && findMember(room, userId);
    if (!member) return fail("not_in_room");
    if (difficulty !== undefined && !DIFFICULTIES.includes(difficulty)) return fail("bad_difficulty");
    // Everything is checked before anything changes, so a refusal leaves the member as it was.
    if (spectate === true && !member.spectator && ROUND_PHASES.includes(room.phase)) return fail("in_round");
    let spectatorAfter = member.spectator;
    if (spectate === true) spectatorAfter = true;
    else if (spectate === false && !ROUND_PHASES.includes(room.phase) && playersOf(room).length < MAX_PLAYERS) spectatorAfter = false;
    if (isReady === true && spectatorAfter) return fail("spectating");

    if (difficulty !== undefined) member.difficulty = difficulty;
    if (spectate === true) member.watching = true;
    else if (spectate === false) member.watching = false;
    member.spectator = spectatorAfter;
    if (typeof isReady === "boolean") member.ready = isReady;
    if (member.spectator) member.ready = false;
    rosterChanged(room);
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
    // A run on another difficulty than the one chosen in the room doesn't
    // count: scores are only comparable on the same chart.
    if (difficulty !== undefined && difficulty !== member.difficulty) return fail("wrong_difficulty");

    member.submitted = true;
    room.roundResults.set(userId, {
      userId,
      username: member.username,
      score,
      accuracy,
      grade,
      difficulty: member.difficulty,
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

module.exports = {
  createRooms,
  DIFFICULTIES,
  MAX_PLAYERS,
  MAX_QUEUE,
  MAX_QUEUE_PER_USER,
  MAX_MEMBERS,
  RESULTS_GRACE_MS,
  LOADING_MS,
  ROUND_LEAD_MS,
  READY_WINDOW_MS,
  FINAL_COUNTDOWN_MS,
  INTERMISSION_MS,
};
