const { SlashCommandBuilder } = require("discord.js");
const djStore = require("../../helpers/dj/store");
const { errorEmbed, successEmbed } = require("../../helpers/embeds");
const { requireSharedVoice } = require("../../helpers/interactions/voiceGuards");
const { createPoru, getPlayer } = require("../../helpers/lavalink");
const { addManualTracksToQueue, markManualTrack } = require("../../helpers/lavalink/queueOrdering");
const { AUTOCOMPLETE_VARIANT_LIMIT, searchAcrossSources } = require("../../helpers/lavalink/searchAggregator");
const { filterRelevantSearchResults, rankSearchResults } = require("../../helpers/lavalink/searchRanking");
const { generateShareCode, importFromCode, shareWithUser } = require("../../helpers/playlists/sharing");
const {
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  addTrack,
  removeTrack,
  renamePlaylist,
  moveTrack,
  editPlaylist,
  manageCollaborator,
  listPlaylists,
  mergePlaylists,
} = require("../../helpers/playlists/store");
const { formatDuration } = require("../../helpers/utils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("Manage playlists - create, edit, share, and play custom playlists")

    // Create subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Create a new playlist")
        .addStringOption((option) => option.setName("name").setDescription("Playlist name").setRequired(true))
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("Playlist type")
            .addChoices(
              { name: "User Playlist (private to you)", value: "user" },
              { name: "Server Playlist (shared with server)", value: "server" }
            )
            .setRequired(false)
        )
        .addBooleanOption((option) =>
          option.setName("public").setDescription("Make playlist public (default: false)").setRequired(false)
        )
        .addStringOption((option) =>
          option.setName("description").setDescription("Playlist description").setRequired(false)
        )
        .addBooleanOption((option) =>
          option
            .setName("collaborative")
            .setDescription("Allow others to add/remove tracks (default: false)")
            .setRequired(false)
        )
    )

    // Delete subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName("delete")
        .setDescription("Delete a playlist")
        .addStringOption((option) =>
          option.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true)
        )
    )

    // List subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List playlists")
        .addStringOption((option) =>
          option
            .setName("filter")
            .setDescription("Filter by type")
            .addChoices(
              { name: "All Playlists", value: "all" },
              { name: "Your Playlists", value: "user" },
              { name: "Server Playlists", value: "server" },
              { name: "Shared With You", value: "shared" }
            )
            .setRequired(false)
        )
        .addUserOption((option) =>
          option.setName("user").setDescription("View another user's public playlists").setRequired(false)
        )
    )

    // View subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("View tracks in a playlist")
        .addStringOption((option) =>
          option.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true)
        )
    )

    // Play subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName("play")
        .setDescription("Load playlist into queue")
        .addStringOption((option) =>
          option.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true)
        )
        .addBooleanOption((option) =>
          option.setName("shuffle").setDescription("Shuffle the playlist (default: false)").setRequired(false)
        )
        .addBooleanOption((option) =>
          option.setName("prepend").setDescription("Add to front of queue (default: false)").setRequired(false)
        )
    )

    // Add subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add track to playlist (current track if no query specified)")
        .addStringOption((option) =>
          option.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("track")
            .setDescription("Search query or URL (leave empty for current track)")
            .setRequired(false)
            .setAutocomplete(true)
        )
    )

    // Remove subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove track from playlist")
        .addStringOption((option) =>
          option.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true)
        )
        .addIntegerOption((option) =>
          option.setName("position").setDescription("Track position (1-based)").setRequired(true).setMinValue(1)
        )
    )

    // Rename subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName("rename")
        .setDescription("Rename a playlist")
        .addStringOption((option) =>
          option.setName("old").setDescription("Current playlist name").setRequired(true).setAutocomplete(true)
        )
        .addStringOption((option) => option.setName("new").setDescription("New playlist name").setRequired(true))
    )

    // Move subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName("move")
        .setDescription("Reorder tracks in playlist")
        .addStringOption((option) =>
          option.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true)
        )
        .addIntegerOption((option) =>
          option.setName("from").setDescription("Source position").setRequired(true).setMinValue(1)
        )
        .addIntegerOption((option) =>
          option.setName("to").setDescription("Target position").setRequired(true).setMinValue(1)
        )
    )

    // Edit subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName("edit")
        .setDescription("Edit playlist settings")
        .addStringOption((option) =>
          option.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true)
        )
        .addStringOption((option) => option.setName("description").setDescription("New description").setRequired(false))
        .addBooleanOption((option) => option.setName("public").setDescription("Make public/private").setRequired(false))
        .addBooleanOption((option) =>
          option.setName("collaborative").setDescription("Enable/disable collaboration").setRequired(false)
        )
    )

    // Collaborators subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName("collaborators")
        .setDescription("Manage playlist collaborators")
        .addStringOption((option) =>
          option.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true)
        )
        .addUserOption((option) => option.setName("add").setDescription("Add collaborator").setRequired(false))
        .addUserOption((option) => option.setName("remove").setDescription("Remove collaborator").setRequired(false))
    )

    // Merge subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName("merge")
        .setDescription("Merge two playlists")
        .addStringOption((option) =>
          option
            .setName("target")
            .setDescription("Target playlist (will receive tracks)")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("source")
            .setDescription("Source playlist (tracks to copy)")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )

    // Share subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName("share")
        .setDescription("Share playlist with user or generate share code")
        .addStringOption((option) =>
          option.setName("name").setDescription("Playlist name").setRequired(true).setAutocomplete(true)
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Share with specific user (leave empty for share code)")
            .setRequired(false)
        )
    )

    // Import subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName("import")
        .setDescription("Import playlist from share code or URL")
        .addStringOption((option) =>
          option.setName("source").setDescription("Share code (8 chars) or Spotify/YouTube URL").setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("name").setDescription("Custom playlist name (optional)").setRequired(false)
        )
    ),

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    if (
      focusedOption.name === "name" ||
      focusedOption.name === "old" ||
      focusedOption.name === "target" ||
      focusedOption.name === "source"
    ) {
      const userId = interaction.user.id;
      const guildId = interaction.guild.id;
      const playlists = listPlaylists(userId, guildId, "all");

      const filtered = playlists
        .filter((p) => p.name.toLowerCase().includes(focusedOption.value.toLowerCase()))
        .slice(0, 25)
        .map((p) => ({
          name: `${p.name} (${p.type}, ${p.tracks.length} tracks)`,
          value: p.name,
        }));

      await interaction.respond(filtered);
    } else if (focusedOption.name === "track") {
      // Track search autocomplete (same as /play command)
      const query = focusedOption.value;

      if (!query || query.length < 2) {
        return interaction.respond([]);
      }

      try {
        const { createPoru } = require("../../helpers/lavalink");
        const poru = createPoru(interaction.client);
        const resolved = await searchAcrossSources(poru, query, {
          preferredSource: "youtube",
          variantLimit: AUTOCOMPLETE_VARIANT_LIMIT,
        });

        if (!resolved.length) {
          return interaction.respond([]);
        }

        const rankedTracks = rankSearchResults(filterRelevantSearchResults(resolved, query), query, { limit: 25 });
        const options = rankedTracks.map((track) => ({
          name: `${track.info.title} - ${track.info.author}`.substring(0, 100),
          value: track.info.uri || track.info.title,
        }));

        await interaction.respond(options);
      } catch {
        await interaction.respond([]);
      }
    }
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    // Handle each subcommand
    switch (subcommand) {
      case "create":
        return handleCreate(interaction, userId, guildId);
      case "delete":
        return handleDelete(interaction, userId, guildId);
      case "list":
        return handleList(interaction, userId, guildId);
      case "view":
        return handleView(interaction, userId, guildId);
      case "play":
        return handlePlay(interaction, userId, guildId);
      case "add":
        return handleAdd(interaction, userId, guildId);
      case "remove":
        return handleRemove(interaction, userId, guildId);
      case "rename":
        return handleRename(interaction, userId, guildId);
      case "move":
        return handleMove(interaction, userId, guildId);
      case "edit":
        return handleEdit(interaction, userId, guildId);
      case "collaborators":
        return handleCollaborators(interaction, userId, guildId);
      case "merge":
        return handleMerge(interaction, userId, guildId);
      case "share":
        return handleShare(interaction, userId, guildId);
      case "import":
        return handleImport(interaction, userId, guildId);
      default:
        return interaction.reply({ embeds: [errorEmbed("Unknown subcommand")], ephemeral: true });
    }
  },

  // Export pagination function for button handlers
  showPlaylistPage,
};

