const test = require("node:test");
const assert = require("node:assert/strict");
const { sectionStarts } = require("../../../helpers/mewbeat/charts/sections");

const BAR_MS = 2000;
const BARS = 24;

function setup(lastBandOnset) {
  const beats = Array.from({ length: BARS * 4 + 1 }, (_, i) => (i * BAR_MS) / 4);
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  const onsets = downbeats.slice(0, -1).map((t, i) => ({ t: t + 10, s: 0.5 + (i >= BARS / 2 ? 0.4 : 0) }));
  const features = { bands: [{ name: "low", onsets: [...onsets, { t: lastBandOnset, s: 1 }] }] };
  const timing = { snapped: true, beats, downbeats };
  const energy = { at: (t) => (t >= (BARS / 2) * BAR_MS ? 0.9 : 0.3) };
  return { features, timing, energy, lastDownbeat: downbeats[downbeats.length - 1] };
}

test("sectionStarts: an onset within 1 ms before the last downbeat counts in the last bar", () => {
  const { features, timing, energy, lastDownbeat } = setup(BARS * BAR_MS - 0.5);
  assert.equal(lastDownbeat, BARS * BAR_MS);
  assert.doesNotThrow(() => sectionStarts(features, timing, energy));
});

test("sectionStarts: an onset within 1 ms before a fractional last downbeat counts in the last bar", () => {
  const { features, timing, energy } = setup(BARS * BAR_MS + 0.2);
  timing.downbeats = [...timing.downbeats.slice(0, -1), BARS * BAR_MS + 0.4];
  assert.doesNotThrow(() => sectionStarts(features, timing, energy));
});

test("sectionStarts: finds the change in the middle of the song", () => {
  const { features, timing, energy } = setup(BARS * BAR_MS - 100);
  const starts = sectionStarts(features, timing, energy);
  assert.ok(starts.some((s) => s.t === (BARS / 2) * BAR_MS));
});
