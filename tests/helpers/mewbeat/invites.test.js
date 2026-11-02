const assert = require("node:assert");
const { describe, it } = require("node:test");

const {
  FALLBACK_HINT, JOIN_CUSTOM_ID, createInvitePoster, handleJoinButton,
} = require("../../../helpers/mewbeat/invites");

function fakeGuild({ voiceChannel, fetched } = {}) {
  return {
    voiceStates: { cache: new Map(voiceChannel ? [["u1", { channel: voiceChannel }]] : []) },
    members: { fetch: async () => (fetched ? { voice: { channel: fetched } } : { voice: { channel: null } }) },
  };
}

const clientOf = (guild) => ({ guilds: { cache: new Map(guild ? [["g1", guild]] : []) } });

describe("mewbeat invites", () => {
  it("posts an embed with a Join button in the voice channel chat", async () => {
    const sent = [];
    const channel = { send: async (message) => sent.push(message) };
    const post = createInvitePoster({ getClient: () => clientOf(fakeGuild({ voiceChannel: channel })) });
    assert.deepStrictEqual(await post({ guildId: "g1", userId: "u1", username: "Ann" }), { ok: true });
    assert.strictEqual(sent.length, 1);
    assert.match(sent[0].embeds[0].toJSON().description, /Ann.*is playing mewbeat/);
    const button = sent[0].components[0].toJSON().components[0];
    assert.strictEqual(button.custom_id, JOIN_CUSTOM_ID);
    assert.strictEqual(button.label, "Join");
  });

  it("falls back to fetching the member when the voice state is not cached", async () => {
    const sent = [];
    const channel = { send: async (message) => sent.push(message) };
    const post = createInvitePoster({ getClient: () => clientOf(fakeGuild({ fetched: channel })) });
    assert.deepStrictEqual(await post({ guildId: "g1", userId: "u1", username: "Ann" }), { ok: true });
    assert.strictEqual(sent.length, 1);
  });

  it("reports no voice channel, a failed send and an unknown guild", async () => {
    const noVoice = createInvitePoster({ getClient: () => clientOf(fakeGuild()) });
    assert.deepStrictEqual(await noVoice({ guildId: "g1", userId: "u1", username: "Ann" }), { ok: false, reason: "no_voice_channel" });

    const broken = { send: async () => { throw new Error("Missing Permissions"); } };
    const failing = createInvitePoster({ getClient: () => clientOf(fakeGuild({ voiceChannel: broken })) });
    assert.deepStrictEqual(await failing({ guildId: "g1", userId: "u1", username: "Ann" }), { ok: false, reason: "send_failed" });

    const noGuild = createInvitePoster({ getClient: () => clientOf(null) });
    assert.deepStrictEqual(await noGuild({ guildId: "g1", userId: "u1", username: "Ann" }), { ok: false, reason: "send_failed" });
  });

  it("launches the Activity from the Join button", async () => {
    let launched = 0;
    const replies = [];
    await handleJoinButton({ launchActivity: async () => { launched += 1; }, reply: async (r) => replies.push(r) });
    assert.strictEqual(launched, 1);
    assert.deepStrictEqual(replies, []);
  });

  it("answers with an ephemeral hint when the Activity can't be launched, without the code", async () => {
    const replies = [];
    await handleJoinButton({
      launchActivity: async () => { throw new Error("no activity"); },
      replied: false,
      deferred: false,
      reply: async (r) => replies.push(r),
    });
    assert.strictEqual(replies.length, 1);
    assert.strictEqual(replies[0].content, FALLBACK_HINT);
    assert.ok(replies[0].flags);
    assert.doesNotMatch(FALLBACK_HINT, /konami|↑|up up|arrow/i);
  });
});
