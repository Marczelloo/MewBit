const {
  Events,
  TextInputStyle,
  ModalBuilder,
  TextInputBuilder,
  ActionRowBuilder,
  EmbedBuilder,
} = require("discord.js");
const queueCommand = require("../commands/music/queue");
const helpCommand = require("../commands/utility/help");
const { handleControlButtons, refreshNowPlayingMessage } = require("../helpers/buttons");
const { getClient } = require("../helpers/clientRegistry");
const { handleProposalInteraction } = require("../helpers/dj/interactions");
const djStore = require("../helpers/dj/store");
const { createPoru, lavalinkSetVolume } = require("../helpers/lavalink/index");
const Log = require("../helpers/logs/log");
const { JOIN_CUSTOM_ID, handleJoinButton: handleMewbeatJoin } = require("../helpers/mewbeat/invites");
const health = require("../helpers/monitoring/health");

// Bot logs helper
async function logBotCommand(interaction, success, error = null) {
  try {
    const logsCommand = require("../commands/utility/logs");
    const config = logsCommand.getGuildLogsConfig(interaction.guild?.id);

    if (!config?.enabled || !config?.categories?.bot || !config?.channels?.bot) return;

    const channel = await interaction.guild.channels.fetch(config.channels.bot).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setAuthor({
        name: interaction.user.tag,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTimestamp();

    // Build command string
    let commandStr = `/${interaction.commandName}`;
    if (interaction.options) {
      const subcommandGroup = interaction.options.getSubcommandGroup?.(false);
      const subcommand = interaction.options.getSubcommand?.(false);
      if (subcommandGroup) commandStr += ` ${subcommandGroup}`;
      if (subcommand) commandStr += ` ${subcommand}`;

      // Add options
      const options = interaction.options.data;
      for (const opt of options) {
        if (opt.type === 1 || opt.type === 2) {
          // Subcommand or group
          if (opt.options) {
            for (const subOpt of opt.options) {
              if (subOpt.type === 1 && subOpt.options) {
                for (const o of subOpt.options) {
                  commandStr += ` ${o.name}:${o.value}`;
                }
              } else if (subOpt.value !== undefined) {
                commandStr += ` ${subOpt.name}:${subOpt.value}`;
              }
            }
          }
        } else if (opt.value !== undefined) {
          commandStr += ` ${opt.name}:${opt.value}`;
        }
      }
    }

    if (success) {
      embed
        .setColor(0x57f287)
        .setTitle("✅ Command Executed")
        .addFields(
          { name: "Command", value: `\`${commandStr.slice(0, 1024)}\``, inline: false },
          { name: "User", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Channel", value: `<#${interaction.channel?.id}>`, inline: true }
        );
    } else {
      embed
        .setColor(0xed4245)
        .setTitle("❌ Command Failed")
        .addFields(
          { name: "Command", value: `\`${commandStr.slice(0, 1024)}\``, inline: false },
          { name: "User", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Channel", value: `<#${interaction.channel?.id}>`, inline: true }
        );
      if (error) {
        embed.addFields({
          name: "Error",
          value: `\`\`\`${String(error.message || error).slice(0, 1000)}\`\`\``,
          inline: false,
        });
      }
    }

    embed.setFooter({ text: `User ID: ${interaction.user.id}` });

    await channel.send({ embeds: [embed] });
  } catch {
    // Silently fail - don't break command execution for logging
  }
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command || !command.autocomplete) {
        return;
      }

      try {
        await command.autocomplete(interaction);
      } catch (error) {
        Log.error(`Error handling autocomplete for ${interaction.commandName}`, error);
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "help-category" && typeof helpCommand.handleCategorySelect === "function") {
        await helpCommand.handleCategorySelect(interaction);
      }
      ``;
      if (interaction.customId.startsWith("eq:")) {
        const { handlePanelInteraction } = require("../helpers/equalizer/interactions");
        await handlePanelInteraction(interaction);
        return;
      }

      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("changelog:")) {
        const announcer = require("../helpers/announcements/announcer");
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
        const parts = interaction.customId.split(":");
        const action = parts[1]; // prev, next, or current
        const allVersions = announcer.getAllVersions();

        if (allVersions.length === 0) {
          await interaction.reply({ content: "No changelog versions available.", ephemeral: true });
          return;
        }

        // Get current version from embed footer - try multiple patterns
        const footerText = interaction.message.embeds[0]?.footer?.text;
        let currentVersion = footerText?.match(/Version ([\d.]+)/)?.[1] || footerText?.match(/v?([\d.]+)/)?.[1];

        if (!currentVersion || !allVersions.includes(currentVersion)) {
          currentVersion = allVersions[0];
        }

        const currentIndex = allVersions.indexOf(currentVersion);
        let newIndex = currentIndex;

        // Navigate based on action
        if (action === "prev") {
          // Older version = higher index (move down the list)
          if (currentIndex < allVersions.length - 1) {
            newIndex = currentIndex + 1;
          }
        } else if (action === "next") {
          // Newer version = lower index (move up the list)
          if (currentIndex > 0) {
            newIndex = currentIndex - 1;
          }
        } else if (action === "current") {
          // Latest version = index 0
          newIndex = 0;
        }

        const newVersion = allVersions[newIndex];

        const embed = announcer.buildPatchNotesEmbed(newVersion, newIndex + 1, allVersions.length);
        const linkButtons = announcer.buildPatchNotesButtons(newVersion, false);

        // Build navigation buttons
        const components = [linkButtons];

        if (allVersions.length > 1) {
          const navButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("changelog:prev")
              .setLabel("◀ Older")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(newIndex >= allVersions.length - 1),
            new ButtonBuilder()
              .setCustomId("changelog:current")
              .setLabel("Latest")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(newIndex === 0),
            new ButtonBuilder()
              .setCustomId("changelog:next")
              .setLabel("Newer ▶")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(newIndex <= 0)
          );

          components.push(navButtons);
        }

        await interaction.update({
          content: newIndex === 0 ? `📢 **Latest Version: v${newVersion}**` : `📜 **Version: v${newVersion}**`,
          embeds: [embed],
          components,
        });
        return;
      }

      if (interaction.customId === JOIN_CUSTOM_ID) {
        await handleMewbeatJoin(interaction);
        return;
      }

      if (interaction.customId === "announce:dismiss") {
        await interaction.message.delete().catch((err) => {
          Log.error("Failed to delete announcement message", err);
        });
        return;
      }

      // Unlike confirmation buttons
      if (interaction.customId.startsWith("unlike-confirm:") || interaction.customId === "unlike-cancel") {
        const { removeTrack } = require("../helpers/playlists/store");
        const { successEmbed, errorEmbed } = require("../helpers/embeds");

        if (interaction.customId === "unlike-cancel") {
          await interaction.update({
            content: "❌ Cancelled",
            embeds: [],
            components: [],
          });
          return;
        }

        // Extract position from customId
        const position = parseInt(interaction.customId.split(":")[1], 10);
        const userId = interaction.user.id;
        const guildId = interaction.guild.id;

        const result = removeTrack(userId, guildId, "Liked Songs", position);

        if (!result.success) {
          await interaction.update({
            embeds: [errorEmbed(result.error)],
            components: [],
          });
          return;
        }

        await interaction.update({
          embeds: [successEmbed("Removed from Liked Songs 💔").setDescription(result.message)],
          components: [],
        });
        return;
      }

      if (interaction.customId.startsWith("eq:")) {
        const { handlePanelInteraction } = require("../helpers/equalizer/interactions");
        await handlePanelInteraction(interaction);
        return;
      }

      if (interaction.customId.startsWith("dj|")) {
        await handleProposalInteraction(interaction);
        return;
      }

      // Handle ticket buttons
      if (interaction.customId.startsWith("ticket_")) {
        const ticketCommand = require("../commands/utility/ticket");
        await ticketCommand.handleTicketButton(interaction);
        return;
      }

      if (interaction.customId.startsWith("queue|")) {
        if (typeof queueCommand.handlePaginationButtons === "function") {
          await queueCommand.handlePaginationButtons(interaction);
        }

        return;
      }

      // Playlist pagination buttons
      if (interaction.customId.startsWith("playlist-prev:") || interaction.customId.startsWith("playlist-next:")) {
        const parts = interaction.customId.split(":");
        const action = parts[0].replace("playlist-", ""); // "prev" or "next"
        const playlistName = parts[1];
        const currentPage = parseInt(parts[2], 10);

        const userId = interaction.user.id;
        const guildId = interaction.guild.id;
        const { getPlaylist } = require("../helpers/playlists/store");
        const playlist = getPlaylist(userId, guildId, playlistName);

        if (!playlist) {
          await interaction.reply({ content: "Playlist not found.", ephemeral: true });
          return;
        }

        const newPage = action === "next" ? currentPage + 1 : currentPage - 1;
        const playlistCommand = require("../commands/music/playlist");
        await playlistCommand.showPlaylistPage(interaction, playlist, newPage);
        return;
      }

      // History pagination buttons
      if (interaction.customId.startsWith("history:")) {
        const historyCommand = require("../commands/music/history");
        await historyCommand.handlePaginationButtons(interaction);
        return;
      }

      const poru = createPoru(getClient());
      const player = poru.players.get(interaction.guild.id);
      if (!player) {
        await interaction.reply({ content: "No music is being played on this server.", ephemeral: true });
        return;
      }

      const config = djStore.getGuildConfig(interaction.guild.id);
      const isDj = djStore.hasDjPermissions(interaction.member, config);

      const memberChannel = interaction.member.voice?.channelId;
      if (player.voiceChannel && player.voiceChannel !== memberChannel) {
        await interaction.reply({
          content: "You must be in the same voice channel as me to use this button.",
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId === "volume-button") {
        if (config.enabled && !isDj) {
          const mention = djStore.getDjRoleMention(config);
          await interaction.reply({
            content: "Only " + mention + " can adjust the volume while DJ mode is active.",
            ephemeral: true,
          });
          return;
        }

        const modal = new ModalBuilder().setCustomId("player-volume-modal").setTitle("Set Player Volume");

        const volumeInput = new TextInputBuilder()
          .setCustomId("player-volume-value")
          .setLabel("Volume (1-100)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(player.volume ?? 100));

        modal.addComponents(new ActionRowBuilder().addComponents(volumeInput));
        await interaction.showModal(modal);
        return;
      }

      await handleControlButtons(interaction, player);
      return;
    }

    if (interaction.isModalSubmit()) {
      // Handle embed modal
      if (interaction.customId === "embed_modal") {
        const embedCommand = require("../commands/utility/embed");
        await embedCommand.handleModal(interaction);
        return;
      }

      // Handle ticket modals
      if (interaction.customId.startsWith("ticket_create:") || interaction.customId.startsWith("ticket_respond:")) {
        const ticketCommand = require("../commands/utility/ticket");
        await ticketCommand.handleModal(interaction);
        return;
      }

      // Handle report modals
      if (interaction.customId.startsWith("report:")) {
        const reportCommand = require("../commands/utility/report");
        await reportCommand.handleModal(interaction);
        return;
      }

      if (interaction.customId !== "player-volume-modal") return;

      const rawValue = interaction.fields.getTextInputValue("player-volume-value").trim();
      const parsed = Number(rawValue);

      if (!Number.isFinite(parsed)) {
        await interaction.reply({
          content: "Invalid volume value. Please provide a number between 1 and 100.",
          ephemeral: true,
        });
        return;
      }

      const target = Math.max(0, Math.min(100, Math.round(parsed)));

      const poru = createPoru(getClient());
      const player = poru.players.get(interaction.guild.id);
      if (!player) {
        await interaction.reply({ content: "No music is being played on this server.", ephemeral: true });
        return;
      }

      const config = djStore.getGuildConfig(interaction.guild.id);
      const isDj = djStore.hasDjPermissions(interaction.member, config);
      if (config.enabled && !isDj) {
        const mention = djStore.getDjRoleMention(config);
        await interaction.reply({
          content: "Only " + mention + " can adjust the volume while DJ mode is active.",
          ephemeral: true,
        });
        return;
      }

      const memberChannel = interaction.member.voice?.channelId;
      if (player.voiceChannel && player.voiceChannel !== memberChannel) {
        await interaction.reply({
          content: "You must be in the same voice channel as me to use this button.",
          ephemeral: true,
        });
        return;
      }

      await lavalinkSetVolume(interaction.guild.id, target);
      await interaction.reply({ content: `Set player volume to \`${target}\`.`, ephemeral: true });
      await refreshNowPlayingMessage(
        interaction.client,
        interaction.guild.id,
        player,
        player.loop ?? "NONE",
        player.position
      );
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      Log.error(
        `No command matching ${interaction.commandName} was found.`,
        null,
        `Command name: ${interaction.commandName}`,
        interaction.guild?.id,
        interaction.guild?.name
      );
      return;
    }

    try {
      await command.execute(interaction);
      health.recordCommand(true);
      // Log successful command to bot-logs channel
      await logBotCommand(interaction, true);
    } catch (error) {
      health.recordCommand(false);
      // Log failed command to bot-logs channel
      await logBotCommand(interaction, false, error);
      Log.error(
        `Error executing ${interaction.commandName}`,
        error,
        `Command name: ${interaction.commandName}`,
        interaction.guild?.id,
        interaction.guild?.name
      );
    }
  },
};
