// A believable room for the lobby preview (?mock=1&lobby=1, dev server only). Everything here is pure: a snapshot in
// the shape helpers/mewbeat/rooms.js sends, and the few changes the lobby's controls make to it. MockLobby.jsx holds
// the state and the clock.

import { audioKeyOf, MOCK_USER_ID, SONGS } from "./mockRequests.js";
import { accuracyOf, applyJudgement, canFever, createScore, gradeOf, isFailed, startFever } from "./scoring.js";

export const READY_WINDOW_MS = 60_000; // before the room's first round: the wait the first Ready opens, as on the bot
export const FINAL_COUNTDOWN_MS = 5000; // the final seconds once everyone is ready, a vote passed or the host forced the start, as on the bot
export const MAX_QUEUE = 20;

const ME = { userId: MOCK_USER_ID, username: "Meowczelloo" };
const PLAYERS = [
  { userId: "kuba", username: "kuba", difficulty: "hard", ready: true, modifiers: ["gn", "st"] },
  { ...ME, difficulty: "normal", ready: false },
  { userId: "neko", username: "neko", difficulty: "normal", ready: true, modifiers: ["ol"] },
  { userId: "ola", username: "ola", difficulty: "easy", ready: false },
];
// Songs with a chart, in the order they join the queue; the first three are queued from the start.
const QUEUEABLE = SONGS.filter((song) => song.stars).map((song) => song.title);
const START_QUEUE = [["MEGALOVANIA", "kuba"], ["Hopes and Dreams", MOCK_USER_ID], ["Rude Buster", "neko"]];

export function mockTrack(title, addedBy) {
  const song = SONGS.find((candidate) => candidate.title === title);
  return {
    audioKey: audioKeyOf(song),
    uri: `https://mock.invalid/watch?v=${song.title}`,
    source: "youtube",
    title: song.title,
    artist: song.artist,
    artworkUrl: null,
    durationMs: song.len * 1000,
    addedBy,
  };
}

const member = (player) => ({ avatarUrl: null, loaded: false, spectator: false, watching: false, submitted: false, modifiers: [], ...player });

// The vote the way the bot counts it (helpers/mewbeat/rooms.js tallyOf): the players, i.e. not the watchers, and more
// than half of them. The snapshot carries the tally next to the members' own flags.
export function withTally(room) {
  const players = room.members.filter((m) => !m.spectator);
  return { ...room, votes: players.filter((m) => m.ready).length, votesNeeded: players.length ? Math.floor(players.length / 2) + 1 : 0 };
}

// The final countdown to the next round: `clockMs` from `now`, started by a passed vote or, with `forced`, by the host.
export function startCountdown(room, clockMs = FINAL_COUNTDOWN_MS, now = Date.now(), forced = false) {
  return { ...room, serverNow: now, nextAt: now + clockMs, finalCountdown: true, forced };
}

// Before the room's first round (`voting: false`) the clock is the bot's ready wait: nothing runs until someone is ready,
// the first Ready opens a long wait, and everyone being ready cuts it to the final seconds.
function settleReady(room, now = Date.now()) {
  const tallied = withTally(room);
  const players = tallied.members.filter((m) => !m.spectator).length;
  if (!tallied.queue.length || !players || !tallied.votes) {
    return { ...tallied, serverNow: now, windowAt: null, nextAt: null, finalCountdown: false, forced: false };
  }
  const windowAt = tallied.windowAt ?? now + READY_WINDOW_MS;
  if (tallied.votes === players) {
    const finalAt = tallied.finalCountdown && tallied.nextAt != null ? tallied.nextAt : Math.min(windowAt, now + FINAL_COUNTDOWN_MS);
    return { ...tallied, serverNow: now, windowAt, nextAt: finalAt, finalCountdown: true, forced: false };
  }
  return { ...tallied, serverNow: now, windowAt, nextAt: windowAt, finalCountdown: false, forced: false };
}

// The vote and its countdown cleared, which is the room right after a round has started; the preview puts the others'
// votes back so it can be run again.
export function clearCountdown(room, now = Date.now()) {
  const voted = new Set(PLAYERS.filter((p) => p.ready).map((p) => p.userId));
  const reset = withTally({ ...room, serverNow: now, windowAt: null, nextAt: null, finalCountdown: false, forced: false, members: room.members.map((m) => ({ ...m, ready: voted.has(m.userId) && !m.spectator })) });
  return reset.voting === false ? settleReady(reset, now) : reset;
}

