const assert = require("node:assert");
const { describe, it, beforeEach } = require("node:test");

const {
  buildLibrary,
  clearLibraryCache,
  findLibraryMatches,
  getPersonalSearchTracks,
} = require("../../../helpers/lavalink/personalSearch");
const { getTokenSimilarity } = require("../../../helpers/lavalink/searchMatching");

const numb = { title: "Numb", author: "Linkin Park", uri: "https://youtu.be/numb", length: 185000 };
const library = buildLibrary({
  playlists: [
    { name: "Liked Songs", tracks: [{ title: "Nothing Else Matters", author: "Metallica", uri: "https://youtu.be/nem", length: 388000 }, numb] },
    { name: "Gym", tracks: [{ title: "Believer", author: "Imagine Dragons", uri: "https://youtu.be/believer", length: 204000 }, numb] },
  ],
  history: [
    { query: "sanah szampan", track: { title: "Szampan", author: "sanah", uri: "https://youtu.be/szampan", length: 190000 } },
    { query: "broken", track: { title: "No link", author: "Nobody", uri: "", length: 1000 } },
  ],
});

describe("Personal library search", () => {
  beforeEach(() => clearLibraryCache());

  it("keeps one entry per track, from its strongest origin", () => {
    assert.deepStrictEqual(
      library.map((track) => `${track.personal}:${track.info.title}`),
      ["liked:Nothing Else Matters", "liked:Numb", "playlist:Believer", "history:Szampan"]
    );
  });

  it("finds library tracks despite typos and half-typed words", () => {
    assert.deepStrictEqual(findLibraryMatches(library, "metalica").map((track) => track.info.title), ["Nothing Else Matters"]);
    assert.deepStrictEqual(findLibraryMatches(library, "linkinpark").map((track) => track.info.title), ["Numb"]);
    assert.deepStrictEqual(findLibraryMatches(library, "imagine dragons beliv").map((track) => track.info.title), ["Believer"]);
    assert.deepStrictEqual(findLibraryMatches(library, "szamp").map((track) => track.info.title), ["Szampan"]);
  });

  it("returns nothing for unrelated or one-letter queries", () => {
    assert.deepStrictEqual(findLibraryMatches(library, "xyz qq"), []);
    assert.deepStrictEqual(findLibraryMatches(library, "n"), []);
  });

  it("reads each user's library once while they type", () => {
    let reads = 0;
    const read = () => {
      reads += 1;
      return library;
    };
    getPersonalSearchTracks("user", "guild", "numb", { read });
    getPersonalSearchTracks("user", "guild", "nothing", { read });
    assert.strictEqual(reads, 1);
    assert.deepStrictEqual(getPersonalSearchTracks(null, "guild", "numb", { read }), []);
  });

  it("credits a half-typed word with one typo below a clean prefix", () => {
    const typo = getTokenSimilarity("beliv", "believer", { allowPrefix: true });
    const clean = getTokenSimilarity("belie", "believer", { allowPrefix: true });
    assert.ok(typo > 0 && typo < clean, `typo=${typo} clean=${clean}`);
    assert.strictEqual(getTokenSimilarity("beliv", "believer"), 0);
  });
});
