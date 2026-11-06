const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { analyse } = require("../../../helpers/mewbeat/charts/generate");
const { scoreMoments } = require("../../../helpers/mewbeat/charts/selection");
const { DIFFICULTIES, FELT_TEMPO } = require("../../../helpers/mewbeat/charts/difficulty");
const { makeLayeredFeatures } = require("./fixtures");

const FELT = FELT_TEMPO;

describe("slow songs read at twice the tempo (Normal's feltTempo)", () => {
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

  it("is Normal's alone", () => {
    assert.deepEqual(DIFFICULTIES.normal.feltTempo, FELT_TEMPO);
    for (const level of ["easy", "hard", "hell"]) assert.equal(DIFFICULTIES[level].feltTempo, undefined, level);
  });
});
