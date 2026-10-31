const { restoreVoiceChannelStatus } = require("../discord/voiceChannelStatus");
const djProposals = require("../dj/proposals");
const skipVotes = require("../dj/skipVotes");
const { deletePanelState } = require("../equalizer/panel");
const { clearPendingUpdates } = require("../equalizer/throttle");
const Log = require("../logs/log");
const { assertAllowedMusicUrl } = require("../security/mediaUrl");
const statsStore = require("../stats/store");
const { getEqualizerState } = require("./equalizerStore");
const { toLavalinkFilters } = require("./filters");
const { applyNormalizedVolume } = require("./loudness");
const {
  getInterpolatedPosition,
  pauseLyricsSession,
  resumeLyricsSession,
  stopLyricsSession,
} = require("./lyricsFormatter");
const { getPlayer, getPoru } = require("./players");
const { addManualTracksToQueue, markManualTrack, partitionQueueTracks } = require("./queueOrdering");
const { clearRecoverySnapshot, getRecoverySnapshot } = require("./recovery");
const { searchAcrossSources } = require("./searchAggregator");
const { parseSearchIdentifier } = require("./searchIdentifier");
const { buildSearchQueries } = require("./searchQueryVariants");
const { filterPlayableSearchResults, rankSearchResults } = require("./searchRanking");
const { getFallbackSources, getSearchPrefix } = require("./searchSources");
const { cloneTrack, playbackState, ensurePlaybackState, endActivePlayback, clearLyricsState } = require("./state");
const {
  clearInactivityTimer,
  clearProgressInterval,
  scheduleInactivityDisconnect,
  scheduleProgressUpdates,
} = require("./timers");

async function ensurePlayer(guildId, voiceId, textId) {
  let player = getPlayer(guildId);
  const poru = getPoru();

  if (player) return player;

  player = await poru.createConnection({
    guildId,
    voiceChannel: voiceId,
    textChannel: textId,
    deaf: true,
  });

  statsStore.beginSession(guildId);

  const defaultVolume = Number(process.env.DEFAULT_VOLUME ?? 50);
  const target = Number.isFinite(defaultVolume) ? Math.max(0, Math.min(defaultVolume, 1000)) : 50;

  player.userVolume = target;
  await applyNormalizedVolume(player);

  const savedEq = getEqualizerState(guildId);

  if (savedEq && Object.keys(savedEq).length > 0) {
    try {
      await player.node.rest.updatePlayer({
        guildId,
        data: { filters: toLavalinkFilters(savedEq) },
      });
      player.filters = savedEq;
    } catch (err) {
      Log.error("Failed to restore EQ settings", err, `guild=${guildId}`);
    }
  }

  // If Discord/Lavalink dropped the live player, restore its queue only when
  // someone explicitly starts playback again. This avoids joining a voice
  // channel on its own after the bot has been kicked or disconnected.
  const snapshot = await getRecoverySnapshot(guildId);
  if (snapshot) {
    try {
      player.userVolume = snapshot.userVolume;
      player.loop = snapshot.loop || "NONE";
      if (snapshot.filters && typeof snapshot.filters === "object") {
        await player.node.rest.updatePlayer({ guildId, data: { filters: toLavalinkFilters(snapshot.filters) } });
        player.filters = snapshot.filters;
      }
      for (const queuedTrack of snapshot.queue || []) await player.queue.add(cloneTrack(queuedTrack));
      if (snapshot.currentTrack) {
        await player.queue.unshift(cloneTrack(snapshot.currentTrack));
        await player.play();
        if (snapshot.position > 1_000 && !snapshot.paused) await player.seekTo(snapshot.position);
        if (snapshot.paused) await player.pause(true);
      }
      await applyNormalizedVolume(player, snapshot.currentTrack || player.currentTrack);
      await clearRecoverySnapshot(guildId);
      Log.success("Recovered player session", `guild=${guildId}`, `queue=${player.queue.length}`, `reason=${snapshot.reason}`);
    } catch (error) {
      Log.error("Failed to restore player recovery snapshot", error, `guild=${guildId}`);
    }
  }
  return player;
}

async function loadProviderSearchResults(node, sourcePrefix, query) {
  const settled = await Promise.allSettled(
    buildSearchQueries(query).map(async (candidateQuery) => {
      const searchUrl = `http://${node.options.host}:${
        node.options.port
      }/v4/loadtracks?identifier=${encodeURIComponent(`${sourcePrefix}:${candidateQuery}`)}`;
      const response = await fetch(searchUrl, { headers: { Authorization: node.options.password } });
      return response.json();
    })
  );
  const responses = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  return {
    loadType: responses.find((data) => data?.loadType === "search")?.loadType ?? responses[0]?.loadType,
    playlistInfo: responses.find((data) => data?.playlistInfo)?.playlistInfo,
    tracks: responses.flatMap((data) => (Array.isArray(data?.data) ? data.data : [])),
  };
}

