const assert = require("node:assert/strict");
const test = require("node:test");

const {
  clearSongSearchCache,
  rankGameResults,
  recordingKeyOf,
  searchGameSongs,
  splitArtistCredit,
} = require("../../../helpers/mewbeat/songSearch");
const { clearSearchPopularityCache } = require("../../../helpers/lavalink/searchPopularity");
const MAYDAY = require("../../fixtures/search/mayday-pools.json");

// Lane answers recorded from Lavalink for "mayday" (ytmsearch, ytsearch, dzsearch, and the extra "mayday song"
// YouTube search), and the Deezer play counts the popularity lookup returned for them. Nothing here touches the network.
const { popularity: MAYDAY_POPULARITY, ...MAYDAY_LANES } = MAYDAY;

function lanePoru(lanes) {
  clearSongSearchCache();
  const asked = [];
  return {
    asked,
    async resolve({ query, source }) {
      const identifier = `${source}:${query}`;
      asked.push(identifier);
      const entry = lanes[identifier];
      if (!entry) return { loadType: "empty", tracks: [] };
      return { loadType: entry.loadType, tracks: entry.tracks.map((item) => ({ info: { ...item.info }, pluginInfo: item.pluginInfo })) };
    },
  };
}

// Runs a search with Deezer's play counts answered from the recording (the lookup is off in tests by default).
async function searchWithPopularity(query, lanes) {
  const saved = { fetch: globalThis.fetch, flag: process.env.SEARCH_POPULARITY };
  process.env.SEARCH_POPULARITY = "true";
  globalThis.fetch = async () => ({ ok: true, json: async () => MAYDAY_POPULARITY });
  clearSearchPopularityCache();
  try {
    const poru = lanePoru(lanes);
    const result = await searchGameSongs(poru, query, {});
    return { result, asked: poru.asked };
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.flag === undefined) delete process.env.SEARCH_POPULARITY;
    else process.env.SEARCH_POPULARITY = saved.flag;
    clearSearchPopularityCache();
  }
}

const titles = (result, count = 3) => result.tracks.slice(0, count).map((found) => `${found.info.title} | ${found.info.author}`);
const fatRatRows = (result) => result.tracks.filter((found) => /thefatrat/i.test(found.info.author) || /thefatrat/i.test(found.info.title));

test("mayday finds TheFatRat's song among the many small songs of that name, and lists it once", async () => {
  const { result, asked } = await searchWithPopularity("mayday", MAYDAY_LANES);
  const rows = fatRatRows(result);
  assert.equal(rows.length, 1, `TheFatRat rows: ${rows.map((found) => found.info.title)}`);
  // The artist's own upload stands for the recording, not the lyric channel that re-posted it.
  assert.equal(rows[0].info.author, "TheFatRat");
  const rank = result.tracks.indexOf(rows[0]);
  assert.ok(rank >= 0 && rank < 8, `TheFatRat's MAYDAY is at ${rank}: ${titles(result, 10)}`);
  // Festival sets and event uploads that merely have the word in their name stay out of the first page.
  for (const found of result.tracks.slice(0, 8)) assert.ok(found.info.length < 600_000, `a long upload in the top eight: ${found.info.title}`);
  // One more Lavalink call than the three lanes at most (the "song" search), never a search per candidate.
  assert.ok(asked.length <= 6, `asked ${asked.join(", ")}`);
});

test("mayday still finds TheFatRat when the extra song search has nothing to add", async () => {
  const lanes = { ...MAYDAY_LANES, "ytsearch:mayday song": { loadType: "empty", tracks: [] } };
  const { result } = await searchWithPopularity("mayday", lanes);
  const rows = fatRatRows(result);
  assert.equal(rows.length, 1);
  assert.ok(result.tracks.indexOf(rows[0]) < 10, `at ${result.tracks.indexOf(rows[0])}: ${titles(result, 12)}`);
});

test("the best-known songs of the exact title are in the first page, not buried by obscure artists", async () => {
  const { result } = await searchWithPopularity("mayday", MAYDAY_LANES);
  const authors = result.tracks.slice(0, 8).map((found) => found.info.author);
  for (const artist of ["Three Days Grace", "Hippie Sabotage", "Sohodolls", "TheFatRat"]) assert.ok(authors.includes(artist), `${artist} missing: ${authors}`);
});

// --- one recording, many providers and uploads ---------------------------------------------------------------------

const track = (info, lane = "yt") => ({
  searchLane: lane,
  info: { uri: `https://example.test/${info.identifier}`, length: 214_000, isStream: false, author: "Aurora Fields", ...info },
});
const rowsFor = (items, needle) => items.filter((item) => item.track.info.title.toLowerCase().includes(needle));

test("the same recording from YouTube Music, YouTube, Spotify and SoundCloud is one row, played from the best copy", () => {
  const pool = [
    track({ title: "Aurora Fields - Neon Skyline (Official Video)", identifier: "yt-video", length: 219_000 }),
    track({ title: "Aurora Fields - Neon Skyline (Lyrics)", author: "Lyric Garden", identifier: "yt-lyrics", length: 216_000 }),
    track({ title: "Neon Skyline", identifier: "ytm-copy" }, "ytm"),
    track({ title: "Neon Skyline", author: "Aurora Fields - Topic", identifier: "yt-topic" }),
    track({ title: "Neon Skyline", identifier: "sp-copy" }, "sp"),
    track({ title: "Aurora Fields - Neon Skyline", author: "aurorafields", identifier: "sc-copy" }, "sc"),
    track({ title: "Neon Skyline", identifier: "dz-copy" }, "dz"),
  ];
  const { items } = rankGameResults(pool, { queries: ["neon skyline"] });
  const same = rowsFor(items, "neon skyline");
  assert.equal(same.length, 1, same.map((item) => item.track.info.identifier).join(","));
  assert.equal(same[0].track.info.identifier, "ytm-copy");
});

