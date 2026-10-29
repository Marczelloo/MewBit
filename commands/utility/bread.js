const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const Log = require("../../helpers/logs/log");

// Collection of bread image URLs
const BREAD_IMAGES = [
  "https://pngimg.com/uploads/bread/bread_PNG2292.png",
  "https://designitlife.com/wp-content/uploads/2024/08/Baked-Bread.webp",
  "https://cdn-icons-png.flaticon.com/512/8620/8620877.png",
  "https://image.similarpng.com/file/similarpng/original-picture/2020/05/Arrangement-of-bread-in-basket-transparent-PNG.png",
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTAUAPqOOu9yYH5YeuevWkmnTvyjVVfJM4hVA&s",
  "https://w7.pngwing.com/pngs/546/882/png-transparent-rye-bread-graham-bread-pumpernickel-pumpkin-bread-soda-bread-bread-baked-goods-whole-grain-bread.png",
  "https://yimages360.yellowimages.com/products/2021/06/60db4fb374c10/1x.jpg",
  "https://images-ext-1.discordapp.net/external/5ScU_FDYv14JGQ_F-To1hd_FwISdgmbxLM3MOHUrJlQ/https/media.tenor.com/OTU3W8vhFTUAAAPo/teleport-bread.mp4",
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("bread")
    .setDescription("Get a random bread image")
    .addBooleanOption((option) =>
      option
        .setName("teleport")
        .setDescription("Send the bread to a random channel on a random server")
        .setRequired(false)
    ),
  async execute(interaction) {
    const teleport = interaction.options.getBoolean("teleport") || false;
    const randomBread = BREAD_IMAGES[Math.floor(Math.random() * BREAD_IMAGES.length)];

    Log.info(
      `/bread command used by ${interaction.user.tag} in guild ${interaction.guild?.name ?? "DMs"} ${
        teleport ? "with teleport" : ""
      }`
    );

    if (teleport) {
      try {
        // Get all guilds the bot is in
        const guilds = Array.from(interaction.client.guilds.cache.values());
        if (guilds.length === 0) {
          await interaction.reply({ content: "❌ Bot is not in any servers!", ephemeral: true });
          return;
        }

        // Pick a random guild
        const randomGuild = guilds[Math.floor(Math.random() * guilds.length)];

        // Get all text channels from that guild
        const textChannels = randomGuild.channels.cache.filter(
          (channel) => channel.isTextBased() && channel.permissionsFor(randomGuild.members.me).has("SendMessages")
        );

        if (textChannels.size === 0) {
          await interaction.reply({
            content: "❌ Could not find any text channels to send bread to!",
            ephemeral: true,
          });
          return;
        }

        // Pick a random channel
        const randomChannel = textChannels.random();

        // Create bread embed
        const breadEmbed = new EmbedBuilder()
          .setTitle("🍞 Teleported Bread!")
          .setDescription(`A wild bread appeared! Sent by ${interaction.user.tag} from **${interaction.guild.name}**`)
          .setImage(randomBread)
          .setColor("#D2691E")
          .setTimestamp();

        // Send to random channel
        await randomChannel.send({ embeds: [breadEmbed] });

        // Confirm to user
        await interaction.reply({
          content: `🍞 Bread teleported to **${randomChannel.name}** in **${randomGuild.name}**!`,
          ephemeral: true,
        });

        Log.info(
          `Bread teleported from ${interaction.guild.name}#${interaction.channel.name} to ${randomGuild.name}#${randomChannel.name}`
        );
      } catch (error) {
        Log.error("Error teleporting bread:", error);
        await interaction.reply({
          content: "❌ Failed to teleport bread. I might not have permissions!",
          ephemeral: true,
        });
      }
    } else {
      // Normal bread - just send in current channel
      const breadEmbed = new EmbedBuilder()
        .setTitle("🍞 Here's your bread!")
        .setImage(randomBread)
        .setColor("#D2691E")
        .setTimestamp();

      await interaction.reply({ embeds: [breadEmbed] });
    }
  },
};