// Subcommand handlers

async function handleCreate(interaction, userId, guildId) {
  const name = interaction.options.getString("name");
  const type = interaction.options.getString("type") || "user";
  const isPublic = interaction.options.getBoolean("public") || false;
  const description = interaction.options.getString("description") || "";
  const collaborative = interaction.options.getBoolean("collaborative") || false;

  const result = createPlaylist(userId, guildId, name, {
    type,
    public: isPublic,
    description,
    collaborative,
  });

  if (!result.success) {
    return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
  }

  const embed = successEmbed(`Created ${type} playlist **${name}**`).addFields(
    { name: "Type", value: type === "user" ? "User Playlist" : "Server Playlist", inline: true },
    { name: "Visibility", value: isPublic ? "Public" : "Private", inline: true },
    { name: "Collaborative", value: collaborative ? "Yes" : "No", inline: true }
  );

  if (description) {
    embed.addFields({ name: "Description", value: description });
  }

  return interaction.reply({ embeds: [embed] });
}

async function handleDelete(interaction, userId, guildId) {
  const name = interaction.options.getString("name");
  const result = deletePlaylist(userId, guildId, name);

  if (!result.success) {
    return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
  }

  return interaction.reply({ embeds: [successEmbed(result.message)] });
}

async function handleList(interaction, userId, guildId) {
  const filter = interaction.options.getString("filter") || "all";
  const targetUser = interaction.options.getUser("user");
  const targetUserId = targetUser?.id || null;

  const playlists = listPlaylists(userId, guildId, filter, targetUserId);

  if (playlists.length === 0) {
    return interaction.reply({
      embeds: [errorEmbed("No playlists found.")],
      ephemeral: true,
    });
  }

  // Group by type
  const userPlaylists = playlists.filter((p) => p.type === "user");
  const serverPlaylists = playlists.filter((p) => p.type === "server");

  const embed = successEmbed(targetUser ? `${targetUser.username}'s Playlists` : "Your Playlists").setDescription(
    `Found ${playlists.length} playlist(s)`
  );

  if (userPlaylists.length > 0) {
    const userList = userPlaylists
      .slice(0, 10)
      .map((p) => {
        const flags = [];
        if (p.public) flags.push("📢");
        if (!p.public) flags.push("🔒");
        if (p.collaborative) flags.push("👥");
        if (p.sharedWith?.length > 0) flags.push("🔗");
        const flagText = flags.length > 0 ? ` ${flags.join(" ")}` : "";
        return `• **${p.name}** - ${p.tracks.length} tracks${flagText}`;
      })
      .join("\n");
    embed.addFields({ name: "User Playlists", value: userList || "None" });
  }

  if (serverPlaylists.length > 0 && !targetUser) {
    const serverList = serverPlaylists
      .slice(0, 10)
      .map((p) => {
        const flags = [];
        if (p.collaborative) flags.push("👥");
        const flagText = flags.length > 0 ? ` ${flags.join(" ")}` : "";
        return `• **${p.name}** - ${p.tracks.length} tracks${flagText}`;
      })
      .join("\n");
    embed.addFields({ name: "Server Playlists", value: serverList || "None" });
  }

  if (playlists.length > 20) {
    embed.setFooter({ text: `Showing first 20 of ${playlists.length} playlists` });
  }

  return interaction.reply({ embeds: [embed] });
}

