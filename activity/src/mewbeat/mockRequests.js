// Fake replies for the song select, so it can be looked at in a browser with no bot (?mock=1&select=1, dev
// server only). The shapes are the ones helpers/mewbeat/activityChannel.js answers; the songs and numbers are
// the ones of docs/superpowers/specs/mewbeat-mockups/song-select-profile.html.
//
// Two ids are there to show the awkward states: "new-player" has no rounds at all (zeros, stats null) and
// "missing" is somebody the bot has never seen (not_found). Both sit in the ranking so they can be clicked.

export const MOCK_USER_ID = "mock-me";
export const NEW_PLAYER_ID = "new-player";
export const MISSING_PLAYER_ID = "missing";

const LATENCY_MS = 80; // long enough to see the loading state, short enough not to be in the way
const LEVELS = ["easy", "normal", "hard", "hell"];
const NOTES = { easy: 420, normal: 780, hard: 1240, hell: 1810 };
const FIRST_AT = Date.UTC(2026, 9, 12);
const NOW = Date.UTC(2026, 10, 9);

// stars and the player's best grade per level (easy, normal, hard, hell); bpm and stars null are an uncharted song.
export const SONGS = [
  { title: "MEGALOVANIA", artist: "Toby Fox", len: 156, bpm: 240, stars: [2.4, 4.1, 5.8, 7.3], grades: ["S", "A", "C", null], plays: [3, 5, 2, 0] },
  { title: "Hopes and Dreams", artist: "Toby Fox", len: 185, bpm: 170, stars: [2.1, 3.8, 5.2, 6.9], grades: ["S", "S", "B", null], plays: [2, 4, 3, 0] },
  { title: "MORE", artist: "K/DA", len: 217, bpm: 115, stars: [1.9, 3.4, 4.7, 6.2], grades: [null, "B", null, null], plays: [0, 2, 0, 0] },
  { title: "Five Nights at Freddy's 2 Song", artist: "The Living Tombstone", len: 180, bpm: 125, stars: [1.7, 3.2, 4.4, 5.7], grades: ["A", "A", null, null], plays: [2, 3, 0, 0] },
  { title: "Rude Buster", artist: "Toby Fox", len: 131, bpm: 133, stars: [1.6, 3.0, 4.3, 5.5], grades: [null, "S", "A", "D"], plays: [0, 2, 2, 1] },
  { title: "Coffin Dance", artist: "Vicetone", len: 152, bpm: 128, stars: [1.5, 2.8, 4.0, 5.1], grades: [null, null, null, null], plays: [0, 0, 0, 0] },
  { title: "REVOLVANIA", artist: "NyxTheShield", len: 192, bpm: 190, stars: [2.0, 2.7, 5.0, 6.5], grades: ["B", null, null, null], plays: [1, 0, 0, 0] },
  { title: "GHOST", artist: "Camellia", len: 260, bpm: 174, stars: [1.3, 2.5, 3.9, 5.3], grades: [null, "C", null, null], plays: [0, 1, 0, 0] },
  // Played in a server but never charted: no stars, no tempo, no scores.
  { title: "Bad Apple!! (live cut)", artist: "Alstroemeria Records", len: 219, bpm: null, stars: null, grades: [null, null, null, null], plays: [0, 0, 0, 0] },
];
// Songs only other servers have played; they come up under "Everywhere" and "Played by you".
const ELSEWHERE = new Set(["REVOLVANIA"]);
const SCORE_BY_GRADE = { S: 641_900, A: 512_300, B: 441_000, C: 318_400, D: 201_900 };
const ACCURACY_BY_GRADE = { S: 98.4, A: 94.2, B: 87.6, C: 77.3, D: 68.1 };

const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
export const audioKeyOf = (song) => `mock:${slug(song.title)}:${song.len * 1000}`;

// name, rating, global rank, server rank, average accuracy
const PEOPLE = {
  [MOCK_USER_ID]: { username: "Meowczelloo", pp: 1248, global: 2, server: 8, accuracy: 86.4 },
  shiro: { username: "shiro", pp: 2104, global: 1, server: null, accuracy: 95.2 },
  kuba: { username: "kuba", pp: 1190, global: 3, server: 1, accuracy: 89.0 },
  vex: { username: "vex", pp: 1003, global: 4, server: null, accuracy: 90.7 },
  neko: { username: "neko", pp: 874, global: 5, server: 2, accuracy: 84.3 },
  luna: { username: "luna", pp: 716, global: 6, server: null, accuracy: 88.1 },
  ola: { username: "ola", pp: 602, global: 7, server: 3, accuracy: 81.9 },
  dawid: { username: "dawid", pp: 455, global: 8, server: 4, accuracy: 79.4 },
  tomek: { username: "tomek", pp: 398, global: 9, server: 5, accuracy: 77.0 },
};
const NEW_PLAYER_NAME = "Nova";
const GHOST_NAME = "Ghost";

