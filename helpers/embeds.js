const { EmbedBuilder } = require("discord.js");
const { getHighResolutionArtworkUrl } = require("./artwork");
const { BRAND, brandFooter } = require("./brand");
const { formatDuration } = require("./utils");

const ICONS = {
  artist: "🎙️",
  duration: "⏱️",
  loop: "🔁",
  volume: "🔊",
  source: "📡",
  requested: "🙏",
  nowPlaying: "🎧",
  success: "✅",
  error: "❌",
  lyrics: "🎵",
  playlist: "🎶",
  stats: "📊",
  autoplay: "🔄",
};

const COLORS = {
  player: BRAND.colors.primary,
  success: BRAND.colors.success,
  error: BRAND.colors.error,
  song: BRAND.colors.secondary,
  lyrics: BRAND.colors.primary,
  playlist: BRAND.colors.secondary,
  stats: "#a978ff",
  queue: BRAND.colors.deep,
};

const bold = (label, value) => `**${label}** ${value ?? "—"}`;

module.exports = {
  playerEmbed(
    title,
    url,
    image,
    artist,
    requesterTag,
    requesterAvatar,
    duration,
    position,
    loop,
    volume = 100,
    autoplay = false,
    source = null,
    quality = null
  ) {
    const loopLabel = loop === "TRACK" ? "Track" : loop === "QUEUE" ? "Queue" : "None";

    // Build source label with quality info
    let sourceLabel = "Unknown";
    if (source === "deezer") {
      const qualityStr = quality || "FLAC";
      sourceLabel = `Deezer • ${qualityStr}`;
    } else if (source === "spotify") {
      sourceLabel = "Spotify • ~320kbps";
    } else if (source === "youtube") {
      sourceLabel = "YouTube • ~128kbps";
    } else if (source === "soundcloud") {
      sourceLabel = "SoundCloud • variable quality";
    } else if (source) {
      sourceLabel = source.charAt(0).toUpperCase() + source.slice(1);
    }

    const infoLeft = [
      `${ICONS.artist} ${bold("Artist", artist ?? "Unknown")}`,
      `${ICONS.duration} ${bold("Duration", duration ?? "Unknown")}`,
      `${ICONS.source} ${bold("Source", sourceLabel)}`,
    ].join("\n");

    const infoRight = [
      `${ICONS.loop} ${bold("Loop", loopLabel)}`,
      `${ICONS.volume} ${bold("Volume", volume)}`,
      `${ICONS.autoplay} ${bold("Autoplay", autoplay ? "On" : "Off")}`,
    ].join("\n");

    const embed = new EmbedBuilder()
      .setColor(COLORS.player)
      .setAuthor({
        name: `${ICONS.nowPlaying} Now Playing`,
        iconURL: "https://cdn.discordapp.com/emojis/741605543046807626.gif",
      })
      .setTitle(title)
      .setThumbnail(image ?? "https://i.imgur.com/3g7nmJC.png")
      .setDescription(position && duration ? `\`${position}\` / \`${duration}\`` : null)
      .addFields({ name: "\u200b", value: infoLeft, inline: true }, { name: "\u200b", value: infoRight, inline: true })
      .setFooter({
        text: `Requested by ${requesterTag ?? "Unknown"}`,
        iconURL: requesterAvatar ?? undefined,
      });

    // Providers occasionally omit a canonical page URL. Passing null or an
    // invalid value to discord.js' EmbedBuilder triggers an AggregateError
    // and aborts the whole trackStartUI handler, even though the track itself
    // is perfectly playable.
    if (/^https?:\/\//i.test(String(url || ""))) embed.setURL(url);
    return embed;
  },
  successEmbed: function (title, description) {
    return new EmbedBuilder()
      .setColor(COLORS.success)
      .setAuthor({
        name: `${ICONS.success} Success`,
        iconURL: "https://cdn.discordapp.com/emojis/809543717553446912.gif",
      })
      .setTitle(title)
      .setDescription(description || null)
      .setFooter({
        text: brandFooter("Success"),
      });
  },
  errorEmbed: function (title, description) {
    return new EmbedBuilder()
      .setColor(COLORS.error)
      .setAuthor({
        name: `${ICONS.error} Error`,
        iconURL: "https://cdn.discordapp.com/emojis/853314041004015616.png",
      })
      .setTitle(title)
      .setDescription(description || null)
      .setFooter({
        text: brandFooter("Error"),
      })
      .setTimestamp();
  },
  songEmbed(trackInfo) {
    const duration = trackInfo.isStream
      ? "Live"
      : Number.isFinite(trackInfo.length)
      ? formatDuration(trackInfo.length)
      : "Unknown";

    const requester = trackInfo.requesterId ? `<@${trackInfo.requesterId}>` : trackInfo.requesterTag ?? "Unknown";

    const details = [
      `${ICONS.duration} ${bold("Duration", duration)}`,
      `${ICONS.source} ${bold(
        "Source",
        (trackInfo.sourceName ?? "Unknown").replace(/^./, (c) => c.toUpperCase())
      )}`,
      `${ICONS.requested} ${bold("Requested", requester)}`,
    ].join("\n");

    return new EmbedBuilder()
      .setColor(COLORS.song)
      .setAuthor({
        name: `${ICONS.playlist} Added to Queue`,
        iconURL: "https://cdn.discordapp.com/emojis/853314041004015616.png",
      })
      .setTitle(trackInfo.title)
      .setURL(trackInfo.uri)
      .setDescription(trackInfo.author ? `*${trackInfo.author}*` : null)
      .setThumbnail(getHighResolutionArtworkUrl(trackInfo.artworkUrl ?? trackInfo.thumbnail ?? trackInfo.image) ?? "https://i.imgur.com/3g7nmJC.png")
      .addFields({ name: "\u200b", value: details })
      .setFooter({ text: brandFooter("Queue system") })
      .setTimestamp();
  },
  lyricsEmbed: function (title, description, footerNote) {
    return new EmbedBuilder()
      .setColor(COLORS.lyrics)
      .setAuthor({
        name: `${ICONS.lyrics} Lyrics`,
        iconURL: "https://cdn.discordapp.com/emojis/741605543046807626.gif",
      })
      .setTitle(title)
      .setDescription(description || null)
      .setFooter({ text: footerNote || brandFooter("Lyrics") });
  },
  playlistEmbed({ title, url, trackCount, totalDurationMs, requesterTag, requesterAvatar, source }) {
    const durationLabel = Number.isFinite(totalDurationMs) ? formatDuration(totalDurationMs) : "Unknown";

    return new EmbedBuilder()
      .setColor(COLORS.playlist)
      .setAuthor({
        name: `${ICONS.playlist} Playlist Added`,
        iconURL: "https://cdn.discordapp.com/emojis/853314041004015616.png",
      })
      .setTitle(title)
      .setURL(url)
      .setDescription(source ? `Source • **${source}**` : null)
      .addFields(
        { name: "Tracks", value: `**${trackCount}**`, inline: true },
        { name: "Total duration", value: `**${durationLabel}**`, inline: true }
      )
      .setFooter({
        text: requesterTag ? `Requested by ${requesterTag}` : brandFooter("Queue"),
        iconURL: requesterAvatar ?? undefined,
      })
      .setTimestamp();
  },
  statsEmbed(guildStats, globalStats, lastActivityLabel, detailedInfo = null) {
    const toHours = (ms) => (ms / 3_600_000).toFixed(2);
    const toDays = (ms) => (ms / 86_400_000).toFixed(1);

    const guildFields = [];
    const globalFields = [];

    if (guildStats) {
      guildFields.push(
        {
          name: "🎵 This Server",
          value: [
            `Songs played: **${guildStats.songsPlayed}**`,
            `Hours played: **${toHours(guildStats.msPlayed)}h**`,
            `Songs skipped: **${guildStats.songsSkipped}**`,
            `Playlists added: **${guildStats.playlistsAdded}**`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "👥 Server Activity",
          value: [
            `Unique users: **${guildStats.uniqueUserCount}**`,
            `Peak listeners: **${guildStats.peakListeners}**`,
            `Sessions: **${guildStats.totalSessions}**`,
            `Avg session: **${toHours(guildStats.averageSessionLength)}h**`,
          ].join("\n"),
          inline: true,
        }
      );

      // Add detailed info if provided
      if (detailedInfo) {
        if (detailedInfo.topSources && detailedInfo.topSources.length > 0) {
          const sourceList = detailedInfo.topSources
            .map((item) => {
              const percentage = ((item.count / guildStats.songsPlayed) * 100).toFixed(1);
              return `**${item.source}**: ${item.count} (${percentage}%)`;
            })
            .join("\n");

          guildFields.push({
            name: "📻 Top Sources",
            value: sourceList,
            inline: false,
          });
        }

        if (detailedInfo.mostActiveHour) {
          const hour = detailedInfo.mostActiveHour.hour;
          const hourStr = `${hour}:00`;
          guildFields.push({
            name: "⏰ Most Active Hour",
            value: `**${hourStr}** - ${detailedInfo.mostActiveHour.count} songs played`,
            inline: false,
          });
        }
      }
    }

    if (globalStats) {
      globalFields.push({
        name: "🌍 Global Stats",
        value: [
          `Songs played: **${globalStats.songsPlayed}**`,
          `Total playtime: **${toDays(globalStats.msPlayed)} days**`,
          `Unique users: **${globalStats.uniqueUserCount}**`,
          `Total sessions: **${globalStats.totalSessions}**`,
        ].join("\n"),
        inline: false,
      });
    }

    return new EmbedBuilder()
      .setTitle(`${ICONS.stats} Playback Statistics`)
      .setColor(COLORS.stats)
      .addFields(...guildFields, ...globalFields)
      .setFooter({ text: `Last activity: ${lastActivityLabel}` })
      .setTimestamp();
  },
  queueEmbed({ currentTrack, isPlaying, queue, page, totalPages, requesterId }) {
    const lines = [];

    if (currentTrack && (isPlaying || queue.length)) {
      const info = currentTrack.info || {};
      const duration = info.isStream ? "Live" : formatDuration(info.length);

      lines.push(
        `**Now Playing:** ${info.uri ? `[${info.title}](${info.uri})` : info.title} • \`${duration}\` • requested by <@${
          info.requesterId ?? requesterId
        }>`,
        ""
      );
    } else {
      lines.push("**Not playing anything right now.**", "");
    }

    const start = page * 20;
    const slice = queue.slice(start, start + 20);

    if (!slice.length) lines.push("The queue is empty.");
    else {
      slice.forEach((track, idx) => {
        const info = track.info || {};
        const duration = info.isStream ? "Live" : formatDuration(info.length);
        const position = start + idx + 1;

        lines.push(
          `**${position}.** ${info.uri ? `[${info.title}](${info.uri})` : info.title} • \`${duration}\` • requested by <@${
            info.requesterId ?? requesterId
          }>`
        );
      });
    }

    return new EmbedBuilder()
      .setColor(COLORS.queue)
      .setTitle("Current Queue")
      .setDescription(lines.join("\n"))
      .setFooter({ text: `Page ${page + 1}/${totalPages} • ${queue.length} queued tracks` })
      .setTimestamp();
  },
  helpCategoryEmbed(category, user) {
    const embed = new EmbedBuilder()
      .setColor(BRAND.colors.secondary)
      .setTitle(`Help - ${category.label}`)
      .setDescription(category.description);

    (category.commands ?? []).forEach((command) => {
      embed.addFields({
        name: `/${command.name}`,
        value: `${command.description}\nUsage: \`${command.usage}\``,
      });
    });

    if (Array.isArray(category.notes)) {
      category.notes.forEach((note) => {
        embed.addFields({
          name: note.name,
          value: note.value,
          inline: false,
        });
      });
    }

    return embed.setFooter({
      text: `Requested by ${user.tag}`,
      iconURL: user.displayAvatarURL({ size: 128 }),
    });
  },
};
