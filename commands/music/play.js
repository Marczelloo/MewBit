const { SlashCommandBuilder } = require("discord.js");
const { hasActiveActivitySession } = require("../../helpers/activity/sessions");
const djProposals = require("../../helpers/dj/proposals");
const djStore = require("../../helpers/dj/store");
const { buildProposalAnnouncement, buildProposalComponents, buildProposalEmbed } = require("../../helpers/dj/ui");
const { errorEmbed, successEmbed, playlistEmbed, songEmbed } = require("../../helpers/embeds");
const { getGuildState, updateGuildState } = require("../../helpers/guildState.js");
const { recordSearch } = require("../../helpers/history/searchHistory");
const { beginAutocompleteRequest, isLatestAutocompleteRequest } = require("../../helpers/interactions/autocompleteGuard");
const { buildTrackAutocompleteValue } = require("../../helpers/lavalink/autocompleteTrack");
const { lavalinkPlay, lavalinkResolveTracks } = require("../../helpers/lavalink/index");
const { getPersonalSearchTracks } = require("../../helpers/lavalink/personalSearch");
const { getPoru } = require("../../helpers/lavalink/players");
const { searchAcrossSources } = require("../../helpers/lavalink/searchAggregator");
const { filterPlayableSearchResults, rankSearchResults } = require("../../helpers/lavalink/searchRanking");
const { resolveSearchSource } = require("../../helpers/lavalink/searchSources");
const { findSearchCorrection, getSearchSuggestions, searchWithCorrection } = require("../../helpers/lavalink/searchSuggestions");
const { normalizeComparableText } = require("../../helpers/lavalink/trackNormalization");
const Log = require("../../helpers/logs/log");
const { assertAllowedMusicUrl } = require("../../helpers/security/mediaUrl");
const statsStore = require("../../helpers/stats/store");
const userPrefs = require("../../helpers/users/preferences");

const SOURCE_LABELS = Object.freeze({
  deezer: "Deezer",
  soundcloud: "SoundCloud",
  spotify: "Spotify",
  youtube: "YouTube",
});
const LIBRARY_ORIGIN_LABELS = Object.freeze({ liked: "Liked", playlist: "Playlist", history: "Played before" });

/**
 * Enter on typed text (not a picked autocomplete choice, which is a URL or a
 * provider-prefixed query) plays what the user meant: "metalica nothing els"
 * becomes the "metallica nothing else matters" YouTube suggests.
 */