async function handleView(interaction, userId, guildId) {
  const name = interaction.options.getString("name");
  const playlist = getPlaylist(userId, guildId, name);

  if (!playlist) {
    return interaction.reply({ embeds: [errorEmbed(`Playlist "${name}" not found.`)], ephemeral: true });
  }

  if (playlist.tracks.length === 0) {
    return interaction.reply({
      embeds: [errorEmbed(`Playlist "${name}" is empty. Use \`/playlist add\` to add tracks.`)],
      ephemeral: true,
    });
  }

  await showPlaylistPage(interaction, playlist, 0);
}

async function showPlaylistPage(interaction, playlist, page) {
  const tracksPerPage = 15;
  const totalPages = Math.ceil(playlist.tracks.length / tracksPerPage);
  const start = page * tracksPerPage;
  const end = Math.min(start + tracksPerPage, playlist.tracks.length);

  const trackList = playlist.tracks
    .slice(start, end)
    .map((track, index) => {
      const duration = formatDuration(track.length || 0);
      return `${start + index + 1}. **${track.title}** by ${track.author} [${duration}]`;
    })
    .join("\n");

  const totalDuration = playlist.tracks.reduce((sum, t) => sum + (t.length || 0), 0);

  const embed = successEmbed(`Playlist: ${playlist.name}`)
    .setDescription(playlist.description || "No description")
    .addFields(
      { name: "Type", value: playlist.type === "user" ? "User Playlist" : "Server Playlist", inline: true },
      { name: "Tracks", value: playlist.tracks.length.toString(), inline: true },
      { name: "Duration", value: formatDuration(totalDuration), inline: true },
      { name: `Track List (Page ${page + 1}/${totalPages})`, value: trackList }
    );

  if (playlist.thumbnail) {
    embed.setThumbnail(playlist.thumbnail);
  }

  // Add pagination buttons if more than one page
  const components = [];
  if (totalPages > 1) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`playlist-prev:${playlist.name}:${page}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`playlist-next:${playlist.name}:${page}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === totalPages - 1)
    );
    components.push(row);
  }

  const messageOptions = { embeds: [embed], components };

  // If this is a button interaction, update the message
  if (interaction.isButton()) {
    return interaction.update(messageOptions);
  }

  // Otherwise, reply or edit based on state
  if (interaction.replied || interaction.deferred) {
    return interaction.editReply(messageOptions);
  } else {
    return interaction.reply(messageOptions);
  }
}

