// A believable room for the lobby preview (?mock=1&lobby=1, dev server only). Everything here is pure: a snapshot in
// the shape helpers/mewbeat/rooms.js sends, and the few changes the lobby's controls make to it. MockLobby.jsx holds
// the state and the clock.

import { audioKeyOf, MOCK_USER_ID, SONGS } from "./mockRequests.js";

export const ROUND_CLOCK_MS = 30_000; // how long the mock round clock runs before it starts over
export const MAX_QUEUE = 20;

const ME = { userId: MOCK_USER_ID, username: "Meowczelloo" };
const PLAYERS = [
  { userId: "kuba", username: "kuba", difficulty: "hard", ready: true },
  { ...ME, difficulty: "normal", ready: false },
  { userId: "neko", username: "neko", difficulty: "normal", ready: true },
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

const member = (player) => ({ avatarUrl: null, loaded: false, spectator: false, watching: false, submitted: false, ...player });

// A lobby with four players, the owner among them, three songs queued and the round clock running.
// hostId: who owns the room (the player themselves, or "kuba" to see it as a guest). clockMs: time left on the clock.
export function createMockRoom({ hostId = MOCK_USER_ID, clockMs = ROUND_CLOCK_MS, now = Date.now() } = {}) {
  return {
    hostId,
    phase: "lobby",
    round: 0,
    endedAt: null,
    members: PLAYERS.map(member),
    queue: START_QUEUE.map(([title, addedBy]) => mockTrack(title, addedBy)),
    played: QUEUEABLE.filter((title) => !START_QUEUE.some(([queued]) => queued === title)).slice(0, 2).map((title) => mockTrack(title, "neko")),
    current: null,
    startAt: null,
    nextAt: now + clockMs,
    results: [],
    serverNow: now,
  };
}

// The same room one round later: Hopes and Dreams has just ended, the others wait in the queue, and the standings are in.
export function createMockFinishedRoom({ hostId = MOCK_USER_ID, now = Date.now() } = {}) {
  const base = createMockRoom({ hostId, now });
  const [first, second, third] = base.queue;
  const rows = [
    ["kuba", "hard", 99.2, 701_400, "S"],
    [MOCK_USER_ID, "normal", 98.4, 641_900, "S"],
    ["neko", "normal", 94.1, 512_300, "A"],
    ["ola", "easy", 91.7, 489_800, "A"],
  ];
  return {
    ...base,
    phase: "intermission",
    round: 1,
    endedAt: now - 4000,
    current: second,
    queue: [third, first],
    nextAt: null,
    results: rows.map(([userId, difficulty, accuracy, score, grade]) => ({
      userId,
      username: base.members.find((m) => m.userId === userId).username,
      difficulty,
      accuracy,
      score,
      grade,
    })),
  };
}

// The same room with the round clock set to run out in `clockMs` from `now`.
export function restartClock(room, clockMs, now = Date.now()) {
  return { ...room, serverNow: now, nextAt: now + clockMs };
}

const ok = (room) => ({ room, reply: { status: "ok" } });
const fail = (room, reason) => ({ room, reply: { status: "error", reason } });
const patchMember = (room, userId, patch) => ({ ...room, members: room.members.map((m) => (m.userId === userId ? { ...m, ...patch } : m)) });

// store.ready({ ready } | { difficulty } | { spectate }) for one player. A spectator is never ready.
export function applyReady(room, userId, change) {
  const me = room.members.find((m) => m.userId === userId);
  if (!me) return fail(room, "not_in_room");
  if ("difficulty" in change) {
    if (!["easy", "normal", "hard", "hell"].includes(change.difficulty)) return fail(room, "bad_difficulty");
    return ok(patchMember(room, userId, { difficulty: change.difficulty }));
  }
  if ("spectate" in change) return ok(patchMember(room, userId, change.spectate ? { watching: true, ready: false } : { watching: false }));
  if ("ready" in change) {
    if (me.watching) return fail(room, "spectator");
    return ok(patchMember(room, userId, { ready: Boolean(change.ready) }));
  }
  return fail(room, "bad_request");
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
  return ok({ ...room, queue: room.queue.filter((_, i) => i !== index) });
}

export function moveInQueue(room, userId, from, to) {
  if (room.hostId !== userId) return fail(room, "not_host");
  if (!room.queue[from] || !room.queue[to]) return fail(room, "bad_index");
  const queue = [...room.queue];
  queue.splice(to, 0, queue.splice(from, 1)[0]);
  return ok({ ...room, queue });
}

// A full-combo run of Hopes and Dreams on Normal, as the Results screen gets it from the game.
export function createMockSummary() {
  const track = mockTrack("Hopes and Dreams", MOCK_USER_ID);
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
    grade: "S",
    score: 641_900,
    accuracy: 98.4,
    maxCombo: 820,
    fevers: 7,
    counts: { perfect: 702, great: 118, good: 0, miss: 0 },
    hitErrors,
    offsetMs: 0,
    submit: {
      status: "ok",
      result: { ranked: true, newBest: true, rank: { server: 2, global: 3 }, best: { score: 641_900, grade: "S" } },
    },
  };
}
