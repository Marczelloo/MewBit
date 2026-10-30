const Log = require("../logs/log");
const { getGenreFamilies, normalizeGenreTags } = require("./genreUtils");
const { normalizeReleaseYear } = require("./metadataValidation");
const { playbackState } = require("./state");
const { cleanArtistName } = require("./trackNormalization");

const sessionStartTime = new Map();
const genreCache = new Map();
const AUTOPLAY_VIBE_WEIGHT = 0.3;
const MANUAL_CONTEXT_LIMIT = Math.max(Number(process.env.AUTOPLAY_MANUAL_CONTEXT_LIMIT ?? 12), 1);
const MANUAL_MEMORY_LIMIT = Math.max(Number(process.env.AUTOPLAY_MANUAL_MEMORY_LIMIT ?? 40), MANUAL_CONTEXT_LIMIT);
const PENDING_MANUAL_CONTEXT_LIMIT = Math.max(Number(process.env.AUTOPLAY_PENDING_MANUAL_CONTEXT_LIMIT ?? 4), 1);
const AUTOPLAY_ARTIST_WINDOW = Math.max(Number(process.env.AUTOPLAY_ARTIST_WINDOW ?? 5), 3);

function isAutoplayTrack(track) {
  return Boolean(track?.userData?.autoplay || track?.info?.autoplayed);
}

function isManualTrack(track) {
  return Boolean(track) && !isAutoplayTrack(track);
}

function getTrackContextKey(track) {
  const identifier = track?.info?.identifier;
  if (identifier) return `id:${identifier}`;
  return `text:${String(track?.info?.author || "").toLowerCase()}|${String(track?.info?.title || "").toLowerCase()}`;
}

function uniqueTracks(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    if (!track) return false;
    const key = getTrackContextKey(track);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildManualAnchorRecords(manualHistory, pendingManualTracks) {
  const played = uniqueTracks(manualHistory.slice(-MANUAL_CONTEXT_LIMIT)).map((track, index, tracks) => ({
    track,
    type: "played",
    weight: Number((0.85 + ((index + 1) / Math.max(tracks.length, 1)) * 0.2).toFixed(2)),
  }));
  const queued = uniqueTracks(pendingManualTracks.slice(0, PENDING_MANUAL_CONTEXT_LIMIT)).map((track) => ({
    track,
    type: "queued",
    weight: 1.35,
  }));

  return [...queued, ...played];
}

function buildManualTasteProfile(manualTracks) {
  const genreCounts = {};
  const familySet = new Set();
  const featureValues = {};
  const tracks = uniqueTracks(manualTracks).slice(-MANUAL_CONTEXT_LIMIT);

  tracks.forEach((track) => {
    const metadata = getTrackMetadata(track);
    metadata.genres.forEach((genre) => {
      genreCounts[genre] = (genreCounts[genre] || 0) + 1;
      getGenreFamilies([genre]).forEach((family) => familySet.add(family));
    });

    const features = getContinuityFeatures(metadata);
    if (!features) return;
    for (const field of ["tempo", "energy", "valence", "danceability"]) {
      if (Number.isFinite(features[field])) {
        featureValues[field] ||= [];
        featureValues[field].push(features[field]);
      }
    }
  });

  const manualTasteGenres = Object.entries(genreCounts)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 10)
    .map(([genre, count]) => ({ genre, count, weight: count / Math.max(tracks.length, 1) }));
  const manualTasteFeatures = Object.fromEntries(
    Object.entries(featureValues).map(([field, values]) => [
      field,
      values.reduce((sum, value) => sum + value, 0) / values.length,
    ])
  );

  return {
    genres: manualTasteGenres,
    genreFamilies: [...familySet],
    features: Object.keys(manualTasteFeatures).length ? manualTasteFeatures : null,
  };
}

function getManualMemoryTracks(tracks) {
  const seen = new Set();
  const newestFirst = [];
  for (let index = tracks.length - 1; index >= 0; index -= 1) {
    const track = tracks[index];
    if (!track) continue;
    const key = getTrackContextKey(track);
    if (seen.has(key)) continue;
    seen.add(key);
    newestFirst.push(track);
    if (newestFirst.length >= MANUAL_MEMORY_LIMIT) break;
  }
  return newestFirst.reverse();
}

