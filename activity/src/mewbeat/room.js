// Pure logic of the room screens: which view a room snapshot maps to, how server-clock times map onto the
// local clock, the countdown digit and the Mewbit pose. Nothing here touches the DOM, so it is unit tested.

export const PEEK_WINDOW_MS = 15_000; // Mewbit peeks in the last 15 s of the intermission
export const GO_WINDOW_MS = 800; // how long "GO!" stays on screen after the start

export function memberOf(room, userId) {
  return room?.members?.find((m) => m.userId === userId) ?? null;
}

export const isHost = (room, userId) => Boolean(room && userId && room.hostId === userId);
export const isSpectator = (room, userId) => Boolean(memberOf(room, userId)?.spectator);

// A round is in flight from the loading phase until it ends (a finished round keeps `current` set with
// endedAt != null and the room is already back in lobby/intermission).
export function roundActive(room) {
  return Boolean(room) && (room.phase === "loading" || room.phase === "countdown" || room.phase === "playing");
}

// Which screen a room snapshot shows for this user.
//   none       not in a room
//   lobby      lobby / intermission (also the end-of-round state, with Results on top)
//   loading    a player waiting for audio + chart before the countdown
//   countdown  the 5-4-3-2-1-GO overlay (only for someone who is loaded and charted)
//   playing    the game screen
//   watching   a spectator, or a player who missed the start: lobby with "Round in progress" + live board
// `prepared` says this client has the audio decoded and the chart accepted for the current round; the
// server must also have counted it as loaded, or it is not part of the round.
export function roomView(room, userId, { prepared = false } = {}) {
  if (!room) return "none";
  if (!roundActive(room)) return "lobby";
  const me = memberOf(room, userId);
  if (!me || me.spectator) return "watching";
  if (room.phase === "loading") return "loading";
  if (!prepared || !me.loaded) return "watching";
  return room.phase === "countdown" ? "countdown" : "playing";
}

// Server-clock ms -> performance.now() ms. The synced offset wins; before the clock has samples, the
// distance to the snapshot's own serverNow, measured from when the snapshot arrived, is the best guess.
export function serverToPerf(serverMs, { offsetMs = null, serverNow = null, receivedAtMs = 0 } = {}) {
  if (!Number.isFinite(serverMs)) return null;
  if (Number.isFinite(offsetMs)) return serverMs - offsetMs;
  if (Number.isFinite(serverNow)) return receivedAtMs + (serverMs - serverNow);
  return null;
}

export const startPerfMs = (startAt, mapping) => serverToPerf(startAt, mapping);

// The server's clock now, on the same mapping.
export function serverNowMs({ offsetMs = null, serverNow = null, receivedAtMs = 0 } = {}, nowPerf) {
  if (Number.isFinite(offsetMs)) return nowPerf + offsetMs;
  if (Number.isFinite(serverNow)) return serverNow + (nowPerf - receivedAtMs);
  return null;
}

// Milliseconds until a server-clock moment (negative once it is past).
export function remainingMs(serverMs, mapping, nowPerf) {
  const perf = serverToPerf(serverMs, mapping);
  return perf == null ? null : perf - nowPerf;
}

// 5..1 while counting down, 0 for "GO!" just after the start, null otherwise.
export function countdownDigit(startPerf, nowPerf) {
  if (!Number.isFinite(startPerf)) return null;
  const left = startPerf - nowPerf;
  if (left > 5500) return null;
  if (left > 0) return Math.min(5, Math.ceil(left / 1000));
  return left > -GO_WINDOW_MS ? 0 : null;
}

// "m:ss" for a remaining time; never negative.
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Mewbit's pose on the lobby stage. "idle" lets the caller cycle its idle poses.
export function lobbyPose({ phase, remainingMs: left = null, digit = null } = {}) {
  if (digit === 0) return "go";
  if (digit != null && digit >= 1 && digit <= 5) return "hype";
  if (phase === "intermission" && left != null && left <= PEEK_WINDOW_MS) return "peek";
  return "idle";
}

// Queue timeline: the running (or just finished) round first, then the queue. Segment width follows the
// song length. `index` is the position in `queue` (what mewbeat_room_queue_remove takes); the current song
// has none.
export function timelineOf(room, userId) {
  if (!room) return [];
  const host = isHost(room, userId);
  const items = [];
  if (room.current) {
    items.push({
      key: `current:${room.round}`,
      track: room.current,
      current: true,
      finished: room.endedAt != null,
      index: null,
      mine: room.current.addedBy === userId,
      canRemove: false,
    });
  }
  (room.queue ?? []).forEach((track, index) => {
    items.push({
      key: `q:${index}:${track.audioKey}`,
      track,
      current: false,
      finished: false,
      index,
      mine: track.addedBy === userId,
      canRemove: host || track.addedBy === userId,
    });
  });
  const durations = items.map((item) => Math.max(1, item.track.durationMs || 0));
  const longest = Math.max(1, ...durations);
  return items.map((item, i) => ({ ...item, flex: Math.max(0.35, durations[i] / longest) }));
}

