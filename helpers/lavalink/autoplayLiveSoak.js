const { EventEmitter } = require("node:events");

const { getGuildState } = require("../guildState");
const { getRelevantPlayableTrack } = require("./autoplayCandidates");
const { clearAutoplayExposureForGuild, recordAutoplayExposure } = require("./autoplayExposure");
const { getTempoDistance } = require("./autoplayMetadata");
const { getAIDJTimeoutBudget } = require("./aiDj");
const { fetchAutoplayV3Track } = require("./autoplayV3");
const { createPoru } = require("./client");
const { getGenreBridgeStrength, getGenreFamilies, areGenreFamiliesCompatible } = require("./genreUtils");
const { cloneTrack, playbackState, pushTrackHistory, rememberAutoplayTrack } = require("./state");
const { normalizeArtist } = require("./trackIdentity");
const { hasTrackIdentity } = require("./trackIdentity");

function createLavalinkTestClient() {
  const client = new EventEmitter();
  client.user = { id: process.env.CLIENT_ID || "autoplay-live-soak" };
  client.guilds = { cache: new Map() };
  return client;
}

async function waitForLavalink(poru, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (poru.leastUsedNodes.length > 0) return poru.leastUsedNodes[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Lavalink did not become ready for the live autoplay soak test");
}

async function resolveSeedTrack(poru, query) {
  const response = await poru.resolve({ query, source: "ytsearch" });
  // The live runner must start from the same ranked result the bot would
  // choose, not Lavalink's raw first upload (which is often a channel/video).
  const track = getRelevantPlayableTrack(response.tracks || [], query);
  if (!track?.info?.identifier) throw new Error(`Lavalink returned no playable seed for: ${query}`);
  return track;
}

function markAutoplay(track) {
  const cloned = cloneTrack(track);
  cloned.info = { ...(cloned.info || {}), autoplayed: true };
  cloned.userData = { ...(cloned.userData || {}), autoplay: true };
  return cloned;
}

function getTrackSummary(track) {
  return {
    title: track?.info?.title || "unknown",
    artist: track?.info?.author || "unknown",
    identifier: track?.info?.identifier || null,
    source: track?.info?.sourceName || "unknown",
    genres: track?.userData?.genres || [],
    features: {
      ...(track?.userData?.derivedFeatures || {}),
      ...(track?.userData?.features || {}),
    },
    metadataConfidence: Number(track?.userData?.metadataConfidence) || 0,
    albumId: track?.userData?.albumId || null,
    albumTitle: track?.userData?.albumTitle || null,
    fallback: track?.userData?.autoplayFallback || null,
  };
}

function createMetrics() {
  return {
    completedSteps: 0,
    unresolvedSteps: 0,
    duplicateSelections: 0,
    longTermRepeats: 0,
    genreFamilyJumps: 0,
    maxConsecutiveArtist: 0,
    maxConsecutiveArtistOutsideAlbum: 0,
    artistWindowViolations: 0,
    artistWindowDiversityViolations: 0,
    sameAlbumTransitions: 0,
    resolutionFailures: 0,
    fallbackSelections: 0,
    weakEvidenceSelections: 0,
    bridgeStrengths: [],
    tempoDistances: [],
    energyDistances: [],
    valenceDistances: [],
    sources: {},
    artists: [],
  };
}

function addDistance(metrics, collection, left, right, { tempo = false } = {}) {
  if (!Number.isFinite(Number(left)) || !Number.isFinite(Number(right))) return;
  const distance = tempo ? getTempoDistance(left, right) : Math.abs(Number(left) - Number(right));
  if (distance !== null) metrics[collection].push(Number(distance.toFixed(3)));
}

function summarizeDistances(values) {
  if (!values.length) return { samples: 0, average: null, max: null };
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    samples: values.length,
    average: Number(average.toFixed(3)),
    max: Number(Math.max(...values).toFixed(3)),
  };
}

