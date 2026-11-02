const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");

const JOIN_CUSTOM_ID = "mewbeat:join";
const INVITE_COLOR = 0xa78bfa;
const FALLBACK_HINT = "Open the MewBit Activity from the rocket button in this voice channel, then enter the secret code.";

function inviteMessage(username) {
  const embed = new EmbedBuilder()
    .setColor(INVITE_COLOR)
    .setDescription(`**${username}** is playing mewbeat`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(JOIN_CUSTOM_ID).setLabel("Join").setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

// postInvite({ guildId, userId, username }) -> { ok: true } | { ok: false, reason }.
// It posts into the text chat of the voice channel the inviter is in; getClient
// is a function because the Discord client only exists once the bot is up.
function createInvitePoster({ getClient }) {
  return async function postInvite({ guildId, userId, username }) {
    const guild = getClient()?.guilds?.cache?.get(guildId);
    if (!guild) return { ok: false, reason: "send_failed" };

    let channel = guild.voiceStates?.cache?.get(userId)?.channel ?? null;
    if (!channel) {
      const member = await guild.members.fetch(userId).catch(() => null);
      channel = member?.voice?.channel ?? null;
    }
    if (!channel) return { ok: false, reason: "no_voice_channel" };

    try {
      await channel.send(inviteMessage(username || "Someone"));
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
