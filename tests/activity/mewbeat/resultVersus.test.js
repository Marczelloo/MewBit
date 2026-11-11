const assert = require("node:assert/strict");
const path = require("node:path");
const { before, describe, it } = require("node:test");
const { pathToFileURL } = require("node:url");

let accuracyDiff;
let scoreDiff;
let versusOf;

before(async () => {
  ({ accuracyDiff, scoreDiff, versusOf } = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/resultVersus.js")).href));
});

const MINUS = "−";

describe("mewbeat results versus", () => {
  describe("score difference", () => {
    it("writes the sign of a better run, with thousands separators", () => {
      assert.deepEqual(scoreDiff(112_400, 100_000), { text: "+12,400", trend: "up" });
    });

    it("writes a real minus for a worse run", () => {
      assert.deepEqual(scoreDiff(96_800, 100_000), { text: `${MINUS}3,200`, trend: "down" });
    });

    it("writes a tie as nothing, still signed", () => {
      assert.deepEqual(scoreDiff(5000, 5000), { text: "±0", trend: "even" });
    });

    it("has nothing to say while either side is unknown", () => {
      assert.equal(scoreDiff(5000, undefined), null);
      assert.equal(scoreDiff(null, 5000), null);
      assert.equal(scoreDiff(NaN, 5000), null);
    });
  });

  describe("accuracy difference", () => {
    it("is the difference of the two numbers as they read, in hundredths", () => {
      assert.deepEqual(accuracyDiff(96.12, 94.88), { text: "+1.24%", trend: "up" });
      assert.deepEqual(accuracyDiff(91.5, 95), { text: `${MINUS}3.50%`, trend: "down" });
    });

    it("does not let float error show in a small difference", () => {
      assert.equal(accuracyDiff(90.3, 90.1).text, "+0.20%");
      assert.equal(accuracyDiff(97.33, 97.32).text, "+0.01%");
    });

    it("writes a tie as nothing, still signed, and a difference below what is shown the same", () => {
      assert.deepEqual(accuracyDiff(95, 95), { text: "±0.00%", trend: "even" });
      assert.equal(accuracyDiff(95.001, 95).text, "±0.00%");
    });

    it("has nothing to say while either side is unknown", () => {
      assert.equal(accuracyDiff(95, undefined), null);
      assert.equal(accuracyDiff(null, 95), null);
    });
  });

  describe("versusOf", () => {
    const reply = (extra) => ({ ranked: true, newBest: true, score: 112_400, accuracy: 96.12, pp: 123.4, previousBest: { score: 100_000, accuracy: 94.88 }, ...extra });

    it("gives the pp, and the run against the best from before it", () => {
      assert.deepEqual(versusOf(reply()), {
        pp: { text: "123 pp", counts: true },
        first: false,
        score: { text: "+12,400", trend: "up" },
        accuracy: { text: "+1.24%", trend: "up" },
      });
    });

    it("says the pp of a run that is not a new best does not count: the best stands", () => {
      const versus = versusOf(reply({ newBest: false, score: 96_800, accuracy: 91.5 }));
      assert.deepEqual(versus.pp, { text: "123 pp", counts: false });
      assert.deepEqual(versus.score, { text: `${MINUS}3,200`, trend: "down" });
      assert.deepEqual(versus.accuracy, { text: `${MINUS}3.38%`, trend: "down" });
    });

    it("calls the run with no best before it a first play, and has no difference to give", () => {
      const versus = versusOf(reply({ previousBest: null }));
      assert.equal(versus.first, true);
      assert.equal(versus.score, null);
      assert.equal(versus.accuracy, null);
      assert.equal(versus.pp.text, "123 pp");
    });

    it("rounds the pp as the profile does, and shows a run worth nothing as 0 pp", () => {
      assert.equal(versusOf(reply({ pp: 1234.5 })).pp.text, "1,235 pp");
      assert.equal(versusOf(reply({ pp: 0 })).pp.text, "0 pp");
    });

    it("shows nothing for a run that was not ranked, whatever else the reply holds", () => {
      assert.equal(versusOf(reply({ ranked: false })), null);
      assert.equal(versusOf(null), null);
      assert.equal(versusOf(undefined), null);
    });

    it("leaves out what the reply does not carry: no pp, and not a first play, since that is not known", () => {
      const bare = reply();
      delete bare.pp;
      delete bare.previousBest;
      assert.deepEqual(versusOf(bare), { pp: null, first: false, score: null, accuracy: null });
    });
  });
});
