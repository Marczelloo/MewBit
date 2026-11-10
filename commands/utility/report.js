const {
  ActionRowBuilder,
  InteractionContextType,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { MAX_TEXT, MIN_TEXT, getReporter, placeLabel } = require("../../helpers/mewbeat/reports");
const Log = require("../../helpers/logs/log");

const MODAL_PREFIX = "report:";
const TEXT_INPUT_ID = "report_text";
const LABELS = { bug: "Bug", idea: "Idea" };

async function execute(interaction) {
  const type = interaction.options.getString("type");
  const modal = new ModalBuilder().setCustomId(`${MODAL_PREFIX}${type}`).setTitle(`Report: ${LABELS[type]}`);
  const textInput = new TextInputBuilder()
    .setCustomId(TEXT_INPUT_ID)
    .setLabel("What happened, or what would you like?")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Say what you were doing, what you expected and what happened.")
    .setMinLength(MIN_TEXT)
    .setMaxLength(MAX_TEXT)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(textInput));
  await interaction.showModal(modal);
}

async function handleModal(interaction) {
  const type = interaction.customId.slice(MODAL_PREFIX.length);
  const text = interaction.fields.getTextInputValue(TEXT_INPUT_ID);
  // Nothing here may reject: a failed answer is logged, the report still goes out, and the bot stays up.
  const logFailedAnswer = (error) => Log.error("Failed to answer a report", error);
  const reply = (content) => interaction.editReply({ content, allowedMentions: { parse: [] } }).catch(logFailedAnswer);

  // Posting can take longer than the 3 s Discord allows for a first answer.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(logFailedAnswer);
  try {
    await getReporter().send({
      type,
      text,
      reporter: { id: interaction.user.id, name: interaction.member?.displayName || interaction.user.globalName || interaction.user.username },
      source: "command",
      place: interaction.guild ? placeLabel(interaction.guild.name, interaction.guild.id) : placeLabel(),
    });
  } catch (error) {
    if (!error?.statusCode) Log.error("Failed to send a report", error);
    // A modal cannot stay open, so the text comes back with the refusal and isn't lost.
    await reply(`${error?.statusCode ? error.message : "MewBit could not send the report."} Your text was not sent. Here it is, so you can copy it:\n\n${text}`);
    return;
  }
  await reply("Thanks, your report was sent.");
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("report")
    .setDescription("Report a bug or share an idea with the author")
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Is this a bug or an idea?")
        .setRequired(true)
        .addChoices({ name: "Bug", value: "bug" }, { name: "Idea", value: "idea" })
    ),
  execute,
  handleModal,
};
