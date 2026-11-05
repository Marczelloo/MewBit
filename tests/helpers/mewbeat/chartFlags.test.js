const assert = require("node:assert");
const { describe, it } = require("node:test");

const { DIFFICULTIES, INTERNAL_LEVELS, levelOf } = require("../../../helpers/mewbeat/charts/difficulty");
const { FLAGS, flagsKey, normalFlags, withFlags } = require("../../../helpers/mewbeat/charts/flags");
const { GENERATOR_VERSION, analyse, generateAll, generateChart, traceChart } = require("../../../helpers/mewbeat/charts/generate");
const { makeLayeredFeatures } = require("./fixtures");

const KEY = "youtube:flags:64000";
const LEVELS = ["easy", "normal", "hard", "hell"];
const features = () => makeLayeredFeatures({ bpm: 120, durationMs: 64000 });

// Runs fn with a flag's overrides set, and puts the registry back after it.
function withOverrides(name, levels, fn) {
  const saved = FLAGS[name].levels;
  FLAGS[name].levels = levels;
  try {
    return fn();
  } finally {
    FLAGS[name].levels = saved;
  }
}

describe("mewbeat generator flags", () => {
  describe("registry", () => {
    it("has the four named flags", () => {
      assert.deepStrictEqual(Object.keys(FLAGS), ["density", "holds", "transitions", "lead"]);
      for (const flag of Object.values(FLAGS)) {
        assert.strictEqual(typeof flag.label, "string");
        assert.strictEqual(typeof flag.levels, "object");
      }
    });
  });

  describe("normalFlags and flagsKey", () => {
    it("takes undefined, an array or an object", () => {
      assert.deepStrictEqual(normalFlags(undefined), {});
      assert.deepStrictEqual(normalFlags(null), {});
      assert.deepStrictEqual(normalFlags(["holds", "density"]), { holds: true, density: true });
      assert.deepStrictEqual(normalFlags({ holds: true, lead: false }), { holds: true });
    });

    it("ignores unknown names, including inherited ones", () => {
      assert.deepStrictEqual(normalFlags(["holds", "nope", "constructor", 7]), { holds: true });
      assert.deepStrictEqual(normalFlags({ toString: true, nope: true }), {});
    });

    it("keys the enabled names sorted, whatever the order they came in", () => {
      assert.strictEqual(flagsKey(undefined), "");
      assert.strictEqual(flagsKey({}), "");
      assert.strictEqual(flagsKey(["lead", "density", "holds"]), "density-holds-lead");
      assert.strictEqual(flagsKey({ holds: true, density: true }), flagsKey(["density", "holds"]));
      assert.strictEqual(flagsKey(["nope"]), "");
    });
  });

  describe("withFlags", () => {
    it("returns the same object when no enabled flag overrides the level", () => {
      const diff = levelOf("hard");
      assert.strictEqual(withFlags(diff, "hard", undefined), diff);
      withOverrides("holds", {}, () => assert.strictEqual(withFlags(diff, "hard", ["holds"]), diff));
      withOverrides("holds", { easy: { maxNps: 1 } }, () => {
        assert.strictEqual(withFlags(diff, "hard", ["holds"]), diff);
        assert.strictEqual(withFlags(diff, "hard", []), diff);
      });
    });

    it("applies overrides for the named level only, and only for enabled flags", () => {
      withOverrides("holds", { easy: { maxNps: 1 } }, () => {
        const easy = levelOf("easy");
        const over = withFlags(easy, "easy", ["holds"]);
        assert.notStrictEqual(over, easy);
        assert.strictEqual(over.maxNps, 1);
        assert.strictEqual(over.baseDiv, easy.baseDiv);
        assert.strictEqual(easy.maxNps, DIFFICULTIES.easy.maxNps);
        withOverrides("lead", {}, () => assert.strictEqual(withFlags(easy, "easy", ["lead"]), easy));
      });
    });

    it("applies overrides on an internal level name", () => {
      withOverrides("density", { normalV26: { maxNps: 2 } }, () => {
        assert.ok(INTERNAL_LEVELS.normalV26);
        assert.strictEqual(withFlags(levelOf("normalV26"), "normalV26", ["density"]).maxNps, 2);
        assert.strictEqual(withFlags(levelOf("normal"), "normal", ["density"]), levelOf("normal"));
      });
    });

    it("applies several flags in sorted order, the later name winning", () => {
      const saved = [FLAGS.density.levels, FLAGS.lead.levels];
      FLAGS.density.levels = { hard: { maxNps: 3, maxJack: 1 } };
      FLAGS.lead.levels = { hard: { maxNps: 5 } };
      try {
        const over = withFlags(levelOf("hard"), "hard", ["lead", "density"]);
        assert.strictEqual(over.maxNps, 5);
        assert.strictEqual(over.maxJack, 1);
      } finally {
        [FLAGS.density.levels, FLAGS.lead.levels] = saved;
      }
    });
  });

  describe("charts", () => {
    it("are what they are today with no flag on, for every level", () => {
      const plain = generateAll(features(), KEY);
      assert.deepStrictEqual(generateAll(features(), KEY, undefined), plain);
      assert.deepStrictEqual(generateAll(features(), KEY, {}), plain);
      assert.deepStrictEqual(generateAll(features(), KEY, []), plain);
      assert.deepStrictEqual(generateAll(features(), KEY, ["nope"]), plain);
      for (const level of LEVELS) {
        assert.deepStrictEqual(generateChart(features(), level, KEY, {}), plain[level], level);
        assert.deepStrictEqual(traceChart(features(), level, KEY, {}).chart, plain[level], level);
      }
    });

    it("are the same with a flag on that overrides nothing, but carry the flag in their version", () => {
      const plain = generateAll(features(), KEY);
      withOverrides("holds", {}, () => {
        const flagged = generateAll(features(), KEY, ["holds"]);
        for (const level of LEVELS) {
          assert.deepStrictEqual({ ...flagged[level], version: undefined }, { ...plain[level], version: undefined }, level);
          assert.strictEqual(flagged[level].version, `${GENERATOR_VERSION}-holds`);
        }
      });
    });

    it("change when a flag's override is set (control)", () => {
      const plain = generateAll(features(), KEY);
      withOverrides("density", Object.fromEntries(LEVELS.map((level) => [level, { maxNps: 0.8 }])), () => {
        const flagged = generateAll(features(), KEY, ["density"]);
        for (const level of LEVELS) {
          assert.notDeepStrictEqual(flagged[level].notes, plain[level].notes, level);
          assert.ok(flagged[level].notes.length < plain[level].notes.length, level);
        }
        // Not asked for, so not applied.
        assert.deepStrictEqual(generateAll(features(), KEY, ["lead"]).hard.notes, plain.hard.notes);
        const { busy } = analyse(features());
        assert.strictEqual(traceChart(features(), "hard", KEY, ["density"]).diff.maxNps, Math.min(levelOf("hard").maxNpsCeiling ?? Infinity, 0.8 * busy));
      });
      assert.deepStrictEqual(generateAll(features(), KEY, ["density"]).hard.notes, plain.hard.notes);
    });

    it("reach the levels a cut level reads its moments from", () => {
      const plain = generateAll(features(), KEY);
      // Easy is cut from the internal normalV26; an override there must show in Easy.
      withOverrides("density", { normalV26: { maxNps: 0.8 } }, () => {
        const flagged = generateAll(features(), KEY, ["density"]);
        assert.notDeepStrictEqual(flagged.easy.notes, plain.easy.notes);
        assert.deepStrictEqual(flagged.hell.notes, plain.hell.notes);
      });
    });

    it("keep the version a plain number with no flags and a string with them", () => {
      const ctx = analyse(features(), ["lead", "holds"]);
      assert.deepStrictEqual(ctx.flags, { lead: true, holds: true });
      assert.deepStrictEqual(analyse(features()).flags, {});
      assert.strictEqual(generateChart(features(), "easy", KEY).version, GENERATOR_VERSION);
      assert.strictEqual(generateChart(features(), "easy", KEY, ["lead", "holds"]).version, `${GENERATOR_VERSION}-holds-lead`);
      assert.strictEqual(generateChart(features(), "easy", KEY, ["holds", "lead"]).version, `${GENERATOR_VERSION}-holds-lead`);
    });
  });
});
