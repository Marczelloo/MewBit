const { audioKeyOf } = require("./audioKey");

// Finds new songs like a given one for the suggestions (recommendations.js), with the music bot's own autoplay
// search: Last.fm's similar tracks for the seed, each resolved to a playable Lavalink track, then scored by autoplay v3
// against the seed (genre flow and similarity), which drops what would not sit next to it. Nothing of autoplay is
// changed or started: no player, no queue, no AI service; it only calls the same lookups it does for a queue slot.
//
// One call is one Last.fm lookup plus up to a dozen Lavalink searches, so the recommender budgets how many run (see
// createSearchBudget). Without LASTFM_API_KEY the search has nothing to start from and answers an empty list.
// The autoplay modules load the player and Poru, so they are required on the first call, not when the bot starts.
//
// The player's taste in general. Autoplay's scorer reads no per-player profile (buildSelectionContext keeps `profile` but
// scoreCandidateV3 never looks at it); the one taste input it has is the anchor track, whose genre families give up to
// 30% of a candidate's genre score. So a seed may come with an `anchor`, a song the player listens to, and a candidate
// that fits the anchor's genres better than the seed's alone moves up by what the anchor adds (a few points, at most
// about nine). It never moves down and never drops a row: which rows qualify (the genre-flow gate and MIN_SCORE) is
// judged against the seed alone, as before.

const MIN_SCORE = 45;
// The candidates of a seed (the Last.fm lookup and a dozen Lavalink searches) are kept this long, so the same seed asked
// with another anchor, or again, costs nothing more.
const CANDIDATE_TTL_MS = 60 * 60_000;
const CANDIDATE_CACHE_MAX = 60;

function createDiscoverer({
  loadAutoplay = () => ({
    candidates: require("../lavalink/autoplayCandidates"),
    v3: require("../lavalink/autoplayV3"),
    tags: require("../lavalink/lastfmClient"),
  }),
  hasKey = () => Boolean(process.env.LASTFM_API_KEY),
  now = Date.now,
  log = { debug() {} },
} = {}) {
  let modules = null;
  const candidateCache = new Map(); // "artist|title" -> { at, promise }

  // The candidates of one seed, one lookup at a time however many players ask. A failed lookup is not kept.
  function candidatesOf(autoplay, reference) {
    const key = `${reference.searchArtist}|${reference.cleanTitle}`.toLowerCase();
    const cached = candidateCache.get(key);
    if (cached && now() - cached.at < CANDIDATE_TTL_MS) return cached.promise;
    const promise = Promise.resolve(autoplay.fetchLastFmCandidates(reference, null, null));
    candidateCache.set(key, { at: now(), promise });
    promise.catch(() => { if (candidateCache.get(key)?.promise === promise) candidateCache.delete(key); });
    while (candidateCache.size > CANDIDATE_CACHE_MAX) candidateCache.delete(candidateCache.keys().next().value);
    return promise;
  }

  // The anchor track as autoplay reads it: its genres are what counts. Null when it has none (Last.fm does not know it).
  async function anchorTrackOf(autoplay, tags, anchor) {
    if (!anchor?.title || !anchor?.artist) return null;
    const reference = autoplay.cleanTrackInfo(anchor.title, anchor.artist);
    if (!reference.cleanTitle || !reference.searchArtist) return null;
    const profile = await tags.getLastFmTagProfile({ artist: reference.searchArtist, title: reference.cleanTitle, limit: 8 });
    if (!profile?.tags?.length) return null;
    return {
      info: { title: reference.cleanTitle, author: reference.searchArtist, identifier: `anchor:${reference.searchArtist}:${reference.cleanTitle}` },
      userData: { genres: profile.tags },
    };
  }

  // [{ title, artist, uri, source, audioKey, durationMs, artworkUrl, score }], best first. Never throws for a seed with
  // no neighbours; a lookup that fails outright rejects, and the recommender tries again later.
  return async function discover({ title, artist }, { anchor = null } = {}) {
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

    // The same context with the player's taste as the anchor, its genre-flow gate off: only the score is read from it.
    const anchorTrack = await anchorTrackOf(autoplay, tags, anchor).catch(() => null);
    const tasted = anchorTrack
      ? { ...v3.buildSelectionContext({ profile: null, exposure: null, referenceTrack: seed, recentTracks: [], skipPatterns: null, anchorTrack, blockedTracks: [] }), genreFlowGate: false }
      : null;

    const found = await candidatesOf(autoplay, reference);
    const rows = [];
    for (const candidate of found) {
      const info = candidate.track?.info;
      const audioKey = candidate.track ? audioKeyOf(candidate.track) : null; // null for a stream
      if (!info?.uri || !audioKey) continue;
      const scored = v3.scoreCandidateV3(candidate, context);
      if (!scored || scored.details?.genreFlow?.allowed === false || !(scored.score >= MIN_SCORE)) continue;
      const withTaste = tasted ? v3.scoreCandidateV3(candidate, tasted) : null;
      const bonus = withTaste && Number.isFinite(withTaste.score) ? Math.max(0, withTaste.score - scored.score) : 0;
      rows.push({
        title: candidate.title,
        artist: candidate.artist,
        uri: info.uri,
        source: info.sourceName,
        audioKey,
        durationMs: info.length,
        artworkUrl: info.artworkUrl ?? null,
        score: scored.score + bonus,
      });
    }
    log.debug("mewbeat suggestions: discovered", `${reference.searchArtist} - ${reference.cleanTitle}`, `rows=${rows.length}`, anchorTrack ? "anchored" : "");
    return rows.sort((a, b) => b.score - a.score);
  };
}

module.exports = { createDiscoverer, MIN_SCORE };
