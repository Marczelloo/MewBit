const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const { audioKeyOf } = require("../../../helpers/mewbeat/audioKey");
const {
  CALIBRATION,
  calibrationCharts,
  calibrationQuery,
  isCalibrationTrack,
  parseCalibration,
} = require("../../../helpers/mewbeat/calibrationTrack");
const { createChartStore } = require("../../../helpers/mewbeat/chartStore");

// What Lavalink returns for mewbeat:calibration:120:64:3000 (lengthMs = 3000 + 64 * 500 + 1500).
function calibrationTrack(identifier = "mewbeat:calibration:120:64:3000", length = 36500) {
  return { track: "ENCODED", info: { sourceName: "mewbeat", identifier, length, isStream: false, uri: null } };
}

describe("mewbeat calibration track", () => {
  it("asks the plugin for the default clicks", () => {
    assert.equal(`mewbeat:${calibrationQuery()}`, "mewbeat:calibration:120:64:3000");
    assert.deepEqual(parseCalibration(`mewbeat:${calibrationQuery()}`), CALIBRATION);
  });

  it("recognises only the plugin's calibration identifiers", () => {
    assert.equal(isCalibrationTrack(calibrationTrack()), true);
    assert.equal(isCalibrationTrack({ info: { sourceName: "youtube", identifier: "mewbeat:calibration:120:64:3000" } }), false);
    assert.equal(isCalibrationTrack(calibrationTrack("mewbeat:calibration:120:64")), false);
    assert.equal(isCalibrationTrack(null), false);
  });

  it("charts one note per click, alternating the middle lanes", () => {
    const charts = calibrationCharts(calibrationTrack());
    const { notes } = charts.normal;

    assert.equal(notes.length, 64);
    assert.deepEqual(notes.slice(0, 3), [{ t: 3000, lane: 1 }, { t: 3500, lane: 2 }, { t: 4000, lane: 1 }]);
    assert.equal(notes.at(-1).t, 3000 + 63 * 500);
    for (const difficulty of ["easy", "normal", "hard"]) {
      assert.equal(charts[difficulty].difficulty, difficulty);
      assert.equal(charts[difficulty].calibration, true);
      assert.equal(charts[difficulty].audioKey, audioKeyOf(calibrationTrack()));
      assert.equal(charts[difficulty].durationMs, 36500);
    }
  });

  it("rounds clicks of a tempo that does not divide a minute", () => {
    const { notes } = calibrationCharts(calibrationTrack("mewbeat:calibration:90:3:1000", 5500)).easy;
    assert.deepEqual(notes.map((note) => note.t), [1000, 1667, 2333]);
  });

  it("is served by the chart store without analysis", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-calibration-"));
    try {
      const analysis = {
        getFeatures: async () => assert.fail("calibration clicks must not be analysed"),
        statusOf: () => null,
      };
      const store = createChartStore({ dir, analysis, log: { warning() {} } });

      const result = await store.getCharts(calibrationTrack(), "node");
      assert.equal(result.status, "ready");
      assert.equal(result.charts.hard.notes.length, 64);
      assert.equal(store.peekCharts(calibrationTrack()).status, "ready");
      assert.equal(fs.existsSync(path.join(dir, "charts")), false, "nothing is written for the clicks");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
