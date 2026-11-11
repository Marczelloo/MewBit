const assert = require("node:assert");
const { after, before, beforeEach, describe, it } = require("node:test");

const {
  DEFAULT_SETTINGS,
  normalizeSettings,
  validateSettingsPatch,
  getMewbeatRecord,
  markTutorialSeen,
  updateMewbeatSettings,
} = require("../../../helpers/mewbeat/userSettings");
const { installFakePreferences } = require("./fakePreferences");

describe("mewbeat settings validation", () => {
  it("normalizes an empty record to the defaults", () => {
    assert.deepStrictEqual(normalizeSettings({}), DEFAULT_SETTINGS);
    assert.deepStrictEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  });

  it("falls back per field on invalid stored data", () => {
    const settings = normalizeSettings({ offsetMs: 9999, keys: ["KeyA", "KeyA", "KeyB", "KeyC"], effects: "neon", scrollSpeed: 7 });
    assert.strictEqual(settings.offsetMs, 0);
    assert.deepStrictEqual(settings.keys, ["KeyD", "KeyF", "KeyJ", "KeyK"]);
    assert.strictEqual(settings.effects, "full");
    assert.strictEqual(settings.scrollSpeed, 7);
  });

  it("returns settings the caller can mutate without touching the defaults", () => {
    normalizeSettings({}).keys.push("KeyZ");
    assert.deepStrictEqual(DEFAULT_SETTINGS.keys, ["KeyD", "KeyF", "KeyJ", "KeyK"]);
  });

  it("has sound effects on by default, and accepts them changed", () => {
    assert.strictEqual(DEFAULT_SETTINGS.sfx, true);
    assert.strictEqual(DEFAULT_SETTINGS.sfxVolume, 60);
    const merged = validateSettingsPatch({ sfx: false, sfxVolume: 0 }, DEFAULT_SETTINGS);
    assert.strictEqual(merged.sfx, false);
    assert.strictEqual(merged.sfxVolume, 0);
  });

  it("defaults to quiet hit sounds and a visible Mewbit, and accepts both changed", () => {
    assert.strictEqual(DEFAULT_SETTINGS.hitVolume, 40);
    assert.strictEqual(DEFAULT_SETTINGS.showMewbit, true);
    const merged = validateSettingsPatch({ hitVolume: 0, showMewbit: false }, DEFAULT_SETTINGS);
    assert.strictEqual(merged.hitVolume, 0);
    assert.strictEqual(merged.showMewbit, false);
  });

  it("keeps a separate offset for solo and room audio, with the same range", () => {
    assert.strictEqual(DEFAULT_SETTINGS.soloOffsetMs, 0);
    assert.strictEqual(validateSettingsPatch({ soloOffsetMs: -300 }, DEFAULT_SETTINGS).soloOffsetMs, -300);
    assert.strictEqual(validateSettingsPatch({ soloOffsetMs: 700 }, DEFAULT_SETTINGS).soloOffsetMs, 700);
    assert.strictEqual(normalizeSettings({ offsetMs: -45 }).soloOffsetMs, 0, "a Live offset is not a solo one");
    assert.strictEqual(normalizeSettings({ soloOffsetMs: 9999 }).soloOffsetMs, 0);
  });

  it("defaults the music volume to 80 and accepts 0 to 100", () => {
    assert.strictEqual(DEFAULT_SETTINGS.musicVolume, 80);
    assert.strictEqual(validateSettingsPatch({ musicVolume: 0 }, DEFAULT_SETTINGS).musicVolume, 0);
    assert.strictEqual(validateSettingsPatch({ musicVolume: 100 }, DEFAULT_SETTINGS).musicVolume, 100);
    assert.strictEqual(normalizeSettings({ musicVolume: 35 }).musicVolume, 35);
    assert.strictEqual(normalizeSettings({ musicVolume: 140 }).musicVolume, 80);
    assert.strictEqual(normalizeSettings({}).musicVolume, 80);
  });

  it("evens out loudness by default, accepts it off, and refuses anything but a boolean", () => {
    assert.strictEqual(DEFAULT_SETTINGS.normalizeLoudness, true);
    assert.strictEqual(normalizeSettings({}).normalizeLoudness, true);
    assert.strictEqual(validateSettingsPatch({ normalizeLoudness: false }, DEFAULT_SETTINGS).normalizeLoudness, false);
    assert.strictEqual(normalizeSettings({ normalizeLoudness: false }).normalizeLoudness, false);
    assert.strictEqual(normalizeSettings({ normalizeLoudness: "off" }).normalizeLoudness, true, "a bad stored value falls back");
    for (const bad of ["off", 0, null]) {
      assert.throws(() => validateSettingsPatch({ normalizeLoudness: bad }, DEFAULT_SETTINGS), /loudness/);
    }
  });

  it("follows the tempo by default and accepts a fixed speed", () => {
    assert.strictEqual(DEFAULT_SETTINGS.tempoScroll, true);
    assert.strictEqual(validateSettingsPatch({ tempoScroll: false }, DEFAULT_SETTINGS).tempoScroll, false);
    assert.throws(() => validateSettingsPatch({ tempoScroll: "yes" }, DEFAULT_SETTINGS), /tempo/);
  });

  it("merges a valid patch onto the current settings", () => {
    const keys = ["KeyA", "KeyS", "KeyK", "KeyL"];
    const merged = validateSettingsPatch({ keys }, DEFAULT_SETTINGS);
    assert.deepStrictEqual(merged.keys, keys);
    assert.strictEqual(merged.scrollSpeed, DEFAULT_SETTINGS.scrollSpeed);
  });

  const refused = {
    "duplicate keys": { keys: ["KeyA", "KeyA", "KeyJ", "KeyK"] },
    "the reserved Space key": { keys: ["Space", "KeyF", "KeyJ", "KeyK"] },
    "the reserved Escape key": { keys: ["Escape", "KeyF", "KeyJ", "KeyK"] },
    "three keys": { keys: ["KeyA", "KeyS", "KeyD"] },
    "a key that is not a code": { keys: ["a b", "KeyF", "KeyJ", "KeyK"] },
    "offset above the range": { offsetMs: 701 },
    "offset below the range": { offsetMs: -301 },
    "a fractional offset": { offsetMs: 1.5 },
    "a solo offset above the range": { soloOffsetMs: 701 },
    "a fractional solo offset": { soloOffsetMs: 1.5 },
    "scroll speed 0": { scrollSpeed: 0 },
    "an unknown difficulty": { liveDifficulty: "expert" },
    "an unknown effects level": { effects: "neon" },
    "a non-boolean hit sounds": { hitSounds: "yes" },
    "an unknown hit sound": { hitSound: "cowbell" },
    "hit volume above 100": { hitVolume: 101 },
    "a negative hit volume": { hitVolume: -5 },
    "a fractional hit volume": { hitVolume: 12.5 },
    "non-boolean sound effects": { sfx: "yes" },
    "sound effects volume above 100": { sfxVolume: 101 },
    "a fractional sound effects volume": { sfxVolume: 12.5 },
    "music volume above 100": { musicVolume: 101 },
    "a negative music volume": { musicVolume: -1 },
    "a fractional music volume": { musicVolume: 50.5 },
    "a non-boolean show Mewbit": { showMewbit: 1 },
    "an unknown field": { colour: 1 },
  };
  for (const [name, patch] of Object.entries(refused)) {
    it(`refuses ${name} with a 400`, () => {
      assert.throws(() => validateSettingsPatch(patch, DEFAULT_SETTINGS), (error) => error.statusCode === 400 && typeof error.message === "string");
    });
  }

  it("refuses a patch that is not an object", () => {
    assert.throws(() => validateSettingsPatch(null, DEFAULT_SETTINGS), { statusCode: 400 });
    assert.throws(() => validateSettingsPatch([], DEFAULT_SETTINGS), { statusCode: 400 });
  });
});

