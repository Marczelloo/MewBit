const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { errorEmbed, successEmbed } = require("../../helpers/embeds");
const { getHistory, clearHistory, searchHistory } = require("../../helpers/history/searchHistory");
const { requireSharedVoice } = require("../../helpers/interactions/voiceGuards");
const { createPoru } = require("../../helpers/lavalink");
const { scheduleAutoplayRefresh } = require("../../helpers/lavalink/autoplay");
const { addManualTracksToQueue, markManualTrack } = require("../../helpers/lavalink/queueOrdering");
const Log = require("../../helpers/logs/log");
const { createPlaylist, addTrack } = require("../../helpers/playlists/store");
const { formatDuration } = require("../../helpers/utils");

const ITEMS_PER_PAGE = 15;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription("View and manage your search history")

    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("View your recent searches")
        .addBooleanOption((option) =>
          option
            .setName("server-only")
            .setDescription("Show only searches from this server (default: all)")
            .setRequired(false)
        )
    )

    .addSubcommand((subcommand) =>
      subcommand
        .setName("replay")
        .setDescription("Replay a track from your history")
        .addIntegerOption((option) =>
          option.setName("number").setDescription("History entry number (from /history view)").setRequired(true)
        )
        .addBooleanOption((option) =>
          option.setName("prepend").setDescription("Add to front of queue (default: false)").setRequired(false)
        )
    )

    .addSubcommand((subcommand) =>
      subcommand
        .setName("search")
        .setDescription("Search your history")
        .addStringOption((option) =>
          option.setName("query").setDescription("Search for track title or artist").setRequired(true)
        )
    )

    .addSubcommand((subcommand) =>
      subcommand
        .setName("export")
        .setDescription("Export search history to a playlist")
        .addStringOption((option) => option.setName("name").setDescription("Playlist name").setRequired(true))
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription("Max tracks to export (default: 50)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(100)
        )
        .addBooleanOption((option) =>
          option.setName("server-only").setDescription("Export only searches from this server").setRequired(false)
        )
    )

    .addSubcommand((subcommand) =>
      subcommand
        .setName("clear")
        .setDescription("Clear your search history")
        .addBooleanOption((option) =>
          option.setName("server-only").setDescription("Clear only searches from this server").setRequired(false)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    switch (subcommand) {
      case "view":
        return handleView(interaction, userId, guildId);
      case "replay":
        return handleReplay(interaction, userId, guildId);
      case "search":
        return handleSearch(interaction, userId, guildId);
      case "export":
        return handleExport(interaction, userId, guildId);
      case "clear":
        return handleClear(interaction, userId, guildId);
      default:
        return interaction.reply({ embeds: [errorEmbed("Unknown subcommand")], ephemeral: true });
    }
  },

  async handlePaginationButtons(interaction) {
    const [, action, page, userIdFromButton, guildFilter] = interaction.customId.split(":");

    if (interaction.user.id !== userIdFromButton) {
      return interaction.reply({
        content: "Only the user who initiated the command can use these buttons.",
        ephemeral: true,
      });
    }

    const currentPage = parseInt(page);
    const newPage = action === "next" ? currentPage + 1 : currentPage - 1;

    await showHistoryPage(interaction, userIdFromButton, guildFilter === "true" ? interaction.guildId : null, newPage);
  },
};

async function handleView(interaction, userId, guildId) {
  const serverOnly = interaction.options.getBoolean("server-only") || false;
  await showHistoryPage(interaction, userId, serverOnly ? guildId : null, 0);
}

async function showHistoryPage(interaction, userId, guildFilter, page) {
  const history = getHistory(userId, guildFilter, 200); // Get more for pagination

  if (history.length === 0) {
    const embed = errorEmbed("No search history found.");
    if (interaction.isButton()) {
      return interaction.update({ embeds: [embed], components: [] });
    }
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  const totalPages = Math.ceil(history.length / ITEMS_PER_PAGE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * ITEMS_PER_PAGE;
  const end = Math.min(start + ITEMS_PER_PAGE, history.length);

  const entries = history.slice(start, end);

  const historyList = entries
    .map((entry, index) => {
      const number = start + index + 1;
      const duration = formatDuration(entry.track.length || 0);
      const timeAgo = getTimeAgo(entry.timestamp);
      const source = entry.track.sourceName || "unknown";

      return `${number}. **${entry.track.title}** by ${entry.track.author}\n   ⏱️ ${duration} • 🎵 ${source} • 🕒 ${timeAgo}`;
    })
    .join("\n\n");

  const embed = successEmbed("Search History")
    .setDescription(`${guildFilter ? "Server searches only" : "All searches"}\n\n` + historyList)
    .setFooter({ text: `Page ${safePage + 1}/${totalPages} • Total: ${history.length} searches` });

  const components = [];
  if (totalPages > 1) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`history:prev:${safePage}:${userId}:${!!guildFilter}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(safePage === 0),
      new ButtonBuilder()
        .setCustomId(`history:next:${safePage}:${userId}:${!!guildFilter}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(safePage === totalPages - 1)
    );
    components.push(row);
  }

  const messageOptions = { embeds: [embed], components, ephemeral: true };

  if (interaction.isButton()) {
    return interaction.update(messageOptions);
  } else if (interaction.replied || interaction.deferred) {
    return interaction.editReply(messageOptions);
  } else {
    return interaction.reply(messageOptions);
  }
}