const playerOf = (userId) => ({ userId, username: PEOPLE[userId]?.username ?? NEW_PLAYER_NAME, avatarUrl: null, firstAt: userId === NEW_PLAYER_ID ? null : FIRST_AT });

function playedTrack(song) {
  const stars = song.stars ? Object.fromEntries(LEVELS.map((level, i) => [level, song.stars[i]])) : null;
  const bests = {};
  LEVELS.forEach((level, i) => {
    const grade = song.grades[i];
    if (grade) bests[level] = { score: SCORE_BY_GRADE[grade], grade };
  });
  return {
    audioKey: audioKeyOf(song),
    uri: `https://mock.invalid/watch?v=${slug(song.title)}`,
    source: "youtube",
    title: song.title,
    artist: song.artist,
    artworkUrl: null,
    durationMs: song.len * 1000,
    plays: song.plays.reduce((sum, n) => sum + n, 0),
    playsBy: Object.fromEntries(LEVELS.map((level, i) => [level, song.plays[i]])),
    lastAt: NOW,
    stars,
    notes: stars ? NOTES : {},
    bests,
    highlightMs: song.bpm ? 45_000 : null,
    bpm: song.bpm,
  };
}

function played({ scope }) {
  const mine = SONGS.filter((song) => song.grades.some(Boolean));
  const rows = scope === "mine" ? mine : scope === "global" ? SONGS : SONGS.filter((song) => !ELSEWHERE.has(song.title));
  return { tracks: rows.map(playedTrack) };
}

// Scores on one level: the same people on every level, each a little lower than the one before.
const BOARD_PEOPLE = {
  server: [MOCK_USER_ID, "kuba", "neko", "dawid", "ola"],
  global: ["shiro", "kuba", "vex", "luna", "neko", "ola", "tomek"],
};
const PINNED_GLOBAL_RANK = 12;
const GRADE_BY_PLACE = ["S", "A", "A", "B", "B", "C", "C"];

// A few board rows were played with modifiers, so the tags can be checked.
const MODIFIERS_BY_PLACE = [["gn", "st"], [], ["nf"], ["fs"], [], ["mr", "st"]];

function scoreRow(userId, place, top) {
  return {
    userId,
    username: PEOPLE[userId].username,
    avatarUrl: null,
    score: Math.round(top - place * 41_000),
    accuracy: Math.round((98.4 - place * 2.2) * 100) / 100,
    grade: GRADE_BY_PLACE[place] ?? "D",
    maxCombo: 812 - place * 60,
    modifiers: MODIFIERS_BY_PLACE[place] ?? [],
    at: NOW,
  };
}

function board({ audioKey, difficulty, scope }) {
  const song = SONGS.find((candidate) => audioKeyOf(candidate) === audioKey);
  const level = LEVELS.indexOf(difficulty);
  if (!song || level < 0 || !song.stars) return { entries: [], own: { rank: null, best: null } };
  const top = 640_000 - level * 20_000;
  const played = Boolean(song.grades[level]);
  const ids = BOARD_PEOPLE[scope === "global" ? "global" : "server"].filter((userId) => played || userId !== MOCK_USER_ID);
  const entries = ids.map((userId, place) => scoreRow(userId, place, top));
  const shown = entries.findIndex((entry) => entry.userId === MOCK_USER_ID);
  if (shown >= 0) return { entries, own: { rank: shown + 1, best: entries[shown] } };
  // On the global board you are further down than the rows shown, so the pinned row comes up.
  return { entries, own: played ? { rank: PINNED_GLOBAL_RANK, best: scoreRow(MOCK_USER_ID, entries.length, top) } : { rank: null, best: null } };
}

const RECENT_ORDER = [0, 4, 2, 3, 7, 1];
function recentPlay(song, i) {
  const level = song.grades.findIndex(Boolean);
  const grade = song.grades[level] ?? "D";
  return {
    audioKey: audioKeyOf(song),
    title: song.title,
    artist: song.artist,
    artworkUrl: null,
    difficulty: LEVELS[Math.max(0, level)],
    grade,
    accuracy: Math.round((ACCURACY_BY_GRADE[grade] - i * 0.7) * 100) / 100,
    score: SCORE_BY_GRADE[grade] - i * 9_000,
    at: NOW - i * 3_600_000,
  };
}

