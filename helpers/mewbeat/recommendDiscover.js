const { audioKeyOf } = require("./audioKey");

// Finds new songs like a given one for the suggestions (recommendations.js), with the music bot's own autoplay
// search: Last.fm's similar tracks for the seed, each resolved to a playable Lavalink track, then scored by autoplay v3
// against the seed (genre flow and similarity), which drops what would not sit next to it. Nothing of autoplay is
// changed or started: no player, no queue, no AI service; it only calls the same lookups it does for a queue slot.
//
// One call is one Last.fm lookup plus up to a dozen Lavalink searches, so the recommender budgets how many run (see
// createSearchBudget). Without LASTFM_API_KEY the search has nothing to start from and answers an empty list.
// The autoplay modules load the player and Poru, so they are required on the first call, not when the bot starts.

const MIN_SCORE = 45;

function createDiscoverer({
  loadAutoplay = () => ({
    candidates: require("../lavalink/autoplayCandidates"),
    v3: require("../lavalink/autoplayV3"),
    tags: require("../lavalink/lastfmClient"),
  }),
  hasKey = () => Boolean(process.env.LASTFM_API_KEY),
  log = { debug() {} },
} = {}) {
  let modules = null;

  // [{ title, artist, uri, source, audioKey, durationMs, artworkUrl, score }], best first. Never throws for a seed with
  // no neighbours; a lookup that fails outright rejects, and the recommender tries again later.
  return async function discover({ title, artist }) {
    if (!hasKey() || !title || !artist) return [];
    modules ??= loadAutoplay();
    const { candidates: autoplay, v3, tags } = modules;

    const reference = autoplay.cleanTrackInfo(title, artist);
    if (!reference.cleanTitle || !reference.searchArtist) return [];
    const profile = await tags.getLastFmTagProfile({ artist: reference.searchArtist, title: reference.cleanTitle, limit: 8 });
    const seed = {
      info: { title: reference.cleanTitle, author: reference.searchArtist, identifier: `seed:${reference.searchArtist}:${reference.cleanTitle}` },
      userData: { autoplayReference: { title: reference.cleanTitle, artist: reference.searchArtist }, genres: profile?.tags ?? [] },
    };
    const context = v3.buildSelectionContext({
      profile: null, exposure: null, referenceTrack: seed, recentTracks: [], skipPatterns: null, anchorTrack: null, blockedTracks: [],
    });

    const found = await autoplay.fetchLastFmCandidates(reference, null, null);
    const rows = [];
    for (const candidate of found) {
      const info = candidate.track?.info;
      const audioKey = candidate.track ? audioKeyOf(candidate.track) : null; // null for a stream
      if (!info?.uri || !audioKey) continue;
      const scored = v3.scoreCandidateV3(candidate, context);
      if (!scored || scored.details?.genreFlow?.allowed === false || !(scored.score >= MIN_SCORE)) continue;
      rows.push({
        title: candidate.title,
        artist: candidate.artist,
        uri: info.uri,
        source: info.sourceName,
        audioKey,
        durationMs: info.length,
        artworkUrl: info.artworkUrl ?? null,
        score: scored.score,
      });
    }
    log.debug("mewbeat suggestions: discovered", `${reference.searchArtist} - ${reference.cleanTitle}`, `rows=${rows.length}`);
    return rows.sort((a, b) => b.score - a.score);
  };
}

module.exports = { createDiscoverer, MIN_SCORE };
