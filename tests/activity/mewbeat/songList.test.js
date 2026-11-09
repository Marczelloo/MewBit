const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let arrangeRows;

test.before(async () => {
  ({ arrangeRows } = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/songList.js")).href));
});

// The input order is "recent": a is the last song played.
const ROWS = [
  { key: "a", title: "banana", durationMs: 180_000, bpm: 120, stars: { hard: 5.0 }, playsBy: { hard: 2 }, bests: { hard: { grade: "A" } } },
  { key: "b", title: "Apple", durationMs: 120_000, bpm: null, stars: { hard: null }, playsBy: {}, bests: {} },
  { key: "c", title: "cherry", durationMs: 240_000, bpm: 160, stars: { hard: 3.5 }, playsBy: { hard: 7 }, bests: { hard: { grade: "S" } } },
  { key: "d", title: "Date", durationMs: 0, bpm: null, stars: null, bests: {} },
  { key: "e", title: "elder", durationMs: 120_000, bpm: 90, stars: { hard: 5.0 }, playsBy: { hard: 2 }, bests: {} },
];
const keys = (rows) => rows.map((row) => row.key).join("");
const arrange = (options) => keys(arrangeRows(ROWS, { sort: "recent", level: "hard", direction: "desc", filter: "all", ...options }));

test("recent keeps the order the server sent, and asc reverses it", () => {
  assert.equal(arrange({}), "abcde");
  assert.equal(arrange({ direction: "asc" }), "edcba");
});

test("stars on a level keep rows without stars last in both directions", () => {
  assert.equal(arrange({ sort: "stars" }), "aecbd");
  assert.equal(arrange({ sort: "stars", direction: "asc" }), "caebd");
});

test("bpm keeps rows without a bpm last in both directions", () => {
  assert.equal(arrange({ sort: "bpm" }), "caebd");
  assert.equal(arrange({ sort: "bpm", direction: "asc" }), "eacbd");
});

test("length puts rows without a length last", () => {
  assert.equal(arrange({ sort: "length" }), "cabed");
  assert.equal(arrange({ sort: "length", direction: "asc" }), "beacd");
});

test("plays counts the chosen level, and a missing count as 0", () => {
  assert.equal(arrange({ sort: "plays" }), "caebd");
  assert.equal(arrange({ sort: "plays", direction: "asc" }), "bdaec");
  assert.equal(arrange({ sort: "plays", level: "easy" }), "abcde");
});

test("title compares without regard to case", () => {
  assert.equal(arrange({ sort: "title", direction: "asc" }), "bacde");
  assert.equal(arrange({ sort: "title" }), "edcab");
});

test("filter played keeps rows with a best on the level, unplayed the others", () => {
  assert.equal(arrange({ filter: "played" }), "ac");
  assert.equal(arrange({ filter: "unplayed" }), "bde");
  assert.equal(arrange({ filter: "all" }), "abcde");
  assert.equal(arrange({ filter: "played", level: "easy" }), "");
});

test("filter and sort work together", () => {
  assert.equal(arrange({ filter: "unplayed", sort: "stars" }), "ebd");
});

test("the input array is not mutated", () => {
  const before = keys(ROWS);
  arrangeRows(ROWS, { sort: "title", level: "hard", direction: "asc", filter: "played" });
  assert.equal(keys(ROWS), before);
});