async function lavalinkResolveTracks(query, source = "deezer") {
  const poru = getPoru();
  let q = String(query || "").trim();
  assertAllowedMusicUrl(q);
  const isUrl = /^(https?:\/\/)/i.test(q);

  // For URLs (Spotify/YouTube links), let Lavalink handle via providers chain
  // For search queries, use the specified source
  let res = null;
  const sourceIdentifier = parseSearchIdentifier(q);
  const hasSourcePrefix = Boolean(sourceIdentifier);

  if (!isUrl && !hasSourcePrefix) {
    // Remove any existing search prefix
    let searchQuery = q;
    if (q.toLowerCase().startsWith("ytsearch:")) {
      searchQuery = q.slice("ytsearch:".length).trim();
    }

    // Auto mode searches every provider in parallel and ranks the unified
    // pool. This makes Enter behave like the Activity results instead of
    // accepting the first (often clean/alternate) YouTube hit.
    if (source === "auto") {
      const aggregate = await searchAcrossSources(poru, searchQuery, { preferredSource: "youtube" });
      const relevant = filterPlayableSearchResults(aggregate, searchQuery);
      if (relevant.length) {
        res = { loadType: "search", tracks: rankSearchResults(relevant, searchQuery) };
      }
    }

    // Try the requested source first, then its verified fallback lane.
    if (!res) {
    try {
      const primarySource = source === "auto" ? "youtube" : source;
      const sourcePrefix = getSearchPrefix(primarySource);
      const sourceName =
        primarySource === "youtube"
          ? "YouTube"
          : primarySource === "spotify"
            ? "Spotify"
            : primarySource === "soundcloud"
              ? "SoundCloud"
              : "Deezer";

      Log.info(`🔍 ${sourceName} search`, `query=${searchQuery}`);
      const node = poru.leastUsedNodes[0];
      if (node) {
        const searchData = await loadProviderSearchResults(node, sourcePrefix, searchQuery);
        const relevantSearchTracks = filterPlayableSearchResults(searchData.tracks, searchQuery);

        if (searchData?.loadType === "search" && relevantSearchTracks.length > 0) {
          Log.info(
            `✅ ${sourceName} found tracks`,
            `count=${relevantSearchTracks.length}`,
            `topResult=${relevantSearchTracks[0]?.info?.title || "Unknown"}`,
            `query=${searchQuery}`
          );
          res = {
            loadType: searchData.loadType,
            tracks: relevantSearchTracks,
            playlistInfo: searchData.playlistInfo,
          };
        } else {
          Log.info(
            `⚠️ ${sourceName} no results, trying fallback`,
            `loadType=${searchData?.loadType}`,
            `query=${searchQuery}`
          );

          for (const fallbackSource of getFallbackSources(source).filter((candidate) => candidate !== primarySource)) {
            const fallbackPrefix = getSearchPrefix(fallbackSource);
            const fallbackData = await loadProviderSearchResults(node, fallbackPrefix, searchQuery);
            const relevantFallbackTracks = filterPlayableSearchResults(fallbackData.tracks, searchQuery);

            if (fallbackData?.loadType === "search" && relevantFallbackTracks.length > 0) {
              Log.info(
                "✅ Alternate source found tracks",
                `source=${fallbackSource}`,
                `count=${relevantFallbackTracks.length}`,
                `query=${searchQuery}`
              );
              res = {
                loadType: fallbackData.loadType,
                tracks: relevantFallbackTracks,
                playlistInfo: fallbackData.playlistInfo,
              };
              break;
            }
          }
        }
      }
    } catch (err) {
      Log.warn(`${source} search failed, trying alternate sources`, err, `query=${searchQuery}`);
    }
    }
  }

  // If source search didn't work or this is an exact URL/prefixed autocomplete
  // value, resolve it without letting Poru prepend its default source again.
  if (!res) {
    if (sourceIdentifier) {
      res = await poru.resolve({
        query: sourceIdentifier.query,
        source: sourceIdentifier.source,
      });
    } else {
      res = await poru.resolve({ query: q });
    }
  }

  const validTracks = Array.isArray(res?.tracks)
    ? res.tracks.filter(
        (t) =>
          t &&
          (typeof t.track === "string" || typeof t.encoded === "string") &&
          (t.track?.length > 0 || t.encoded?.length > 0) &&
          t.info &&
          typeof t.info === "object"
      )
    : [];

  if (!validTracks.length) {
    throw new Error(
      res?.loadType === "loadFailed"
        ? res?.exception?.message ?? "Failed to load track (Lavalink error)."
        : "No playable tracks found."
    );
  }

  let tracksToAdd = validTracks;
  let nowPlaying = validTracks[0];

  if (res.loadType === "playlist") {
    const selectedIndex = res.playlistInfo?.selectedTrack ?? 0;
    nowPlaying = tracksToAdd[selectedIndex] ?? nowPlaying;
  } else {
    if (!isUrl && (res.loadType === "search" || !res.loadType)) {
      const playableMatches = filterPlayableSearchResults(validTracks, q);
      if (!playableMatches.length) {
        throw new Error("No base-version match found. Include a version such as remix or acoustic if that is what you want.");
      }
      const ranked = rankSearchResults(playableMatches, q, { withScores: true });
      const bestMatch = ranked[0];

      if (bestMatch) {
        nowPlaying = bestMatch.track;
        Log.info(
          "🎯 Search result selected",
          `title=${nowPlaying.info?.title || "Unknown"}`,
          `artist=${nowPlaying.info?.author || "Unknown"}`,
          `score=${bestMatch.score.toFixed(1)}`,
          `popularity=${bestMatch.popularity || 0}`,
          `reasons=${bestMatch.reasons.join(",") || "provider order"}`,
          `candidates=${validTracks.length}`
        );
      }
    }

    tracksToAdd = [nowPlaying];
  }

  const clones = tracksToAdd.map((track) => cloneTrack(track));
  const selectedClone = cloneTrack(nowPlaying);

  const isPlaylist = res.loadType === "playlist";
  const playlistInfo = isPlaylist ? res.playlistInfo ?? {} : null;
  const playlistUrl = isPlaylist ? playlistInfo?.uri ?? playlistInfo?.url ?? (isUrl ? q : null) : null;
  const playlistTrackCount = clones.length;
  const playlistDurationMs = isPlaylist ? clones.reduce((sum, track) => sum + (track.info?.length ?? 0), 0) : 0;

  return {
    tracks: clones,
    track: selectedClone,
    isPlaylist,
    playlistInfo,
    playlistUrl,
    playlistTrackCount,
    playlistDurationMs,
  };
}