// A lobby before the room's first round: four players, the owner among them and three songs queued. Two of the four are
// ready, which opened the long wait (`clockMs` long, the bot's 60 s by default); the other two cut it short by readying.
// hostId: who owns the room (the player themselves, or "kuba" to see it as a guest).
export function createMockRoom({ hostId = MOCK_USER_ID, clockMs = READY_WINDOW_MS, now = Date.now() } = {}) {
  return withTally({
    hostId,
    phase: "lobby",
    voting: false,
    round: 0,
    endedAt: null,
    members: PLAYERS.map(member),
    queue: START_QUEUE.map(([title, addedBy]) => mockTrack(title, addedBy)),
    played: QUEUEABLE.filter((title) => !START_QUEUE.some(([queued]) => queued === title)).slice(0, 2).map((title) => mockTrack(title, "neko")),
    current: null,
    startAt: null,
    windowAt: clockMs ? now + clockMs : null,
    nextAt: clockMs ? now + clockMs : null,
    finalCountdown: false,
    forced: false,
    results: [],
    serverNow: now,
  });
}

// The same room one round later: Hopes and Dreams has just ended, the others wait in the queue, and the standings are in.
// From here on Ready is the vote for the next map: two of the four have voted, one short of the majority, so nothing
// counts down.
export function createMockFinishedRoom({ hostId = MOCK_USER_ID, now = Date.now() } = {}) {
  const base = createMockRoom({ hostId, now });
  const [first, second, third] = base.queue;
  const rows = [
    ["kuba", "hard", 99.2, 701_400, "S", ["gn", "st"], false],
    [MOCK_USER_ID, "normal", 98.4, 641_900, "S", ["nf"], false],
    ["neko", "normal", 94.1, 512_300, "A", [], false],
    // Failed players sit under the ones that finished, as the server sorts them.
    ["ola", "easy", 91.7, 489_800, "A", ["ol", "mr"], true],
  ];
  return {
    ...base,
    phase: "lobby",
    voting: true,
    round: 1,
    endedAt: now - 4000,
    current: second,
    queue: [third, first],
    windowAt: null,
    nextAt: null,
    results: rows.map(([userId, difficulty, accuracy, score, grade, modifiers, failed]) => ({
      userId,
      username: base.members.find((m) => m.userId === userId).username,
      difficulty,
      accuracy,
      score,
      grade,
      failed,
      modifiers,
    })),
  };
}

const ok = (room) => ({ room, reply: { status: "ok" } });
const fail = (room, reason) => ({ room, reply: { status: "error", reason } });
const patchMember = (room, userId, patch) => ({ ...room, members: room.members.map((m) => (m.userId === userId ? { ...m, ...patch } : m)) });

// The vote after a change, as the bot settles it: a majority starts the final countdown, and a vote that drops back
// below one stops a countdown it started (a host's forced start stays).
function settleVote(room, now) {
  if (room.voting === false) return settleReady(room, now);
  const tallied = withTally(room);
  const passed = tallied.votesNeeded > 0 && tallied.votes >= tallied.votesNeeded && tallied.queue.length > 0;
  if (passed && !tallied.finalCountdown) return startCountdown(tallied, FINAL_COUNTDOWN_MS, now);
  if (!passed && tallied.finalCountdown && !tallied.forced) return { ...tallied, nextAt: null, finalCountdown: false };
  return tallied;
}

// store.ready({ ready } | { difficulty } | { spectate } | { modifiers }) for one player. A spectator never votes, and
// neither does anyone with no song queued to vote for.
export function applyReady(room, userId, change, now = Date.now()) {
  const me = room.members.find((m) => m.userId === userId);
  if (!me) return fail(room, "not_in_room");
  if ("difficulty" in change) {
    if (!["easy", "normal", "hard", "hell"].includes(change.difficulty)) return fail(room, "bad_difficulty");
    return ok(patchMember(room, userId, { difficulty: change.difficulty }));
  }
  if ("modifiers" in change) return ok(patchMember(room, userId, { modifiers: Array.isArray(change.modifiers) ? change.modifiers : [] }));
  if ("spectate" in change) {
    // Watching takes the vote back with it, so the others' count shrinks as well.
    const patch = change.spectate ? { watching: true, spectator: true, ready: false } : { watching: false, spectator: false };
    return ok(settleVote(patchMember(room, userId, patch), now));
  }
  if ("ready" in change) {
    if (me.watching) return fail(room, "spectating");
    if (change.ready && room.voting !== false && !room.queue.length) return fail(room, "empty_queue");
    return ok(settleVote(patchMember(room, userId, { ready: Boolean(change.ready) }), now));
  }
  return fail(room, "bad_request");
}

// The host's start. Before the first round it begins at once; after a round it needs no vote: the first press runs the
// final countdown even with no majority, the second skips what is left of it.
export function forceStart(room, userId, now = Date.now()) {
  if (room.hostId !== userId) return fail(room, "not_host");
  if (!room.queue.length) return fail(room, "empty_queue");
  if (room.voting === false || room.finalCountdown) return ok(startCountdown(room, 0, now, room.forced === true));
  return ok(startCountdown(room, FINAL_COUNTDOWN_MS, now, true));
}