function bestPlay(song, i) {
  const level = Math.max(0, song.grades.findIndex(Boolean));
  const grade = song.grades[level] ?? "D";
  return {
    audioKey: audioKeyOf(song),
    title: song.title,
    artist: song.artist,
    artworkUrl: null,
    difficulty: LEVELS[level],
    stars: song.stars?.[level] ?? null,
    grade,
    accuracy: ACCURACY_BY_GRADE[grade],
    pp: 312 - i * 31,
  };
}

function profile({ userId = MOCK_USER_ID }) {
  if (userId === MISSING_PLAYER_ID) return { status: "error", reason: "not_found" };
  const base = { status: "ok", player: playerOf(userId) };
  if (userId === NEW_PLAYER_ID) {
    return {
      ...base,
      rating: { pp: 0, global: null, server: null },
      summary: { plays: 0, avgAccuracy: 0, songs: 0, playMs: 0, bestGrades: { S: 0, A: 0, B: 0, C: 0, D: 0 } },
      recent: [],
      best: [],
    };
  }
  const person = PEOPLE[userId] ?? PEOPLE[MOCK_USER_ID];
  const charted = SONGS.filter((song) => song.grades.some(Boolean));
  return {
    ...base,
    rating: { pp: person.pp, global: person.global, server: person.server },
    summary: { plays: 312, avgAccuracy: person.accuracy, songs: 48, playMs: 11 * 3_600_000 + 40 * 60_000, bestGrades: { S: 9, A: 21, B: 34, C: 19, D: 6 } },
    recent: RECENT_ORDER.map((index, i) => recentPlay(SONGS[index], i)),
    best: charted.slice(0, 6).map(bestPlay),
  };
}

function stats({ userId = MOCK_USER_ID }) {
  if (userId === MISSING_PLAYER_ID) return { status: "error", reason: "not_found" };
  const base = { status: "ok", player: playerOf(userId) };
  if (userId === NEW_PLAYER_ID) return { ...base, stats: null };
  const person = PEOPLE[userId] ?? PEOPLE[MOCK_USER_ID];
  const maps = [
    ["Rude Buster", "normal", 812, 812], ["Hopes and Dreams", "normal", 744, 1020], ["MEGALOVANIA", "normal", 689, 1204],
    ["Five Nights at Freddy's 2 Song", "easy", 512, 512], ["MORE", "normal", 366, 884],
  ].map(([title, difficulty, maxCombo, parts]) => {
    const song = SONGS.find((candidate) => candidate.title === title);
    return { audioKey: audioKeyOf(song), difficulty, title, maxCombo, parts, fullCombo: maxCombo === parts };
  });
  return {
    ...base,
    stats: {
      username: person.username,
      avatarUrl: null,
      firstAt: FIRST_AT,
      plays: 312,
      avgAccuracy: person.accuracy,
      songs: 48,
      playMs: 11 * 3_600_000 + 40 * 60_000,
      counts: { perfect: 184_210, great: 48_930, good: 15_204, miss: 10_346 },
      presses: 291_402,
      emptyPresses: 32_712,
      holdMs: 72 * 60_000,
      longestHoldMs: 14_200,
      fevers: 486,
      fullCombos: 14,
      timing: { meanMs: 6, spreadMs: 18, earlyShare: 0.38, lateShare: 0.62 },
      bestCombo: { value: 812, title: "Rude Buster" },
      maps,
    },
  };
}

// Everyone by rating. The two awkward ids close the list so they can be clicked.
const RATED = [
  [MOCK_USER_ID, 1248], ["shiro", 2104], ["kuba", 1190], ["vex", 1003], ["neko", 874], ["luna", 716], ["ola", 602], ["dawid", 455], ["tomek", 398],
];
const SERVER_RANKED = ["kuba", "neko", "ola", "dawid", "tomek"];

