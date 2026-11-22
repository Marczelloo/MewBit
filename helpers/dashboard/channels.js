const { PermissionsBitField } = require("discord.js");

/**
 * Whether MewBit can post an embed in a channel: Send Messages and Embed Links.
 *
 * Shared by the embed composer and the settings pickers so both report the same
 * answer. It is reported rather than used to filter a list: "MewBit cannot post
 * here" is more useful to an owner than a channel quietly missing from it.
 */
function channelCanPost(guild, channel) {
  const me = guild?.members?.me;
  const permissions = me && typeof channel?.permissionsFor === "function" ? channel.permissionsFor(me) : null;
  return Boolean(
    permissions?.has?.(PermissionsBitField.Flags.SendMessages) &&
      permissions?.has?.(PermissionsBitField.Flags.EmbedLinks)
  );
}

module.exports = { channelCanPost };
