const assert = require("node:assert");
const { describe, it, beforeEach } = require("node:test");

const { clearSimilarCache, getSimilarSearchTracks } = require("../../../helpers/lavalink/similarSearch");

const toTrack = (title, author) => ({
  info: { title, author, uri: `https://youtu.be/${encodeURIComponent(`${author}-${title}`)}`, length: 200000, isStream: false, sourceName: "youtube" },
});

const neighbours = [
  { artist: "Linkin Park", title: "Numb", match: 1 },
  { artist: "Linkin Park", title: "In the End", match: 0.9 },
  { artist: "Linkin Park", title: "Faint", match: 0.8 },
  { artist: "Evanescence", title: "Bring Me to Life", match: 0.7 },
  { artist: "Papa Roach", title: "Last Resort", match: 0.6 },
];

describe("Similar search tracks", () => {
  beforeEach(() => clearSimilarCache());

  it("resolves Last.fm neighbours, at most two per artist, without the reference", async () => {
    const lookups = [];
    const tracks = await getSimilarSearchTracks(
      { title: "Linkin Park - Numb (Official Video)", author: "Linkin Park" },
      {
        limit: 3,
        lookup: async (reference) => {
          lookups.push(reference);
          return neighbours;
        },
        search: async (query) => {
          const match = neighbours.find((track) => `${track.artist} ${track.title}` === query);
          return match ? [toTrack(match.title, match.artist)] : [];
        },
      }
    );

    assert.strictEqual(lookups[0].artist, "Linkin Park");
    assert.strictEqual(lookups[0].title, "Numb");
    assert.deepStrictEqual(tracks.map((track) => track.info.title), ["In the End", "Faint", "Bring Me to Life"]);
  });

  it("skips neighbours that fail to resolve and caches the answer", async () => {
    let lookups = 0;
    const options = {
      lookup: async () => {
        lookups += 1;
        return neighbours.slice(3);
      },
      search: async (query) => {
        if (query.startsWith("Evanescence")) throw new Error("timeout");
        return [toTrack("Last Resort", "Papa Roach")];
      },
    };

    const first = await getSimilarSearchTracks({ title: "Numb", author: "Linkin Park" }, options);
    const second = await getSimilarSearchTracks({ title: "Numb", author: "Linkin Park" }, options);
    assert.deepStrictEqual(first.map((track) => track.info.title), ["Last Resort"]);
    assert.strictEqual(second, first);
    assert.strictEqual(lookups, 1);
  });

  it("returns nothing without a title, an artist or a search function", async () => {
    assert.deepStrictEqual(await getSimilarSearchTracks({ title: "", author: "x" }, { search: async () => [] }), []);
    assert.deepStrictEqual(await getSimilarSearchTracks({ title: "Numb", author: "Linkin Park" }), []);
  });
});
