const Log = require("../logs/log");
const { getExposureKey, getExposureRecord } = require("./autoplayExposure");
const {
  enrichCandidateWithAutoplayMetadata,
  enrichCandidatesWithDeezerMetadata,
  getDeezerChartTracks,
  getDeezerAlbumTracks,
} = require("./autoplayMetadata");
const { AUTOPLAY_RESOLVE_TIMEOUT_MS } = require("./constants");
const { normalizeGenreTags } = require("./genreUtils");
const { getLastFmSimilarTracks, getLastFmTagProfile } = require("./lastfmClient");
const { normalizeReleaseYear } = require("./metadataValidation");
const { getPoru } = require("./players");
const { withTimeout } = require("./resolveTimeout");
const { searchSingleSource } = require("./searchAggregator");
const { filterPlayableSearchResults, rankSearchResults } = require("./searchRanking");
const { genreCache, isAutoplayTrack } = require("./sessionProfile");
const {
  cleanTrackMetadata,
  getAutoplayVersionCompatibility,
  getBaseTitle,
  getVariantKinds,
  normalizeComparableText,
} = require("./trackNormalization");
const { filterAutoplaySongs } = require("./trackValidation");

const LASTFM_AUTOPLAY_FETCH_LIMIT = Number(process.env.LASTFM_AUTOPLAY_FETCH_LIMIT ?? 18);
const LASTFM_AUTOPLAY_RESOLVE_LIMIT = Number(process.env.LASTFM_AUTOPLAY_RESOLVE_LIMIT ?? 12);
const USE_DEEZER_METADATA = process.env.AUTOPLAY_DEEZER_METADATA !== "false";
const AUTOPLAY_DEEZER_METADATA_LIMIT = Number(process.env.AUTOPLAY_DEEZER_METADATA_LIMIT ?? 18);
// Deezer and Spotify tracks are excellent catalogue/metadata candidates, but
// neither is a dependable direct audio transport on a self-hosted Lavalink.
// In particular, Deezer can accept a search and then reject the stream with a
// 403 at playback time. Resolve those candidates to a verified playable
// mirror before they ever enter the queue.
const MIRROR_ONLY_PLAYBACK_SOURCES = new Set(["deezer", "spotify"]);
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
const CONTROL_CHARACTER_PATTERN = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g"
);

function formatLogValue(value, maxLength = 160) {
  return String(value || "")
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(CONTROL_CHARACTER_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function getLavalinkNode() {
  return getPoru()?.leastUsedNodes?.[0] || null;
}

function getLavalinkBaseUrl() {
  const node = getLavalinkNode();
  const host = node?.options?.host || process.env.LAVALINK_HOST || "127.0.0.1";
  const port = node?.options?.port || Number(process.env.LAVALINK_PORT || 2333);
  const protocol = node?.options?.secure ? "https" : "http";
  return `${protocol}://${host}:${port}`;
}

async function loadLavalinkTracks(query) {
  const node = getLavalinkNode();
  const response = await fetch(`${getLavalinkBaseUrl()}/v4/loadtracks?identifier=${encodeURIComponent(query)}`, {
    headers: { Authorization: node?.options?.password || process.env.LAVALINK_PASSWORD || "youshallnotpass" },
  });

  if (!response.ok) throw new Error(`Lavalink search failed with status ${response.status}`);

  const data = await response.json();
  if (data?.loadType === "playlist") return data.data?.tracks || [];
  if (data?.loadType === "search") return Array.isArray(data.data) ? data.data : [];
  if (data?.loadType === "track") return data.data ? [data.data] : [];
  return [];
}

function candidateKey(candidate) {
  const canonicalKey = getExposureKey(candidate);
  if (canonicalKey) return `canonical:${canonicalKey}`;

  const identifier = candidate?.identifier || candidate?.track?.info?.identifier;
  return identifier ? `id:${identifier}` : null;
}

function mergeCandidates(candidates) {
  const merged = new Map();

  for (const candidate of candidates) {
    if (!candidate?.title || !candidate?.artist) continue;
    const key = candidateKey(candidate);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...candidate,
        genres: normalizeGenreTags(candidate.genres, { artist: candidate.artist, title: candidate.title }),
        providerSources: [candidate.source].filter(Boolean),
      });
      continue;
    }

    existing.genres = normalizeGenreTags([...(existing.genres || []), ...(candidate.genres || [])], {
      artist: existing.artist,
      title: existing.title,
    });
    const mergedFeatures = { ...(candidate.features || {}), ...(existing.features || {}) };
    existing.features = Object.keys(mergedFeatures).length ? mergedFeatures : null;
    existing.metadataChecked ||= candidate.metadataChecked;
    existing.metadataConfidence = Math.max(existing.metadataConfidence || 0, candidate.metadataConfidence || 0);
    existing.metadataProvider ||= candidate.metadataProvider;
    existing.deezerId ||= candidate.deezerId;
    existing.artistId ||= candidate.artistId;
    existing.albumId ||= candidate.albumId;
    existing.albumTitle ||= candidate.albumTitle;
    existing.trackPosition ||= candidate.trackPosition;
    existing.diskNumber ||= candidate.diskNumber;
    existing.isrc ||= candidate.isrc;
    existing.catalogRank ||= candidate.catalogRank;
    existing.similarity = Math.max(existing.similarity || 0, candidate.similarity || 0);
    existing.popularity = Math.max(existing.popularity || 0, candidate.popularity || 0);
    existing.releaseYear ||= candidate.releaseYear;
    existing.sameAlbum ||= candidate.sameAlbum;
    existing.track ||= candidate.track;
    existing.providerSources = [...new Set([...(existing.providerSources || []), candidate.source].filter(Boolean))];
  }

  return [...merged.values()];
}