// How far the round's song has played, 0..1 (1 once the round ended).
export function songProgress(room, mapping, nowPerf) {
  if (!room?.current) return 0;
  if (room.endedAt != null) return 1;
  if (room.phase !== "playing" || !Number.isFinite(room.startAt) || !(room.current.durationMs > 0)) return 0;
  const server = serverNowMs(mapping, nowPerf);
  if (server == null) return 0;
  return Math.min(1, Math.max(0, (server - room.startAt) / room.current.durationMs));
}

// The status line of a player in the list: ready flag between rounds, loading/playing/done during one.
export function memberStatus(room, member) {
  if (!member) return { text: "", tone: "wait" };
  if (member.spectator) return { text: "Watching", tone: "wait" };
  if (roundActive(room)) {
    if (member.submitted) return { text: "Done", tone: "ok" };
    if (room.phase === "loading") return member.loaded ? { text: "Loaded", tone: "ok" } : { text: "Loading…", tone: "wait" };
    return { text: "Playing", tone: "ok" };
  }
  return member.ready ? { text: "Ready", tone: "ok" } : { text: "Picking…", tone: "wait" };
}

// Rows for Results' standings, from the finished round of a snapshot. The server sends no avatar, so it
// is looked up from the members. `next` mirrors the (informational) ready flag.
export function standingsOf(room, userId) {
  if (!room || room.endedAt == null || !Array.isArray(room.results)) return [];
  return room.results.map((row) => {
    const member = memberOf(room, row.userId);
    return {
      userId: row.userId,
      username: row.username,
      avatarUrl: member?.avatarUrl ?? null,
      difficulty: row.difficulty,
      accuracy: row.accuracy,
      score: row.score,
      grade: row.grade,
      me: row.userId === userId,
      next: Boolean(member?.ready),
    };
  });
}

// "Up next" for Results: the head of the queue.
export function upNextOf(room) {
  const head = room?.queue?.[0];
  return head ? { title: head.title ?? "Untitled", ready: true } : null;
}

// Counts of players (non spectators) that finished loading, for the loading state.
export function loadedCount(room) {
  const players = (room?.members ?? []).filter((m) => !m.spectator);
  return { loaded: players.filter((m) => m.loaded).length, total: players.length };
}

export function inviteMessage(reply) {
  if (!reply) return { ok: false, text: "The bot didn't answer. Try again." };
  if (reply.status === "ok") return { ok: true, text: "Invite sent to the voice channel." };
  switch (reply.reason) {
    case "cooldown": {
      const secs = Math.max(1, Math.ceil((Number(reply.retryInMs) || 0) / 1000));
      return { ok: false, text: `Invite was just sent. Try again in ${secs}s.` };
    }
    case "no_voice_channel": return { ok: false, text: "Join a voice channel first." };
    case "not_in_room": return { ok: false, text: "You're not in the room." };
    case "send_failed": return { ok: false, text: "Couldn't send the invite." };
    default: return { ok: false, text: "Couldn't send the invite." };
  }
}

const ROOM_ERRORS = {
  not_in_room: "You're not in the room.",
  not_host: "Only the host can do that.",
  wrong_phase: "Not possible while a round is running.",
  empty_queue: "Add a song to the queue first.",
  queue_full: "The queue is full (5 per player, 20 in total).",
  forbidden: "You can only remove your own songs.",
  bad_index: "That song is already gone from the queue.",
  wrong_track: "That song can't be played here.",
  spectator: "Spectators can't do that until the next round.",
  in_round: "You can't switch to spectator in the middle of your round.",
  bad_difficulty: "Pick a valid difficulty.",
  bad_request: "That didn't work. Try again.",
  room_full: "The room is full.",
  locked: "Unlock mewbeat first.",
  bad_uri: "That song link isn't valid.",
  bad_source: "That song link isn't valid.",
  resolve_failed: "Couldn't look that song up. Try again.",
  not_found: "Couldn't find that song.",
  unsupported: "That song can't be played in mewbeat.",
  prepare_failed: "Couldn't prepare that song. Try again.",
  cooldown: "Slow down a little.",
  no_voice_channel: "Join a voice channel first.",
  send_failed: "Couldn't send that.",
  no_players: "Nobody is able to play yet.",
  unreachable: "Can't reach the bot right now. Try again in a moment.",
};

// A short sentence for a failed room request (the reply's reason, or a thrown error).
export function roomErrorText(reasonOrReply) {
  const reason = typeof reasonOrReply === "string" ? reasonOrReply : reasonOrReply?.reason;
  return ROOM_ERRORS[reason] ?? "Something went wrong. Try again.";
}