function updateMetrics(
  metrics,
  previousTrack,
  selectedTrack,
  recentHistory,
  fullHistory,
  artistWindowSize,
  maxArtistAppearancesInWindow
) {
  if (hasTrackIdentity(recentHistory, selectedTrack, { includeIdentifier: false })) metrics.duplicateSelections += 1;
  if (hasTrackIdentity(fullHistory, selectedTrack, { includeIdentifier: false })) metrics.longTermRepeats += 1;

  const previousFamilies = getGenreFamilies(previousTrack?.userData?.genres || []);
  const selectedFamilies = getGenreFamilies(selectedTrack?.userData?.genres || []);
  if (areGenreFamiliesCompatible(previousFamilies, selectedFamilies) === false) metrics.genreFamilyJumps += 1;
  metrics.bridgeStrengths.push(
    getGenreBridgeStrength(previousTrack?.userData?.genres || [], selectedTrack?.userData?.genres || []).strength
  );

  const previousFeatures = { ...(previousTrack?.userData?.derivedFeatures || {}), ...(previousTrack?.userData?.features || {}) };
  const selectedFeatures = { ...(selectedTrack?.userData?.derivedFeatures || {}), ...(selectedTrack?.userData?.features || {}) };
  addDistance(metrics, "tempoDistances", previousFeatures.tempo, selectedFeatures.tempo, { tempo: true });
  addDistance(metrics, "energyDistances", previousFeatures.energy, selectedFeatures.energy);
  addDistance(metrics, "valenceDistances", previousFeatures.valence, selectedFeatures.valence);
  if (selectedTrack?.userData?.autoplayFallback) metrics.fallbackSelections += 1;
  if (!selectedFamilies.length && !Object.keys(selectedFeatures).length) metrics.weakEvidenceSelections += 1;

  const artist = normalizeArtist(selectedTrack.info?.author);
  const previousArtist = metrics.artists.at(-1);
  const previousAlbumId = String(previousTrack?.userData?.albumId || "");
  const selectedAlbumId = String(selectedTrack?.userData?.albumId || "");
  const sameAlbum = Boolean(
    artist && artist === previousArtist && previousAlbumId && selectedAlbumId && previousAlbumId === selectedAlbumId
  );
  const streak = artist && artist === previousArtist ? (metrics.currentArtistStreak || 0) + 1 : 1;
  metrics.currentArtistStreak = streak;
  metrics.maxConsecutiveArtist = Math.max(metrics.maxConsecutiveArtist, streak);
  const diversityStreak = artist && artist === previousArtist && !sameAlbum
    ? (metrics.currentArtistStreakOutsideAlbum || 0) + 1
    : 1;
  metrics.currentArtistStreakOutsideAlbum = diversityStreak;
  metrics.maxConsecutiveArtistOutsideAlbum = Math.max(metrics.maxConsecutiveArtistOutsideAlbum, diversityStreak);
  if (sameAlbum) metrics.sameAlbumTransitions += 1;
  metrics.artists.push(artist);
  const recentArtists = metrics.artists.slice(-artistWindowSize);
  if (recentArtists.filter((entry) => entry === artist).length > maxArtistAppearancesInWindow) {
    metrics.artistWindowViolations += 1;
    // Album metadata is occasionally absent from the first YouTube resolve.
    // A dense same-artist window is only an actionable drift signal when the
    // current run also exceeds the verified cross-album diversity streak.
    if (!sameAlbum && diversityStreak > maxArtistAppearancesInWindow) {
      metrics.artistWindowDiversityViolations += 1;
    }
  }

  const source = selectedTrack.info?.sourceName || "unknown";
  metrics.sources[source] = (metrics.sources[source] || 0) + 1;
}

function evaluateLiveSoak(result, {
  maxDuplicateSelections = 0,
  maxGenreFamilyJumps = 0,
  // Run length belongs to the AI director now, so the soak reports streaks
  // instead of enforcing the old rigid caps unless a caller overrides them.
  maxConsecutiveArtist = null,
  maxArtistWindowViolations = null,
  maxUnresolvedSteps = 0,
  maxTempoJump = 48,
  maxEnergyJump = 0.45,
} = {}) {
  const continuity = result.metrics.continuity || {
    tempo: { samples: 0, average: null, max: null },
    energy: { samples: 0, average: null, max: null },
    valence: { samples: 0, average: null, max: null },
    averageBridgeStrength: null,
  };
  const violations = [];
  if (result.metrics.duplicateSelections > maxDuplicateSelections) violations.push(`duplicates=${result.metrics.duplicateSelections}`);
  if (result.metrics.genreFamilyJumps > maxGenreFamilyJumps) violations.push(`genreJumps=${result.metrics.genreFamilyJumps}`);
  const diversityStreak = result.metrics.maxConsecutiveArtistOutsideAlbum ?? result.metrics.maxConsecutiveArtist;
  const diversityWindowViolations = result.metrics.artistWindowDiversityViolations ?? result.metrics.artistWindowViolations;
  if (maxConsecutiveArtist !== null && diversityStreak > maxConsecutiveArtist) violations.push(`maxArtistStreak=${diversityStreak}`);
  if (maxArtistWindowViolations !== null && diversityWindowViolations > maxArtistWindowViolations) violations.push(`artistWindow=${diversityWindowViolations}`);
  if (result.metrics.unresolvedSteps > maxUnresolvedSteps) violations.push(`unresolved=${result.metrics.unresolvedSteps}`);
  if (continuity.tempo.max !== null && continuity.tempo.max > maxTempoJump) {
    violations.push(`tempoJump=${continuity.tempo.max}`);
  }
  if (continuity.energy.max !== null && continuity.energy.max > maxEnergyJump) {
    violations.push(`energyJump=${continuity.energy.max}`);
  }
  return { ...result, metrics: { ...result.metrics, continuity }, passed: violations.length === 0, violations };
}

