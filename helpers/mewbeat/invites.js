const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");

const JOIN_CUSTOM_ID = "mewbeat:join";
const INVITE_COLOR = 0xa78bfa;
const FOOTER = "4-key rhythm game · play together in this voice channel";
const FALLBACK_HINT = "Open the MewBit Activity from the rocket button in this voice channel, then enter the secret code.";

// Titles and names are user data: markdown specials and line breaks would break
// the embed layout, so they are dropped, and the text is cut to a sane length.
function plain(value, max) {
  const text = String(value ?? "").replace(/[*_~`|>#\\[\]]/g, "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// room: { title, artist, artworkUrl, players, maxPlayers, queued, inRound } | null
function inviteMessage({ username, avatarUrl, room } = {}) {
  const name = plain(username, 100) || "Someone";
  const embed = new EmbedBuilder()
    .setColor(INVITE_COLOR)
    .setAuthor({ name: `${name} invited you to play`, iconURL: avatarUrl || undefined })
    .setTitle("mewbeat")
    .setFooter({ text: FOOTER });

  const title = plain(room?.title, 200);
  if (title) {
    const artist = plain(room.artist, 100);
    embed.setDescription(artist ? `**${title}**\n${artist}` : `**${title}**`);
    if (typeof room.artworkUrl === "string" && room.artworkUrl.startsWith("https://")) embed.setThumbnail(room.artworkUrl);
  } else {
    embed.setDescription("Pick a song together and play it in sync.");
  }
  if (room) {
    const queued = Number(room.queued) || 0;
    embed.addFields(
      { name: "Players", value: `${Number(room.players) || 0}/${Number(room.maxPlayers) || 0}`, inline: true },
      { name: "Queue", value: `${queued} ${queued === 1 ? "song" : "songs"}`, inline: true },
      { name: "Status", value: room.inRound ? "Round in progress" : "In the lobby", inline: true },
    );
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(JOIN_CUSTOM_ID).setLabel("Join the room").setEmoji("🎵").setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

// postInvite({ guildId, userId, username, avatarUrl, room }) -> { ok: true } | { ok: false, reason }.
// It posts into the text chat of the voice channel the inviter is in; getClient
// is a function because the Discord client only exists once the bot is up.
function createInvitePoster({ getClient }) {
  return async function postInvite({ guildId, userId, username, avatarUrl, room }) {
    const guild = getClient()?.guilds?.cache?.get(guildId);
    if (!guild) return { ok: false, reason: "send_failed" };

    let channel = guild.voiceStates?.cache?.get(userId)?.channel ?? null;
    if (!channel) {
      const member = await guild.members.fetch(userId).catch(() => null);
      channel = member?.voice?.channel ?? null;
    }
    if (!channel) return { ok: false, reason: "no_voice_channel" };

    try {
      await channel.send(inviteMessage({ username, avatarUrl, room }));
      return { ok: true };
    } catch {
      return { ok: false, reason: "send_failed" };
    }
  };
}

// The Join button: opens the Activity when the library can, else tells the
// player where to find it. It never unlocks anything, and the hint doesn't
// give the code away.
async function handleJoinButton(interaction) {
  if (typeof interaction.launchActivity === "function") {
    try {
      await interaction.launchActivity();
      return;
    } catch {
      // Falls through to the hint (no Activity set up for this app/channel).
      if (interaction.replied || interaction.deferred) return;
    }
  }
  await interaction.reply({ content: FALLBACK_HINT, flags: MessageFlags.Ephemeral });
}

module.exports = { FALLBACK_HINT, JOIN_CUSTOM_ID, createInvitePoster, handleJoinButton, inviteMessage };