async function handlePlay(interaction, userId, guildId) {
  const name = interaction.options.getString("name");
  const shuffle = interaction.options.getBoolean("shuffle") || false;
  const prepend = interaction.options.getBoolean("prepend") || false;

  // Voice check
  const voiceGuard = await requireSharedVoice(interaction);
  if (!voiceGuard.ok) return interaction.reply(voiceGuard.response);

  // DJ mode check for server playlists
  const playlist = getPlaylist(userId, guildId, name);
  if (!playlist) {
    return interaction.reply({ embeds: [errorEmbed(`Playlist "${name}" not found.`)], ephemeral: true });
  }

  if (playlist.type === "server") {
    const config = djStore.getDjConfig(guildId);
    if (config?.enabled) {
      const isDj = djStore.isDj(interaction.member, config);
      if (!isDj) {
        const mention = djStore.getDjRoleMention(config);
        return interaction.reply({
          embeds: [errorEmbed(`Only ${mention} can play server playlists while DJ mode is active.`)],
          ephemeral: true,
        });
      }
    }
  }

  if (playlist.tracks.length === 0) {
    return interaction.reply({ embeds: [errorEmbed("Playlist is empty.")], ephemeral: true });
  }

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

  // Prepare tracks
  let tracks = [...playlist.tracks];
  if (shuffle) {
    tracks = tracks.sort(() => Math.random() - 0.5);
  }

  // Add requester info
  tracks.forEach((track) => {
    markManualTrack(track);
    track.info = {
      title: track.title,
      author: track.author,
      identifier: track.identifier,
      uri: track.uri,
      length: track.length,
      requesterTag: interaction.user.tag,
      requesterAvatar: interaction.user.displayAvatarURL(),
      loop: "NONE",
    };
  });

  // Add to queue
  if (prepend) {
    player.queue.unshift(...tracks);
  } else {
    addManualTracksToQueue(player, tracks);
  }

  // Start playing if not already
  if (!player.isPlaying && !player.isPaused) {
    player.play();
  }

  const embed = successEmbed(`Loaded playlist **${name}**`).addFields(
    { name: "Tracks Added", value: tracks.length.toString(), inline: true },
    { name: "Shuffled", value: shuffle ? "Yes" : "No", inline: true },
    { name: "Position", value: prepend ? "Front of queue" : "End of queue", inline: true }
  );

  return interaction.editReply({ embeds: [embed] });
}

