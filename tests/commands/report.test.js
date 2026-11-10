const assert = require("node:assert");
const { afterEach, beforeEach, describe, it, mock } = require("node:test");

const { MessageFlags, WebhookClient } = require("discord.js");

const report = require("../../commands/utility/report");

const TEXT = "The notes stop falling after the pause.";
const FAKE_WEBHOOK = `https://discord.com/api/webhooks/${"1".repeat(18)}/${"a".repeat(68)}`;

function modalInteraction({ customId = "report:bug", text = TEXT, userId = "u1", guild = { id: "g1", name: "Test Server" } } = {}) {
  const replies = [];
  const deferred = [];
  return {
    replies,
    deferred,
    interaction: {
      customId,
      user: { id: userId, username: "ann", globalName: "Ann" },
      member: null,
      guild,
      fields: { getTextInputValue: (id) => (id === "report_text" ? text : "") },
      deferReply: async (options) => deferred.push(options),
      editReply: async (message) => replies.push(message),
    },
  };
}

describe("/report", () => {
  let posted;
  let webhookBefore;

  beforeEach(() => {
    posted = [];
    webhookBefore = process.env.MEWBEAT_REPORT_WEBHOOK_URL;
    process.env.MEWBEAT_REPORT_WEBHOOK_URL = FAKE_WEBHOOK;
    mock.method(WebhookClient.prototype, "send", async (message) => posted.push(message));
  });

  afterEach(() => {
    mock.restoreAll();
    if (webhookBefore === undefined) delete process.env.MEWBEAT_REPORT_WEBHOOK_URL;
    else process.env.MEWBEAT_REPORT_WEBHOOK_URL = webhookBefore;
  });

  it("works on servers and in DMs with the bot, and asks for a bug or an idea", () => {
    const json = report.data.toJSON();
    assert.deepStrictEqual(json.contexts, [0, 1]);
    assert.deepStrictEqual(json.options[0].choices.map((choice) => choice.value), ["bug", "idea"]);
    assert.strictEqual(json.options[0].required, true);
  });

  it("opens a modal with one paragraph input, 10 to 1000 characters, keyed by the type", async () => {
    let modal;
    await report.execute({ options: { getString: () => "idea" }, showModal: async (value) => { modal = value.toJSON(); } });
    assert.strictEqual(modal.custom_id, "report:idea");
    const inputs = modal.components.flatMap((row) => row.components);
    assert.strictEqual(inputs.length, 1);
    assert.strictEqual(inputs[0].style, 2);
    assert.strictEqual(inputs[0].min_length, 10);
    assert.strictEqual(inputs[0].max_length, 1000);
  });

  it("posts the report from a server and answers privately", async () => {
    const { interaction, replies, deferred } = modalInteraction({ customId: "report:idea", userId: "u-server" });
    await report.handleModal(interaction);

    assert.strictEqual(posted.length, 1);
    const embed = posted[0].embeds[0].toJSON();
    assert.match(embed.title, /Idea/);
    assert.strictEqual(embed.description, TEXT);
    const fields = Object.fromEntries(embed.fields.map((field) => [field.name, field.value]));
    assert.match(fields.Reporter, /Ann \(u-server\)/);
    assert.match(fields.Source, /command/i);
    assert.strictEqual(fields.Place, "Test Server (g1)");
    assert.strictEqual(replies.length, 1);
    assert.strictEqual(deferred[0].flags, MessageFlags.Ephemeral);
    assert.match(replies[0].content, /sent/i);
  });

  it("still posts the report and does not throw when Discord refuses the answer", async () => {
    const { interaction } = modalInteraction({ userId: "u-late" });
    interaction.deferReply = async () => { throw new Error("Unknown interaction"); };
    interaction.editReply = async () => { throw new Error("Unknown interaction"); };
    await report.handleModal(interaction);
    assert.strictEqual(posted.length, 1);
  });

  it("calls a DM a private conversation", async () => {
    const { interaction } = modalInteraction({ userId: "u-dm", guild: null });
    await report.handleModal(interaction);
    assert.strictEqual(Object.fromEntries(posted[0].embeds[0].toJSON().fields.map((field) => [field.name, field.value])).Place, "private conversation");
  });

  it("tells the player nothing was sent and gives their text back when it cannot be posted", async () => {
    delete process.env.MEWBEAT_REPORT_WEBHOOK_URL;
    const { interaction, replies, deferred } = modalInteraction({ userId: "u-fail" });
    await report.handleModal(interaction);

    assert.strictEqual(posted.length, 0);
    assert.strictEqual(deferred[0].flags, MessageFlags.Ephemeral);
    assert.match(replies[0].content, /not set up/i);
    assert.match(replies[0].content, /not sent/i);
    assert.ok(replies[0].content.includes(TEXT));
  });

  it("refuses text that is too short and still hands it back", async () => {
    const { interaction, replies } = modalInteraction({ userId: "u-short", text: "tiny" });
    await report.handleModal(interaction);
    assert.strictEqual(posted.length, 0);
    assert.match(replies[0].content, /at least 10/i);
    assert.ok(replies[0].content.includes("tiny"));
  });
});
