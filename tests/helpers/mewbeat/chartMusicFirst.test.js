const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { DIFFICULTIES } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { holdSung, inWindows, outsideSung, sungWindows, withMusic } = require("../../../helpers/mewbeat/charts/musicFirst");
const { makeLayeredFeatures } = require("./fixtures");

const RULE = FLAGS.musicFirst.levels.normal.musicFirst;
const chartsOf = (bpm, flags) => generateAll(makeLayeredFeatures({ bpm, durationMs: 64000 }), "k", flags);
const phrase = (startMs, endMs, lead) => ({ startMs, endMs, confidence: { lead: lead.conf }, rate: { lead: lead.rate }, activity: { lead: lead.activity } });

describe("musicFirst (Normal follows the music in sung phrases)", () => {
  it("is off by default and acts on Normal alone", () => {
    assert.deepEqual(Object.keys(FLAGS.musicFirst.levels), ["normal"]);
    assert.equal(DIFFICULTIES.normal.musicFirst, undefined);
  });

  it("leaves Easy, Hard and Hell byte-identical, and changes Normal on a sung song", () => {
    for (const bpm of [95, 130]) {
      const plain = chartsOf(bpm, undefined), on = chartsOf(bpm, { musicFirst: true });
      for (const level of ["easy", "hard", "hell"]) assert.deepEqual(on[level].notes, plain[level].notes, `${bpm} BPM ${level}`);
      assert.notDeepEqual(on.normal.notes, plain.normal.notes, `${bpm} BPM Normal`);
    }
  });

  it("changes nothing on a song with no sung phrase", () => {
    const features = makeLayeredFeatures({ bpm: 120, durationMs: 64000, lead: false });
    assert.deepEqual(generateAll(features, "k", { musicFirst: true }).normal.notes, generateAll(features, "k", undefined).normal.notes);
  });

  it("finds the sung phrases by the lead line's confidence, rate and activity, and merges the touching ones", () => {
    const sung = { conf: 0.9, rate: 1.5, activity: 0.3 };
    const ctx = { phrases: [phrase(0, 1000, sung), phrase(1000, 2000, sung), phrase(2000, 3000, { ...sung, rate: 0.2 }), phrase(3000, 4000, { ...sung, conf: 0.5 }), phrase(4000, 5000, { ...sung, activity: 0.01 }), phrase(5000, 6000, sung)] };
    const windows = sungWindows(ctx, RULE);
    assert.deepEqual(windows, [{ from: 0, to: 2000 }, { from: 5000, to: 6000 }]);
    assert.equal(inWindows(windows, 1999), true);
    assert.equal(inWindows(windows, 2000), false);
    assert.equal(inWindows(windows, 5500), true);
    assert.equal(inWindows(windows, 6000), false);
    assert.deepEqual(sungWindows({ phrases: [] }, RULE), []);
  });

  const ctx = { phrases: [phrase(1000, 2000, { conf: 0.9, rate: 1.5, activity: 0.3 })] };

  it("drops a melody's notes inside the sung windows and keeps the rest", () => {
    const line = [{ t: 500 }, { t: 1000 }, { t: 1500 }, { t: 2000 }, { t: 2500 }];
    assert.deepEqual(outsideSung(line, ctx, RULE).map((n) => n.t), [500, 2000, 2500]);
    assert.equal(outsideSung(null, ctx, RULE), null);
    assert.equal(outsideSung(line, { phrases: [] }, RULE), line);
  });

  it("raises a bass or drum moment and lowers a lead one, in the sung windows only", () => {
    const scored = [1500, 500].map((t) => [t, "bass"]).concat([[1500, "drums"], [1500, "lead"], [1500, "low"], [500, "lead"]]).map(([t, source]) => ({ t, source, score: 1 }));
    const out = withMusic(scored, ctx, RULE);
    assert.deepEqual(out.map((m) => m.score), [1 + RULE.musicBonus, 1, 1 + RULE.musicBonus, 1 - RULE.voicePenalty, 1, 1]);
    assert.equal(withMusic(scored, { phrases: [] }, RULE), scored);
  });

  describe("holdSung", () => {
    const lead = (t, len, conf = 0.9) => ({ t, len, conf, pitch: 60 });
    const timing = { medianMs: 500 };
    const run = (notes, leadLine, sustained = new Set()) => holdSung(notes, { ...ctx, features: { lead: leadLine } }, RULE, timing, sustained);

    it("holds the tap on a long sung note and marks it a sustain", () => {
      const sustained = new Set();
      const out = run([{ t: 1100, lane: 1 }, { t: 1600, lane: 2 }], [lead(1120, 900)], sustained);
      assert.equal(out[0].len, 900);
      assert.equal(out[1].len, undefined);
      assert.ok(sustained.has("1100:1"));
    });

    it("caps the hold at rule.maxBeats beats", () => {
      assert.equal(run([{ t: 1100, lane: 1 }], [lead(1100, 9000)])[0].len, RULE.maxBeats * 500);
    });

    it("leaves a short note, an unsure note, a note outside a sung window and a chord as they are", () => {
      assert.equal(run([{ t: 1100, lane: 1 }], [lead(1100, 200)])[0].len, undefined);
      assert.equal(run([{ t: 1100, lane: 1 }], [lead(1100, 900, 0.3)])[0].len, undefined);
      assert.equal(run([{ t: 300, lane: 1 }], [lead(300, 900)])[0].len, undefined);
      assert.equal(run([{ t: 1100, lane: 1 }, { t: 1100, lane: 3 }], [lead(1100, 900)]).some((n) => n.len > 0), false);
      assert.equal(run([{ t: 1400, lane: 1 }], [lead(1100, 900)])[0].len, undefined);
    });

    it("does not start a hold inside another", () => {
      const out = run([{ t: 1100, lane: 1, len: 2000 }, { t: 1500, lane: 2 }], [lead(1500, 900)]);
      assert.equal(out[1].len, undefined);
    });

    it("does nothing with minBeats 0", () => {
      const notes = [{ t: 1100, lane: 1 }];
      assert.equal(holdSung(notes, { ...ctx, features: { lead: [lead(1100, 900)] } }, { ...RULE, minBeats: 0 }, timing, null), notes);
    });
  });
});
