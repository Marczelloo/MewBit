const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { assignLanes } = require("../../../helpers/mewbeat/charts/lanes");
const { melodyDirection, normalViolations } = require("../../../helpers/mewbeat/charts/laneRules");
const { buildTiming } = require("../../../helpers/mewbeat/charts/timing");
const { makeFeatures } = require("./fixtures");

const BEAT_MS = 500;
const timing = { beatMsAt: () => BEAT_MS }; // a constant 120 BPM: all normalViolations needs of the timing is the beat length at a time
const rules = (notes, more = {}) => normalViolations(notes, timing, more);
const ruleNames = (notes, more) => rules(notes, more).map((v) => v.rule);
const tap = (t, lane) => ({ t, lane });
const hold = (t, lane, len) => ({ t, lane, len });

describe("normalViolations", () => {
  it("a clean chart has no violations", () => {
    const notes = [
      tap(1000, 0), tap(1500, 2), tap(2000, 1), { ...tap(2500, 3) }, tap(2500, 0),
      hold(3000, 1, 1000), tap(3500, 3), tap(4000, 2), tap(4500, 0),
      tap(5000, 0), // a minijack at a half beat or slower is style
      tap(5250, 3), tap(5375, 1),
    ];
    assert.deepEqual(rules(notes, { durationMs: 60000 }), []);
  });

  it("flags an anchor of 3 notes", () => {
    const notes = [tap(0, 0), tap(250, 1), tap(500, 0), tap(750, 2), tap(1000, 0)];
    assert.deepEqual(rules(notes), [{ rule: "anchor", t: 1000, lane: 0 }]);
  });

  it("lets two notes anchor, and a trill is no anchor", () => {
    assert.deepEqual(rules([tap(0, 0), tap(250, 1), tap(500, 0), tap(750, 2), tap(1500, 0)]), []);
    assert.deepEqual(rules([tap(0, 0), tap(250, 1), tap(500, 0), tap(750, 1), tap(1000, 0), tap(1250, 1)]), []);
  });

  it("flags a minijack at a quarter beat", () => {
    assert.deepEqual(rules([tap(0, 1), tap(125, 1)]), [{ rule: "minijack", t: 125, lane: 1 }]);
    assert.deepEqual(rules([tap(0, 1), tap(250, 1)]), []);
  });

  it("flags more than 5 quarter-beat gaps in a row", () => {
    const run = (count) => Array.from({ length: count }, (_, i) => tap(i * 125, [0, 2, 1, 3][i % 4]));
    assert.deepEqual(rules(run(6)), []);
    assert.deepEqual(rules(run(7)), [{ rule: "quarterRun", t: 750, lane: 1 }]);
  });

  it("flags a chord of 3 notes", () => {
    assert.deepEqual(ruleNames([tap(0, 0), tap(0, 1), tap(0, 3)]), ["chord"]);
    assert.deepEqual(ruleNames([tap(0, 0), tap(0, 3)]), []);
  });

  it("flags a hold shorter than half a beat", () => {
    assert.deepEqual(rules([hold(0, 0, 200)]), [{ rule: "holdShort", t: 0, lane: 0 }]);
    assert.deepEqual(rules([hold(0, 0, 250)]), []);
  });

  it("flags a note under a half-beat hold", () => {
    assert.deepEqual(rules([hold(0, 0, 250), tap(100, 3)]), [{ rule: "underShortHold", t: 100, lane: 3 }]);
    assert.deepEqual(rules([hold(0, 0, 250), tap(500, 3)]), []);
  });

  it("flags a note faster than a half beat under a hold of a beat", () => {
    assert.deepEqual(rules([hold(0, 0, 500), tap(100, 3)]), [{ rule: "underHold", t: 100, lane: 3 }]);
    assert.deepEqual(rules([hold(0, 0, 500), tap(250, 3)]), []);
    assert.deepEqual(rules([hold(0, 0, 1000), tap(500, 3), tap(750, 2)]), [], "a longer hold has no rule of its own");
  });

  it("flags a note on the lane of a running hold", () => {
    assert.deepEqual(rules([hold(0, 0, 1000), tap(500, 0)]), [{ rule: "holdLane", t: 500, lane: 0 }]);
    assert.deepEqual(rules([hold(0, 0, 1000), tap(500, 1)]), []);
  });

  it("flags a hold that runs past the end of the song", () => {
    assert.deepEqual(rules([hold(9500, 2, 1000)], { durationMs: 10000 }), [{ rule: "holdBounds", t: 9500, lane: 2 }]);
    assert.deepEqual(rules([hold(8000, 2, 1000)], { durationMs: 10000 }), []);
  });

  it("takes the beat length from the timing at that time", () => {
    const slowLater = { beatMsAt: (t) => (t < 1000 ? 500 : 1000) };
    assert.deepEqual(normalViolations([hold(2000, 0, 400)], slowLater), [{ rule: "holdShort", t: 2000, lane: 0 }]);
    assert.deepEqual(normalViolations([hold(0, 0, 400)], slowLater), []);
    assert.deepEqual(normalViolations([hold(2000, 0, 400)], null), [], "without a timing a beat is the fallback 500 ms");
  });
});