describe("mewbeat per-account record", () => {
  let fake;
  before(() => { fake = installFakePreferences(); });
  after(() => fake.restore());
  beforeEach(() => fake.store.clear());

  it("starts with the tutorial unseen and the default settings", () => {
    assert.deepStrictEqual(getMewbeatRecord("u1"), { tutorialSeen: false, settings: DEFAULT_SETTINGS });
  });

  it("changes settings with no unlock first", () => {
    const record = updateMewbeatSettings("u1", { offsetMs: 40 });
    assert.strictEqual(record.settings.offsetMs, 40);
    assert.strictEqual(record.tutorialSeen, false);
  });

  it("remembers the tutorial was seen and keeps the settings", () => {
    updateMewbeatSettings("u1", { offsetMs: 40 });
    const record = markTutorialSeen("u1");
    assert.strictEqual(record.tutorialSeen, true);
    assert.strictEqual(record.settings.offsetMs, 40);
    assert.strictEqual(getMewbeatRecord("u1").tutorialSeen, true);
    assert.strictEqual(getMewbeatRecord("u1").settings.offsetMs, 40);
    assert.strictEqual(markTutorialSeen("u1").tutorialSeen, true);
  });

  it("keeps the tutorial flag through a settings change", () => {
    markTutorialSeen("u1");
    updateMewbeatSettings("u1", { offsetMs: 40 });
    assert.strictEqual(getMewbeatRecord("u1").tutorialSeen, true);
  });

  it("reads an old unlock record as an unseen tutorial, keeping its settings", () => {
    const settings = { ...DEFAULT_SETTINGS, keys: [...DEFAULT_SETTINGS.keys], offsetMs: 40 };
    fake.store.set("u1", { mewbeat: { unlocked: true, unlockedAt: 1000, generation: 2, settings } });
    assert.deepStrictEqual(getMewbeatRecord("u1"), { tutorialSeen: false, settings });
    assert.strictEqual(updateMewbeatSettings("u1", { offsetMs: 50 }).settings.offsetMs, 50);
  });

  it("stores settings and the tutorial flag per user", () => {
    markTutorialSeen("u1");
    updateMewbeatSettings("u1", { offsetMs: 40 });
    assert.strictEqual(getMewbeatRecord("u1").settings.offsetMs, 40);
    assert.strictEqual(getMewbeatRecord("u2").settings.offsetMs, 0);
    assert.strictEqual(getMewbeatRecord("u2").tutorialSeen, false);
  });

  it("keeps the old settings when a patch is refused", () => {
    updateMewbeatSettings("u1", { scrollSpeed: 8 });
    assert.throws(() => updateMewbeatSettings("u1", { scrollSpeed: 8, offsetMs: 5000 }), { statusCode: 400 });
    assert.strictEqual(getMewbeatRecord("u1").settings.scrollSpeed, 8);
    assert.strictEqual(getMewbeatRecord("u1").settings.offsetMs, 0);
  });
});