function normalizeLastFmSimilarity(match, maximumMatch) {
  const value = Number(match);
  const max = Number(maximumMatch);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value <= 1) return Math.min(1, value);
  if (Number.isFinite(max) && max > 1) return Math.min(1, value / max);
  return Math.min(1, value / 100);
}

async function mapWithConcurrency(items, limit, worker) {
  const results = Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function getRelevantPlayableTrack(tracks, query) {
  return getRelevantPlayableTracks(tracks, query)[0] || null;
}

// Candidate collection talks to Lavalink's raw REST endpoint, while Poru's
// queue expects the same encoded value under `track`. Without this bridge,
// an otherwise valid Deezer candidate is resolved again only after the
// previous track ends. That late resolver call can hang and leave the player
// in a silent state with no TrackException event.
function normalizePlayableTrack(track) {
  const encoded = track?.track || track?.encoded;
  if (!track || !encoded) return null;

  return {
    ...track,
    track: encoded,
    info: { ...(track.info || {}) },
    pluginInfo: track.pluginInfo ? { ...track.pluginInfo } : undefined,
    userData: track.userData ? { ...track.userData } : undefined,
  };
}

function requiresVerifiedMirror(candidate = {}, track = candidate?.track) {
  const info = track?.info || {};
  const source = String(info.sourceName || info.source || candidate.source || "").trim().toLowerCase();
  return MIRROR_ONLY_PLAYBACK_SOURCES.has(source);
}

function getRelevantPlayableTracks(tracks, query) {
  const playable = filterPlayableSearchResults(filterAutoplaySongs(tracks || []), query);
  return rankSearchResults(playable, query);
}

function getTokenCoverage(needle, haystack) {
  const needleTokens = normalizeComparableText(needle).split(" ").filter(Boolean);
  const haystackTokens = new Set(normalizeComparableText(haystack).split(" ").filter(Boolean));
  if (!needleTokens.length) return 0;
  return needleTokens.filter((token) => haystackTokens.has(token)).length / needleTokens.length;
}

const UNEXPECTED_MASHUP_MARKER_PATTERN = /\b(?:mash\s*up|bootleg|blend|megamix|flip|ale\s+to|versus|vs\.?)(?:\b|$)/i;
const PROVIDER_UPLOADER_ALIAS_PATTERN = /\b(?:topic|vevo|official|records?|music|audio|channel|entertainment|lyrics?)\b/i;

function getProviderValidationIssue(candidate, track) {
  const candidateKinds = getVariantKinds(candidate?.title || "");
  const resolvedTitle = track?.info?.title || "";
  const resolvedKinds = getVariantKinds(resolvedTitle);
  const unexpectedKinds = resolvedKinds.filter((kind) => !candidateKinds.includes(kind));
  if (unexpectedKinds.length > 0) return `unexpected-version:${unexpectedKinds.join(",")}`;

  if (
    UNEXPECTED_MASHUP_MARKER_PATTERN.test(resolvedTitle) &&
    !UNEXPECTED_MASHUP_MARKER_PATTERN.test(candidate?.title || "")
  ) {
    return "unexpected-mashup-or-edit";
  }

  const expectedArtist = normalizeComparableText(candidate?.artist || "");
  const resolvedAuthor = normalizeComparableText(track?.info?.author || "");
  const resolvedText = `${resolvedAuthor} ${normalizeComparableText(resolvedTitle)}`.trim();
  const authorCoverage = getTokenCoverage(expectedArtist, resolvedAuthor);
  const combinedCoverage = getTokenCoverage(expectedArtist, resolvedText);
  const isUploaderAlias = PROVIDER_UPLOADER_ALIAS_PATTERN.test(resolvedAuthor);
  if (expectedArtist && authorCoverage < 0.5 && !(isUploaderAlias && combinedCoverage >= 0.5)) {
    return "provider-author-mismatch";
  }

  return null;
}

function matchesAutoplayCandidate(candidate, track) {
  const candidateTitle = getBaseTitle(candidate?.title || "");
  const candidateArtist = normalizeComparableText(candidate?.artist || "");
  const trackTitle = getBaseTitle(track?.info?.title || "");
  const trackArtist = normalizeComparableText(track?.info?.author || "");
  const combinedTrackText = `${trackArtist} ${trackTitle}`.trim();
  const titleCoverage = getTokenCoverage(candidateTitle, trackTitle);
  const artistCoverage = getTokenCoverage(candidateArtist, trackArtist);
  const combinedArtistCoverage = getTokenCoverage(candidateArtist, combinedTrackText);
  const uploaderAlias = PROVIDER_UPLOADER_ALIAS_PATTERN.test(trackArtist);

  return titleCoverage >= 0.75 && (artistCoverage >= 0.5 || (uploaderAlias && combinedArtistCoverage >= 0.5));
}

/**
 * Cleans up title for better search results
 * @param {string} title - Raw track title
 * @param {string} author - Raw track author
 * @returns {Object} Cleaned title and artist
 */
function cleanTrackInfo(title, author) {
  return cleanTrackMetadata(title, author);
}

function getAutoplayReference(track) {
  const canonical = track?.userData?.autoplayReference;
  return cleanTrackInfo(canonical?.title || track?.info?.title, canonical?.artist || track?.info?.author);
}

function applyCandidateMetadata(track, candidate) {
  track.userData = track.userData || {};
  const canonical = cleanTrackInfo(candidate.title, candidate.artist);

  if (canonical.cleanTitle && canonical.searchArtist) {
    track.userData.autoplayReference = {
      title: canonical.cleanTitle,
      artist: canonical.searchArtist,
    };
  }
  const normalizedGenres = normalizeGenreTags(candidate.genres, { artist: candidate.artist, title: candidate.title });
  if (normalizedGenres.length) track.userData.genres = normalizedGenres;
  if (candidate.moodTags?.length) track.userData.moodTags = normalizeGenreTags(candidate.moodTags, { artist: candidate.artist, title: candidate.title });
  if (candidate.features) track.userData.features = candidate.features;
  if (candidate.derivedFeatures) track.userData.derivedFeatures = candidate.derivedFeatures;
  if (candidate.metadataChecked) track.userData.metadataChecked = true;
  if (Number.isFinite(candidate.metadataConfidence)) track.userData.metadataConfidence = candidate.metadataConfidence;
  if (candidate.metadataProvider) track.userData.metadataProvider = candidate.metadataProvider;
  if (candidate.metadataSources?.length) track.userData.metadataSources = candidate.metadataSources;
  if (candidate.deezerId) track.userData.deezerId = candidate.deezerId;
  if (candidate.artistId) track.userData.artistId = candidate.artistId;
  if (candidate.albumId) track.userData.albumId = candidate.albumId;
  if (candidate.albumTitle) track.userData.albumTitle = candidate.albumTitle;
  if (Number.isFinite(candidate.trackPosition)) track.userData.trackPosition = candidate.trackPosition;
  if (Number.isFinite(candidate.diskNumber)) track.userData.diskNumber = candidate.diskNumber;
  if (candidate.isrc) {
    track.userData.isrc = candidate.isrc;
    track.userData.autoplayIsrc = candidate.isrc;
  }
  const releaseYear = normalizeReleaseYear(candidate.releaseYear);
  if (releaseYear) track.userData.releaseYear = releaseYear;

  return track;
}

async function enrichManualAnchorTracks(tracks, guildId) {
  const anchors = (Array.isArray(tracks) ? tracks : []).filter((track) => track && !isAutoplayTrack(track)).slice(0, 4);
  if (!anchors.length) return anchors;

  await mapWithConcurrency(anchors, 2, async (track) => {
    const reference = getAutoplayReference(track);
    if (!reference.cleanTitle || !reference.searchArtist) return;

    const candidate = {
      artist: reference.searchArtist,
      title: reference.cleanTitle,
      genres: track.userData?.genres || [],
      features: track.userData?.features || null,
      derivedFeatures: track.userData?.derivedFeatures || null,
      releaseYear: track.userData?.releaseYear || null,
      moodTags: track.userData?.moodTags || [],
      album: track.info?.albumName || track.info?.album?.name || "",
    };

    if (!candidate.genres.length) {
      const tagProfile = await getLastFmTagProfile({
        artist: reference.searchArtist,
        title: reference.cleanTitle,
        album: candidate.album,
        limit: 8,
      });
      if (tagProfile.tags.length) {
        candidate.genres = tagProfile.tags;
        candidate.metadataConfidence = tagProfile.confidence;
        candidate.metadataProvider = tagProfile.source;
      }
    }
    if (USE_DEEZER_METADATA) await enrichCandidateWithAutoplayMetadata(candidate);

    applyCandidateMetadata(track, candidate);
    track.userData.manual = true;
    track.userData.autoplay = false;

    if (track.info?.identifier && (candidate.genres?.length || candidate.features || candidate.derivedFeatures)) {
      genreCache.set(track.info.identifier, {
        genres: candidate.genres || [],
        features: candidate.features || null,
        derivedFeatures: candidate.derivedFeatures || null,
        metadataConfidence: candidate.metadataConfidence || 0,
        metadataProvider: candidate.metadataProvider || null,
        metadataSources: candidate.metadataSources || [],
        releaseYear: candidate.releaseYear || null,
        deezerId: candidate.deezerId || null,
        artistId: candidate.artistId || null,
        albumId: candidate.albumId || null,
        albumTitle: candidate.albumTitle || null,
        trackPosition: candidate.trackPosition || null,
        diskNumber: candidate.diskNumber || null,
      });
    }
  });

  Log.debug("Manual autoplay anchors enriched", "", `guild=${guildId}`, `count=${anchors.length}`);
  return anchors;
}

/**
 * Fetches Deezer recommendations via Lavalink
 * @param {string} guildId - Guild identifier
 * @param {string} cleanTitle - Cleaned track title
 * @param {string} searchArtist - Search artist name
 * @returns {Promise<Array>} Array of candidate tracks from Deezer
 */
async function fetchDeezerCandidates(guildId, cleanTitle, searchArtist) {
  const candidates = [];

  try {
    // Search for track on Deezer
    const deezerSearchQuery = `dzsearch:${searchArtist} ${cleanTitle}`;
    Log.info("🎵 Searching Deezer", "", `guild=${guildId}`, `query=${deezerSearchQuery}`);

    const deezerSearchTracks = await loadLavalinkTracks(deezerSearchQuery);

    if (deezerSearchTracks.length > 0) {
      const deezerTrack = getRelevantPlayableTrack(deezerSearchTracks, `${searchArtist} ${cleanTitle}`);
      if (!deezerTrack || !matchesAutoplayCandidate({ artist: searchArtist, title: cleanTitle }, deezerTrack)) {
        Log.debug("Rejected Deezer recommendation seed with mismatched identity", "", `guild=${guildId}`);
        return candidates;
      }
      let deezerTrackId = deezerTrack.info?.identifier;

      // Check if we got a Deezer track or YouTube fallback
      const sourceName = deezerTrack.info?.sourceName || deezerTrack.pluginInfo?.source || "unknown";
      const uri = deezerTrack.info?.uri || "";

      // Try to extract Deezer ID from URI if we got YouTube fallback
      if (sourceName === "youtube" && uri.includes("deezer.com")) {
        const match = uri.match(/\/track\/(\d+)/);
        if (match) {
          deezerTrackId = match[1];
        }
      }

      // Only proceed if we have numeric Deezer ID
      if (deezerTrackId && /^\d+$/.test(String(deezerTrackId))) {
        // Get recommendations from Deezer using dzrec: prefix
        const deezerRecQuery = `dzrec:${deezerTrackId}`;
        const deezerRecTracks = await loadLavalinkTracks(deezerRecQuery);

        if (deezerRecTracks.length > 0) {
          const validTracks = filterAutoplaySongs(deezerRecTracks).slice(0, 25);

          for (const track of validTracks) {
            candidates.push({
              artist: track.info?.author,
              title: track.info?.title,
              identifier: track.info?.identifier,
              duration: track.info?.length,
              source: "deezer_recommendations",
              track: track,
              genres: [],
              popularity: 0,
              releaseYear: null,
              features: null,
            });
          }

          Log.info(
            "✅ Deezer recommendations collected",
            "",
            `guild=${guildId}`,
            `count=${validTracks.length}`,
            `deezerID=${deezerTrackId}`
          );
        }
      }
    }
  } catch (err) {
    Log.warning("❌ Failed to get Deezer recommendations", err.message, `guild=${guildId}`);
  }

  return candidates;
}

async function fetchDeezerChartCandidates(guildId, { limit = 18 } = {}) {
  const chartTracks = await getDeezerChartTracks(limit);
  const candidates = chartTracks
    .filter((track) => Number(track.duration) >= 55_000)
    .map((track) => ({
      ...track,
      source: "deezer_chart",
      genres: [],
      releaseYear: null,
      features: null,
      metadataConfidence: 0.25,
      metadataProvider: "deezer-chart",
    }));
  Log.info("Deezer trending candidates collected", "", `guild=${guildId}`, `count=${candidates.length}`);
  return candidates;
}

async function fetchSameAlbumCandidates(guildId, referenceTrack, reference) {
  const referenceCandidate = {
    artist: reference.searchArtist,
    title: reference.cleanTitle,
    deezerId: referenceTrack.userData?.deezerId,
    albumId: referenceTrack.userData?.albumId,
    albumTitle: referenceTrack.userData?.albumTitle,
    trackPosition: referenceTrack.userData?.trackPosition,
  };

  try {
    const { metadata, tracks } = await getDeezerAlbumTracks(referenceCandidate, 12);
    if (!metadata?.albumId || tracks.length < 2) return [];

    const currentKey = getExposureKey(referenceCandidate);
    const neighbours = tracks.filter((track) => getExposureKey(track) !== currentKey).slice(0, 8);
    const resolved = await mapWithConcurrency(neighbours, 3, async (albumTrack) => {
      try {
        const direct = await loadLavalinkTracks(`https://www.deezer.com/track/${albumTrack.deezerId}`);
        const track = getRelevantPlayableTrack(direct, `${albumTrack.artist} ${albumTrack.title}`);
        if (!track || !matchesAutoplayCandidate(albumTrack, track)) return null;

        return {
          ...albumTrack,
          identifier: track.info?.identifier,
          duration: track.info?.length || albumTrack.duration,
          source: "same_album",
          track,
          genres: [],
          popularity: albumTrack.catalogRank || 0,
          releaseYear: null,
          features: null,
          metadataConfidence: 0.9,
          metadataProvider: "deezer-album",
          sameAlbum: true,
        };
      } catch {
        return null;
      }
    });

    const candidates = resolved.filter(Boolean);
    Log.info(
      "Deezer same-album candidates collected",
      "",
      `guild=${guildId}`,
      `album=${formatLogValue(metadata.albumTitle)}`,
      `count=${candidates.length}`
    );
    return candidates;
  } catch (error) {
    Log.debug("Same-album autoplay candidates failed", error.message, `guild=${guildId}`);
    return [];
  }
}

function getLastFmExposureWeight(track, reference, exposure, now = Date.now()) {
  if (!exposure) return 0;

  const ttlMs = Math.max(Number(exposure.ttlMs) || 0, 1);
  const halfLifeMs = Math.max(ttlMs / 3, 60 * 60 * 1000);
  const freshness = (entry) => {
    if (!entry) return 0;
    const ageMs = Math.max(0, now - Number(entry.lastSeen || 0));
    return (Number(entry.count) || 1) * Math.exp(-ageMs / halfLifeMs);
  };

  const trackKey = getExposureKey(track);
  const referenceKey = getExposureKey({ title: reference.cleanTitle, artist: reference.searchArtist });
  const transitionKey = trackKey && referenceKey ? `${referenceKey}=>${trackKey}` : null;

  return freshness(getExposureRecord(exposure, trackKey)) + freshness(getExposureRecord(exposure, transitionKey, "transitions"));
}

async function fetchLastFmCandidates(reference, guildId, exposure = null) {
  const candidates = [];

  try {
    const similarTracks = await getLastFmSimilarTracks({
      artist: reference.searchArtist,
      title: reference.cleanTitle,
      limit: Math.max(LASTFM_AUTOPLAY_FETCH_LIMIT, LASTFM_AUTOPLAY_RESOLVE_LIMIT),
    });

    const maximumMatch = Math.max(...similarTracks.map((track) => Number(track.match) || 0), 0);

    // Last.fm returns a stable ordered list. Keep that order for fresh tracks,
    // but move recently exposed neighbours behind unseen ones before paying
    // the Lavalink resolution cost.
    const orderedSimilar = similarTracks
      .map((track, index) => ({ track, index }))
      .sort((left, right) => {
        const exposureDifference =
          getLastFmExposureWeight(left.track, reference, exposure) - getLastFmExposureWeight(right.track, reference, exposure);
        return exposureDifference || left.index - right.index;
      })
      .slice(0, Math.max(LASTFM_AUTOPLAY_RESOLVE_LIMIT, 1))
      .map(({ track }) => track);

    // Tags add useful genre evidence but Last.fm is a shared service. Eight
    // strong neighbours with a small worker pool are enough for a queue slot.
    const resolved = await mapWithConcurrency(orderedSimilar, 2, async (similar) => {
        try {
          const query = `${similar.artist} ${similar.title}`;
          const tracks = await loadLavalinkTracks(`ytsearch:${query}`);
          const track = getRelevantPlayableTrack(tracks, query);
          if (!track) return null;

          const tagProfile = await getLastFmTagProfile({ artist: similar.artist, title: similar.title, limit: 8 });

          return {
            artist: similar.artist,
            title: similar.title,
            identifier: track.info?.identifier,
            duration: track.info?.length,
            source: "lastfm_similar",
            track,
            genres: tagProfile.tags,
            metadataConfidence: tagProfile.confidence,
            metadataProvider: tagProfile.source,
            // This is a collaborative-similarity signal, not catalog
            // popularity. Keeping it separate prevents a great match from
            // being penalized as an overplayed track.
            similarity: normalizeLastFmSimilarity(similar.match, maximumMatch),
            popularity: 0,
            releaseYear: null,
            features: null,
          };
        } catch {
          return null;
        }
      });

    candidates.push(...resolved.filter(Boolean));
    Log.info("Last.fm similar candidates collected", "", `guild=${guildId}`, `count=${candidates.length}`);
  } catch (error) {
    Log.debug("Last.fm autoplay candidates failed", error.message);
  }

  return candidates;
}

function selectTagEnrichmentTargets(candidates, limit = 9) {
  const buckets = new Map();
  for (const candidate of candidates) {
    if (candidate.source === "lastfm_similar" || candidate.genres?.length || !candidate.artist || !candidate.title) continue;
    const source = candidate.source || "unknown";
    if (!buckets.has(source)) buckets.set(source, []);
    buckets.get(source).push(candidate);
  }

  const targets = [];
  while (targets.length < limit) {
    let added = false;
    for (const bucket of buckets.values()) {
      const candidate = bucket.shift();
      if (!candidate) continue;
      targets.push(candidate);
      added = true;
      if (targets.length === limit) break;
    }
    if (!added) break;
  }
  return targets;
}

async function enrichCandidatesWithLastFmTags(candidates, guildId, limit = 9) {
  const targets = selectTagEnrichmentTargets(candidates, limit);

  if (!targets.length) return candidates;

  await mapWithConcurrency(targets, 2, async (candidate) => {
    const tagProfile = await getLastFmTagProfile({ artist: candidate.artist, title: candidate.title, limit: 8 });
    if (tagProfile.tags.length) {
      candidate.genres = tagProfile.tags;
      candidate.metadataConfidence = Math.max(candidate.metadataConfidence || 0, tagProfile.confidence);
      candidate.metadataProvider ||= tagProfile.source;
    }
  });

  Log.info(
    "Last.fm candidate tags enriched",
    "",
    `guild=${guildId}`,
    `requested=${targets.length}`,
    `tagged=${targets.filter((candidate) => candidate.genres?.length).length}`
  );
  return candidates;
}

/**
 * Fetches YouTube Mix Radio candidates
 * @param {string} identifier - YouTube video identifier
 * @param {string} guildId - Guild identifier
 * @returns {Promise<Array>} Array of candidate tracks from YouTube Mix
 */
async function fetchYouTubeMixCandidates(identifier, guildId) {
  const candidates = [];
  const poru = getPoru();

  try {
    Log.info("🎵 Fetching YouTube Mix", "", `guild=${guildId}`);
    const radioQuery = `https://www.youtube.com/watch?v=${identifier}&list=RD${identifier}`;
    const radioRes = await poru.resolve({ query: radioQuery });

    if (radioRes?.tracks?.length > 1) {
      const validTracks = filterAutoplaySongs(radioRes.tracks.slice(1, 21));

      validTracks.forEach((track) => {
        candidates.push({
          artist: track.info?.author,
          title: track.info?.title,
          identifier: track.info?.identifier,
          duration: track.info?.length,
          source: "youtube_mix",
          track: track,
          genres: [],
          popularity: 0,
          releaseYear: null,
          features: null,
        });
      });

      Log.info("✅ YouTube Mix candidates collected", "", `guild=${guildId}`, `count=${validTracks.length}`);
    }
  } catch (err) {
    Log.warning("❌ Failed to get YouTube Mix", err.message, `guild=${guildId}`);
  }

  return candidates;
}

/**
 * Collects candidate tracks from every available free source in parallel.
 * The AI director chooses between them; broad artist searches stay excluded
 * because they were the main source of unrelated fallback picks.
 *
 * @param {Object} referenceTrack - Reference track to base candidates on
 * @param {string} guildId - Guild identifier
 * @param {Object} profile - Session profile from buildSessionProfile
 * @param {Object} reference - Canonical cleaned reference identity
 * @param {Object} options - Optional source subset selection
 * @returns {Promise<Array>} Array of candidate tracks
 */
async function collectCandidates(referenceTrack, guildId, profile, reference, {
  sources = null,
  enrichLastFmTags = true,
  enrichDeezerMetadata = USE_DEEZER_METADATA,
} = {}) {
  const { identifier } = referenceTrack.info;
  const { cleanTitle, searchArtist } = reference;

  const candidateSources = [
    ["sameAlbum", () => fetchSameAlbumCandidates(guildId, referenceTrack, reference)],
    ["deezer", () => fetchDeezerCandidates(guildId, cleanTitle, searchArtist)],
    ["lastfm", () => fetchLastFmCandidates(reference, guildId, profile.autoplayExposure)],
    ["youtubeMix", () => fetchYouTubeMixCandidates(identifier, guildId)],
    ["deezerChart", () => fetchDeezerChartCandidates(guildId)],
  ];

  const selectedSources = Array.isArray(sources)
    ? candidateSources.filter(([name]) => sources.includes(name))
    : candidateSources;
  const sourceResults = await Promise.allSettled(selectedSources.map(([, load]) => load()));
  const allCandidates = sourceResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const deduplicatedCandidates = mergeCandidates(allCandidates);
  if (enrichLastFmTags) await enrichCandidatesWithLastFmTags(deduplicatedCandidates, guildId);
  if (enrichDeezerMetadata) {
    await enrichCandidatesWithDeezerMetadata(deduplicatedCandidates, AUTOPLAY_DEEZER_METADATA_LIMIT);
  }

  Log.info(
    "📊 Candidate collection complete",
    "",
    `guild=${guildId}`,
    `raw=${allCandidates.length}`,
    `unique=${deduplicatedCandidates.length}`,
    `metadata=${deduplicatedCandidates.filter((candidate) => candidate.metadataConfidence > 0).length}`,
    `sources=${[...new Set(allCandidates.map((candidate) => candidate.source))].join(",") || "none"}`
  );

  return deduplicatedCandidates;
}

/**
 * Resolves a candidate to a playable Poru track
 * @param {Object} candidate - Candidate track object
 * @param {string} guildId - Guild identifier
 * @returns {Promise<Object|null>} Poru track object or null
 */
async function resolveToPlayable(candidate, guildId, { referenceTitle = "", providerSources = null, debugLabel = "candidate" } = {}) {
  const candidateVersion = getAutoplayVersionCompatibility(candidate?.title, referenceTitle);
  if (!candidateVersion.allowed) {
    Log.debug(
      "Skipping unmatched alternate-version autoplay candidate",
      "",
      `guild=${guildId}`,
      `title=${formatLogValue(candidate.title)}`,
      `mode=${candidateVersion.mode}`
    );
    return null;
  }

  const directTrack = normalizePlayableTrack(candidate.track);
  if (directTrack && !requiresVerifiedMirror(candidate, directTrack)) {
    const resolvedVersion = getAutoplayVersionCompatibility(directTrack.info?.title, candidate.title);
    if (!resolvedVersion.allowed || (getVariantKinds(candidate.title).length && !getVariantKinds(directTrack.info?.title).length)) {
      Log.debug(
        "Skipping mismatched alternate-version autoplay resolution",
        "",
        `guild=${guildId}`,
        `resolved=${formatLogValue(directTrack.info?.title)}`,
        `mode=${resolvedVersion.mode}`
      );
      return null;
    }
    const directProviderIssue = getProviderValidationIssue(candidate, directTrack);
    if (directProviderIssue) {
      Log.debug(
        "Skipping provider track with suspicious autoplay identity",
        "",
        `guild=${guildId}`,
        `reason=${directProviderIssue}`,
        `resolved=${formatLogValue(`${directTrack.info?.author} - ${directTrack.info?.title}`)}`
      );
      return null;
    }
    if (!matchesAutoplayCandidate(candidate, directTrack)) {
      Log.debug(
        "Skipping provider track with mismatched canonical identity",
        "",
        `guild=${guildId}`,
        `expected=${formatLogValue(`${candidate.artist} - ${candidate.title}`)}`,
        `resolved=${formatLogValue(`${directTrack.info?.author} - ${directTrack.info?.title}`)}`
      );
      return null;
    }
    return applyCandidateMetadata(directTrack, candidate);
  }

  if (directTrack) {
    Log.debug(
      "Autoplay candidate requires a verified playback mirror",
      "",
      `guild=${guildId}`,
      `source=${directTrack.info?.sourceName || candidate.source || "unknown"}`,
      `candidate=${formatLogValue(`${candidate.artist} - ${candidate.title}`)}`
    );
  }

  const poru = getPoru();
  const searchTitle = getVariantKinds(candidate.title).length ? candidate.title : getBaseTitle(candidate.title);
  const searchQuery = `${candidate.artist} ${searchTitle}`;
  const sources = requiresVerifiedMirror(candidate, directTrack)
    ? ["youtube", "soundcloud"]
    : Array.isArray(providerSources) && providerSources.length
      ? providerSources
      : ["legacy-youtube"];

  for (const source of sources) {
    try {
      const tracks = source === "legacy-youtube"
        ? (await withTimeout(
          poru.resolve({ query: `ytsearch:${searchQuery}` }),
          AUTOPLAY_RESOLVE_TIMEOUT_MS,
          `Autoplay YouTube resolver (${searchQuery})`
        )).tracks || []
        : await withTimeout(
          // Catalog metadata is already spelled correctly.
          searchSingleSource(poru, searchQuery, source, { variantLimit: 0 }),
          AUTOPLAY_RESOLVE_TIMEOUT_MS,
          `Autoplay ${source} resolver (${searchQuery})`
        );
      const rankedTracks = getRelevantPlayableTracks(tracks, searchQuery).slice(0, 6);
      if (!rankedTracks.length) {
        Log.debug("Autoplay proposal provider returned no playable result", "", `guild=${guildId}`, `label=${debugLabel}`, `provider=${source}`, `query=${formatLogValue(searchQuery)}`);
        continue;
      }

      for (const track of rankedTracks) {
        if (!getAutoplayVersionCompatibility(track.info?.title, candidate.title).allowed) {
          Log.debug("Autoplay proposal rejected after provider resolution", "", `guild=${guildId}`, `label=${debugLabel}`, `provider=${source}`, "reason=version-mismatch");
          continue;
        }
        const providerIssue = getProviderValidationIssue(candidate, track);
        if (providerIssue) {
          Log.debug("Autoplay proposal rejected after provider resolution", "", `guild=${guildId}`, `label=${debugLabel}`, `provider=${source}`, `reason=${providerIssue}`);
          continue;
        }
        if (!matchesAutoplayCandidate(candidate, track)) {
          Log.debug("Autoplay proposal rejected after provider resolution", "", `guild=${guildId}`, `label=${debugLabel}`, `provider=${source}`, "reason=canonical-identity-mismatch");
          continue;
        }

        applyCandidateMetadata(track, candidate);
        if (track.info?.identifier) {
          genreCache.set(track.info.identifier, {
            genres: candidate.genres || [], features: candidate.features || null, derivedFeatures: candidate.derivedFeatures || null,
            metadataConfidence: candidate.metadataConfidence || 0, metadataProvider: candidate.metadataProvider || null,
            metadataSources: candidate.metadataSources || [], releaseYear: candidate.releaseYear || null,
            deezerId: candidate.deezerId || null, artistId: candidate.artistId || null, albumId: candidate.albumId || null,
            albumTitle: candidate.albumTitle || null, trackPosition: candidate.trackPosition || null, diskNumber: candidate.diskNumber || null,
          });
        }
        Log.info("Resolved candidate to playable track", "", `guild=${guildId}`, `label=${debugLabel}`, `provider=${source}`, `query=${formatLogValue(searchQuery)}`, `genres=${candidate.genres?.join(", ") || "unknown"}`);
        return track;
      }
    } catch (err) {
      Log.debug("Autoplay proposal provider resolution failed", err.message, `guild=${guildId}`, `label=${debugLabel}`, `provider=${source}`, `query=${formatLogValue(searchQuery)}`);
    }
  }

  return null;
}

module.exports = {
  AUTOPLAY_DEEZER_METADATA_LIMIT,
  USE_DEEZER_METADATA,
  applyCandidateMetadata,
  candidateKey,
  cleanTrackInfo,
  collectCandidates,
  enrichCandidatesWithLastFmTags,
  enrichManualAnchorTracks,
  fetchDeezerCandidates,
  fetchDeezerChartCandidates,
  fetchLastFmCandidates,
  fetchSameAlbumCandidates,
  fetchYouTubeMixCandidates,
  formatLogValue,
  getAutoplayReference,
  getProviderValidationIssue,
  normalizePlayableTrack,
  requiresVerifiedMirror,
  getRelevantPlayableTrack,
  getRelevantPlayableTracks,
  loadLavalinkTracks,
  matchesAutoplayCandidate,
  mergeCandidates,
  resolveToPlayable,
  selectTagEnrichmentTargets,
};