async function lavalinkPlay({ guildId, voiceId, textId, query, requester, prepend = false, playNow = false, source = "deezer" }) {
  const player = await ensurePlayer(guildId, voiceId, textId);

  const resolution = await lavalinkResolveTracks(query, source);
  const tracksToAdd = resolution.tracks.map((track) => cloneTrack(track));

  if (!tracksToAdd.length) {
    throw new Error("No playable tracks found.");
  }

  const targetEncoded = resolution.track?.track ?? tracksToAdd[0].track;
  let nowPlaying = tracksToAdd.find((track) => track.track === targetEncoded) ?? tracksToAdd[0];

  const requesterMeta = requester
    ? {
        requesterId: requester.id,
        requesterTag: requester.tag,
        requesterAvatar: requester.avatar,
      }
    : {};

  // "Play now" puts the chosen result ahead of every queued track and then
  // skips the current one. Ordinary manual additions still preserve the
  // manual queue before the autoplay buffer (see addManualTracksToQueue).
  const shouldPlayNow = Boolean(playNow) && Boolean(player.currentTrack);
  const shouldPrepend = !shouldPlayNow && prepend && player.queue.length > 0;
  const queueTargets = (shouldPlayNow || shouldPrepend) ? [...tracksToAdd].reverse() : tracksToAdd;

  for (const track of queueTargets) {
    if (!track) continue;

    markManualTrack(track);
    track.info = { ...(track.info || {}), ...requesterMeta, requester: textId };
    track.userData = {
      ...(track.userData || {}),
      fallbackAttempts: 0,
    };

    if (shouldPlayNow || shouldPrepend) await player.queue.unshift(track);
  }

  if (!shouldPlayNow && !shouldPrepend) addManualTracksToQueue(player, queueTargets);
  // The waiting autoplay pick was chosen for the track that used to precede it.
  if (!shouldPlayNow) require("./autoplay").scheduleAutoplayRefresh(player, textId);

  if (shouldPlayNow) {
    await player.skip();
  }

  const currentTitle = player.currentTrack?.info?.title || "none";
  Log.info(
    "🔍 Playback check",
    `current=${currentTitle}`,
    `playing=${player.isPlaying}`,
    `paused=${player.isPaused}`,
    `queue=${player.queue.length}`,
    `guild=${guildId}`
  );

  if (!player.currentTrack && player.queue.length > 0) {
    await player.play();
  }

  Log.info("➕ Queue updated", `added=${tracksToAdd.length}`, `queue=${player.queue.length}`, `guild=${guildId}`);

  clearInactivityTimer(guildId, "playRequest");

  return {
    track: cloneTrack(nowPlaying),
    player,
    isPlaylist: resolution.isPlaylist,
    playlistInfo: resolution.playlistInfo,
    playlistUrl: resolution.playlistUrl,
    playlistTrackCount: resolution.playlistTrackCount,
    playlistDurationMs: resolution.playlistDurationMs,
  };
}

