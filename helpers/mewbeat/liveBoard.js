const DIFFICULTIES = ["easy", "normal", "hard", "hell"];
// An entry that hasn't been refreshed for this long is a player who stopped.
const EXPIRE_MS = 5_000;
// A session is pushed at most every 250 ms (4 Hz).
const PUSH_INTERVAL_MS = 250;
const MAX_SESSION_LENGTH = 200;
const MAX_ENTRIES = 50;
const MAX_SCORE = 1_000_000_000;
const MAX_COMBO = 1_000_000;
const ROOM = "room";
const LIVE_PREFIX = "live:";

const ok = () => ({ ok: true });
const fail = (reason) => ({ ok: false, reason });

// The modifier ids a player shows on the board, shape only: the board is for show, a run's list is checked at submit.
const MODIFIER_ID = /^[a-z]{2}$/;
const MAX_MODIFIERS = 9;
function modifierTagsOf(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === "string" && MODIFIER_ID.test(id)))].slice(0, MAX_MODIFIERS);
}

// The live standings of the people playing the same thing right now. A session
// is "room" (the server's room) or "live:<audioKey>" (everyone playing along
// with the bot). It keeps one entry per user per session, in memory: an entry
// lives EXPIRE_MS after its last update and everything is rebuilt by the next
// update after a restart. Time and timers are injected like in rooms.js.
//
// broadcast(guildId, userIds, payload) pushes to those users' sockets.
// membersOf(guildId) -> [{ userId, spectator }] lists the guild's room; only a
// player there may post to "room", and every member (spectators too) receives it.
function createLiveBoard({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  broadcast = () => {},
  membersOf = () => [],
  log = {},
} = {}) {
  const sessions = new Map(); // `${guildId}\n${session}` -> state
  const placed = new Map(); // `${guildId}\n${userId}` -> state the user has an entry in

  const sessionKey = (guildId, session) => `${guildId}\n${session}`;
  const userKey = (guildId, userId) => `${guildId}\n${userId}`;

  function validSession(session, audioKey) {
    if (session === ROOM) return true;
    if (typeof session !== "string" || session.length > MAX_SESSION_LENGTH || !session.startsWith(LIVE_PREFIX)) return false;
    const key = session.slice(LIVE_PREFIX.length);
    // The audioKey is redundant with the session; when both come, they agree.
    return key.length > 0 && (audioKey === undefined || audioKey === null || audioKey === key);
  }

  function number(value, { min, max, integer }) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const clamped = Math.min(max, Math.max(min, value));
    return integer ? Math.round(clamped) : clamped;
  }

  function recipientsOf(state) {
    if (state.session === ROOM) return membersOf(state.guildId).map((member) => member.userId);
    return [...state.entries.keys()];
  }

  function sortedEntries(state) {
    let entries = [...state.entries.values()];
    if (state.session === ROOM) {
      const members = new Set(membersOf(state.guildId).map((member) => member.userId));
      entries = entries.filter((entry) => members.has(entry.userId));
    }
    const mixed = new Set(entries.map((entry) => entry.difficulty)).size > 1;
    // Scores aren't comparable across difficulties; accuracy is. No judgement yet counts as last.
    const accuracyOf = (entry) => entry.accuracy ?? -1;
    entries.sort((a, b) => (mixed
      ? accuracyOf(b) - accuracyOf(a) || b.score - a.score
      : b.score - a.score || accuracyOf(b) - accuracyOf(a)) || (a.userId < b.userId ? -1 : 1));
    return entries.map(({ userId, username, avatarUrl, difficulty, score, combo, accuracy, vibe, fever, failed, modifiers, ended }) => ({
      userId, username, avatarUrl, difficulty, score, combo, accuracy, vibe, fever, failed, modifiers, ended,
    }));
  }

  function pushNow(state) {
    state.lastPushAt = now();
    try {
      const userIds = recipientsOf(state);
      if (userIds.length) {
        broadcast(state.guildId, userIds, { type: "mewbeat_live_board", session: state.session, entries: sortedEntries(state) });
      }
    } catch (error) {
      log.warning?.("mewbeat live board broadcast failed", error?.message);
    }
  }

  // Leading push when the session has been quiet, else one trailing push at the
  // end of the interval, so the last update of a burst always gets delivered.
  function schedulePush(state) {
    if (state.pushTimer !== undefined) return;
    const wait = state.lastPushAt + PUSH_INTERVAL_MS - now();
    if (wait <= 0) return pushNow(state);
    state.pushTimer = setTimer(() => {
      state.pushTimer = undefined;
      if (sessions.get(sessionKey(state.guildId, state.session)) !== state) return;
      pushNow(state);
      dropIfEmpty(state);
    }, wait);
  }

  // Empty sessions go away with their timers. A room's last push is still
  // owed to its members (the board emptied), so that one waits for its timer.
  function dropIfEmpty(state) {
    if (state.entries.size) return;
    if (state.pushTimer !== undefined) {
      if (state.session === ROOM) return;
      clearTimer(state.pushTimer);
      state.pushTimer = undefined;
    }
    sessions.delete(sessionKey(state.guildId, state.session));
  }

  function removeEntry(state, userId) {
    const entry = state.entries.get(userId);
    if (!entry) return false;
    if (entry.expireTimer !== undefined) clearTimer(entry.expireTimer);
    state.entries.delete(userId);
    const key = userKey(state.guildId, userId);
    if (placed.get(key) === state) placed.delete(key);
    return true;
  }

  function leaveState(state, userId) {
    if (!removeEntry(state, userId)) return;
    schedulePush(state);
    dropIfEmpty(state);
  }

  function expire(state, userId) {
    const entry = state.entries.get(userId);
    if (entry) entry.expireTimer = undefined;
    removeEntry(state, userId);
    schedulePush(state);
    dropIfEmpty(state);
  }

  function update(guildId, userId, profile, message = {}) {
    if (typeof userId !== "string" || !userId) return fail("bad_profile");
    const { session, audioKey, difficulty, ended } = message;
    if (!validSession(session, audioKey)) return fail("bad_session");
    if (!DIFFICULTIES.includes(difficulty)) return fail("bad_difficulty");
    const score = number(message.score, { min: 0, max: MAX_SCORE, integer: true });
    const combo = number(message.combo, { min: 0, max: MAX_COMBO, integer: true });
    // Before the first judgement there is no accuracy yet.
    const accuracy = message.accuracy == null ? null : number(message.accuracy, { min: 0, max: 100 });
    // What a spectator's stage follows. Older clients don't send it.
    const vibe = message.vibe == null ? null : number(message.vibe, { min: 0, max: 1 });
    if (score === null || combo === null || (message.accuracy != null && accuracy === null) || (message.vibe != null && vibe === null)) return fail("bad_numbers");

    if (session === ROOM) {
      const member = membersOf(guildId).find((candidate) => candidate.userId === userId);
      if (!member) return fail("not_in_room");
      if (member.spectator) return fail("spectator");
    }

    const key = sessionKey(guildId, session);
    let state = sessions.get(key);
    const previous = placed.get(userKey(guildId, userId));
    if (!state?.entries.has(userId) && state && state.entries.size >= MAX_ENTRIES) return fail("session_full");

    // Moving on to another session takes the user out of the old one.
    if (previous && previous !== state) leaveState(previous, userId);

    if (!state) {
      state = { guildId, session, entries: new Map(), lastPushAt: -Infinity, pushTimer: undefined };
      sessions.set(key, state);
    }
    const existing = state.entries.get(userId);
    if (existing?.expireTimer !== undefined) clearTimer(existing.expireTimer);
    const entry = {
      userId,
      username: profile?.username || existing?.username || userId,
      avatarUrl: profile?.avatarUrl ?? existing?.avatarUrl ?? null,
      difficulty,
      score,
      combo,
      accuracy,
      vibe,
      fever: Boolean(message.fever),
      failed: Boolean(message.failed), // lost the run: the board shows FAILED instead of the combo
      modifiers: modifierTagsOf(message.modifiers),
      ended: Boolean(ended),
      expireTimer: undefined,
    };
    entry.expireTimer = setTimer(() => expire(state, userId), EXPIRE_MS);
    state.entries.set(userId, entry);
    placed.set(userKey(guildId, userId), state);
    schedulePush(state);
    return ok();
  }

  // Takes the user out of every session, or only of `session`.
  function remove(guildId, userId, session) {
    const state = placed.get(userKey(guildId, userId));
    if (state && (session === undefined || state.session === session)) leaveState(state, userId);
  }

  return { update, remove };
}

module.exports = { createLiveBoard, EXPIRE_MS, PUSH_INTERVAL_MS, MAX_ENTRIES };