function ranking({ scope }) {
  // Sorted here, not at the top of the module, so that the module has no call left when nothing uses it.
  const ids = scope === "server" ? SERVER_RANKED : [...RATED].sort((a, b) => b[1] - a[1]).map(([userId]) => userId);
  const entries = ids.map((userId, index) => ({
    rank: index + 1,
    userId,
    username: PEOPLE[userId].username,
    avatarUrl: null,
    pp: PEOPLE[userId].pp,
    accuracy: PEOPLE[userId].accuracy,
  }));
  entries.push(
    { rank: entries.length + 1, userId: NEW_PLAYER_ID, username: NEW_PLAYER_NAME, avatarUrl: null, pp: 0, accuracy: 0 },
    { rank: entries.length + 2, userId: MISSING_PLAYER_ID, username: GHOST_NAME, avatarUrl: null, pp: 0, accuracy: 0 },
  );
  const me = PEOPLE[MOCK_USER_ID];
  const shown = entries.some((entry) => entry.userId === MOCK_USER_ID);
  // On the server list you are not among the rows, so the pinned row comes up under them.
  return {
    status: "ok",
    entries,
    own: { rank: shown ? entries.find((entry) => entry.userId === MOCK_USER_ID).rank : me.server, pp: me.pp, username: me.username, avatarUrl: null, accuracy: me.accuracy },
  };
}

// The four levels of one song, as the room lobby's tiles want them: stars, notes and the player's best.
// The uncharted song (queued in the lobby with &charting=1) is being charted: no stats and a queue until CHART_MS has passed.
function songStats({ audioKey }) {
  const song = SONGS.find((candidate) => audioKeyOf(candidate) === audioKey);
  if (!song) return { status: "ok", stats: null };
  if (!song.stars) {
    const elapsed = mockElapsed(audioKey);
    return elapsed < CHART_MS ? { status: "ok", stats: null, queue: mockQueueAt(elapsed) } : { status: "ok", stats: chartedStats() };
  }
  const stats = Object.fromEntries(LEVELS.map((level, i) => {
    const grade = song.grades[i];
    return [level, { stars: song.stars[i], notes: NOTES[level], best: grade ? { score: SCORE_BY_GRADE[grade], grade } : null }];
  }));
  return { status: "ok", stats };
}

// The runs a map report can name, newest first: twelve rounds spread over the charted songs, each at a different level.
// Their times follow the clock so the "ago" in the list reads like a real evening of play.
function reportRuns() {
  const charted = SONGS.filter((song) => song.stars);
  const runs = Array.from({ length: 12 }, (_, i) => {
    const song = charted[i % charted.length];
    const level = (i * 2 + 1) % LEVELS.length;
    const grade = ["S", "A", "B", "C", "D"][i % 5];
    return {
      audioKey: audioKeyOf(song),
      difficulty: LEVELS[level],
      at: Date.now() - (i + 1) * 47 * 60_000 - i * i * 3_600_000,
      title: song.title,
      artist: song.artist,
      grade,
      accuracy: Math.round((ACCURACY_BY_GRADE[grade] - i * 0.3) * 100) / 100,
    };
  });
  return { status: "ok", runs };
}

// "Chart this map" on the uncharted song: the first ask queues it, and it is ready CHART_MS later (so a few polls see
// "queued"). The charted stars are the ones the mock hands out for it from then on; reset it with resetMockCharting().
// While it waits, the replies carry the `queue` the bot sends (see chartStore.queueOf), stepping through two songs ahead,
// one ahead, then the three steps of its own job, a few seconds each: every 4 s poll of song select shows a new line.
const CHART_MS = 19000;
const QUEUE_STEPS = [
  [3500, { step: "analysis", ahead: 2, running: false }],
  [7500, { step: "analysis", ahead: 1, running: false }],
  [11000, { step: "analysis", ahead: 0, running: true }],
  [15000, { step: "melody", ahead: 0, running: true }],
  [CHART_MS, { step: "charts", ahead: 0, running: true }],
];
export function mockQueueAt(elapsedMs) {
  const [, queue] = QUEUE_STEPS.find(([until]) => elapsedMs < until) ?? QUEUE_STEPS[QUEUE_STEPS.length - 1];
  return { ...queue };
}
const CHARTED_STARS = [1.4, 2.6, 3.8, 5.0];
const chartingSince = new Map(); // audioKey -> when the first ask came

export function resetMockCharting() {
  chartingSince.clear();
}

// Time since the first ask for the song (which starts the clock).
function mockElapsed(key) {
  const since = chartingSince.get(key) ?? Date.now();
  chartingSince.set(key, since);
  return Date.now() - since;
}

const chartedStats = () => Object.fromEntries(LEVELS.map((level, i) => [level, { stars: CHARTED_STARS[i], notes: NOTES[level], best: null }]));