// A new queue. The votes were for the song at the head, so when another song takes its place (or none is left) they
// are gone, and so is a countdown to the old head, as on the bot.
function afterQueueChange(room, queue) {
  const next = { ...room, queue };
  if (room.voting === false) return settleReady(next);
  if (queue[0]?.audioKey === room.queue[0]?.audioKey && queue.length) return next;
  return withTally({ ...next, nextAt: null, finalCountdown: false, forced: false, members: room.members.map((m) => ({ ...m, ready: false })) });
}

// The "Add songs" button: the next charted song nobody queued yet (then the list starts over).
export function addNextSong(room, userId) {
  if (room.queue.length >= MAX_QUEUE) return fail(room, "queue_full");
  const queued = new Set(room.queue.map((track) => track.title));
  const title = QUEUEABLE.find((candidate) => !queued.has(candidate)) ?? QUEUEABLE[room.queue.length % QUEUEABLE.length];
  return ok({ ...room, queue: [...room.queue, mockTrack(title, userId)] });
}

export function removeFromQueue(room, userId, index) {
  const track = room.queue[index];
  if (!track) return fail(room, "bad_index");
  if (room.hostId !== userId && track.addedBy !== userId) return fail(room, "forbidden");
  return ok(afterQueueChange(room, room.queue.filter((_, i) => i !== index)));
}

export function moveInQueue(room, userId, from, to) {
  if (room.hostId !== userId) return fail(room, "not_host");
  if (!room.queue[from] || !room.queue[to]) return fail(room, "bad_index");
  const queue = [...room.queue];
  queue.splice(to, 0, queue.splice(from, 1)[0]);
  return ok(afterQueueChange(room, queue));
}

// A full-combo run of Hopes and Dreams on Normal, as the Results screen gets it from the game.
const MOCK_PARTS = 820;
const MOCK_MISSES = [140, 141, 142, 143, 330, 331, 520, 700]; // a few dips in an otherwise clean run
const MOCK_PILE_UP = [380, 400]; // a lost run (and a No Fail one) misses everything between these notes

// A run the way the game logs it: judgements in time order and a FEVER started as soon as the bar is full, all played
// through scoring.js so the summary's numbers are the ones the results screen replays.
function mockRun({ durationMs, modifiers, pileUp }) {
  const events = [];
  const feverStarts = [];
  let state = createScore({ parts: MOCK_PARTS, modifiers });
  const span = durationMs - 6000;
  for (let n = 0; n < MOCK_PARTS && !isFailed(state); n += 1) {
    const t = Math.round(3000 + (n / MOCK_PARTS) * span);
    const piled = pileUp && n >= MOCK_PILE_UP[0] && n < MOCK_PILE_UP[1];
    const j = piled || (!pileUp && MOCK_MISSES.includes(n)) ? "miss" : n % 97 === 0 ? "good" : n % 9 === 0 ? "great" : "perfect";
    events.push({ n, part: "head", j, t });
    state = applyJudgement(state, j, t, "head");
    // One ms after the judgement, as the replay applies a FEVER start before the judgement at the same instant.
    if (canFever(state, t + 1)) {
      state = startFever(state, t + 1);
      feverStarts.push(t + 1);
    }
  }
  return { events, feverStarts, state };
}

// variant: { failed } a run lost to a pile-up of misses, { nf } a No Fail run whose health ran out and played on.
export function createMockSummary({ failed = false, nf = false } = {}) {
  const track = mockTrack("Hopes and Dreams", MOCK_USER_ID);
  const modifiers = nf ? ["nf"] : ["gn", "st"];
  const { events, feverStarts, state } = mockRun({ durationMs: track.durationMs, modifiers, pileUp: failed || nf });
  const accuracy = accuracyOf(state.counts);
  // Deterministic and bell-shaped, so the timing histogram looks like a real run: a little late on average.
  const hitErrors = Array.from({ length: 820 }, (_, i) => Math.round(5 + 18 * (Math.sin(i * 12.9898) + Math.sin(i * 78.233) + Math.sin(i * 37.719)) / 1.6));
  return {
    id: "mock-run",
    finished: true,
    autoplay: false,
    calibration: false,
    skipped: 0,
    difficultyChanged: false,
    title: track.title,
    artist: track.artist,
    artworkUrl: null,
    audioKey: track.audioKey,
    difficulty: "normal",
    grade: gradeOf(accuracy),
    score: state.score,
    accuracy,
    maxCombo: state.maxCombo,
    fevers: state.fevers,
    counts: state.counts,
    hitErrors,
    offsetMs: 0,
    events,
    feverStarts,
    parts: MOCK_PARTS,
    durationMs: track.durationMs,
    modifiers,
    modMult: state.modMult,
    failed: isFailed(state),
    failedAt: state.failedAt,
    depleted: state.depletedAt !== null,
    submit: failed
      ? { status: "skipped" }
      : { status: "ok", result: { ranked: true, newBest: !nf, rank: { server: 2, global: 3 }, best: { score: state.score, grade: gradeOf(accuracy) } } },
  };
}
