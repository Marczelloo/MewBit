const assert = require("node:assert");
const { describe, it } = require("node:test");

const { lavalinkToggleMute } = require("../../../helpers/lavalink");
const {
  DEFAULT_SOURCE_GAIN_DB,
  applyNormalizedVolume,
  getNormalizedVolume,
  getSourceVolumeMultiplier,
} = require("../../../helpers/lavalink/loudness");
const { getRestoreVolume, setPlayerVolume } = require("../../../helpers/lavalink/volume");

describe("Provider loudness normalization", () => {
  it("exposes the Activity mute action through the Lavalink public API", () => {
    assert.strictEqual(typeof lavalinkToggleMute, "function");
  });

  it("keeps Deezer as the neutral reference and attenuates noisier providers", () => {
    assert.strictEqual(DEFAULT_SOURCE_GAIN_DB.deezer, 0);
    assert.strictEqual(getNormalizedVolume(100, "deezer"), 100);
    assert.ok(getSourceVolumeMultiplier("soundcloud") < 1);
    assert.ok(getNormalizedVolume(100, "soundcloud") < 100);
  });

  it("preserves the user volume while applying the provider compensation", async () => {
    const applied = [];
    const player = {
      userVolume: 80,
      volume: 80,
      setVolume: async (volume) => applied.push(volume),
    };

    const normalized = await applyNormalizedVolume(player, { info: { sourceName: "youtube" } });

    assert.strictEqual(player.userVolume, 80);
    assert.strictEqual(player.volume, normalized);
    assert.strictEqual(applied.at(-1), normalized);
    assert.ok(normalized < 80);
  });

  it("remembers the last audible volume when muted so it can be restored", async () => {
    const applied = [];
    const player = {
      userVolume: 72,
      volume: 72,
      setVolume: async (volume) => applied.push(volume),
    };

    await setPlayerVolume(player, 0);
    assert.strictEqual(player.isMuted, true);
    assert.strictEqual(player.lastAudibleVolume, 72);
    assert.strictEqual(player.userVolume, 0);
    assert.strictEqual(applied.at(-1), 0);
    assert.strictEqual(getRestoreVolume(player), 72);

    await setPlayerVolume(player, getRestoreVolume(player));
    assert.strictEqual(player.isMuted, false);
    assert.strictEqual(player.userVolume, 72);
  });
});

describe("Per-track loudness", () => {
  const {
    getPlaybackGainDb,
    getTrackGainAdjustmentDb,
    refineTrackLoudness,
    resolveTrackLoudness,
  } = require("../../../helpers/lavalink/loudness");
  const measured = (gain, sourceName = "youtube") => ({
    info: { title: "Song", author: "Artist", identifier: `id${gain}`, sourceName },
    userData: { features: { loudness: gain } },
  });

  it("leaves typical masters alone, lifts quiet ones and only trims the loudest", () => {
    assert.strictEqual(getTrackGainAdjustmentDb(-6.5), 0);
    assert.strictEqual(getTrackGainAdjustmentDb(-5.9), -0.6);
    assert.strictEqual(getTrackGainAdjustmentDb(1), -2);
    assert.strictEqual(getTrackGainAdjustmentDb(-10.4), 3.9);
    assert.strictEqual(getTrackGainAdjustmentDb(-26), 5);
    assert.strictEqual(getTrackGainAdjustmentDb(null), null);
  });

  it("does not turn a typical playlist down", () => {
    // Real Deezer gains: Metallica, Dua Lipa, Nirvana, Taco Hemingway.
    const gains = [-5.9, -6.3, -7.4, -9.7];
    const average = gains.reduce((sum, gain) => sum + getTrackGainAdjustmentDb(gain), 0) / gains.length;
    assert.ok(average >= 0, `average adjustment ${average} dB`);
  });

  it("prefers the measured master over the provider estimate", () => {
    assert.strictEqual(getPlaybackGainDb(measured(-5)), -1.5);
    assert.strictEqual(getPlaybackGainDb({ info: { sourceName: "youtube" } }), DEFAULT_SOURCE_GAIN_DB.youtube);
    assert.ok(getNormalizedVolume(100, measured(-5)) < getNormalizedVolume(100, measured(-12)));
  });

  it("looks a track up once and keeps the measured gain on it", async () => {
    let calls = 0;
    const lookup = async () => { calls += 1; return { features: { loudness: -6.5 } }; };
    const track = { info: { title: "Song (Official Video)", author: "Artist", identifier: "yt1", sourceName: "youtube" } };

    assert.strictEqual(await resolveTrackLoudness(track, { lookup }), -6.5);
    assert.strictEqual(await resolveTrackLoudness(track, { lookup }), -6.5);
    assert.strictEqual(calls, 1);

    const unmatched = { info: { title: "Bootleg", author: "Nobody", identifier: "yt2", sourceName: "youtube" } };
    const miss = async () => { calls += 1; return null; };
    assert.strictEqual(await resolveTrackLoudness(unmatched, { lookup: miss }), null);
    assert.strictEqual(await resolveTrackLoudness(unmatched, { lookup: miss }), null);
    assert.strictEqual(calls, 2);
  });

  it("applies the measured level only while the same track is still playing", async () => {
    const applied = [];
    const track = { info: { title: "Song", author: "Artist", identifier: "yt3", sourceName: "youtube" } };
    const player = { userVolume: 100, volume: 100, currentTrack: track, setVolume: async (volume) => applied.push(volume) };

    const volume = await refineTrackLoudness(player, track, { lookup: async () => ({ features: { loudness: -5 } }) });
    assert.strictEqual(volume, getNormalizedVolume(100, measured(-5)));
    assert.strictEqual(player.userVolume, 100);

    const next = { info: { title: "Next", author: "Artist", identifier: "yt4", sourceName: "youtube" } };
    player.currentTrack = { info: { identifier: "other" } };
    assert.strictEqual(await refineTrackLoudness(player, next, { lookup: async () => ({ features: { loudness: -5 } }) }), null);
    assert.strictEqual(applied.length, 1);
  });
});