async function lavalinkStop(guildId) {
  const player = getPlayer(guildId);

  if (!player) return false;

  const queueSize = player.queue.length;
  const currentTrack = player.currentTrack?.info?.title || "none";

  Log.info("⏹️ Player stopped", `currentTrack=${currentTrack}`, `clearedQueue=${queueSize}`, `guild=${guildId}`);

  player.queue.clear();
  await restoreVoiceChannelStatus(player.poru?.client, player.voiceChannel).catch(() => null);
  await player.destroy();
  clearInactivityTimer(guildId, "stopCommand");
  clearProgressInterval(guildId);
  clearLyricsState(guildId);
  await stopLyricsSession(guildId);
  // Keep room history available in the Activity after a manual stop. The
  // player is gone, but history and its session filters remain meaningful.
  endActivePlayback(guildId);
  skipVotes.clear(guildId);
  djProposals.clearGuild(guildId);
  deletePanelState(guildId);
  clearPendingUpdates(guildId);
  await clearRecoverySnapshot(guildId);

  return true;
}

async function lavalinkPause(guildId) {
  const player = getPlayer(guildId);

  if (player && !player.isPaused) {
    const trackTitle = player.currentTrack?.info?.title || "Unknown";
    const pausedPosition = getInterpolatedPosition(player, Date.now(), 0);
    Log.info("⏸️ Player paused", `track=${trackTitle}`, `guild=${guildId}`);
    await player.pause(true);

    const state = ensurePlaybackState(guildId);
    state.lastPosition = pausedPosition;
    state.lastTimestamp = Date.now();
    state.paused = true;
    playbackState.set(guildId, state);
    pauseLyricsSession(guildId, pausedPosition);

    clearInactivityTimer(guildId, "pauseCommand");
    return true;
  }

  return false;
}

async function lavalinkResume(guildId) {
  const player = getPlayer(guildId);

  if (player && player.isPaused) {
    const trackTitle = player.currentTrack?.info?.title || "Unknown";
    Log.info("▶️ Player resumed", `track=${trackTitle}`, `guild=${guildId}`);
    await player.pause(false);

    const state = ensurePlaybackState(guildId);
    state.lastTimestamp = Date.now();
    state.paused = false;
    playbackState.set(guildId, state);
    resumeLyricsSession(guildId);

    clearInactivityTimer(guildId, "resumeCommand");
    return true;
  }

  return false;
}

async function lavalinkSkip(guildId) {
  const player = getPlayer(guildId);
  if (!player || (!player.currentTrack && player.queue.length === 0)) return false;

  const skippedTitle = player.currentTrack?.info?.title || "Unknown";
  const nextTitle = player.queue[0]?.info?.title || "none";
  void stopLyricsSession(guildId);

  Log.info(
    "⏭️ Track skipped",
    `from=${skippedTitle}`,
    `to=${nextTitle}`,
    `queue=${player.queue.length}`,
    `guild=${guildId}`
  );

  const result = await player.skip();

  if (!player.currentTrack && player.queue.length === 0) {
    scheduleInactivityDisconnect(player, "skipEmpty");
  }

  if (result) {
    statsStore.trackSkip(guildId);

    // Record skip in health monitoring
    const health = require("../monitoring/health");
    health.recordTrackSkipped();
  }

  return true;
}