function chartMap({ audioKey, uri }) {
  const song = SONGS.find((candidate) => audioKeyOf(candidate) === audioKey || `https://mock.invalid/watch?v=${slug(candidate.title)}` === uri);
  if (!song) return { status: "error", reason: "not_found" };
  const key = audioKeyOf(song);
  if (song.stars) return { status: "ok", state: "ready", audioKey: key, stats: songStats({ audioKey: key }).stats };
  const elapsed = mockElapsed(key);
  if (elapsed < CHART_MS) return { status: "ok", state: "queued", audioKey: key, queue: mockQueueAt(elapsed) };
  return { status: "ok", state: "ready", audioKey: key, stats: chartedStats() };
}

// Suggestions (mewbeat_recs): one section of each kind, from the sample songs and a few that nobody charted. The
// shapes are the ones recommendations.js builds and activityChannel.js decorates; pending stays false.
const UNCHARTED = [
  { title: "Bury the Light", artist: "Casey Edwards", len: 233 },
  { title: "Bad Apple!!", artist: "Alstroemeria Records", len: 219 },
  { title: "Butterfly", artist: "Smile.dk", len: 183 },
  { title: "Through the Fire and Flames", artist: "DragonForce", len: 442 },
];

function suggestion(song, extra) {
  const charted = SONGS.find((candidate) => candidate.title === song.title);
  const base = charted ? playedTrack(charted) : { audioKey: audioKeyOf(song), uri: `https://mock.invalid/watch?v=${slug(song.title)}`, source: "youtube", title: song.title, artist: song.artist, artworkUrl: null, durationMs: song.len * 1000, stars: null, notes: {}, bests: {}, highlightMs: null, bpm: null };
  const { audioKey, uri, source, title, artist, artworkUrl, durationMs, stars, notes, bests, highlightMs, bpm } = base;
  return { audioKey, uri, source, title, artist, artworkUrl, durationMs, stars, notes, bests: extra.kind === "again" ? bests : {}, highlightMs, bpm, playIssue: null, played: false, levelStars: null, ...extra };
}

function recs({ seedKey } = {}) {
  const byTitle = (title) => SONGS.find((song) => song.title === title);
  const stepUp = suggestion(byTitle("Rude Buster"), { kind: "again", reason: "S on Normal, try Hard", level: "hard", levelStars: 4.3 });
  const retry = suggestion(byTitle("MEGALOVANIA"), { kind: "again", reason: "78% on Hard, one more go", level: "hard", levelStars: 5.8 });
  const similar = [
    suggestion(UNCHARTED[0], { kind: "similar", reason: "Because you just played MEGALOVANIA", level: null }),
    suggestion(UNCHARTED[3], { kind: "similar", reason: "Because you did well on Rude Buster", level: null }),
  ];
  const here = [suggestion(byTitle("Coffin Dance"), { kind: "here", reason: "Played 4 times by others here", level: "normal", levelStars: 2.8 })];
  const classic = [UNCHARTED[1], UNCHARTED[2]].map((song) => suggestion(song, { kind: "classic", reason: song.title === "Butterfly" ? "From Dance Dance Revolution" : "From Touhou", level: null }));
  const sections = [
    { kind: "similar", title: "Like what you play", rows: similar },
    { kind: "again", title: "Worth another go", rows: [stepUp, retry] },
    { kind: "here", title: "Played here", rows: here },
    { kind: "classic", title: "Rhythm game classics", rows: classic },
  ];
  const strip = [similar[0], stepUp, here[0], classic[0]].filter((row) => row.audioKey !== seedKey);
  const without = (rows) => rows.filter((row) => row.audioKey !== seedKey);
  return { status: "ok", sections: sections.map((section) => ({ ...section, rows: without(section.rows) })), strip, pending: false, skill: { stars: 5.2, basis: "good" } };
}

const ANSWERS = {
  mewbeat_recs: recs,
  mewbeat_chart_map: chartMap,
  mewbeat_song_stats: songStats,
  mewbeat_played: played,
  mewbeat_board: board,
  mewbeat_profile: profile,
  mewbeat_stats: stats,
  mewbeat_ranking: ranking,
  mewbeat_report_runs: reportRuns,
};

// request(type, body) -> a promise of the reply, like createMewbeatRequests().request without the socket.
export function createMockRequest() {
  return (type, body = {}) => new Promise((resolve) => {
    const answer = ANSWERS[type];
    const reply = answer ? { type, id: "mock", ...answer(body) } : { type, id: "mock", status: "error", reason: "unknown" };
    setTimeout(() => resolve(reply), LATENCY_MS);
  });
}
