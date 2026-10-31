const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let createKonamiMatcher;

test.before(async () => {
  ({ createKonamiMatcher } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/konami.js")).href
  ));
});

const SEQUENCE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

// Feeds keys and returns the pushes that completed the code.
const feed = (matcher, keys) => keys.map((key) => matcher.push(key));

test("the exact sequence completes on the last key only", () => {
  const results = feed(createKonamiMatcher(), SEQUENCE);
  assert.deepEqual(results, [...Array(9).fill(false), true]);
});

test("uppercase B and A also complete it", () => {
  const results = feed(createKonamiMatcher(), [...SEQUENCE.slice(0, 8), "B", "A"]);
  assert.equal(results.at(-1), true);
});

test("a third ArrowUp up front still completes", () => {
  const results = feed(createKonamiMatcher(), ["ArrowUp", ...SEQUENCE]);
  assert.equal(results.at(-1), true);
  assert.equal(results.slice(0, -1).includes(true), false);
});

test("a wrong key midway followed by the full sequence completes", () => {
  const matcher = createKonamiMatcher();
  feed(matcher, ["ArrowUp", "ArrowUp", "ArrowDown", "x"]);
  assert.equal(feed(matcher, SEQUENCE).at(-1), true);
});

test("a second full sequence completes again", () => {
  const matcher = createKonamiMatcher();
  assert.equal(feed(matcher, SEQUENCE).at(-1), true);
  assert.equal(feed(matcher, SEQUENCE).at(-1), true);
});

test("a partial sequence does not complete", () => {
  assert.equal(feed(createKonamiMatcher(), SEQUENCE.slice(0, 9)).includes(true), false);
});
