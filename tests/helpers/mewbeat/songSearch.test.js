const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MAX_PLAY_MS,
  clearSongSearchCache,
  detectArtistQuery,
  isNoiseUpload,
  playIssueOf,
  rankGameResults,
  searchGameSongs,
  searchSongLink,
  splitQueryWords,
} = require("../../../helpers/mewbeat/songSearch");
const { parseSongLink } = require("../../../helpers/mewbeat/songLink");
const FIXTURE = require("../../fixtures/search/game-search-pools.json");

// A Poru that answers from the recorded Lavalink responses (tests/fixtures/search/game-search-pools.json), keyed by
// the identifier Lavalink was asked ("ytmsearch:camellia", a link). Anything not recorded is an empty answer.
function fixturePoru(extra = {}) {
  clearSongSearchCache();
  const asked = [];
  return {
    asked,
    async resolve({ query, source }) {
      const identifier = /^https?:\/\//i.test(query) || !source ? query : `${source}:${query}`;
      asked.push(identifier);
      const entry = extra[identifier] || FIXTURE[identifier];
      if (!entry) return { loadType: "empty", tracks: [] };
      return {
        loadType: entry.loadType,
        playlistInfo: entry.playlistInfo,
        tracks: entry.tracks.map((item) => ({ info: { ...item.info }, pluginInfo: item.pluginInfo })),
      };
    },
  };
}

const SUGGESTIONS = { "quebo bubbletea": ["quebo bubble tea"] };
async function search(query, options = {}) {
  clearSongSearchCache();
  return searchGameSongs(fixturePoru(), query, { getSuggestions: async (text) => SUGGESTIONS[text.toLowerCase()] || [], ...options });
}
const titles = (result, count = 3) => result.tracks.slice(0, count).map((track) => track.info.title);
const track = (info, lane = "yt") => ({ searchLane: lane, info: { identifier: info.title, uri: `https://example.test/${info.title}`, length: 200_000, isStream: false, ...info } });

test("an artist-only query lists that artist's own songs, not other artists' songs with the same title", async () => {
  const result = await search("Camellia");
  assert.ok(result.tracks.length >= 5);
  for (const found of result.tracks.slice(0, 5)) assert.equal(found.info.author, "Camellia Official");
});

test("an artist-only query puts the artist's own songs before a collaboration", async () => {
  const result = await search("sanah");
  const top = result.tracks.slice(0, 5);
  assert.ok(top.every((found) => found.info.author === "sanah"), `top five: ${top.map((found) => found.info.author)}`);
  assert.ok(!/enklawa/i.test(top[0].info.title));
});

test("fan re-uploads titled \"Artist - Song\" do not hide the artist's own recordings", async () => {
  // YouTube answered this query with twenty uploads named "Quebonafide - ..." on a fan channel next to the artist's own songs.
  const result = await search("Quebonafide");
  const top = result.tracks.slice(0, 5);
  assert.ok(top.every((found) => found.info.author === "Quebonafide"), `top five: ${top.map((found) => found.info.author)}`);
});

test("detectArtistQuery needs a few songs by one author, and not a song title", () => {
  const byArtist = ["a", "b", "c", "d"].map((title) => track({ title: `${title} song`, author: "Toby Fox" }));
  assert.equal(detectArtistQuery(byArtist, "toby fox"), true);
  const titled = ["a", "b", "c", "d"].map((author) => track({ title: "Camellia", author: `Someone ${author}` }));
  assert.equal(detectArtistQuery(titled, "camellia"), false);
  assert.equal(detectArtistQuery([], "toby fox"), false);
  // A long query is a title or a sentence, never an artist.
  assert.equal(detectArtistQuery(byArtist, "a b c d e f toby fox"), false);
});

test("a mix query lists mixes that can be played before the ones over 20 minutes, and labels the long ones", async () => {
  const result = await search("polskie hity mix");
  assert.ok(result.tracks.length >= 4);
  const issues = result.tracks.map((found) => found.playIssue);
  const firstLong = issues.indexOf("too_long");
  assert.ok(firstLong > 0, "a mix that can be played comes first");
  assert.ok(issues.slice(0, firstLong).every((issue) => issue === null));
  // The ranking keeps relevance first: playable mixes are not pushed behind a long one with the same words.
  assert.match(result.tracks[0].info.title, /mix/i);
  for (const found of result.tracks) {
    assert.equal(found.playIssue, found.info.length > MAX_PLAY_MS ? "too_long" : null);
  }
});

test("a query written as artist and title without a space finds the song through the corrected spelling", async () => {
  const result = await search("quebo bubbletea");
  assert.equal(result.correction, "quebo bubble tea");
  assert.equal(result.tracks[0].info.title, "BUBBLETEA");
  assert.equal(result.tracks[0].info.author, "Quebonafide");
});

