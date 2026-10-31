const assert = require("node:assert/strict");
const test = require("node:test");

const {
  playbackState,
  ensurePlaybackState,
  pushTrackHistory,
  endActivePlayback,
  markAwaitingAudio,
  confirmAudioStarted,
  isAwaitingAudio,
} = require("../../../helpers/lavalink/state");

function track(identifier) {
  return {
    track: `encoded-${identifier}`,
    info: { identifier, title: `Track ${identifier}`, author: "MewBit", length: 180_000 },
  };
}

test("ending active playback keeps room history after the live player is gone", () => {
  const guildId = "playback-history-retention";
  playbackState.delete(guildId);

  const state = ensurePlaybackState(guildId);
  state.currentTrack = track("current");
  state.lastEndedTrack = track("ended");
  state.lastPosition = 51_000;
  state.paused = false;
  pushTrackHistory(guildId, track("first"));
  pushTrackHistory(guildId, track("second"));

  const ended = endActivePlayback(guildId);

  assert.equal(ended.currentTrack, null);
  assert.equal(ended.lastEndedTrack, null);
  assert.equal(ended.lastPosition, 0);
  assert.equal(ended.paused, true);
  assert.deepEqual(ended.history.map((entry) => entry.info.identifier), ["first", "second"]);

  playbackState.delete(guildId);
});

test("a started track waits for the position to move before its clock runs", () => {
  const state = {};
  markAwaitingAudio(state, 0);
  assert.equal(isAwaitingAudio(state), true);

  // Lavalink keeps reporting 0 while the stream loads and the voice link opens.
  assert.equal(confirmAudioStarted(state, 0), false);
  assert.equal(isAwaitingAudio(state), true);

  assert.equal(confirmAudioStarted(state, 820), true);
  assert.equal(isAwaitingAudio(state), false);
  assert.equal(confirmAudioStarted(state, 1_820), false);

  // A position Lavalink never reports must not freeze the clock for good.
  markAwaitingAudio(state, 0);
  assert.equal(isAwaitingAudio(state, Date.now() + 16_000), false);
});