async function handleReplay(interaction, userId, guildId) {
  const number = interaction.options.getInteger("number");
  const prepend = interaction.options.getBoolean("prepend") || false;

  const history = getHistory(userId, null, 200);

  if (history.length === 0) {
    return interaction.reply({ embeds: [errorEmbed("No search history found.")], ephemeral: true });
  }

  if (number < 1 || number > history.length) {
    return interaction.reply({
      embeds: [errorEmbed(`Invalid entry number. You have ${history.length} entries in history.`)],
      ephemeral: true,
    });
  }

  const entry = history[number - 1];

  // Voice check
  const voiceGuard = await requireSharedVoice(interaction);
  if (!voiceGuard.ok) return interaction.reply(voiceGuard.response);

  await interaction.deferReply();

  const poru = createPoru(interaction.client);
  let player = poru.players.get(guildId);

  if (!player) {
    player = poru.createConnection({
      guildId,
      voiceChannel: interaction.member.voice.channelId,
      textChannel: interaction.channel.id,
      deaf: true,
    });
  }

  // Resolve track
  const resolved = await poru.resolve({ query: entry.track.uri || entry.query });

  if (!resolved?.tracks?.length) {
    return interaction.editReply({
      embeds: [errorEmbed("Could not find that track anymore.")],
    });
  }

  const track = resolved.tracks[0];
  markManualTrack(track);
  track.info.requesterTag = interaction.user.tag;
  track.info.requesterAvatar = interaction.user.displayAvatarURL();

  if (prepend) {
    player.queue.unshift(track);
  } else {
    addManualTracksToQueue(player, [track]);
  }
  scheduleAutoplayRefresh(player);

  if (!player.isPlaying && !player.isPaused) {
    player.play();
  }

  const embed = successEmbed(`Replayed from history`)
    .setDescription(`**${track.info.title}** by ${track.info.author}`)
    .addFields(
      { name: "Position", value: prepend ? "Front of queue" : "End of queue", inline: true },
      { name: "Original Search", value: entry.query || "Direct link", inline: true }
    );

  Log.info(
    "⏮️ /history replay command",
    `number=${number}`,
    `user=${interaction.user.tag}`,
    `guild=${interaction.guild.name}`,
    `id=${interaction.guild.id}`
  );

  return interaction.editReply({ embeds: [embed] });
}

async function handleSearch(interaction, userId) {
  const query = interaction.options.getString("query");

  const results = searchHistory(userId, query, 25);

  if (results.length === 0) {
    return interaction.reply({
      embeds: [errorEmbed(`No results found for "${query}".`)],
      ephemeral: true,
    });
  }

  const resultList = results
    .slice(0, 15)
    .map((entry, index) => {
      const duration = formatDuration(entry.track.length || 0);
      const timeAgo = getTimeAgo(entry.timestamp);

      return `${index + 1}. **${entry.track.title}** by ${entry.track.author}\n   ⏱️ ${duration} • 🕒 ${timeAgo}`;
    })
    .join("\n\n");

  const embed = successEmbed(`Search Results: "${query}"`)
    .setDescription(resultList)
    .setFooter({ text: `Found ${results.length} matches` });

  Log.info(
    "🔍 /history search command",
    `user=${interaction.user.tag}`,
    `guild=${interaction.guild.name}`,
    `id=${interaction.guild.id}`
  );

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleExport(interaction, userId, guildId) {
  const playlistName = interaction.options.getString("name");
  const limit = interaction.options.getInteger("limit") || 50;
  const serverOnly = interaction.options.getBoolean("server-only") || false;

  await interaction.deferReply();

  const history = getHistory(userId, serverOnly ? guildId : null, limit);

  if (history.length === 0) {
    return interaction.editReply({ embeds: [errorEmbed("No search history found.")] });
  }

  // Create playlist
  const createResult = createPlaylist(userId, guildId, playlistName, {
    type: "user",
    description: `Exported from search history (${serverOnly ? "server only" : "all searches"})`,
    public: false,
  });

  if (!createResult.success) {
    return interaction.editReply({ embeds: [errorEmbed(createResult.error)] });
  }

  // Add tracks
  let addedCount = 0;
  let failedCount = 0;

  for (const entry of history) {
    const result = addTrack(userId, guildId, playlistName, {
      info: entry.track,
      track: entry.track.identifier,
    });

    if (result.success) {
      addedCount++;
    } else {
      failedCount++;
    }
  }

  const embed = successEmbed(`Exported search history to playlist`)
    .setDescription(`Created playlist **${playlistName}**`)
    .addFields(
      { name: "Tracks Added", value: addedCount.toString(), inline: true },
      { name: "Failed", value: failedCount.toString(), inline: true },
      { name: "Source", value: serverOnly ? "This server only" : "All servers", inline: true }
    );

  Log.info(
    "💾 /history export command",
    `user=${interaction.user.tag}`,
    `guild=${interaction.guild.name}`,
    `id=${interaction.guild.id}`
  );

  return interaction.editReply({ embeds: [embed] });
}

async function handleClear(interaction, userId, guildId) {
  const serverOnly = interaction.options.getBoolean("server-only") || false;

  const result = clearHistory(userId, serverOnly ? guildId : null);

  if (!result.success) {
    return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
  }

  Log.info(
    "🗑️ /history clear command",
    `user=${interaction.user.tag}`,
    `guild=${interaction.guild.name}`,
    `id=${interaction.guild.id}`
  );

  return interaction.reply({ embeds: [successEmbed(result.message)], ephemeral: true });
}

function getTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}
