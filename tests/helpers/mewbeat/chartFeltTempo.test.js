const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { analyse } = require("../../../helpers/mewbeat/charts/generate");
const { scoreMoments } = require("../../../helpers/mewbeat/charts/selection");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { makeLayeredFeatures } = require("./fixtures");

const FELT = FLAGS.feltTempo.levels.normal.feltTempo;

describe("slow songs read at twice the tempo (flag feltTempo)", () => {
  it("a quarter beat of a slow song is scored as a half beat, a half beat as a beat", () => {
    const ctx = analyse(makeLayeredFeatures({ bpm: 90, durationMs: 64000 }));
    const plain = scoreMoments(ctx, "normal");
    const felt = scoreMoments(ctx, "normal", FELT);
    assert.equal(felt.length, plain.length);
    const moved = plain.map((m, i) => [m.metric, felt[i].metric]).filter(([a, b]) => a !== b);
    assert.ok(moved.length > 0);
    for (const [a, b] of moved) assert.ok((a === 1 && b === 0) || (a === 2 && b === 1) || (a === 3 && b >= 2), `${a} -> ${b}`);
  });

  it("leaves a song at 115 BPM or over as it is", () => {
    const ctx = analyse(makeLayeredFeatures({ bpm: 120, durationMs: 64000 }));
    assert.deepEqual(scoreMoments(ctx, "normal", FELT), scoreMoments(ctx, "normal"));
  });

  it("touches Normal alone", () => {
    const features = makeLayeredFeatures({ bpm: 90, durationMs: 64000 });
    const plain = generateAll(features, "youtube:felt:64000");
    const on = generateAll(features, "youtube:felt:64000", ["feltTempo"]);
    for (const level of ["easy", "hard", "hell"]) assert.deepEqual(on[level].notes, plain[level].notes, level);
  });
});
