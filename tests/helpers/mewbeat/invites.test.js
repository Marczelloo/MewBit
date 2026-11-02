const assert = require("node:assert");
const { describe, it } = require("node:test");

const { ButtonStyle } = require("discord.js");

const {
  FALLBACK_HINT, JOIN_CUSTOM_ID, createInvitePoster, handleJoinButton, inviteMessage,
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
    assert.match(sent[0].embeds[0].toJSON().author.name, /Ann invited you to play/);
    const button = sent[0].components[0].toJSON().components[0];
    assert.strictEqual(button.custom_id, JOIN_CUSTOM_ID);
    assert.strictEqual(button.label, "Join the room");
    assert.strictEqual(button.emoji.name, "🎵");
    assert.strictEqual(button.style, ButtonStyle.Primary);
  });

  describe("the invite embed", () => {
    const room = {
      title: "Song", artist: "Artist", artworkUrl: "https://i/1.png", players: 3, maxPlayers: 10, queued: 1, inRound: false,
    };
    const fields = (embed) => Object.fromEntries(embed.fields.map((field) => [field.name, field.value]));

    it("shows the song, the seats, the queue and the status", () => {
      const embed = inviteMessage({ username: "Ann", avatarUrl: "https://a/ann.png", room }).embeds[0].toJSON();
      assert.strictEqual(embed.color, 0xa78bfa);
      assert.deepStrictEqual(
        { name: embed.author.name, icon_url: embed.author.icon_url },
        { name: "Ann invited you to play", icon_url: "https://a/ann.png" },
      );
      assert.strictEqual(embed.title, "mewbeat");
      assert.strictEqual(embed.description, "**Song**\nArtist");
      assert.strictEqual(embed.thumbnail.url, "https://i/1.png");
      assert.deepStrictEqual(fields(embed), { Players: "3/10", Queue: "1 song", Status: "In the lobby" });
      assert.ok(embed.fields.every((field) => field.inline));
      assert.strictEqual(embed.footer.text, "4-key rhythm game · play together in this voice channel");

      const busy = inviteMessage({ username: "Ann", room: { ...room, queued: 2, inRound: true, artist: "" } }).embeds[0].toJSON();
      assert.deepStrictEqual(fields(busy), { Players: "3/10", Queue: "2 songs", Status: "Round in progress" });
      assert.strictEqual(busy.description, "**Song**");
    });

    it("asks to pick a song when there is none, and takes no thumbnail that is not https", () => {
      const embed = inviteMessage({ username: "Ann", room: { ...room, title: null, queued: 0 } }).embeds[0].toJSON();
      assert.strictEqual(embed.description, "Pick a song together and play it in sync.");
      assert.strictEqual(embed.thumbnail, undefined);
      assert.strictEqual(embed.author.icon_url, undefined);
      assert.strictEqual(fields(embed).Queue, "0 songs");
      const plainHttp = inviteMessage({ username: "Ann", room: { ...room, artworkUrl: "http://i/1.png" } }).embeds[0].toJSON();
      assert.strictEqual(plainHttp.thumbnail, undefined);
    });

    it("keeps markdown in a title, an artist or a name from breaking the layout, and clamps the length", () => {
      const embed = inviteMessage({
        username: "**Ann**_",
        room: { ...room, title: "*Loud* [song]\n# x | y", artist: "~~A~~ `B`" },
      }).embeds[0].toJSON();
      assert.strictEqual(embed.author.name, "Ann invited you to play");
      assert.strictEqual(embed.description, "**Loud song x y**\nA B");

      const long = inviteMessage({ username: "Ann", room: { ...room, title: "t".repeat(500), artist: "a".repeat(500) } }).embeds[0].toJSON();
      assert.ok(long.description.length <= 400);
    });

    it("still works with no room at all", () => {
      const message = inviteMessage({ username: "Ann", room: null });
      const embed = message.embeds[0].toJSON();
      assert.strictEqual(embed.description, "Pick a song together and play it in sync.");
      assert.strictEqual(embed.fields, undefined);
    });
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
