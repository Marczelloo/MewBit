const DIFFICULTIES = ["easy", "normal", "hard", "hell"];
const DEFAULT_DIFFICULTY = "normal";
const MAX_PLAYERS = 10;
// Watching costs little, but the list is bounded so one room can't grow forever.
const MAX_MEMBERS = 50;
const MAX_QUEUE = 20;
const MAX_PLAYED = 20;
// One member can't fill the whole queue.
const MAX_QUEUE_PER_USER = 5;
const LOADING_MS = 20_000;
// A song nobody has yet may still be in analysis: with no player loaded the round waits this much longer.
const LOADING_LATE_MS = 120_000;
// The quiet stretch between the last player loading and the first note.
const ROUND_LEAD_MS = 3_000;
// Silence added between that start and the song's first sound, so the first notes can lie on it.
const SONG_SILENCE_MS = 2_000;
// Before the room's first round: the first Ready opens this long a wait for the others...
const READY_WINDOW_MS = 60_000;
// ...and everyone being ready cuts it down to this. After a round the same final seconds run once the vote for
// the next map passes or the host forces the start.
const FINAL_COUNTDOWN_MS = 5_000;
// A round that nobody finishes ends this long after the song would have; the
// slack also covers a slow client or a long server-side recompute.
const RESULTS_GRACE_MS = 10_000;
// Between rounds (the lobby also shows the last round's results), spectators can take free player seats.
const IDLE_PHASES = ["lobby"];
const ROUND_PHASES = ["loading", "countdown", "playing"];

const ok = () => ({ ok: true });
const fail = (reason) => ({ ok: false, reason });

