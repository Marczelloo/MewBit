const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let parseRoomInvite;
let sendRoomInvite;

test.before(async () => {
  ({ parseRoomInvite, sendRoomInvite } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/roomInvite.js")).href
  ));
});

const fakeStore = (invite, link = { status: "ok", code: "abc" }) => ({ invite: async () => invite, inviteLink: async () => link });
const fakeSdk = (shareLink) => ({ commands: { shareLink } });
const NO_VOICE = { status: "error", reason: "no_voice_channel" };

test("parseRoomInvite reads only room links", () => {
  assert.equal(parseRoomInvite("room:abc"), "abc");
  assert.equal(parseRoomInvite("room:"), null);
  assert.equal(parseRoomInvite("other"), null);
  assert.equal(parseRoomInvite(undefined), null);
});

test("a player on voice gets the bot's post and no share window", async () => {
  const note = await sendRoomInvite({ store: fakeStore({ status: "ok" }), sdk: fakeSdk(() => assert.fail()) });
  assert.deepEqual(note, { ok: true, text: "Invite sent to the voice channel." });
});

test("a cooldown is reported, not turned into a share window", async () => {
  const note = await sendRoomInvite({ store: fakeStore({ status: "error", reason: "cooldown", retryInMs: 3000 }), sdk: fakeSdk(() => assert.fail()) });
  assert.equal(note.ok, false);
  assert.match(note.text, /3s/);
});

test("off voice it shares a link carrying the room's code", async () => {
  const calls = [];
  const note = await sendRoomInvite({
    store: fakeStore(NO_VOICE),
    sdk: fakeSdk(async (options) => { calls.push(options); return { success: true }; }),
  });
  assert.equal(calls[0].custom_id, "room:abc");
  assert.equal(typeof calls[0].message, "string");
  assert.deepEqual(note, { ok: true, text: "Invite shared." });
});

test("closing the share window says nothing", async () => {
  assert.equal(await sendRoomInvite({ store: fakeStore(NO_VOICE), sdk: fakeSdk(async () => ({ success: false })) }), null);
});

test("a share window that fails to open is reported", async () => {
  const note = await sendRoomInvite({ store: fakeStore(NO_VOICE), sdk: fakeSdk(async () => { throw new Error("nope"); }) });
  assert.equal(note.ok, false);
});

test("without Discord's share window the voice message stands", async () => {
  const note = await sendRoomInvite({ store: fakeStore(NO_VOICE), sdk: null });
  assert.deepEqual(note, { ok: false, text: "Join a voice channel first." });
});

test("a link the bot refused is reported", async () => {
  const note = await sendRoomInvite({ store: fakeStore(NO_VOICE, { status: "error", reason: "not_in_room" }), sdk: fakeSdk(() => assert.fail()) });
  assert.deepEqual(note, { ok: false, text: "You're not in the room." });
});