function buildManualMemory(manualTracks) {
  const tracks = getManualMemoryTracks(manualTracks);
  const artists = new Map();
  const albums = new Map();

  tracks.forEach((track, index) => {
    const artist = getSessionArtist(track);
    if (artist) {
      const entry = artists.get(artist) || { artist, count: 0, lastIndex: index };
      entry.count += 1;
      entry.lastIndex = index;
      artists.set(artist, entry);
    }

    const metadata = getTrackMetadata(track);
    const album = String(metadata.albumTitle || "").trim();
    if (!album || !artist) return;
    const key = `${artist.toLowerCase()}|${album.toLowerCase()}`;
    const entry = albums.get(key) || { artist, album, count: 0, lastIndex: index };
    entry.count += 1;
    entry.lastIndex = index;
    albums.set(key, entry);
  });

  const sortMemory = (left, right) => right.count - left.count || right.lastIndex - left.lastIndex;
  return {
    tracks,
    artists: [...artists.values()].sort(sortMemory).slice(0, 16).map(({ artist, count }) => ({ artist, count })),
    albums: [...albums.values()].sort(sortMemory).slice(0, 16).map(({ artist, album, count }) => ({ artist, album, count })),
  };
}

function getTrackMetadata(track) {
  const identifier = track?.info?.identifier;
  const direct = track?.userData || {};
  const cached = genreCache.get(identifier) || {};
  const artist = cleanArtistName(direct.autoplayReference?.artist || track?.info?.author);
  const title = direct.autoplayReference?.title || track?.info?.title;
  const rawGenres = Array.isArray(direct.genres) && direct.genres.length > 0 ? direct.genres : cached.genres || [];

  return {
    genres: normalizeGenreTags(rawGenres, { artist, title }),
    features: direct.features || cached.features || null,
    derivedFeatures: direct.derivedFeatures || cached.derivedFeatures || null,
    metadataConfidence: Math.max(Number(direct.metadataConfidence) || 0, Number(cached.metadataConfidence) || 0),
    metadataProvider: direct.metadataProvider || cached.metadataProvider || null,
    metadataSources: direct.metadataSources || cached.metadataSources || [],
    releaseYear: normalizeReleaseYear(direct.releaseYear) || normalizeReleaseYear(cached.releaseYear),
    deezerId: direct.deezerId || cached.deezerId || null,
    artistId: direct.artistId || cached.artistId || null,
    albumId: direct.albumId || cached.albumId || null,
    albumTitle: direct.albumTitle || cached.albumTitle || track?.info?.albumName || track?.info?.album?.name || null,
    trackPosition: direct.trackPosition || cached.trackPosition || null,
    diskNumber: direct.diskNumber || cached.diskNumber || null,
  };
}

function getContinuityFeatures(metadata = {}) {
  return {
    ...(metadata.derivedFeatures || {}),
    ...(metadata.features || {}),
  };
}

function getSmoothedTarget(values, trend) {
  const recent = values.slice(-4).filter(Number.isFinite);
  if (!recent.length) return null;

  const weightTotal = recent.reduce((sum, _value, index) => sum + index + 1, 0);
  const smoothed = recent.reduce((sum, value, index) => sum + value * (index + 1), 0) / weightTotal;
  const direction = trend === "increasing" ? 0.06 : trend === "decreasing" ? -0.06 : 0;
  return Math.max(0, Math.min(1, Number((smoothed + direction).toFixed(3))));
}

function getSessionArtist(track) {
  return cleanArtistName(track?.userData?.autoplayReference?.artist || track?.info?.author || "Unknown") || "Unknown";
}

/**
 * Builds a comprehensive profile of the listening session
 * @param {string} guildId - Guild identifier
 * @param {Object} referenceTrack - Current or last played track
 * @returns {Object} Session profile with artists, genres, features, trends
 */
/**
 * `liveTracks` is what the player holds right now, the playing track first
 * and then the queue. History only gains a track when it ends, so without
 * them a pick chosen for a queued reference could repeat the song playing.
 */
