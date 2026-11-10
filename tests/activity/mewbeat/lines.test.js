const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let lines;

test.before(async () => {
  lines = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/mewbit/lines.js")).href);
});

const MOMENTS = [
  "combo", "miss", "crushed", "fever", "charting", "lobby", "count",
  "gradeS", "gradeA", "gradeB", "gradeC", "gradeD", "failed", "fullCombo", "newBest",
  "vibe", "trap", "reveal", "wink",
];
// Pools shown while notes are falling: short enough to read at a glance.
const PLAY_TIME = ["combo", "miss", "crushed", "fever", "charting", "count", "vibe"];
const SINGLE = ["reveal", "wink"];

// Every line Mewbit said before the pools existed, per moment; they must all still be in there, character for character.
const CURRENT = {
  vibe: ["nyaa~!", "wooo!!", "SUGOI!!"],
  combo: ["KIRA KIRA~!", "SUGOOOI!!", "KAMI!!! ✦"],
  miss: ["eep!"],
  crushed: ["mou~"],
  fever: ["FEVER!!! ✦"],
  charting: ["charting…"],
  count: ["nyaa~ ✦"],
  lobby: ["waiting for my song~", "warming up the paws…", "*adjusts headphones*"],
  gradeS: ["S rank?! you're cracked!!"],
  gradeA: ["great run!"],
  gradeB: ["nice one~"],
  gradeC: ["not bad!"],
  gradeD: ["nyoo… next time!"],
  newBest: ["NEW BEST!! ✦"],
  reveal: ["you found me!"],
  wink: ["you know the code ✦"],
};

const words = (line) => lines.lineParts(line).map((part) => part.text).join("").split(/\s+/).filter(Boolean);

// A small deterministic generator, so a failure can be replayed.
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

test("LINES has exactly the moments we decided on", () => {
  assert.deepEqual(Object.keys(lines.LINES).sort(), [...MOMENTS].sort());
});

test("every current line is still in its pool, verbatim", () => {
  for (const [moment, list] of Object.entries(CURRENT)) {
    for (const line of list) assert.ok(lines.LINES[moment].includes(line), `${moment} lost "${line}"`);
  }
});

test("pools hold 6 to 10 distinct lines, except the single-line ones", () => {
  for (const moment of MOMENTS) {
    const pool = lines.LINES[moment];
    assert.equal(new Set(pool).size, pool.length, `${moment} has a duplicate`);
    if (SINGLE.includes(moment)) assert.equal(pool.length, 1, `${moment} is a single line`);
    else assert.ok(pool.length >= 6 && pool.length <= 10, `${moment} has ${pool.length} lines`);
  }
});

test("lines shown while notes fall are at most 6 words (markers do not count)", () => {
  for (const moment of PLAY_TIME) {
    for (const line of lines.LINES[moment]) assert.ok(words(line).length <= 6, `${moment}: "${line}" is ${words(line).length} words`);
  }
});

test("miss lines are at most 3 words, since the pose is gone in 600 ms", () => {
  for (const line of lines.LINES.miss) assert.ok(words(line).length <= 3, `miss: "${line}" is ${words(line).length} words`);
});

test("combo and vibe lines state no number, since one pool serves several milestones", () => {
  for (const moment of ["combo", "vibe", "fever"]) {
    for (const line of lines.LINES[moment]) assert.doesNotMatch(line, /\d/, `${moment}: "${line}"`);
  }
});

test("markers are balanced, wrap one word, and sit on a minority of the lines", () => {
  let marked = 0;
  let total = 0;
  for (const moment of MOMENTS) {
    for (const line of lines.LINES[moment]) {
      total += 1;
      const parts = lines.lineParts(line);
      assert.equal(parts.map((part) => part.text).join("").match(/[[\]{}]/), null, `stray marker in "${line}"`);
      for (const part of parts.filter((p) => p.tone)) assert.equal(part.text.split(/\s+/).length, 1, `"${part.text}" is not one word in "${line}"`);
      if (parts.some((part) => part.tone)) marked += 1;
    }
  }
  assert.ok(marked > 0, "some lines pick a word out");
  assert.ok(marked < total / 2, `${marked} of ${total} lines are marked`);
});

test("pickLine never gives the same line twice in a row, over 500 picks per moment", () => {
  for (const moment of MOMENTS.filter((m) => !SINGLE.includes(m))) {
    for (const random of [Math.random, seeded(7), () => 0, () => 0.999999]) {
      let previous = null;
      for (let i = 0; i < 500; i += 1) {
        const line = lines.pickLine(moment, random);
        assert.ok(lines.LINES[moment].includes(line), `${moment}: "${line}" is not in the pool`);
        assert.notEqual(line, previous, `${moment} repeated "${line}"`);
        previous = line;
      }
    }
  }
});

test("pickLine eventually uses every line of a pool", () => {
  for (const moment of ["combo", "gradeS", "lobby"]) {
    const random = seeded(42);
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) seen.add(lines.pickLine(moment, random));
    assert.equal(seen.size, lines.LINES[moment].length, `${moment} never showed some line`);
  }
});

test("a one-line pool returns its only line, every time, without looping", () => {
  for (const moment of SINGLE) {
    for (let i = 0; i < 20; i += 1) assert.equal(lines.pickLine(moment), lines.LINES[moment][0]);
  }
});

test("an unknown moment gives an empty string and does not throw", () => {
  assert.equal(lines.pickLine("nope"), "");
  assert.equal(lines.pickLine(undefined), "");
  assert.equal(lines.pickLine("toString"), "");
});

test("lineParts splits [cyan] and {pink} words out of a line", () => {
  assert.deepEqual(lines.lineParts("plain line"), [{ text: "plain line", tone: null }]);
  assert.deepEqual(lines.lineParts("that note had {a} family"), [
    { text: "that note had ", tone: null },
    { text: "a", tone: "pink" },
    { text: " family", tone: null },
  ]);
  assert.deepEqual(lines.lineParts("[shh], listening to {this}!"), [
    { text: "shh", tone: "cyan" },
    { text: ", listening to ", tone: null },
    { text: "this", tone: "pink" },
    { text: "!", tone: null },
  ]);
  assert.deepEqual(lines.lineParts("[a]{b}"), [{ text: "a", tone: "cyan" }, { text: "b", tone: "pink" }]);
});

test("lineParts leaves unmatched markers alone and copes with empty input", () => {
  assert.deepEqual(lines.lineParts("array[0 is odd"), [{ text: "array[0 is odd", tone: null }]);
  assert.deepEqual(lines.lineParts(""), []);
  assert.deepEqual(lines.lineParts(null), []);
});