// A song of 120 BPM carrying a lead line of the given pitches, one every `stepMs` from 2 s.
const stepMsOf = (stepMs, pitches) => pitches.map((pitch, i) => ({ t: 2000 + i * stepMs, len: 100, pitch, s: 0.8, conf: 0.9 }));
const ctxOf = (lead, more = {}) => {
  const features = { ...makeFeatures({ durationMs: 64000 }), lead, bass: [], bands: [] };
  return { features, timing: buildTiming(features, 64000), phrases: [], sections: [], durationMs: 64000, energy: { at: () => 0.6 }, onsets: [], eventTimes: [], ...more };
};

describe("melodyDirection", () => {
  const ctx = ctxOf([
    { t: 2000, len: 100, pitch: 60, s: 0.8, conf: 0.9 },
    { t: 2500, len: 100, pitch: 64, s: 0.8, conf: 0.9 },
    { t: 3000, len: 100, pitch: 64.2, s: 0.8, conf: 0.9 },
    { t: 3500, len: 100, pitch: 59, s: 0.8, conf: 0.9 },
    { t: 4000, len: 100, pitch: 59.7, s: 0.8, conf: 0.9 },
    { t: 4500, len: 100, pitch: 70, s: 0.8, conf: 0.3 },
    { t: 30000, len: 100, pitch: 71, s: 0.8, conf: 0.9 },
  ]);

  it("follows the lead line: up, repeated, down", () => {
    assert.equal(melodyDirection(ctx, 2500), 1);
    assert.equal(melodyDirection(ctx, 3000), 0);
    assert.equal(melodyDirection(ctx, 3500), -1);
  });

  it("is null where the line is not sure: the first note, a doubtful pitch, after a long rest, no sound at all", () => {
    assert.equal(melodyDirection(ctx, 2000), null);
    assert.equal(melodyDirection(ctx, 4000), null, "a step of 0.7 semitone is neither a repeat nor a move");
    assert.equal(melodyDirection(ctx, 4500), null, "a low-confidence note");
    assert.equal(melodyDirection(ctx, 30000), null, "the note before it is far behind");
    assert.equal(melodyDirection(ctx, 12000), null);
  });

  it("falls back to the bass line, then to where the bands sound", () => {
    const bass = ctxOf([], { features: { ...ctx.features, lead: [], bass: [{ t: 2000, len: 300, pitch: 30, s: 0.8, conf: 0.9 }, { t: 2500, len: 300, pitch: 25, s: 0.8, conf: 0.9 }] } });
    assert.equal(melodyDirection(bass, 2500), -1);
    const band = (name, onsets) => ({ name, onsets });
    const bands = ctxOf([], { features: { ...ctx.features, lead: [], bands: [band("low", [{ t: 2000, s: 1 }]), band("lowmid", []), band("highmid", []), band("high", [{ t: 2500, s: 1 }])] } });
    assert.equal(melodyDirection(bands, 2500), 1);
    assert.equal(melodyDirection(bands, 2000), null, "nothing came before the first sound");
  });

  it("is null without features", () => {
    assert.equal(melodyDirection({ timing, phrases: [] }, 2000), null);
  });
});

