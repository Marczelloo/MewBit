const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let format;

test.before(async () => {
  format = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/playerFormat.js")).href);
});

test("formatDuration shows hours and minutes, or minutes alone under an hour", () => {
  assert.equal(format.formatDuration(42_000_000), "11h 40m");
  assert.equal(format.formatDuration(720_000), "12m");
  assert.equal(format.formatDuration(0), "0m");
  assert.equal(format.formatDuration(null), "0m");
});

test("formatOffsetMs signs the rounded mean and dashes a missing one", () => {
  assert.equal(format.formatOffsetMs(6.4), "+6 ms");
  assert.equal(format.formatOffsetMs(-4), "-4 ms");
  assert.equal(format.formatOffsetMs(null), "—");
});

test("timingWord names the lean, and calls anything within 2 ms on time", () => {
  assert.equal(format.timingWord(null), "");
  assert.equal(format.timingWord(1), "on time");
  assert.equal(format.timingWord(-2), "on time");
  assert.equal(format.timingWord(6), "a little late");
  assert.equal(format.timingWord(-6), "a little early");
});

test("formatPercent keeps one decimal by default and dashes a missing value", () => {
  assert.equal(format.formatPercent(null), "—");
  assert.equal(format.formatPercent(NaN), "—");
  assert.equal(format.formatPercent(86.42), "86.4%");
  assert.equal(format.formatPercent(94.214, 2), "94.21%");
});

test("formatSeconds, formatCount and formatRank dash or zero what is missing", () => {
  assert.equal(format.formatSeconds(14_240), "14.2 s");
  assert.equal(format.formatSeconds(0), "—");
  assert.equal(format.formatCount(1234567), "1,234,567");
  assert.equal(format.formatCount(undefined), "0");
  assert.equal(format.formatRank(2), "#2");
  assert.equal(format.formatRank(null), "—");
  assert.equal(format.formatSince(null), "");
});
