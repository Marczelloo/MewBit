const assert = require("node:assert/strict");
const test = require("node:test");

const playersPath = require.resolve("../../../helpers/lavalink/players");
const { clearSearchCache } = require("../../../helpers/lavalink/searchAggregator");
const { clearSourceHealth, recordSourcePlayback } = require("../../../helpers/lavalink/sourceHealth");

let pools = {};
const unloadable = new Set();
const poru = {
  resolve: async ({ query, source }) => {
    if (/^https?:/.test(query)) {
      if (unloadable.has(query)) return { loadType: "error", tracks: [] };
      const track = Object.values(pools).flat().find((item) => item.info.uri === query);
      return track ? { loadType: "track", tracks: [track] } : { loadType: "empty", tracks: [] };
    }
    return { loadType: "search", tracks: pools[source] || [] };
  },
};
require.cache[playersPath] = { id: playersPath, filename: playersPath, loaded: true, exports: { getPoru: () => poru } };
const { findActivityTrackSources } = require("../../../helpers/activity/server");

function track(source, title, length, author = "Kendrick Lamar") {
  const uri = `https://${source}.example/${encodeURIComponent(`${author}-${title}-${length}`)}`;
  return { track: `enc-${uri}`, encoded: `enc-${uri}`, info: { title, author, length, uri, sourceName: source, identifier: uri } };
}

const reference = { title: "Not Like Us", author: "Kendrick Lamar", uri: "https://youtube.example/own", source: "youtube", durationMs: 275_000 };

test.beforeEach(() => {
  clearSearchCache();
  clearSourceHealth();
  unloadable.clear();
});

test("offers each provider's copy of the same recording and keeps the clicked result as is", async () => {
  pools = {
    spsearch: [track("spotify", "Not Like Us", 274_192)],
    dzsearch: [track("deezer", "Not Like Us", 274_000)],
    scsearch: [],
  };
  const sources = await findActivityTrackSources(reference);
  const byName = Object.fromEntries(sources.map((entry) => [entry.source, entry]));

  assert.equal(byName.youtube.current, true);
  assert.equal(byName.youtube.track.playQuery, reference.uri);
  assert.equal(byName.spotify.available, true);
  assert.equal(byName.deezer.track.playQuery, pools.dzsearch[0].info.uri);
  assert.deepEqual([byName.soundcloud.available, byName.soundcloud.reason], [false, "not_found"]);
});

test("skips other versions, previews and songs by other artists", async () => {
  pools = {
    spsearch: [track("spotify", "Not Like Us (Live)", 280_000), track("spotify", "Not Like Us", 30_000)],
    dzsearch: [track("deezer", "Not Like Us", 274_000, "Someone Else")],
    scsearch: [],
  };
  const sources = await findActivityTrackSources(reference);
  assert.deepEqual(sources.filter((entry) => entry.available).map((entry) => entry.source), ["youtube"]);
});

test("does not offer a provider whose link will not load or whose streams keep failing", async () => {
  pools = {
    spsearch: [track("spotify", "Not Like Us", 274_192)],
    dzsearch: [track("deezer", "Not Like Us", 274_000)],
    scsearch: [],
  };
  unloadable.add(pools.spsearch[0].info.uri);
  recordSourcePlayback("deezer", false);
  recordSourcePlayback("deezer", false);

  const sources = await findActivityTrackSources(reference);
  const reasons = Object.fromEntries(sources.map((entry) => [entry.source, entry.reason]));
  assert.equal(reasons.spotify, "not_loadable");
  assert.equal(reasons.deezer, "failing");

  recordSourcePlayback("deezer", true);
  clearSearchCache();
  const recovered = await findActivityTrackSources(reference);
  assert.equal(recovered.find((entry) => entry.source === "deezer").available, true);
});
