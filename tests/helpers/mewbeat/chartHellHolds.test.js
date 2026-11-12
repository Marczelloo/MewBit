const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { keptHolds } = require("../../../helpers/mewbeat/charts/holds");
const { makeLayeredFeatures } = require("./fixtures");

// Hard has holds of its own; hellHolds is what Hell does with them (from v45 part of Hell). OFF is Hell as it was before it: the
// release and the yield off, and Hell keeping the holds of the Normal under it from 2 beats up, as Hard does.
FLAGS.withouthellholds = { label: "withouthellholds", levels: { hell: { holdRelease: undefined, holdYield: undefined, keepNormalHolds: { minBeats: 2 } } } };
const ON = undefined;
const OFF = { withouthellholds: true };
const SONGS = {
  "120 BPM": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000 }),
  "180 BPM": () => makeLayeredFeatures({ bpm: 180, durationMs: 64000 }),
  "120 BPM with sustains": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000, holdsEveryBeats: 16, sustainAtBeats: [8, 40, 72] }),
  "120 BPM holds every 2 beats": () => makeLayeredFeatures({ bpm: 120, durationMs: 64000, holdsEveryBeats: 2 }),
  "140 BPM holds every 4 beats": () => makeLayeredFeatures({ bpm: 140, durationMs: 64000, holdsEveryBeats: 4 }),
};
const HOLDING = ["120 BPM holds every 2 beats", "140 BPM holds every 4 beats"];
const chartsOf = (song, flags) => Object.fromEntries(Object.entries(generateAll(SONGS[song](), "k", flags)).map(([level, c]) => [level, c.notes]));
const momentsOf = (notes) => new Set(notes.map((n) => n.t));
const holdsOf = (notes) => notes.filter((n) => n.len > 0);
// how many holds of Hard Hell plays as a hold at the same time
const keptOf = ({ hard, hell }) => {
  const at = new Set(holdsOf(hell).map((h) => h.t));
  return holdsOf(hard).filter((h) => at.has(h.t)).length;
};

describe("Hell plays the holds Hard plays (hellHolds)", () => {
  it("is Hell's alone (from v45) and changes Hell alone", () => {
    assert.equal(DIFFICULTIES.hell.holdYield, true);
    assert.equal(DIFFICULTIES.hell.holdRelease, "free");
    assert.deepEqual(DIFFICULTIES.hell.keepNormalHolds, { minBeats: 0, shortest: true, fullRoom: true });
    for (const [name, level] of Object.entries({ ...DIFFICULTIES, ...INTERNAL_LEVELS })) if (name !== "hell") assert.equal(level.holdYield, undefined, name);
    for (const song of Object.keys(SONGS)) {
      const off = chartsOf(song, OFF), on = chartsOf(song, ON);
      for (const level of ["easy", "normal", "hard"]) assert.deepEqual(on[level], off[level], `${song} ${level}`);
    }
  });

  it("keeps the holds Hard plays where Hell without the rules lets go of them", () => {
    for (const song of HOLDING) {
      const off = chartsOf(song, OFF), on = chartsOf(song, ON);
      const total = holdsOf(off.hard).length;
      assert.ok(total >= 30, `${song}: Hard holds ${total}`);
      assert.ok(keptOf(off) < total - 2, `${song}: without the rules Hell keeps ${keptOf(off)} of ${total}`);
      assert.ok(keptOf(on) >= 0.9 * total, `${song}: with the rules Hell keeps ${keptOf(on)} of ${total}`);
      assert.ok(keptOf(on) > keptOf(off), song);
    }
  });

  it("keeps every moment of Hard in Hell", () => {
    for (const song of Object.keys(SONGS)) {
      const { hard, hell } = chartsOf(song, ON);
      const inHell = momentsOf(hell);
      assert.deepEqual([...momentsOf(hard)].filter((t) => !inHell.has(t)), [], `${song}: Hard moments missing from Hell`);
    }
  });

  it("no two notes on a lane at one time, no note inside a hold on its lane, no overlapping holds, never four keys", () => {
    for (const song of Object.keys(SONGS)) {
      const notes = chartsOf(song, ON).hell;
      const byTime = new Map();
      for (const n of notes) byTime.set(n.t, [...(byTime.get(n.t) ?? []), n.lane]);
      for (const [t, lanes] of byTime) {
        assert.equal(new Set(lanes).size, lanes.length, `${song}: a lane twice at ${t}`);
        assert.ok(lanes.length < 4, `${song}: four keys at ${t}`);
      }
      for (let lane = 0; lane < 4; lane++) {
        const own = notes.filter((n) => n.lane === lane).sort((a, b) => a.t - b.t);
        own.forEach((n, i) => {
          const next = own[i + 1];
          if (n.len > 0 && next) assert.ok(next.t >= n.t + n.len, `${song}: a note at ${next.t} inside the hold at ${n.t} on lane ${lane}`);
        });
      }
    }
  });

  it("is not much thinner in moments than Hell without it", () => {
    for (const song of Object.keys(SONGS)) {
      const off = momentsOf(chartsOf(song, OFF).hell).size, on = momentsOf(chartsOf(song, ON).hell).size;
      assert.ok(on >= 0.85 * off, `${song}: ${on} moments against ${off}`);
    }
  });
});

describe("keptHolds down to the level's shortest hold (keepNormalHolds.shortest)", () => {
  const timing = { beatMsAt: () => 500, gridPoints: () => [] };
  const base = { holdMinBeats: 1, restHoldBeats: 0.5, minNoteGapMs: 60, minLaneGapMs: 100 };
  // a hold of 300 ms, 0.6 of a beat, with a moment of its own 2 s later
  const source = [{ t: 1000, lane: 0, len: 300 }, { t: 3000, lane: 1 }];
  const notes = [{ t: 1000, lane: 2 }, { t: 3000, lane: 1 }];

  it("holds a hold shorter than the level's hold minimum, which the minimum alone does not", () => {
    assert.deepEqual(keptHolds(notes, source, { ...base, keepNormalHolds: { minBeats: 0 } }, timing), notes);
    assert.deepEqual(keptHolds(notes, source, { ...base, keepNormalHolds: { minBeats: 0, shortest: true } }, timing)[0], { t: 1000, lane: 2, len: 300 });
  });

  it("still lets a hold go before the next moment of the source and keeps no hold under the shortest", () => {
    const under = [...source, { t: 1250, lane: 3 }];
    const tiny = [{ t: 1000, lane: 0, len: 150 }, { t: 3000, lane: 1 }];
    assert.deepEqual(keptHolds(notes, tiny, { ...base, keepNormalHolds: { minBeats: 0, shortest: true } }, timing), notes);
    assert.equal(keptHolds([{ t: 1000, lane: 2 }, { t: 1250, lane: 3 }, { t: 3000, lane: 1 }], under, { ...base, keepNormalHolds: { minBeats: 0, shortest: true } }, timing)[0].len, undefined);
  });
});