describe("mewbeat user settings: modifiers and FEVER mode", () => {
  const { DEFAULT_SETTINGS, normalizeSettings, validateSettingsPatch } = require("../../../helpers/mewbeat/userSettings");

  it("defaults to no modifiers and manual FEVER", () => {
    assert.deepStrictEqual(DEFAULT_SETTINGS.modifiers, []);
    assert.strictEqual(DEFAULT_SETTINGS.feverMode, "manual");
  });

  it("takes a list of modifier ids and auto FEVER, and refuses anything else", () => {
    const settings = validateSettingsPatch({ modifiers: ["nf", "gn"], feverMode: "auto" }, {});
    assert.deepStrictEqual(settings.modifiers, ["nf", "gn"]);
    assert.strictEqual(settings.feverMode, "auto");
    for (const patch of [{ modifiers: "nf" }, { modifiers: ["nf", "nf"] }, { modifiers: ["NoFail"] }, { feverMode: "space" }]) {
      assert.throws(() => validateSettingsPatch(patch, {}), (error) => error.statusCode === 400);
    }
  });

  it("does not share the stored list", () => {
    const stored = { modifiers: ["mr"] };
    const settings = normalizeSettings(stored);
    settings.modifiers.push("gn");
    assert.deepStrictEqual(stored.modifiers, ["mr"]);
  });
});