// The server's rooms: one per Discord server, created by the first join and
// deleted with the last member. All state is in memory; a restart just means
// the clients join again. Time and timers are injected so the phase machine
// can be tested with a fake clock.
//
// Phases: lobby, loading, countdown, playing. There is no separate results
// phase. The snapshot carries `round` (0 before the first round, +1 for every
// round started) and `endedAt` (server ms when the last round ended, null while
// a round is on, after an aborted round and before the first one). The client
// shows a round's results while `results`/`current` are set and `endedAt != null`,
// in the lobby phase.
//
// A member has one flag, `ready`, and what it means depends on whether a round
// has ended in this room yet (`roundEnded`, in the snapshot as `voting`):
//
// - Before the room's first round it is the lobby's Ready button. The first
//   Ready opens a wait of READY_WINDOW_MS for the others; everyone ready cuts it
//   to FINAL_COUNTDOWN_MS; when the wait runs out the round starts with whoever
//   is there; the host's `start` begins at once. (A round that was aborted
//   before it ended counts as no round: the room is still in this mode.)
// - Once a round has ended it is the vote "play next" (the results screen's Play
//   next button and the lobby's Ready button are the same flag). Nothing starts
//   by itself, ever, and there is no clock while the room waits for votes. The
//   map starts, after FINAL_COUNTDOWN_MS, once MORE THAN HALF of the players
//   have voted (1 of 1, 2 of 2, 2 of 3, 3 of 4, 3 of 5...). The host can force
//   it: the first `start` begins the countdown without the vote, the second
//   skips what is left of it.
//
// The flags are cleared when a round starts and when one ends, so a Ready or a
// vote never carries over into another round's wait.
//
// Who counts as "a player in the room" (the electorate, `playersOf`): the members that are
// not spectators, `playersOf`. That means
//   - someone who only watches (chose Spectator, or joined while a round was on
//     and has not been seated yet) does not count and cannot vote, so a pure
//     audience can neither hold up a room nor start it;
//   - someone still reading the results screen does count: they are a player
//     and may vote from there, and the room waits for a majority, not for all;
//   - someone who closed the Activity is no longer a member at all (the socket
//     closing removes them, see `leave`), so they stop counting at once and the
//     vote is recounted;
//   - someone who stays in the Activity but walks away does count. Being just
//     under the majority is what the host's force start is for; it is the escape
//     hatch for an absent player and needs no vote.
// The tally is recounted whenever a member comes, leaves, switches between
// Player and Spectator, votes or takes the vote back, and whenever the queue
// changes under it. After a round the votes are also cleared when the song at the
// head of the queue changes, since the voters agreed to play a different map.
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
  // The vote: how many of the players want the next map, and how many are needed (more than half of them).
  function tallyOf(room) {
    const players = playersOf(room);
    return {
      players,
      votes: players.filter((member) => member.ready).length,
      needed: players.length ? Math.floor(players.length / 2) + 1 : 0,
    };
  }

  function snapshotOf(room) {
    const { votes, needed } = tallyOf(room);
    return {
      hostId: room.hostId,
      phase: room.phase,
      members: room.members.map((member) => ({
        userId: member.userId,
        username: member.username,
        avatarUrl: member.avatarUrl,
        difficulty: member.difficulty,
        modifiers: [...(member.modifiers ?? [])],
        ready: member.ready,
        loaded: member.loaded,
        spectator: member.spectator,
        watching: member.watching,
        submitted: member.submitted,
      })),
      queue: room.queue.map((entry) => ({ ...entry })),
      played: room.played.map((entry) => ({ ...entry })),
      current: room.current ? { ...room.current } : null,
      round: room.round,
      endedAt: room.endedAt,
      startAt: room.startAt,
      silenceMs: SONG_SILENCE_MS,
      nextAt: room.nextAt,
      finalCountdown: room.finalAt != null,
      // `voting`: a round has ended in this room, so `ready` is the vote for the next map (`votes` of `votesNeeded`,
      // the majority) and there is no clock while votes are missing. Before that it is the lobby's Ready with its wait.
      // `forced`: the countdown runs because the host forced the start, not because the vote passed.
      voting: room.roundEnded,
      votes,
      votesNeeded: needed,
      forced: room.forced,
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

  // Ends the wait before a round (a vote that fell below the majority, a changed queue, a lost host force, nobody ready).
  function stopCountdown(room) {
    if (room.timers.next !== undefined) clearTimer(room.timers.next);
    delete room.timers.next;
    room.windowAt = null;
    room.finalAt = null;
    room.nextAt = null;
    room.forced = false;
  }

  // Everybody's "play next" vote is withdrawn (they are asked again for the next map).
  function clearVotes(room) {
    for (const member of room.members) member.ready = false;
  }

  // Brings the clock of a waiting room in line with who is ready (or has voted).
  function syncCountdown(room) {
    if (!IDLE_PHASES.includes(room.phase)) return;
    if (room.roundEnded) syncVote(room);
    else syncWindow(room);
  }

  // Before the room's first round. The long wait (`windowAt`) opens with the first Ready and keeps running through
  // every change; the final seconds (`finalAt`) only last while everyone is ready and never go past the end of the
  // long wait.
  function syncWindow(room) {
    const players = playersOf(room);
    const readyCount = players.filter((member) => member.ready).length;
    if (!room.queue.length || !players.length || !readyCount) {
      stopCountdown(room);
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

  // After a round. The ONLY thing that starts a round without a click from the host is the final countdown
  // (`finalAt`), and it exists only while more than half of the players have voted (or the host forced the start).
  // It is recounted on every change, so it also ends when a vote is taken back or someone new makes the majority
  // bigger. A room that is waiting for votes has no clock at all.
  function syncVote(room) {
    const head = room.queue[0] ?? null;
    if (room.voteHead !== head) {
      // The voters agreed to play a different map than the one that is now up next: the vote starts over.
      room.voteHead = head;
      clearVotes(room);
      stopCountdown(room);
    }
    const { players, votes, needed } = tallyOf(room);
    if (!head || !players.length) {
      clearVotes(room);
      stopCountdown(room);
      return;
    }
    if (votes < needed && !room.forced) {
      stopCountdown(room);
      return;
    }
    if (room.finalAt != null) return; // already counting down
    room.finalAt = now() + FINAL_COUNTDOWN_MS;
    room.nextAt = room.finalAt;
    after(room, "next", FINAL_COUNTDOWN_MS, IDLE_PHASES, () => startRound(room));
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
    // Scores aren't comparable across difficulties; accuracy is. A player who failed is below everyone who finished.
    return finished.sort((a, b) => Number(a.failed) - Number(b.failed) || (mixed
      ? b.accuracy - a.accuracy || b.score - a.score
      : b.score - a.score || b.accuracy - a.accuracy));
  }

  // Back to the lobby, with no clock running and nobody ready or having voted: the next round has to be asked for
  // (Ready before the first round, the vote or the host's force after one), whatever is queued. `current` and
  // `results` stay for the results screen until the next round starts.
  function settle(room) {
    clearTimers(room);
    stopCountdown(room);
    room.startAt = null;
    promoteSpectators(room);
    room.phase = "lobby";
    // A Ready or vote from before or during the round belongs to that round, not to the wait that begins now.
    clearVotes(room);
    room.voteHead = room.queue[0] ?? null;
  }

  function endRound(room) {
    room.results = sortedResults(room);
    room.endedAt = now();
    // From here on Ready is the vote for the next map.
    room.roundEnded = true;
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
    settle(room);
  }

  function startRound(room) {
    if (!room.queue.length || !playersOf(room).length) return settle(room);
    clearTimers(room);
    // Only a round that ended is a song played; an aborted one went back to the queue.
    if (room.current && room.endedAt != null) {
      room.played.push(room.current);
      if (room.played.length > MAX_PLAYED) room.played.shift();
    }
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
    }
    // Ready and votes were for the round that is starting, not for the next one.
    clearVotes(room);
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

    // The song is dropped. Before the room's first round the next one is tried, as it always was. After a round the next
    // one was not voted for, so the room goes back to waiting for the vote.
    room.current = null;
    room.results = [];
    if (!room.roundEnded && room.queue.length && playersOf(room).length) startRound(room);
    else settle(room);
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
    after(room, "end", ROUND_LEAD_MS + SONG_SILENCE_MS + durationMs + RESULTS_GRACE_MS, ["countdown", "playing"], () => endRound(room));
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
        played: [], // the songs whose rounds ended, oldest first
        current: null,
        round: 0,
        endedAt: null,
        roundEnded: false, // a round has ended here: `ready` is the vote for the next map from now on
        pending: new Map(), // userId -> queue adds in flight
        startAt: null,
        nextAt: null,
        windowAt: null, // before the first round: when the wait opened by the first Ready runs out
        finalAt: null, // when the final seconds run out (everyone ready, the vote passed or the host forced the start)
        forced: false, // the host forced the start (the countdown does not need the vote)
        voteHead: null, // the queue entry the votes are for (the song up next)
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
        modifiers: [],
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
    // With the first song queued a Ready given earlier opens the wait (a vote can't exist without a song).
    syncCountdown(room);
    push(room);
    return ok();
  }

  // The index counts the waiting queue; the song being played is not in it. `audioKey` is the song the player saw at
  // that index: when the queue moved under them the request is refused rather than hitting another song.
  function queueRemove(guildId, userId, index, audioKey) {
    const room = rooms.get(guildId);
    if (!room || !findMember(room, userId)) return fail("not_in_room");
    if (!Number.isInteger(index) || index < 0 || index >= room.queue.length) return fail("bad_index");
    if (audioKey != null && room.queue[index].audioKey !== audioKey) return fail("queue_changed");
    if (room.hostId !== userId && room.queue[index].addedBy !== userId) return fail("forbidden");

    room.queue.splice(index, 1);
    // After a round, removing the song up next voids the votes (and the wait ends when nothing is left to start).
    syncCountdown(room);
    push(room);
    return ok();
  }

  // The owner orders the queue: the song at `from` ends up at position `to`.
  function queueMove(guildId, userId, from, to, audioKey) {
    const room = rooms.get(guildId);
    if (!room || !findMember(room, userId)) return fail("not_in_room");
    if (room.hostId !== userId) return fail("not_host");
    const valid = (index) => Number.isInteger(index) && index >= 0 && index < room.queue.length;
    if (!valid(from) || !valid(to)) return fail("bad_index");
    if (audioKey != null && room.queue[from].audioKey !== audioKey) return fail("queue_changed");

    room.queue.splice(to, 0, room.queue.splice(from, 1)[0]);
    // Another song may be up next now: after a round the votes were for the old one.
    syncCountdown(room);
    push(room);
    return ok();
  }

  // `spectate: true` is a choice to watch (kept across rounds); `false` asks for
  // a seat, which a running round or a full room defers to the next promotion.
  // `modifiers`: the ids the player picked (checked by the caller), shown next to them in the room.
  function ready(guildId, userId, { ready: isReady, difficulty, spectate, modifiers } = {}) {
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
    // Ready and votes are for what starts next: none while a round runs, and after a round none without a song to
    // vote for (before the first one, Ready may come ahead of the first song, as it always did).
    if (isReady === true && ROUND_PHASES.includes(room.phase)) return fail("wrong_phase");
    if (isReady === true && room.roundEnded && !room.queue.length) return fail("empty_queue");

    if (difficulty !== undefined) member.difficulty = difficulty;
    if (Array.isArray(modifiers)) member.modifiers = [...modifiers];
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

    if (!room.roundEnded) {
      // Before the first round the host's start begins at once, as it always did.
      startRound(room);
      push(room);
      return ok();
    }

    // After a round the host's escape hatch needs no vote. It runs the same final countdown a passed vote does, and
    // when that is already running (the vote passed first, or this is the second press) it skips what is left of it.
    syncCountdown(room);
    if (room.finalAt != null) {
      startRound(room);
    } else {
      room.forced = true;
      syncCountdown(room);
    }
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

  function submitted(guildId, userId, { score, accuracy, grade, difficulty, failed = false, modifiers = [] } = {}) {
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
      failed: failed === true,
      modifiers,
    });
    checkFinished(room);
    push(room);
    return ok();
  }

  function snapshot(guildId) {
    const room = rooms.get(guildId);
    return room ? snapshotOf(room) : null;
  }

  return { join, leave, queueAdd, queueRemove, queueMove, ready, start, loaded, submitted, snapshot };
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
  SONG_SILENCE_MS,
  READY_WINDOW_MS,
  FINAL_COUNTDOWN_MS,
};
