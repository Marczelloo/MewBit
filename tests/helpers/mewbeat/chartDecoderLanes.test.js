const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const { audioKeyFile, audioKeyOf } = require("../../../helpers/mewbeat/audioKey");
const { createChartStore } = require("../../../helpers/mewbeat/chartStore");
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");
const { generateChart } = require("../../../helpers/mewbeat/charts/generate");
const { stairSteps } = require("../../../helpers/mewbeat/charts/laneRules");
const { STAIRS } = require("../../../helpers/mewbeat/charts/difficulty");
const { makeLayeredFeatures } = require("./fixtures");

const quietLog = { warning() {} };
const times = Array.from({ length: 6 }, (_, i) => 1000 + i * 250);
const line = (pitches) => pitches.map((pitch, i) => ({ t: times[i], pitch, conf: 0.9 }));

describe("lanes on a second detector's melody (flag decoderLanes)", () => {
  it("reads features.melodyLine before the lead line", () => {
    const features = { lead: line([60, 60, 60, 60, 60, 60]), bass: [], bands: [] };
    assert.ok(stairSteps({ features }, times, () => 500, STAIRS).every((s) => s === 0));
    const withMelody = { ...features, melodyLine: line([60, 62, 64, 65, 67, 69]) };
    assert.deepEqual(stairSteps({ features: withMelody }, times, () => 500, STAIRS), [0, 1, 1, 1, 1, 1]);
  });

  it("changes lanes only, and only with the flag on", () => {
    const features = makeLayeredFeatures();
    const rising = Array.from({ length: 240 }, (_, i) => ({ t: 1000 + i * 250, pitch: 48 + (i % 12), conf: 1 }));
    const decoded = { ...features, decodedMelody: rising };
    const plain = generateChart(features, "normal", "k", []).notes;
    assert.deepEqual(generateChart(decoded, "normal", "k", []).notes, plain);
    const flagged = generateChart(decoded, "normal", "k", ["decoderLanes"]).notes;
    assert.deepEqual(flagged.map((n) => n.t), plain.map((n) => n.t));
    assert.ok(flagged.some((n, i) => n.lane !== plain[i].lane));
    assert.deepEqual(Object.keys(FLAGS.decoderLanes.levels), ["normal"]);
  });

  it("is loaded by the chart store from melody/<audio key>.json when there is one", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-melody-"));
    try {
      const track = { track: "ENCODED", info: { sourceName: "youtube", identifier: "abc123", length: 180000, isStream: false } };
      const seen = [];
      const generate = (features) => (seen.push(features), null);
      const analysis = { getFeatures: async () => makeLayeredFeatures(), statusOf: () => null };
      await createChartStore({ dir, analysis, generate, log: quietLog }).getCharts(track, "node");
      assert.equal(seen[0].decodedMelody, undefined);
      fs.rmSync(path.join(dir, "charts"), { recursive: true, force: true }); // the first call left an uncharted marker
      fs.mkdirSync(path.join(dir, "melody"));
      fs.writeFileSync(path.join(dir, "melody", `${audioKeyFile(audioKeyOf(track))}.json`), JSON.stringify({ notes: [{ t: 1000, pitch: 60, conf: 1 }] }));
      await createChartStore({ dir, analysis, generate, log: quietLog }).getCharts({ ...track }, "node");
      assert.equal(seen.at(-1).decodedMelody?.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("moments on a second detector's melody (flag decoderPick)", () => {
  const { withMelody } = require("../../../helpers/mewbeat/charts/melodyPick");
  const scored = [
    { t: 1000, s: 0.2, score: 0 },
    { t: 1500, s: 0.9, score: 0, raw: 1520 },
    { t: 2000, s: 0.5, score: 0 },
  ];

  it("raises a moment where a melody note begins, by the sound it was heard at, and only a loud enough one", () => {
    const melody = [{ t: 1010 }, { t: 1540 }, { t: 2200 }];
    assert.deepEqual(withMelody(scored, melody, { bonus: 1, minStrength: 0 }).map((m) => m.score), [1, 1, 0]);
    assert.deepEqual(withMelody(scored, melody, { bonus: 1, minStrength: 0.5 }).map((m) => m.score), [0, 1, 0]);
    assert.equal(withMelody(scored, [], { bonus: 1, minStrength: 0 }), scored);
  });

  it("changes Normal alone, and only with the flag on and a melody decoded", () => {
    const features = makeLayeredFeatures();
    const melody = Array.from({ length: 120 }, (_, i) => ({ t: 1125 + i * 500, pitch: 60 }));
    const decoded = { ...features, decodedMelody: melody };
    const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
    const notesOf = (charts) => Object.fromEntries(Object.entries(charts).map(([level, chart]) => [level, chart.notes]));
    const plain = notesOf(generateAll(features, "k", {}));
    assert.deepEqual(notesOf(generateAll(features, "k", { decoderPick: true })), plain);
    assert.deepEqual(notesOf(generateAll(decoded, "k", {})), plain);
    const on = notesOf(generateAll(decoded, "k", { decoderPick: true }));
    for (const level of ["easy", "hard", "hell"]) assert.deepEqual(on[level], plain[level], level);
    assert.deepEqual(Object.keys(FLAGS.decoderPick.levels), ["normal"]);
  });
});