test("a Deezer hint that does not hold every word is not shown, and the real song stays on top", async () => {
  const result = await search("toby fox finale");
  assert.equal(result.tracks[0].info.title, "Finale");
  assert.equal(result.tracks[0].info.author, "Toby Fox");
  assert.ok(!result.tracks.some((found) => /final power/i.test(found.info.title)));
});

test("a Deezer-only result is replaced by its playable YouTube Music copy", async () => {
  const result = await search("polskie hity mix");
  const via = result.tracks.filter((found) => found.searchVia === "deezer");
  assert.ok(via.length >= 1);
  for (const found of via) {
    assert.equal(found.searchLane === "dz", false);
    assert.ok(found.info.uri);
  }
});

test("results are free of repeats and capped", async () => {
  const result = await search("Camellia");
  const keys = result.tracks.map((found) => `${found.info.title}|${found.info.author}`.toLowerCase());
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(result.tracks.length <= 48);
});

test("a search asks only the search lanes and never loads a chart", async () => {
  clearSongSearchCache();
  const poru = fixturePoru();
  await searchGameSongs(poru, "Camellia", { getSuggestions: async () => [] });
  assert.ok(poru.asked.length > 0);
  assert.ok(poru.asked.every((identifier) => /^(ytmsearch|ytsearch|dzsearch|spsearch|scsearch):/.test(identifier)));
});

test("a failing lane does not fail the search", async () => {
  clearSongSearchCache();
  const poru = fixturePoru();
  const resolve = poru.resolve.bind(poru);
  poru.resolve = async (request) => {
    if (request.source === "dz" || request.source === "dzsearch") throw new Error("deezer is down");
    return resolve(request);
  };
  const result = await searchGameSongs(poru, "Camellia", { getSuggestions: async () => [] });
  assert.ok(result.tracks.length >= 3);
});

test("a repeated query is served from the lane cache", async () => {
  clearSongSearchCache();
  const poru = fixturePoru();
  const options = { getSuggestions: async () => [] };
  await searchGameSongs(poru, "Camellia", options);
  const first = poru.asked.length;
  await searchGameSongs(poru, "Camellia", options);
  assert.equal(poru.asked.length, first);
});

test("playIssueOf marks live streams and tracks over the plugin's length limit", () => {
  assert.equal(playIssueOf({ info: { isStream: true, length: 0 } }), "stream");
  assert.equal(playIssueOf({ info: { isStream: false, length: MAX_PLAY_MS + 1 } }), "too_long");
  assert.equal(playIssueOf({ info: { isStream: false, length: MAX_PLAY_MS } }), null);
  assert.equal(playIssueOf({ info: { isStream: false, length: 180_000 } }), null);
});

test("splitQueryWords separates the words a result must have from the ones that only describe it", () => {
  assert.deepEqual(splitQueryWords("polskie hity mix"), { required: ["polskie"], optional: ["hity", "mix"] });
  assert.deepEqual(splitQueryWords("mix"), { required: ["mix"], optional: [] });
  assert.deepEqual(splitQueryWords("  Camellia "), { required: ["camellia"], optional: [] });
});

test("a reaction or a loop is pushed down unless the query asks for it", () => {
  const real = track({ title: "Finale", author: "Toby Fox" });
  const reaction = track({ title: "Reacting to Finale (UNDERTALE)", author: "Some Channel" });
  assert.equal(isNoiseUpload(reaction, ["undertale finale"]), true);
  assert.equal(isNoiseUpload(real, ["undertale finale"]), false);
  assert.equal(isNoiseUpload(reaction, ["reaction undertale finale"]), false);

  const loop = track({ title: "Finale 10 hours", author: "Toby Fox" });
  const { items } = rankGameResults([loop, real], { queries: ["toby fox finale"] });
  assert.equal(items[0].track.info.title, "Finale");
});

test("an exact title and artist outranks a longer title that only contains the words", () => {
  const exact = track({ title: "Szampan", author: "sanah" });
  const longer = track({ title: "Szampan (Remix) 1 hour loop", author: "Random" });
  const { items } = rankGameResults([longer, exact], { queries: ["sanah szampan"] });
  assert.equal(items[0].track.info.title, "Szampan");
});

test("words in another order and a missing accent still find the song", () => {
  const song = track({ title: "Miłość jest ślepa", author: "sanah" });
  const other = track({ title: "Ślepa uliczka", author: "Someone" });
  const { items } = rankGameResults([other, song], { queries: ["slepa milosc sanah"] });
  assert.equal(items[0].track.info.title, "Miłość jest ślepa");
});

test("a link to a single video loads that video and is marked when it can be played", async () => {
  const poru = fixturePoru();
  const link = parseSongLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&index=2");
  const result = await searchSongLink(poru, link);
  assert.deepEqual(poru.asked, ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"]);
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].playIssue, null);
  assert.deepEqual(result.link, { provider: "youtube", kind: "track", name: null, total: 1, error: null });
});

