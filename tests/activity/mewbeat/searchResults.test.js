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

// A row as the song select lists it: only what the merge looks at, plus a marker for what must survive it.
const listed = (id, extra) => ({ key: `youtube:${id}:200000`, audioKey: `youtube:${id}:200000`, uri: `https://y/${id}`, title: `Song ${id}`, artist: "Band", ...extra });

test("rowMatchesQuery wants every word, ignores case and accents, and matches the artist too", () => {
  const row = listed("a", { title: "Dvořák: Largo", artist: "Zoë Quartet" });
  assert.equal(results.rowMatchesQuery(row, "dvorak"), true);
  assert.equal(results.rowMatchesQuery(row, "LARGO zoe"), true);
  assert.equal(results.rowMatchesQuery(row, "quartet largo"), true, "the order of the words does not matter");
  assert.equal(results.rowMatchesQuery(row, "largo piano"), false, "every word has to be there");
  assert.equal(results.rowMatchesQuery(row, "   "), false);
  assert.equal(results.rowMatchesQuery(row, ""), false);
  assert.equal(results.rowMatchesQuery({ uri: "x" }, "a"), false, "a row without a title or an artist matches nothing");
});

test("mergeSearchRows puts the open tab's matches first, with what the tab knows, then the server's other results", () => {
  const open = [
    listed("a", { title: "Mayday", plays: 5, stars: { normal: 3 }, bests: { normal: { grade: "S", score: 9000 } } }),
    listed("b", { title: "Other song" }),
    listed("c", { title: "Not Mayday", artist: "Mayday Band" }),
  ];
  const found = [listed("a", { key: "https://y/a", plays: null, stars: null, bests: {} }), listed("d", { title: "Mayday (live)" }), listed("c")];
  const merged = results.mergeSearchRows({ openRows: open, foundRows: found, query: "mayday", openLabel: "Played by you" });
  assert.deepEqual(merged.map((row) => [row.audioKey.split(":")[1], row.section]), [["a", "Played by you"], ["c", "Played by you"], ["d", "New songs"]]);
  assert.equal(merged[0].plays, 5, "the tab's row keeps its play count");
  assert.deepEqual(merged[0].stars, { normal: 3 });
  assert.equal(merged[0].bests.normal.grade, "S");
  assert.equal(merged.filter((row) => row.audioKey === "youtube:a:200000").length, 1, "a song is listed once");
});

test("mergeSearchRows takes at most six of the tab's songs, and keeps the rest of them out of the new ones too", () => {
  const open = Array.from({ length: 9 }, (_, index) => listed(`s${index}`, { title: `Mayday ${index}` }));
  const found = [listed("s8", { title: "Mayday 8" }), listed("n", { title: "Mayday new" })];
  const merged = results.mergeSearchRows({ openRows: open, foundRows: found, query: "mayday", openLabel: "Played by you" });
  assert.equal(results.OPEN_TAB_LIMIT, 6);
  assert.deepEqual(merged.slice(0, 6).map((row) => row.section), Array(6).fill("Played by you"));
  assert.deepEqual(merged.slice(0, 6).map((row) => row.audioKey), open.slice(0, 6).map((row) => row.audioKey), "in the tab's order");
  // the ones past the sixth are not "of the first section", so the server's copy of one is a new song
  assert.deepEqual(merged.slice(6).map((row) => [row.audioKey.split(":")[1], row.section]), [["s8", "New songs"], ["n", "New songs"]]);
});

test("mergeSearchRows compares by link when a row has no audio key", () => {
  const open = [listed("a", { audioKey: null, uri: "https://y/same", title: "Mayday" })];
  const found = [listed("x", { audioKey: null, uri: "https://y/same", title: "Mayday" }), listed("y", { audioKey: null, uri: "https://y/other", title: "Mayday 2" })];
  const merged = results.mergeSearchRows({ openRows: open, foundRows: found, query: "mayday", openLabel: "On this server" });
  assert.deepEqual(merged.map((row) => row.uri), ["https://y/same", "https://y/other"]);
});

test("mergeSearchRows has no headers when the tab has no match: the server's results are one plain list", () => {
  const merged = results.mergeSearchRows({ openRows: [listed("a", { title: "Nothing" })], foundRows: [listed("d"), listed("e")], query: "mayday", openLabel: "Played by you" });
  assert.deepEqual(merged.map((row) => row.section), [null, null]);
  assert.equal(merged.length, 2);
  assert.deepEqual(results.mergeSearchRows({ query: "mayday" }), []);
});

test("mergeSearchRows leaves its input as it was", () => {
  const open = [listed("a", { title: "Mayday" })];
  const found = [listed("d", { title: "Mayday 2" })];
  results.mergeSearchRows({ openRows: open, foundRows: found, query: "mayday", openLabel: "x" });
  assert.equal("section" in open[0], false);
  assert.equal("section" in found[0], false);
});
