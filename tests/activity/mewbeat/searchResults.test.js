const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let results;

test.before(async () => {
  results = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/searchResults.js")).href);
});

const song = (extra) => ({ uri: "https://example.test/a", source: "youtube", durationMs: 200_000, ...extra });

test("playIssueOf takes the server's word, and judges a reply that lacks it", () => {
  assert.equal(results.playIssueOf(song({ playIssue: "too_long" })), "too_long");
  assert.equal(results.playIssueOf(song({ playIssue: "stream" })), "stream");
  assert.equal(results.playIssueOf(song({ isStream: true })), "stream");
  assert.equal(results.playIssueOf(song({ durationMs: results.MAX_PLAY_MS + 1 })), "too_long");
  assert.equal(results.playIssueOf(song({ durationMs: results.MAX_PLAY_MS })), null);
  assert.equal(results.playIssueOf(song({ playIssue: "nonsense" })), null);
  assert.equal(results.playIssueOf(null), null);
});

test("describePlayIssue gives a short label, or null", () => {
  assert.equal(results.describePlayIssue("stream"), "Live stream");
  assert.equal(results.describePlayIssue("too_long"), "Over 20 min");
  assert.equal(results.describePlayIssue(null), null);
});

test("every link error code has its own text, and an unknown one falls back", () => {
  const codes = ["unsupported_host", "profile", "playlist_unsupported", "not_found", "failed", "no_copy"];
  const texts = codes.map((error) => results.describeLinkError({ error }));
  assert.equal(new Set(texts).size, codes.length);
  assert.equal(results.describeLinkError({ error: "something else" }), results.describeLinkError({ error: "failed" }));
  assert.equal(results.describeLinkError(null), results.describeLinkError({ error: "failed" }));
});

test("a playlist link has a note with its name and how many songs are shown", () => {
  assert.equal(results.describeLinkNote({ kind: "track" }, 1), null);
  assert.equal(results.describeLinkNote(null, 5), null);
  assert.equal(results.describeLinkNote({ kind: "playlist", name: "Mix", total: 120 }, 48), '"Mix": showing the first 48 of 120 songs.');
  assert.equal(results.describeLinkNote({ kind: "playlist", name: null, total: 12 }, 12), "This playlist: 12 songs.");
  assert.equal(results.describeLinkNote({ kind: "playlist", name: "One", total: 1 }, 1), '"One": 1 song.');
});

test("listedTracks drops Deezer and uri-less results, and caps a search or a playlist differently", () => {
  const many = Array.from({ length: 60 }, (_, index) => song({ uri: `https://example.test/${index}` }));
  const mixed = [song({ source: "deezer" }), song({ uri: "" }), ...many];
  const searched = results.listedTracks({ tracks: mixed });
  assert.equal(searched.length, results.SEARCH_LIMIT);
  assert.ok(searched.every((track) => track.uri && track.source !== "deezer"));
  const opened = results.listedTracks({ tracks: mixed, link: { kind: "playlist" } });
  assert.equal(opened.length, results.LINK_LIST_LIMIT);
  assert.deepEqual(results.listedTracks(null), []);
});

test("listedTracks keeps long songs and streams in the list, so they can be marked", () => {
  const rows = results.listedTracks({ tracks: [song({ playIssue: "too_long" }), song({ playIssue: "stream", isStream: true })] });
  assert.equal(rows.length, 2);
});