async function runLiveAutoplaySoak({
  query,
  manualQueries = [],
  steps = 10,
  delayMs = 0,
  guildId = `autoplay-live-soak-${Date.now()}`,
  artistWindowSize = Number(process.env.AUTOPLAY_ARTIST_WINDOW ?? 5),
  maxArtistAppearancesInWindow = Number(process.env.AUTOPLAY_ARTIST_MAX_IN_WINDOW ?? 2),
  limits,
} = {}) {
  if (!query) throw new Error("Live autoplay soak requires a seed query");

  const client = createLavalinkTestClient();
  const poru = createPoru(client);
  const state = getGuildState(guildId);
  state.autoplay = true;
  await poru.init();
  await waitForLavalink(poru);

  const seed = await resolveSeedTrack(poru, query);
  const pendingManualTracks = [];
  for (const manualQuery of manualQueries) {
    const manualTrack = await resolveSeedTrack(poru, manualQuery);
    pendingManualTracks.push(manualTrack);
  }
  const fullHistory = [];
  const trace = [];
  const metrics = createMetrics();
  metrics.artists.push(normalizeArtist(seed.info?.author));
  metrics.currentArtistStreak = 1;
  metrics.maxConsecutiveArtist = 1;
  let reference = cloneTrack(seed);
  const selectAutoplayTrack = fetchAutoplayV3Track;
  pushTrackHistory(guildId, reference);
  fullHistory.push(cloneTrack(reference));

  try {
    for (let step = 1; step <= steps; step += 1) {
      // Each step stands in for the prefetch at the reference's trackStart.
      const selected = await selectAutoplayTrack(reference, guildId, {
        pendingManualTracks,
        aiTimeoutMs: getAIDJTimeoutBudget(reference.info?.length),
      });
      const stepTrace = {
        step,
        reference: getTrackSummary(reference),
        selected: selected ? getTrackSummary(selected) : null,
      };

      if (!selected) {
        metrics.unresolvedSteps += 1;
        metrics.resolutionFailures += 1;
        trace.push(stepTrace);
        continue;
      }

      const autoplayTrack = markAutoplay(selected);
      const recentHistory = playbackState.get(guildId)?.history || [];
      updateMetrics(
        metrics,
        reference,
        autoplayTrack,
        recentHistory,
        fullHistory,
        artistWindowSize,
        maxArtistAppearancesInWindow
      );
      pushTrackHistory(guildId, autoplayTrack);
      rememberAutoplayTrack(guildId, autoplayTrack);
      await recordAutoplayExposure(guildId, autoplayTrack, reference);
      fullHistory.push(cloneTrack(autoplayTrack));
      reference = autoplayTrack;
      metrics.completedSteps += 1;
      trace.push({ ...stepTrace, selected: getTrackSummary(autoplayTrack) });

      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    metrics.continuity = {
      tempo: summarizeDistances(metrics.tempoDistances),
      energy: summarizeDistances(metrics.energyDistances),
      valence: summarizeDistances(metrics.valenceDistances),
      averageBridgeStrength: metrics.bridgeStrengths.length
        ? Number((metrics.bridgeStrengths.reduce((sum, value) => sum + value, 0) / metrics.bridgeStrengths.length).toFixed(3))
        : null,
    };

    return evaluateLiveSoak(
      {
        guildId,
        seed: getTrackSummary(seed),
        manualAnchors: pendingManualTracks.map(getTrackSummary),
        metrics,
        steps: trace,
      },
      limits
    );
  } finally {
    playbackState.delete(guildId);
    getGuildState(guildId).autoplay = false;
    clearAutoplayExposureForGuild(guildId);
    for (const node of poru.nodes.values()) await node.disconnect().catch(() => {});
  }
}

module.exports = {
  evaluateLiveSoak,
  resolveSeedTrack,
  runLiveAutoplaySoak,
};
