const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let suggestions;
let mock;

test.before(async () => {
  const dir = path.resolve(__dirname, "../../../activity/src/mewbeat");
  suggestions = await import(pathToFileURL(path.join(dir, "suggestions.js")).href);
  mock = await import(pathToFileURL(path.join(dir, "mockRequests.js")).href);
});

const row = (id, extra) => ({ audioKey: `youtube:${id}:200000`, uri: `https://y/${id}`, source: "youtube", title: `Song ${id}`, artist: "A", ...extra });
const reply = (sections, strip = []) => ({ status: "ok", sections, strip });

test("shapes a suggestion like a song-select row, with its reason and level", () => {
  const made = suggestions.suggestionRow(row("a", { kind: "again", reason: "S on Normal, try Hard", level: "hard", levelStars: 6.4, stars: { hard: 6.4 }, bpm: 140 }), "Worth another go");
  assert.equal(made.key, "youtube:a:200000");
  assert.equal(made.reason, "S on Normal, try Hard");
  assert.deepEqual([made.level, made.levelStars, made.section, made.kind], ["hard", 6.4, "Worth another go", "again"]);
  assert.equal(made.bpm, 140);
  assert.equal(made.playIssue, null);
  const bare = suggestions.suggestionRow({ uri: "https://y/x", source: "youtube" });
  assert.deepEqual([bare.key, bare.levelStars, bare.level, bare.stars, bare.played, bare.title], ["https://y/x", null, null, null, false, "Unknown title"]);
});

test("the For you tab lists new, retry and server picks once each; Classics lists the curated list alone", () => {
  const answer = reply([
    { kind: "similar", title: "Like", rows: [row("a")] },
    { kind: "again", title: "Again", rows: [row("b"), row("a")] },
    { kind: "here", title: "Here", rows: [row("c")] },
    { kind: "classic", title: "Classics", rows: [row("d"), row("e", { played: true })] },
  ]);
  assert.deepEqual(suggestions.suggestionRows(answer, "foryou").map((r) => r.audioKey.split(":")[1]), ["a", "b", "c"]);
  const classics = suggestions.suggestionRows(answer, "classics");
  assert.deepEqual(classics.map((r) => r.audioKey.split(":")[1]), ["d", "e"]);
  assert.equal(classics[1].played, true);
});

test("a player with nothing of their own gets the classics under For you", () => {
  const answer = reply([{ kind: "similar", rows: [] }, { kind: "classic", title: "Classics", rows: [row("d")] }]);
  assert.deepEqual(suggestions.suggestionRows(answer, "foryou").map((r) => r.audioKey), ["youtube:d:200000"]);
  assert.deepEqual(suggestions.suggestionRows(null, "foryou"), []);
  assert.deepEqual(suggestions.suggestionRows({ sections: "no" }, "classics"), []);
});

test("drops a suggestion that has no way to be played", () => {
  const answer = reply([{ kind: "here", rows: [row("a", { uri: "" }), row("b")] }]);
  assert.deepEqual(suggestions.suggestionRows(answer, "foryou").map((r) => r.audioKey), ["youtube:b:200000"]);
});

test("the strip keeps the server's order and a song once", () => {
  const strip = suggestions.stripRows(reply([], [row("a"), row("b"), row("a")]));
  assert.deepEqual(strip.map((r) => r.audioKey), ["youtube:a:200000", "youtube:b:200000"]);
  assert.deepEqual(suggestions.stripRows(null), []);
});

test("writes a suggested level, nothing when the song has no charts yet", () => {
  const label = (level) => level[0].toUpperCase() + level.slice(1);
  assert.equal(suggestions.suggestedLevelText({ level: "hard", levelStars: 6.44 }, label), "Hard ★ 6.4");
  assert.equal(suggestions.suggestedLevelText({ level: null, levelStars: null }, label), "");
  assert.equal(suggestions.suggestedLevelText({ level: "hard", levelStars: null }, label), "");
});

test("words a server reason, with a fallback", () => {
  assert.match(suggestions.describeSuggestError("unavailable"), /aren't available/);
  assert.equal(suggestions.describeSuggestError("something_odd"), "something_odd");
  assert.equal(suggestions.describeSuggestError(undefined), "Couldn't load suggestions.");
});

test("the mock preview answers mewbeat_recs with every kind, a strip without the song just played, and no repeats", async () => {
  const request = mock.createMockRequest();
  const answer = await request("mewbeat_recs", {});
  assert.equal(answer.status, "ok");
  assert.deepEqual(answer.sections.map((section) => section.kind), ["similar", "again", "here", "classic"]);
  assert.ok(answer.sections.every((section) => section.rows.length > 0 && section.rows.every((r) => r.reason)));
  assert.ok(answer.strip.length >= 3 && answer.strip.length <= 4);
  assert.equal(new Set(answer.strip.map((r) => r.audioKey)).size, answer.strip.length);
  assert.ok(answer.sections.flatMap((section) => section.rows).some((r) => r.level && Number.isFinite(r.levelStars)), "some suggest a level");

  const seed = answer.strip[0].audioKey;
  const without = await request("mewbeat_recs", { seedKey: seed });
  assert.ok(without.strip.every((r) => r.audioKey !== seed));
  assert.ok(without.sections.flatMap((section) => section.rows).every((r) => r.audioKey !== seed));
});