async function correctTypedQuery(query) {
  const text = query.trim();
  if (/^https?:\/\//i.test(text) || /^[a-z]+search:/i.test(text)) return text;
  const correction = findSearchCorrection(text, await getSearchSuggestions(text));
  if (correction) Log.info("🔤 /play query corrected", `query=${text}`, `correction=${correction}`);
  return correction || text;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song from YouTube, Spotify, or SoundCloud")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("The URL or search term of the song to play")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName("source")
        .setDescription("Search source (default: server preference)")
        .setRequired(false)
        .addChoices(
          { name: "🎵 Auto (Smart Selection)", value: "auto" },
          { name: "🎼 Deezer (FLAC Quality)", value: "deezer" },
          { name: "▶️ YouTube", value: "youtube" },
          { name: "🎧 Spotify", value: "spotify" },
          { name: "☁️ SoundCloud", value: "soundcloud" }
        )
    )
    .addBooleanOption((option) =>
      option
        .setName("prepend")
        .setDescription("Add the track to the front of the queue instead of the back")
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const autocompleteKey = `${interaction.user.id}:${interaction.guildId || "dm"}:play`;
    const requestId = beginAutocompleteRequest(autocompleteKey);
    const respond = async (choices) => {
      if (!isLatestAutocompleteRequest(autocompleteKey, requestId)) return;
      await interaction.respond(choices);
    };

    // Don't autocomplete if the query is too short
    if (!focusedValue || focusedValue.length < 2) {
      return respond([]);
    }

    // Skip autocomplete for URLs (YouTube, Spotify, SoundCloud links)
    if (
      focusedValue.startsWith("http://") ||
      focusedValue.startsWith("https://") ||
      focusedValue.includes("youtube.com") ||
      focusedValue.includes("youtu.be") ||
      focusedValue.includes("spotify.com") ||
      focusedValue.includes("soundcloud.com")
    ) {
      return respond([]);
    }

    try {
      // Check if user has selected a source
      const selectedSource = interaction.options.getString("source");
      const userSource = userPrefs.getUserDefaultSource(interaction.user.id);
      const guildSettings = getGuildState(interaction.guildId);
      const searchSource = resolveSearchSource(selectedSource, userSource, guildSettings?.defaultSource);
      const poru = getPoru();
      const preferredSource = searchSource === "auto" ? "deezer" : searchSource;
      // A misspelt query also searches the correction YouTube suggests (both
      // finish within Discord's three-second autocomplete window), and the
      // pool is ranked against that correction.
      const { tracks: results, rankQuery } = await searchWithCorrection(focusedValue, (text) =>
        searchAcrossSources(poru, text, { preferredSource })
      );

      // The user's own matches lead: liked songs and playlists are what they
      // most likely mean.
      const libraryTracks = getPersonalSearchTracks(interaction.user.id, interaction.guildId, rankQuery, { limit: 3 });

      if (!results.length && !libraryTracks.length) {
        return respond([]);
      }

      // Require the candidate to represent the query before ranking by
      // artist/title accuracy and popularity. Provider order alone is noisy.
      const musicTracks = filterPlayableSearchResults(results, rankQuery);

      // Match the user's artist/title intent before using provider order as a popularity tie-breaker.
      const rankedTracks = rankSearchResults(musicTracks, rankQuery, { limit: 15 });

      // Deduplicate by artist + title
      const seen = new Set();
      const uniqueTracks = [];

      for (const track of [...libraryTracks, ...rankedTracks]) {
        const author = (track.info?.author || "Unknown Artist").trim();
        const title = (track.info?.title || "Unknown").trim();

        // Create a normalized key for deduplication
        const normalizedAuthor = normalizeComparableText(author).replace(/\s+/g, "");
        const normalizedTitle = normalizeComparableText(title).replace(/\s+/g, "");
        const key = `${normalizedAuthor}|||${normalizedTitle}`;

        if (!seen.has(key)) {
          seen.add(key);
          uniqueTracks.push(track);

          // Stop at 10 unique tracks for faster response
          if (uniqueTracks.length >= 10) break;
        }
      }

      // Format results for autocomplete
      const choices = uniqueTracks.map((track) => {
        const title = track.info?.title || "Unknown";
        const author = track.info?.author || "Unknown Artist";
        const sourceKey = String(track.info?.sourceName || track.info?.source || "").toLowerCase();
        const sourceLabel = SOURCE_LABELS[sourceKey] || (sourceKey ? sourceKey : "Unknown source");
        const originLabel = LIBRARY_ORIGIN_LABELS[track.personal];
        const sourceSuffix = originLabel ? ` [${sourceLabel} · ${originLabel}]` : ` [${sourceLabel}]`;

        // Truncate if too long (Discord has 100 char limit)
        let displayName = `${title} - ${author}${sourceSuffix}`;
        if (displayName.length > 100) {
          displayName = `${displayName.substring(0, 100 - sourceSuffix.length - 3)}...${sourceSuffix}`;
        }

        return {
          name: displayName,
          value: buildTrackAutocompleteValue(track),
        };
      });

      await respond(choices);
    } catch (error) {
      Log.error("Autocomplete error in /play", error);
      // Return empty array on error to avoid blocking the user
      await respond([]);
    }
  },

  async execute(interaction) {
    Log.info(
      "🎵 /play command",
      `user=${interaction.user.tag}`,
      `guild=${interaction.guild.name}`,
      `id=${interaction.guild.id}`
    );

    const activityActive = hasActiveActivitySession(interaction.guildId);
    await interaction.deferReply({ ephemeral: activityActive });

    const typedQuery = await interaction.options.getString("query");
    const voiceChannel = await interaction.member.voice.channel;

    if (!voiceChannel)
      return interaction.editReply({
        embeds: [errorEmbed("You must be in a voice channel to use this command.")],
      });

    if (!typedQuery || typedQuery.trim() === "")
      return interaction.editReply({ embeds: [errorEmbed("Please provide a valid URL or search term.")] });

    assertAllowedMusicUrl(typedQuery);
    const query = await correctTypedQuery(typedQuery);

    const prepend = interaction.options.getBoolean("prepend") ?? false;

    // Get source preference
    // Priority: explicit selection > user preference > server default
    const selectedSource = interaction.options.getString("source");
    const userSource = userPrefs.getUserDefaultSource(interaction.user.id);
    const guildSettings = getGuildState(interaction.guildId);
    const source = resolveSearchSource(selectedSource, userSource, guildSettings?.defaultSource);
    const playerChannelId = guildSettings?.playerChannel || interaction.channel.id;

    const requester = {
      id: interaction.user.id,
      tag: interaction.user.tag,
      avatar: interaction.user.displayAvatarURL({ size: 256 }),
    };

    const config = djStore.getGuildConfig(interaction.guild.id);
    const isDj = djStore.hasDjPermissions(interaction.member, config);

    if (config.enabled && !isDj) {
      try {
        const preview = await lavalinkResolveTracks(query, source);
        const proposal = djProposals.createProposal(interaction.guild.id, {
          query,
          prepend,
          requester,
          voiceChannelId: voiceChannel.id,
          textChannelId: interaction.channel.id,
          preview: {
            title: preview.track?.info?.title ?? query,
            url: preview.track?.info?.uri ?? null,
            isPlaylist: preview.isPlaylist,
            trackCount: preview.playlistTrackCount ?? preview.tracks.length,
            durationMs: preview.playlistDurationMs,
            source: preview.track?.info?.sourceName ?? null,
          },
        });

        const embed = buildProposalEmbed(proposal);
        const components = buildProposalComponents(interaction.guild.id, proposal.id);
        const announcement = buildProposalAnnouncement(proposal, config.roleId);

        const message = await interaction.channel.send({
          ...announcement,
          embeds: [embed],
          components,
        });

        djProposals.setMessageReference(interaction.guild.id, proposal.id, message.id, interaction.channel.id);

        return interaction.editReply({
          embeds: [successEmbed("Your suggestion has been sent to the DJ for approval.")],
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        Log.error("Failed to prepare suggestion preview", error);
        return interaction.editReply({
          embeds: [errorEmbed("Could not prepare that track. Please try a different query.")],
        });
      }
    }

    try {
      updateGuildState(interaction.guild.id, {
        nowPlayingChannel: playerChannelId,
      });
      const { track, player, isPlaylist, playlistInfo, playlistUrl, playlistTrackCount, playlistDurationMs } =
        await lavalinkPlay({
          guildId: interaction.guild.id,
          voiceId: voiceChannel.id,
          textId: playerChannelId,
          query: query,
          requester: requester,
          prepend: prepend,
          source: source,
        });

      if (!track || !track.info) {
        Log.warning("Lavalink returned a track without metadata", {
          guild: interaction.guild.id,
          query,
        });

        return interaction.editReply({
          embeds: [
            errorEmbed(
              "Track unavailable",
              "YouTube would not give me the metadata for that track. If it is age-restricted, I will keep trying another source automatically."
            ),
          ],
        });
      }

      track.info.loop = player.loop ?? "NONE";

      // Record search in history (for non-playlist single tracks)
      if (!isPlaylist && track) {
        recordSearch(requester.id, interaction.guild.id, query, track);
      }

      if (activityActive) {
        await interaction.editReply({ content: isPlaylist ? `Added ${playlistTrackCount} tracks to the MewBit Activity queue.` : "Added to MewBit Activity." });
      } else if (isPlaylist) {
        statsStore.trackPlaylistAdded(interaction.guild.id, playlistTrackCount);

        await interaction.editReply({
          embeds: [
            playlistEmbed({
              title: playlistInfo?.name ?? track.info.title ?? "Playlist",
              url: playlistUrl ?? playlistInfo?.url ?? track.info.uri,
              trackCount: playlistTrackCount,
              totalDurationMs: playlistDurationMs,
              requesterTag: requester.tag,
              requesterAvatar: requester.avatar,
              source: track.info?.sourceName ?? "Unknown",
            }),
          ],
        });
      } else {
        await interaction.editReply({ embeds: [songEmbed(track.info)] });
      }

      updateGuildState(interaction.guild.id, {
        nowPlayingChannel: playerChannelId,
      });
    } catch (error) {
      Log.error("Error in /play command:", error);
      return interaction.editReply({
        embeds: [errorEmbed("An error occurred while trying to play the song. Please try again later.")],
      });
    }
  },
};