describe("assignLanes with a melody", () => {
  const normal = levelOf("normal");
  const v26 = { ...normal, melodyLanes: false };
  const melodic = { ...normal, melodyLanes: true };
  const moments = (stepMs, count, from = 2000) => Array.from({ length: count }, (_, i) => tap(from + i * stepMs, 0));
  const lanesOf = (notes) => notes.map((n) => n.lane);
  const steps = (notes) => notes.slice(1).map((n, i) => n.lane - notes[i].lane);

  it("is on for the public Normal", () => {
    assert.equal(normal.melodyLanes, true);
    assert.ok(!levelOf("easy").melodyLanes && !levelOf("hard").melodyLanes && !levelOf("hell").melodyLanes);
  });

  it("a rising run becomes stairs", () => {
    const pitches = Array.from({ length: 60 }, (_, i) => 60 + (i % 5) * 2); // a scale of five notes, up and up again
    const ctx = ctxOf(stepMsOf(BEAT_MS, pitches));
    const out = assignLanes(moments(BEAT_MS, pitches.length), ctx, melodic);
    const rising = steps(out).filter((_, i) => i % 5 !== 4); // the steps within a scale, not the leap back down
    const stairs = rising.filter((s) => s === 1).length / rising.length;
    const up = rising.filter((s) => s > 0).length / rising.length;
    assert.ok(stairs >= 0.45, `${stairs} of the rising steps are one lane up`);
    assert.ok(up >= 0.7, `${up} of the rising steps go right`);
  });

  it("a falling run goes left", () => {
    const pitches = Array.from({ length: 60 }, (_, i) => 70 - (i % 5) * 2);
    const ctx = ctxOf(stepMsOf(BEAT_MS, pitches));
    const out = assignLanes(moments(BEAT_MS, pitches.length), ctx, melodic);
    const falling = steps(out).filter((_, i) => i % 5 !== 4);
    assert.ok(falling.filter((s) => s < 0).length / falling.length >= 0.7);
  });

  it("a repeated sound becomes a trill or a jack within limits", () => {
    for (const stepMs of [125, 250, 500]) {
      const pitches = new Array(stepMs === 125 ? 6 : 40).fill(64); // six notes are five quarter-beat gaps: the most Normal allows in a row
      const ctx = ctxOf(stepMsOf(stepMs, pitches));
      const out = assignLanes(moments(stepMs, pitches.length), ctx, melodic);
      let longest = 1;
      let run = 1;
      out.slice(1).forEach((n, i) => {
        run = n.lane === out[i].lane ? run + 1 : 1;
        longest = Math.max(longest, run);
      });
      assert.ok(longest <= melodic.maxJack, `${stepMs} ms: a run of ${longest} on one lane`);
      const names = new Set(rules(out).map((v) => v.rule));
      assert.ok(!names.has("minijack") && !names.has("anchor"), `${stepMs} ms: ${[...names]}`);
      if (stepMs === 125) assert.ok(out.slice(1).every((n, i) => n.lane !== out[i].lane), "too fast for a jack: a trill");
    }
  });

  it("null direction keeps the v26 grammar", () => {
    const flat = moments(BEAT_MS, 80);
    const without = ctxOf([]);
    assert.deepEqual(assignLanes(flat, without, melodic), assignLanes(flat, without, v26));
  });

  it("same phrase repeated gets the same lanes", () => {
    const phrase = (i) => ({ index: i, startMs: i * 20000, endMs: (i + 1) * 20000, repeatOf: i === 0 ? null : 0, similarity: 1, heard: i > 0, lagMs: i === 0 ? 0 : i * 20000 });
    const pitches = Array.from({ length: 30 }, (_, i) => 60 + ((i * 7) % 12));
    const one = (offset) => pitches.map((_, i) => 2000 + offset + i * 600);
    const lead = [0, 20000, 40000].flatMap((offset) => pitches.map((pitch, i) => ({ t: 2000 + offset + i * 600, len: 100, pitch, s: 0.8, conf: 0.9 })));
    const notes = [0, 20000, 40000].flatMap((offset) => one(offset).map((t) => tap(t, 0)));
    const ctx = ctxOf(lead, { phrases: [phrase(0), phrase(1), phrase(2)] });
    const out = assignLanes(notes, ctx, melodic);
    const phraseLanes = (i) => lanesOf(out.filter((n) => n.t >= i * 20000 && n.t < (i + 1) * 20000));
    assert.deepEqual(phraseLanes(1), phraseLanes(0));
    assert.deepEqual(phraseLanes(2), phraseLanes(0));
  });

  it("leaves no violation of the lane rules in what it lays out", () => {
    const pitches = Array.from({ length: 200 }, (_, i) => 55 + ((i * 5) % 11));
    const ctx = ctxOf(stepMsOf(250, pitches));
    const dense = Array.from({ length: pitches.length }, (_, i) => tap(2000 + i * 250, 0)).flatMap((n, i) => (i % 4 === 0 ? [n, tap(n.t, 0)] : [n]));
    const out = assignLanes(dense, ctx, melodic);
    assert.deepEqual(rules(out, { durationMs: 64000 }), []);
    assert.ok(out.length >= dense.length * 0.97, `${dense.length - out.length} of ${dense.length} notes left out`);
  });
});