test("a playlist link lists its songs (capped), with the playlist's name and size, not just the first", async () => {
  const link = parseSongLink("https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI");
  const result = await searchSongLink(fixturePoru(), link);
  assert.equal(result.link.kind, "playlist");
  assert.equal(result.link.error, null);
  assert.ok(result.link.name);
  assert.ok(result.tracks.length > 1 && result.tracks.length <= 48);
  assert.ok(result.link.total >= result.tracks.length);
  assert.ok(result.tracks.every((found) => "playIssue" in found));
});

test("a live stream and a song over 20 minutes are listed and marked, never hidden", async () => {
  const long = { info: { identifier: "long", title: "Mix", author: "dj", length: MAX_PLAY_MS + 1000, isStream: false, uri: "https://www.youtube.com/watch?v=long" } };
  const live = { info: { identifier: "live", title: "Radio", author: "fm", length: 9e12, isStream: true, uri: "https://www.youtube.com/watch?v=live" } };
  for (const [item, issue] of [[long, "too_long"], [live, "stream"]]) {
    const poru = fixturePoru({ "https://www.youtube.com/watch?v=abcdefghijk": { loadType: "track", tracks: [item] } });
    const result = await searchSongLink(poru, parseSongLink("https://youtu.be/abcdefghijk"));
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].playIssue, issue);
    assert.equal(result.link.error, null);
  }
});

test("a Deezer track link is replaced by its YouTube Music copy", async () => {
  const dz = FIXTURE["https://www.deezer.com/en/track/3135556"].tracks[0].info;
  const copy = { info: { identifier: "copyid12345", title: dz.title, author: dz.author, length: dz.length, isStream: false, uri: "https://music.youtube.com/watch?v=copyid12345" } };
  const poru = fixturePoru({ [`ytmsearch:${dz.author} ${dz.title}`]: { loadType: "search", tracks: [copy] } });
  const result = await searchSongLink(poru, parseSongLink("https://www.deezer.com/en/track/3135556"));
  assert.equal(result.link.error, null);
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].searchVia, "deezer");
  assert.equal(result.tracks[0].info.uri, copy.info.uri);

  const none = await searchSongLink(fixturePoru(), parseSongLink("https://www.deezer.com/en/track/3135556"));
  assert.deepEqual(none.tracks, []);
  assert.equal(none.link.error, "no_copy");
});

test("what a link cannot give is said by an error code, and nothing is loaded for it", async () => {
  const cases = [
    ["https://example.com/some/page", "unsupported_host"],
    ["https://www.youtube.com/@somechannel", "profile"],
    ["https://open.spotify.com/artist/4cOdK2wGLETKBW3PvgPWqT", "profile"],
    ["https://soundcloud.com/forss", "profile"],
    ["https://www.deezer.com/en/playlist/1234", "playlist_unsupported"],
    ["https://www.deezer.com/en/album/1234", "playlist_unsupported"],
  ];
  for (const [text, error] of cases) {
    const poru = fixturePoru();
    const result = await searchSongLink(poru, parseSongLink(text));
    assert.deepEqual(result.tracks, [], text);
    assert.equal(result.link.error, error, text);
    assert.deepEqual(poru.asked, [], text);
  }
});

test("a link Lavalink cannot load is an error, not an empty success; an empty answer is not_found", async () => {
  // Spotify and SoundCloud answered "error" on the machine the fixtures were recorded on (no provider keys).
  for (const text of ["https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT", "https://soundcloud.com/forss/flickermood"]) {
    const result = await searchSongLink(fixturePoru(), parseSongLink(text));
    assert.deepEqual(result.tracks, []);
    assert.equal(result.link.error, "failed");
    assert.equal(result.link.kind, null);
  }
  const missing = await searchSongLink(fixturePoru(), parseSongLink("https://www.youtube.com/watch?v=zzzzzzzzzzz"));
  assert.equal(missing.link.error, "not_found");
  const down = { resolve: async () => { throw new Error("lavalink is down"); } };
  assert.equal((await searchSongLink(down, parseSongLink("https://youtu.be/abcdefghijk"))).link.error, "failed");
});

test("a Spotify or SoundCloud single-song link resolves when the provider answers with a track", async () => {
  const item = { info: { identifier: "sp1", title: "Song", author: "Artist", length: 200_000, isStream: false, uri: "https://open.spotify.com/track/sp1" } };
  const poru = fixturePoru({ "https://open.spotify.com/intl-pl/track/sp1?si=abc": { loadType: "track", tracks: [item] } });
  const result = await searchSongLink(poru, parseSongLink("https://open.spotify.com/intl-pl/track/sp1?si=abc"));
  assert.equal(poru.asked.length, 1);
  assert.equal(result.tracks.length, 1);
  assert.equal(result.link.provider, "spotify");
  assert.equal(result.link.kind, "track");
});