async function handleAdd(interaction, userId, guildId) {
  const name = interaction.options.getString("name");
  const trackQuery = interaction.options.getString("track");

  let track;

  if (trackQuery) {
    // Search for track
    await interaction.deferReply();
    const poru = createPoru(interaction.client);
    const resolved = await poru.resolve({ query: trackQuery });

    if (!resolved?.tracks?.length) {
      return interaction.editReply({ embeds: [errorEmbed("No tracks found for that query.")] });
    }

    const isUrl = /^https?:\/\//i.test(trackQuery.trim());
    track = isUrl ? resolved.tracks[0] : rankSearchResults(resolved.tracks, trackQuery)[0];
  } else {
    // Use current track
    const player = getPlayer(guildId);
    if (!player?.currentTrack) {
      return interaction.reply({
        embeds: [errorEmbed("No track is currently playing. Provide a search query to add a specific track.")],
        ephemeral: true,
      });
    }
    track = player.currentTrack;
  }

  const result = addTrack(userId, guildId, name, track);

  if (!result.success) {
    const replyMethod = trackQuery ? "editReply" : "reply";
    return interaction[replyMethod]({ embeds: [errorEmbed(result.error)], ephemeral: true });
  }

  const replyMethod = trackQuery ? "editReply" : "reply";
  return interaction[replyMethod]({ embeds: [successEmbed(result.message)] });
}

async function handleRemove(interaction, userId, guildId) {
  const name = interaction.options.getString("name");
  const position = interaction.options.getInteger("position");

  const result = removeTrack(userId, guildId, name, position);

  if (!result.success) {
    return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
  }

  return interaction.reply({ embeds: [successEmbed(result.message)] });
}

async function handleRename(interaction, userId, guildId) {
  const oldName = interaction.options.getString("old");
  const newName = interaction.options.getString("new");

  const result = renamePlaylist(userId, guildId, oldName, newName);

  if (!result.success) {
    return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
  }

  return interaction.reply({ embeds: [successEmbed(result.message)] });
}

async function handleMove(interaction, userId, guildId) {
  const name = interaction.options.getString("name");
  const from = interaction.options.getInteger("from");
  const to = interaction.options.getInteger("to");

  const result = moveTrack(userId, guildId, name, from, to);

  if (!result.success) {
    return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
  }

  return interaction.reply({ embeds: [successEmbed(result.message)] });
}

async function handleEdit(interaction, userId, guildId) {
  const name = interaction.options.getString("name");
  const updates = {};

  const description = interaction.options.getString("description");
  const isPublic = interaction.options.getBoolean("public");
  const collaborative = interaction.options.getBoolean("collaborative");

  if (description !== null) updates.description = description;
  if (isPublic !== null) updates.public = isPublic;
  if (collaborative !== null) updates.collaborative = collaborative;

  if (Object.keys(updates).length === 0) {
    return interaction.reply({
      embeds: [errorEmbed("No updates specified. Provide at least one option to update.")],
      ephemeral: true,
    });
  }

  const result = editPlaylist(userId, guildId, name, updates);

  if (!result.success) {
    return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
  }

  return interaction.reply({ embeds: [successEmbed(result.message)] });
}