test("without a YouTube Music copy the audio upload beats the lyric video and the music video", () => {
  const pool = [
    track({ title: "Aurora Fields - Neon Skyline (Lyrics)", author: "Lyric Garden", identifier: "yt-lyrics", length: 216_000 }),
    track({ title: "Aurora Fields - Neon Skyline (Official Video)", identifier: "yt-video", length: 219_000 }),
    track({ title: "Neon Skyline", author: "Aurora Fields - Topic", identifier: "yt-topic" }),
    track({ title: "Neon Skyline", author: "aurorafields", identifier: "sc-copy" }, "sc"),
  ];
  const { items } = rankGameResults(pool, { queries: ["neon skyline"] });
  assert.equal(items.length, 1);
  assert.equal(items[0].track.info.identifier, "yt-topic");
});

test("a remix, a live take, a cover, an instrumental and a nightcore edit stay separate rows", () => {
  const pool = [
    track({ title: "Neon Skyline", identifier: "original" }, "ytm"),
    track({ title: "Neon Skyline (Live at the Dome)", identifier: "live" }),
    track({ title: "Neon Skyline (Night Drive Remix)", author: "Night Drive", identifier: "remix" }, "ytm"),
    track({ title: "Neon Skyline (Instrumental)", identifier: "instrumental" }, "ytm"),
    track({ title: "Neon Skyline (Nightcore)", author: "Nightcore Hub", identifier: "nightcore" }),
    track({ title: "Neon Skyline (Cover)", author: "Mira Lane", identifier: "cover" }),
    track({ title: "Neon Skyline - Remastered", identifier: "remaster" }, "sp"),
  ];
  const { items } = rankGameResults(pool, { queries: ["neon skyline"] });
  const ids = items.map((item) => item.track.info.identifier);
  // The remaster is the same recording as the original; every other version is its own row.
  for (const id of ["original", "live", "remix", "instrumental", "nightcore", "cover"]) assert.ok(ids.includes(id), `${id} missing from ${ids}`);
  assert.ok(!(ids.includes("original") && ids.includes("remaster")), `the remaster and the original are both listed: ${ids}`);
  assert.equal(items.length, 6);
});

test("recordingKeyOf joins uploads of one recording and keeps versions apart", () => {
  const key = (title, author) => recordingKeyOf({ info: { title, author } });
  assert.equal(key("Neon Skyline", "Aurora Fields"), key("Aurora Fields - Neon Skyline (Official Video)", "Aurora Fields"));
  assert.equal(key("Neon Skyline", "Aurora Fields"), key("Neon Skyline", "Aurora Fields - Topic"));
  assert.equal(key("Neon Skyline (feat. Mira Lane)", "Aurora Fields"), key("Neon Skyline", "Aurora Fields"));
  assert.notEqual(key("Neon Skyline", "Aurora Fields"), key("Neon Skyline (Live)", "Aurora Fields"));
  assert.notEqual(key("Neon Skyline", "Aurora Fields"), key("Neon Skyline (Remix)", "Aurora Fields"));
  assert.notEqual(key("Neon Skyline", "Aurora Fields"), key("Neon Skyline", "Someone Else"));
  assert.equal(recordingKeyOf({ info: { title: "", author: "" } }), null);
});

test("splitArtistCredit tells a fan upload from the artist's own", () => {
  const own = splitArtistCredit("TheFatRat - MAYDAY feat. Laura Brehm", "TheFatRat");
  assert.equal(own.credit, "author");
  assert.equal(own.title, "MAYDAY feat. Laura Brehm");
  assert.equal(splitArtistCredit("TheFatRat - MAYDAY (Lyrics) feat. Laura Brehm", "7clouds").credit, "title");
  assert.equal(splitArtistCredit("Mayday", "Sohodolls").credit, null);
  // A label after the dash is a version, not an artist.
  assert.equal(splitArtistCredit("Neon Skyline - Live at the Dome", "Aurora Fields").credit, null);
});

// --- an artist, not a title ----------------------------------------------------------------------------------------

test("an artist-only query lists the artist's songs once each, ahead of other artists' songs with the same title", () => {
  const songs = ["Glass Harbor", "Paper Moons", "Slow Engine", "Ash and Honey", "Lunar Tide"];
  const pool = [
    ...songs.map((title, index) => track({ title, author: "Lunar Tide", identifier: `ytm-${index}` }, "ytm")),
    ...songs.map((title, index) => track({ title: `Lunar Tide - ${title} (Official Video)`, author: "Lunar Tide", identifier: `yt-${index}` })),
    ...songs.slice(0, 2).map((title, index) => track({ title: `Lunar Tide - ${title} (Lyrics)`, author: "Lyric Garden", identifier: `fan-${index}` })),
    track({ title: "Lunar Tide", author: "Somebody Else", identifier: "namesake" }, "ytm"),
    track({ title: "Lunar Tide", author: "Another Band", identifier: "namesake-2" }),
  ];
  const { items } = rankGameResults(pool, { queries: ["lunar tide"] });
  const top = items.slice(0, 5).map((item) => item.track.info);
  assert.ok(top.every((info) => info.author === "Lunar Tide"), `top five: ${top.map((info) => info.author)}`);
  const keys = items.map((item) => recordingKeyOf(item.track));
  assert.equal(new Set(keys).size, keys.length, `a recording is listed twice: ${keys}`);
});