async function lavalinkRemoveFromQueue(guildId, { position, title }) {
  const player = getPlayer(guildId);
  if (!player || player.queue.length === 0) return { status: "empty_queue" };

  let index = -1;

  if (typeof position === "number") {
    index = position - 1;
  } else if (typeof title === "string" && title.trim()) {
    const term = title.trim().toLowerCase();
    index = player.queue.findIndex((track) => track?.info?.title?.toLowerCase().includes(term));
  }

  if (index < 0 || index >= player.queue.length) return { status: "not_found" };

  const removed = player.queue.remove(index);
  const removedTitle = removed?.info?.title ?? "Unknown title";

  Log.info(
    "➖ Track removed",
    `track=${removedTitle}`,
    `position=${index + 1}`,
    `queue=${player.queue.length}`,
    `guild=${guildId}`
  );

  clearInactivityTimer(guildId, "removeFromQueue");

  return {
    status: "removed",
    trackTitle: removedTitle,
    index: index + 1,
  };
}

async function lavalinkPrevious(guildId) {
  const player = getPlayer(guildId);
  if (!player) return { status: "no_player" };

  const state = ensurePlaybackState(guildId);
  const history = state.history ?? [];

  if (history.length === 0) {
    if (player.currentTrack) {
      await player.seekTo(0);
      clearInactivityTimer(guildId, "previousRestart");

      // Update the player message to show position reset
      const { refreshNowPlayingMessage } = require("../buttons");
      const { getClient } = require("../clientRegistry");
      const client = getClient();
      if (client) {
        await refreshNowPlayingMessage(client, guildId, player, player.loop ?? "NONE", 0);
      }

      return { status: "restart", track: cloneTrack(player.currentTrack) };
    }

    return { status: "empty" };
  }

  const previous = history.pop();
  const currentClone = cloneTrack(player.currentTrack);

  const previousTitle = previous?.info?.title || "Unknown";
  const currentTitle = currentClone?.info?.title || "none";

  Log.info(
    "⏮️ Previous track",
    `from=${currentTitle}`,
    `to=${previousTitle}`,
    `historySize=${history.length}`,
    `guild=${guildId}`
  );
  void stopLyricsSession(guildId);

  if (currentClone?.track) {
    player.queue.unshift(currentClone);
  }

  clearProgressInterval(guildId);

  // Update player state before calling updatePlayer
  player.currentTrack = cloneTrack(previous);
  player.isPlaying = true;
  player.isPaused = false;
  player.position = 0;

  await player.node.rest.updatePlayer({
    guildId,
    data: { track: { encoded: previous.track }, position: 0 },
  });

  state.history = history;
  state.currentTrack = cloneTrack(previous);
  state.lastPosition = 0;
  state.lastTimestamp = Date.now();
  playbackState.set(guildId, state);

  clearInactivityTimer(guildId, "previousCommand");
  scheduleProgressUpdates(player);

  // Let Lavalink's trackStart event handle the UI update

  return { status: "previous", track: previous };
}

async function lavalinkToggleLoop(guildId, mode) {
  const player = getPlayer(guildId);

  if (!player) return null;

  // Determine next loop mode
  const currentLoop = player.loop || "NONE";

  const next =
    mode && ["NONE", "TRACK", "QUEUE"].includes(mode)
      ? mode
      : currentLoop === "NONE"
      ? "TRACK"
      : currentLoop === "TRACK"
      ? "QUEUE"
      : "NONE";

  // Set loop mode on player
  player.loop = next;

  clearInactivityTimer(guildId, "toggleLoop");

  return next;
}

async function lavalinkShuffle(guildId) {
  const player = getPlayer(guildId);

  if (!player || player.queue.length === 0) return false;

  // Keep manual requests ahead of the autoplay buffer. A full queue shuffle
  // used to erase that boundary and made an autoplay item look user-added.
  const { manual, autoplay } = partitionQueueTracks(Array.from(player.queue));
  const shuffle = (tracks) => {
    for (let index = tracks.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [tracks[index], tracks[target]] = [tracks[target], tracks[index]];
    }
  };
  shuffle(manual);
  shuffle(autoplay);
  player.queue.splice(0, player.queue.length, ...manual, ...autoplay);
  player.shuffleActive = true;
  clearInactivityTimer(guildId, "shuffle");
  return true;
}

async function lavalinkClearQueue(guildId) {
  const player = getPlayer(guildId);

  if (!player || player.queue.length === 0) return false;

  player.queue.clear();
  clearInactivityTimer(guildId, "clearQueue");
  return true;
}

module.exports = {
  lavalinkPlay,
  lavalinkStop,
  lavalinkPause,
  lavalinkResume,
  lavalinkSkip,
  lavalinkRemoveFromQueue,
  lavalinkPrevious,
  lavalinkToggleLoop,
  lavalinkShuffle,
  lavalinkClearQueue,
  lavalinkResolveTracks,
};
