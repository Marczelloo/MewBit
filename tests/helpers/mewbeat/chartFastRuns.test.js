const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, FAST_RUNS, INTERNAL_LEVELS, MELODY_RUNS } = require("../../../helpers/mewbeat/charts/difficulty");
const { enforceFloors, spacedMoments } = require("../../../helpers/mewbeat/charts/difficultyFilter");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { flagWithout, makeLayeredFeatures } = require("./fixtures");

const PLAIN = flagWithout("withoutfastruns", "fastRuns"); // Normal as it was before fastRuns
const notesOf = (features, flags) => generateAll(features, "k", flags).normal.notes;
const timesOf = (notes) => [...new Set(notes.map((n) => n.t))];
const gapsOf = (notes) => timesOf(notes).map((t, i, all) => t - all[i - 1]).slice(1);
const withLine = (features, line) => ({ ...features, decodedMelody: line, decodedMelodyTuned: line });

const noOtherLevelHas = (param) => {
  for (const [name, level] of Object.entries({ ...DIFFICULTIES, ...INTERNAL_LEVELS })) if (name !== "normal") assert.equal(level[param], undefined, `${name}.${param}`);
};

describe("the bursts of a fast melody where a quarter beat is under 100 ms (fastRuns)", () => {
  // A melody on every sixteenth of the song, which is fast at any tempo: every moment on it may start a burst.
  const fastLine = (bpm) => {
    const sixteenth = 60000 / bpm / 4;
    return Array.from({ length: Math.floor(120000 / sixteenth) }, (_, i) => ({ t: Math.round(i * sixteenth), pitch: 60 + ((i * 7) % 9) }));
  };
  const song = (bpm) => withLine(makeLayeredFeatures({ bpm, durationMs: 128000 }), fastLine(bpm));
  const chains = (notes) => {
    const times = timesOf(notes);
    const out = [];
    for (let i = 0, start = 0; i < times.length; i++) {
      if (i > 0 && times[i] - times[i - 1] >= MELODY_RUNS.minGapMs) start = i;
      (out[start] ??= []).push(times[i]);
    }
    return out.filter(Boolean);
  };

  it("is a rule of Normal (from v45), and no other level has it", () => {
    assert.deepEqual(DIFFICULTIES.normal.fastRuns, FAST_RUNS);
    noOtherLevelHas("fastRuns");
  });

  it("puts bursts at 180 BPM (a quarter beat is 83 ms) that the plain generator cannot", () => {
    const features = song(180);
    const plain = notesOf(features, PLAIN), fast = notesOf(features);
    assert.ok(gapsOf(plain).every((g) => g >= MELODY_RUNS.minGapMs));
    const short = gapsOf(fast).filter((g) => g < MELODY_RUNS.minGapMs);
    assert.ok(short.length > 20, `${short.length} short gaps`);
    assert.ok(Math.min(...gapsOf(fast)) >= FAST_RUNS.minGapMs);
    // a burst is at most maxRun short gaps (maxRun + 1 moments); its notes sit on different lanes, a lane coming back only
    // after the lane gap (a burst of four notes spans 250 ms)
    const laneGap = DIFFICULTIES.normal.minLaneGapMs;
    for (const chain of chains(fast)) {
      assert.ok(chain.length <= MELODY_RUNS.maxRun + 1, `${chain.length} moments in a row`);
      const inChain = fast.filter((n) => chain.includes(n.t));
      for (const a of inChain) {
        for (const b of inChain) if (a !== b && a.lane === b.lane) assert.ok(Math.abs(a.t - b.t) >= laneGap, `lane ${a.lane} at ${a.t} and ${b.t}`);
      }
      for (let i = 1; i < chain.length; i++) {
        const before = new Set(fast.filter((n) => n.t === chain[i - 1]).map((n) => n.lane));
        assert.ok(fast.filter((n) => n.t === chain[i]).every((n) => !before.has(n.lane)), `a lane repeated at ${chain[i]}`);
      }
    }
    assert.ok(chains(fast).some((chain) => chain.length >= 3), "no burst of three moments");
    // everything the plain chart plays is still there but for what the bursts displace
    const kept = new Set(timesOf(fast));
    assert.ok(timesOf(plain).filter((t) => kept.has(t)).length > 0.9 * timesOf(plain).length);
  });

  it("changes nothing where a quarter beat is over 100 ms (120 BPM)", () => {
    const features = song(120);
    assert.deepEqual(notesOf(features), notesOf(features, PLAIN));
    assert.ok(timesOf(notesOf(features)).length > 100);
  });

  it("changes nothing without a decoded melody", () => {
    for (const bpm of [180, 120]) {
      const features = makeLayeredFeatures({ bpm, durationMs: 128000 });
      assert.deepEqual(notesOf(features), notesOf(features, PLAIN), `at ${bpm}`);
    }
  });

  it("lets only a note of a burst stand closer than the level's gap to its neighbour", () => {
    const diff = { minNoteGapMs: 100, minLaneGapMs: 150 };
    // 0, 80, 160 with the middle one a burst's note; 1000 and 1080 with none: the later of those two goes as before
    const notes = [0, 80, 160, 1000, 1080].map((t, i) => ({ t, lane: i % 4 }));
    const close = { times: new Set([80]), gapMs: 70 };
    for (const floors of [(n, c) => spacedMoments(n, diff, c), (n, c) => enforceFloors(n, diff, null, c)]) {
      assert.deepEqual(floors(notes, close).map((n) => n.t), [0, 80, 160, 1000]);
      assert.deepEqual(floors(notes, null).map((n) => n.t), [0, 160, 1000]);
      assert.deepEqual(floors(notes, undefined).map((n) => n.t), [0, 160, 1000]);
      // a gap under the burst's own floor goes too
      assert.deepEqual(floors([{ t: 0, lane: 0 }, { t: 60, lane: 1 }], { times: new Set([60]), gapMs: 70 }).map((n) => n.t), [0]);
    }
  });

  it("is a no-op for the floors without melodyRuns", () => {
    const saved = DIFFICULTIES.normal.melodyRuns;
    DIFFICULTIES.normal.melodyRuns = undefined;
    try {
      const features = song(180);
      assert.deepEqual(notesOf(features), notesOf(features, PLAIN));
    } finally { DIFFICULTIES.normal.melodyRuns = saved; }
  });
});