function buildSessionProfile(guildId, referenceTrack, { pendingManualTracks = [], liveTracks = [] } = {}) {
  const state = playbackState.get(guildId);
  const history = state?.history || [];
  const recentAutoplayTracks = (state?.autoplayHistory || []).map((entry) => entry.track).filter(Boolean).slice(-20);
  const manualHistory = Array.isArray(state?.manualHistory) ? state.manualHistory : history.filter(isManualTrack);
  const pendingManual = pendingManualTracks.filter(isManualTrack).slice(0, PENDING_MANUAL_CONTEXT_LIMIT);

  Log.debug(
    "Building session profile",
    "",
    `guild=${guildId}`,
    `historyLength=${history.length}`,
    `referenceTrack=${referenceTrack?.info?.title || "none"}`,
    `historyTracks=${history
      .slice(-5)
      .map((t) => t.info?.title || "unknown")
      .join(" → ")}`
  );

  const live = liveTracks.filter(Boolean);
  const referenceIndex = live.indexOf(referenceTrack);
  // Plays before the pick; queued manual tracks already reach the plan as upcoming.
  const playsFirst = (referenceIndex > 0 ? live.slice(0, referenceIndex) : [])
    .filter((track) => !pendingManual.includes(track));
  const recentTracks = uniqueTracks([...history.slice(-14), ...playsFirst, referenceTrack]);
  const cooldownTracks = [...history, ...recentAutoplayTracks, ...live, referenceTrack].filter(Boolean).slice(-160);
  const manualHistoryWithReference = isManualTrack(referenceTrack) ? [...manualHistory, referenceTrack] : manualHistory;
  const manualAnchorRecords = buildManualAnchorRecords(manualHistoryWithReference, pendingManual);
  const manualAnchorTracks = manualAnchorRecords.map((record) => record.track);
  const manualTaste = buildManualTasteProfile(manualHistoryWithReference);
  const manualMemory = buildManualMemory(manualHistoryWithReference);
  const manualAnchorGenreFamilies = [
    ...new Set(manualAnchorRecords.flatMap((record) => getGenreFamilies(getTrackMetadata(record.track).genres))),
  ];
  let autoplayStreak = 0;
  for (let index = recentTracks.length - 1; index >= 0; index -= 1) {
    if (!isAutoplayTrack(recentTracks[index])) break;
    autoplayStreak += 1;
  }
  const recentAutoplayArtists = recentTracks
    .filter(isAutoplayTrack)
    .slice(-AUTOPLAY_ARTIST_WINDOW)
    .map(getSessionArtist)
    .filter(Boolean);
  let autoplayArtistStreak = 0;
  if (recentTracks.at(-1) && isAutoplayTrack(recentTracks.at(-1))) {
    const lastAutoplayArtist = getSessionArtist(recentTracks.at(-1));
    for (let index = recentTracks.length - 1; index >= 0; index -= 1) {
      const track = recentTracks[index];
      if (!isAutoplayTrack(track) || getSessionArtist(track) !== lastAutoplayArtist) break;
      autoplayArtistStreak += 1;
    }
  }

  if (recentTracks.length === 0) {
    return {
      topArtists: [],
      artistCounts: {},
      avgDuration: 0,
      totalTracks: 0,
      recentIdentifiers: [],
      topGenres: [],
      genreCounts: {},
      avgFeatures: null,
      avgTempo: null,
      avgYear: null,
      energyTrend: null,
      valenceTrend: null,
      energyTarget: null,
      valenceTarget: null,
      measuredEnergyTarget: null,
      measuredValenceTarget: null,
      referenceGenres: [],
      referenceGenreFamilies: [],
      referenceFeatures: null,
      referenceDerivedFeatures: null,
      referenceMetadataConfidence: 0,
      referenceArtist: getSessionArtist(referenceTrack),
      referenceAlbumId: null,
      referenceAlbumTitle: null,
      avgDerivedFeatures: null,
      recentGenreFamilies: [],
      recentTracks: [],
      recentAutoplayTracks: [],
      cooldownTracks: [],
      manualHistory: [],
      pendingManualTracks: pendingManual,
      manualAnchorTracks: pendingManual,
      manualAnchorRecords: buildManualAnchorRecords([], pendingManual),
      manualAnchorGenreFamilies: [],
      manualTasteGenres: [],
      manualTasteGenreFamilies: [],
      manualTasteFeatures: null,
      manualMemoryTracks: [],
      manualArtistMemory: [],
      manualAlbumMemory: [],
      recentAutoplayArtists: [],
      autoplayArtistStreak: 0,
      referenceIsManual: isManualTrack(referenceTrack),
      referenceIsAutoplay: isAutoplayTrack(referenceTrack),
      autoplayStreak: 0,
    };
  }

  const artistCounts = {};
  const genreCounts = {};
  let totalDuration = 0;
  const identifiers = [];
  const featuresList = [];
  const derivedFeaturesList = [];
  const tempos = [];
  const years = [];
  const energyValues = [];
  const valenceValues = [];
  const measuredEnergyValues = [];
  const measuredValenceValues = [];
  const recentGenreFamilies = [];
  let referenceMetadata = {
    genres: [],
    features: null,
    derivedFeatures: null,
    metadataConfidence: 0,
    metadataProvider: null,
    metadataSources: [],
    releaseYear: null,
    deezerId: null,
    artistId: null,
    albumId: null,
    albumTitle: null,
    trackPosition: null,
    diskNumber: null,
  };

  let profileWeightTotal = 0;

  recentTracks.forEach((track, index) => {
    const artist = getSessionArtist(track);
    const duration = track.info?.length || 0;
    const id = track.info?.identifier;

    // The room's manual selections are the anchor. Autoplay entries still
    // influence continuity, but cannot slowly teach the recommender to drift
    // away from what listeners actually selected.
    const trackWeight = isAutoplayTrack(track) ? AUTOPLAY_VIBE_WEIGHT : 1;
    profileWeightTotal += trackWeight;
    artistCounts[artist] = (artistCounts[artist] || 0) + trackWeight;
    totalDuration += duration;
    if (id) identifiers.push(id);

    const metadata = getTrackMetadata(track);
    const cachedGenres = metadata.genres;
    const cachedFeatures = metadata.features;
    const continuityFeatures = getContinuityFeatures(metadata);
    const cachedYear = metadata.releaseYear;

    if (index === recentTracks.length - 1) {
      referenceMetadata = metadata;
    }

    cachedGenres.forEach((genre) => {
      genreCounts[genre] = (genreCounts[genre] || 0) + trackWeight;
    });
    recentGenreFamilies.push(...getGenreFamilies(cachedGenres));

    if (cachedFeatures) {
      featuresList.push(cachedFeatures);
      if (Number.isFinite(cachedFeatures.tempo)) {
        tempos.push(cachedFeatures.tempo);
      }
    }

    if (Number.isFinite(continuityFeatures.energy)) energyValues.push(continuityFeatures.energy);
    if (Number.isFinite(continuityFeatures.valence)) valenceValues.push(continuityFeatures.valence);
    if (Number.isFinite(metadata.features?.energy)) measuredEnergyValues.push(metadata.features.energy);
    if (Number.isFinite(metadata.features?.valence)) measuredValenceValues.push(metadata.features.valence);

    if (metadata.derivedFeatures) derivedFeaturesList.push(metadata.derivedFeatures);

    if (cachedYear) {
      years.push(cachedYear);
    }
  });

  const topArtists = Object.entries(artistCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([artist, count]) => ({ artist, count, weight: count / profileWeightTotal }));

  const topGenres = Object.entries(genreCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([genre, count]) => ({ genre, count, weight: count / profileWeightTotal }));

  const avgDuration = totalDuration / recentTracks.length;

  let avgFeatures = null;
  if (featuresList.length > 0) {
    const averageFeature = (name) => {
      const values = featuresList.map((features) => features[name]).filter(Number.isFinite);
      return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };

    avgFeatures = {
      energy: averageFeature("energy"),
      danceability: averageFeature("danceability"),
      valence: averageFeature("valence"),
      acousticness: averageFeature("acousticness"),
      tempo: averageFeature("tempo"),
    };
  }

  let avgDerivedFeatures = null;
  if (derivedFeaturesList.length > 0) {
    const averageDerivedFeature = (name) => {
      const values = derivedFeaturesList.map((features) => features[name]).filter(Number.isFinite);
      return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };

    avgDerivedFeatures = {
      energy: averageDerivedFeature("energy"),
      danceability: averageDerivedFeature("danceability"),
      valence: averageDerivedFeature("valence"),
    };
  }

  const avgTempo = tempos.length > 0 ? tempos.reduce((sum, t) => sum + t, 0) / tempos.length : null;

  const avgYear = years.length > 0 ? Math.round(years.reduce((sum, y) => sum + y, 0) / years.length) : null;

  let energyTrend = null;
  if (energyValues.length >= 3) {
    const recent = energyValues.slice(-5);
    const first =
      recent.slice(0, Math.ceil(recent.length / 2)).reduce((a, b) => a + b, 0) / Math.ceil(recent.length / 2);
    const last = recent.slice(Math.ceil(recent.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(recent.length / 2);
    const diff = last - first;

    if (diff > 0.1) energyTrend = "increasing";
    else if (diff < -0.1) energyTrend = "decreasing";
    else energyTrend = "stable";
  }

  let valenceTrend = null;
  if (valenceValues.length >= 3) {
    const recent = valenceValues.slice(-5);
    const first =
      recent.slice(0, Math.ceil(recent.length / 2)).reduce((a, b) => a + b, 0) / Math.ceil(recent.length / 2);
    const last = recent.slice(Math.ceil(recent.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(recent.length / 2);
    const diff = last - first;

    if (diff > 0.1) valenceTrend = "increasing";
    else if (diff < -0.1) valenceTrend = "decreasing";
    else valenceTrend = "stable";
  }

  const energyTarget = getSmoothedTarget(energyValues, energyTrend);
  const valenceTarget = getSmoothedTarget(valenceValues, valenceTrend);
  const measuredEnergyTarget = getSmoothedTarget(measuredEnergyValues, energyTrend);
  const measuredValenceTarget = getSmoothedTarget(measuredValenceValues, valenceTrend);

  Log.debug(
    "Session profile with enhanced features",
    "",
    `guild=${guildId}`,
    `topGenres=${topGenres
      .slice(0, 3)
      .map((g) => `${g.genre}(${g.count})`)
      .join(", ")}`,
    `avgTempo=${avgTempo ? Math.round(avgTempo) : "unknown"}`,
    `avgYear=${avgYear || "unknown"}`,
    `energyTrend=${energyTrend || "unknown"}`,
    `valenceTrend=${valenceTrend || "unknown"}`,
    `energyTarget=${energyTarget ?? "unknown"}`
  );

  // Track last 3 artists to prevent consecutive plays
  const lastThreeArtists = recentTracks
    .slice(-3)
    .map(getSessionArtist)
    .filter(Boolean);

  const cooldownIdentifiers = cooldownTracks.map((track) => track.info?.identifier).filter(Boolean);

  return {
    topArtists,
    artistCounts,
    avgDuration,
    totalTracks: recentTracks.length,
    recentIdentifiers: [...new Set(cooldownIdentifiers)].slice(-160),
    lastThreeArtists,
    topGenres,
    genreCounts,
    avgFeatures,
    avgTempo,
    avgYear,
    energyTrend,
    valenceTrend,
    energyTarget,
    valenceTarget,
    measuredEnergyTarget,
    measuredValenceTarget,
    referenceGenres: referenceMetadata.genres,
    referenceGenreFamilies: getGenreFamilies(referenceMetadata.genres),
    referenceFeatures: referenceMetadata.features,
    referenceDerivedFeatures: referenceMetadata.derivedFeatures,
    referenceMetadataConfidence: referenceMetadata.metadataConfidence,
    referenceMetadataProvider: referenceMetadata.metadataProvider,
    referenceMetadataSources: referenceMetadata.metadataSources,
    referenceArtist: getSessionArtist(referenceTrack),
    referenceAlbumId: referenceMetadata.albumId,
    referenceAlbumTitle: referenceMetadata.albumTitle,
    avgDerivedFeatures,
    recentGenreFamilies,
    recentTracks,
    recentAutoplayTracks,
    cooldownTracks,
    manualHistory: manualHistory.slice(-MANUAL_CONTEXT_LIMIT),
    pendingManualTracks: pendingManual,
    manualAnchorTracks,
    manualAnchorRecords,
    manualAnchorGenreFamilies,
    manualTasteGenres: manualTaste.genres,
    manualTasteGenreFamilies: manualTaste.genreFamilies,
    manualTasteFeatures: manualTaste.features,
    manualMemoryTracks: manualMemory.tracks,
    manualArtistMemory: manualMemory.artists,
    manualAlbumMemory: manualMemory.albums,
    recentAutoplayArtists,
    autoplayArtistStreak,
    referenceIsManual: isManualTrack(referenceTrack),
    referenceIsAutoplay: isAutoplayTrack(referenceTrack),
    autoplayStreak,
  };
}

module.exports = {
  buildSessionProfile,
  getTrackMetadata,
  isAutoplayTrack,
  isManualTrack,
  sessionStartTime,
  genreCache,
  getContinuityFeatures,
  getSmoothedTarget,
  buildManualMemory,
};