async function handleCollaborators(interaction, userId, guildId) {
  const name = interaction.options.getString("name");
  const addUser = interaction.options.getUser("add");
  const removeUser = interaction.options.getUser("remove");

  if (!addUser && !removeUser) {
    return interaction.reply({
      embeds: [errorEmbed("Specify a user to add or remove.")],
      ephemeral: true,
    });
  }

  if (addUser && removeUser) {
    return interaction.reply({
      embeds: [errorEmbed("Cannot add and remove at the same time.")],
      ephemeral: true,
    });
  }

  const action = addUser ? "add" : "remove";
  const targetUserId = (addUser || removeUser).id;

  const result = manageCollaborator(userId, guildId, name, targetUserId, action);

  if (!result.success) {
    return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
  }

  return interaction.reply({ embeds: [successEmbed(result.message)] });
}

async function handleMerge(interaction, userId, guildId) {
  const targetName = interaction.options.getString("target");
  const sourceName = interaction.options.getString("source");

  const result = mergePlaylists(userId, guildId, targetName, sourceName);

  if (!result.success) {
    return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
  }

  return interaction.reply({ embeds: [successEmbed(result.message)] });
}

async function handleShare(interaction, userId, guildId) {
  const name = interaction.options.getString("name");
  const targetUser = interaction.options.getUser("user");

  if (targetUser) {
    // Share with specific user
    const result = shareWithUser(userId, guildId, name, targetUser.id);

    if (!result.success) {
      return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
    }

    return interaction.reply({
      embeds: [successEmbed(`Shared playlist **${name}** with ${targetUser.tag}.`)],
    });
  } else {
    // Generate share code
    const result = generateShareCode(userId, guildId, name);

    if (!result.success) {
      return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
    }

    const embed = successEmbed(`Share Code Generated`).setDescription(
      `Share code for playlist **${name}**:\n\n\`\`\`${result.code}\`\`\`\n\n` +
        `Others can import this playlist using:\n\`/playlist import code:${result.code}\`\n\n` +
        `⏰ Code expires in ${result.expiresIn}.`
    );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function handleImport(interaction, userId, guildId) {
  const source = interaction.options.getString("source");
  const customName = interaction.options.getString("name");

  // Check if it's a URL or share code
  if (source.includes("spotify.com/playlist") || source.includes("youtube.com") || source.includes("youtu.be")) {
    // Import from URL
    await interaction.deferReply();

    const { importPlaylistFromUrl } = require("../../helpers/playlists/import");
    const result = await importPlaylistFromUrl(interaction.client, userId, guildId, source, {
      name: customName,
      type: "user",
    });

    if (!result.success) {
      return interaction.editReply({ embeds: [errorEmbed(result.error)] });
    }

    const embed = successEmbed(result.message).addFields(
      { name: "Playlist Name", value: result.playlistName, inline: true },
      { name: "Tracks Imported", value: result.trackCount.toString(), inline: true },
      { name: "Source", value: result.source === "spotify" ? "Spotify" : "YouTube", inline: true }
    );

    if (result.thumbnail) {
      embed.setThumbnail(result.thumbnail);
    }

    return interaction.editReply({ embeds: [embed] });
  } else {
    // Import from share code
    if (source.length !== 8) {
      return interaction.reply({
        embeds: [
          errorEmbed("Share codes must be exactly 8 characters. For URLs, use a Spotify or YouTube playlist link."),
        ],
        ephemeral: true,
      });
    }

    const result = importFromCode(userId, guildId, source);

    if (!result.success) {
      return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
    }

    const embed = successEmbed(result.message).addFields(
      { name: "Playlist Name", value: result.playlistName, inline: true },
      { name: "Tracks Imported", value: result.trackCount.toString(), inline: true }
    );

    return interaction.reply({ embeds: [embed] });
  }
}
