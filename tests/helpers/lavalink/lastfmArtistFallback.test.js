const assert = require("node:assert/strict");
const { afterEach, describe, it } = require("node:test");

const { fetchLastFmCandidates } = require("../../../helpers/lavalink/autoplayCandidates");
const { clearLastFmTagCache } = require("../../../helpers/lavalink/lastfmClient");

const originalFetch = global.fetch;
const originalKey = process.env.LASTFM_API_KEY;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.LASTFM_API_KEY;
  else process.env.LASTFM_API_KEY = originalKey;
  clearLastFmTagCache();
});

const reference = { searchArtist: "Rosa Walton", cleanTitle: "I Really Want to Stay at Your House" };

const TOP_TRACKS = {
  "Let's Eat Grandma": ["Falling Into Me", "Hot Pink"],
  "Kero Kero Bonito": ["Flamingo", "Only Acting"],
};

function json(body) {
  return { ok: true, json: async () => body };
}

function lavalinkSearch(query) {
  const [artist] = Object.keys(TOP_TRACKS).filter((name) => query.startsWith(name));
  const title = query.slice(artist.length + 1);
  return json({
    loadType: "search",
    data: [{
      encoded: `enc-${title}`,
      info: {
        title,
        author: artist,
        identifier: `yt-${title.replace(/\s+/g, "-")}`,
        length: 200000,
        isStream: false,
        isSeekable: true,
        sourceName: "youtube",
        uri: `https://youtube.com/watch?v=${encodeURIComponent(title)}`,
      },
    }],
  });
}

function mockServices({ similarTracks = [] } = {}) {
  const methods = [];
  global.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/v4/loadtracks")) {
      return lavalinkSearch(parsed.searchParams.get("identifier").replace(/^ytsearch:/, ""));
    }
    const method = parsed.searchParams.get("method");
    methods.push(method);
    if (method === "track.getsimilar") {
      return json({ similartracks: { track: similarTracks } });
    }
    if (method === "artist.getsimilar") {
      return json({
        similarartists: {
          artist: [
            { name: "Rosa Walton", match: "1" },
            { name: "Let's Eat Grandma", match: "0.9" },
            { name: "Kero Kero Bonito", match: "0.5" },
          ],
        },
      });
    }
    if (method === "artist.gettoptracks") {
      const artist = parsed.searchParams.get("artist");
      return json({ toptracks: { track: (TOP_TRACKS[artist] || []).map((name) => ({ name, artist: { name: artist } })) } });
    }
    return json({ toptags: { tag: [] } });
  };
  return methods;
}

describe("Last.fm similar-artist fallback", () => {
  it("uses neighbour artists' top tracks when the recording has no similar tracks", async () => {
    process.env.LASTFM_API_KEY = "test-key";
    const methods = mockServices();

    const candidates = await fetchLastFmCandidates(reference, "guild-lastfm-fallback");

    assert.ok(methods.includes("artist.getsimilar"));
    // Interleaved by rank: each neighbour's best track comes before anyone's second.
    assert.deepEqual(
      candidates.map((candidate) => `${candidate.artist} - ${candidate.title}`),
      [
        "Let's Eat Grandma - Falling Into Me",
        "Kero Kero Bonito - Flamingo",
        "Let's Eat Grandma - Hot Pink",
        "Kero Kero Bonito - Only Acting",
      ]
    );
    // The reference artist is never its own neighbour.
    assert.ok(candidates.every((candidate) => candidate.artist !== "Rosa Walton"));
    assert.ok(candidates.every((candidate) => candidate.source === "lastfm_similar" && candidate.similarVia === "artist"));
    // Artist-level evidence is shaded below a direct recording match.
    assert.ok(candidates.every((candidate) => candidate.similarity <= 0.6));
    assert.ok(candidates[0].similarity > candidates[1].similarity);
  });

  it("does not ask for similar artists when the recording has similar tracks", async () => {
    process.env.LASTFM_API_KEY = "test-key";
    const methods = mockServices({
      similarTracks: [{ name: "Flamingo", artist: { name: "Kero Kero Bonito" }, match: "0.8" }],
    });

    const candidates = await fetchLastFmCandidates(reference, "guild-lastfm-direct");

    assert.ok(!methods.includes("artist.getsimilar"));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].similarVia, undefined);
    assert.equal(candidates[0].similarity, 0.8);
  });
});
