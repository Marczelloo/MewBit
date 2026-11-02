const assert = require("node:assert");
const { after, before, beforeEach, describe, it } = require("node:test");

const {
  DEFAULT_SETTINGS,
  normalizeSettings,
  validateSettingsPatch,
  UNLOCK_GENERATION,
  getMewbeatRecord,
  unlockMewbeat,
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

  it("starts locked with the default settings", () => {
    assert.deepStrictEqual(getMewbeatRecord("u1"), { unlocked: false, unlockedAt: null, settings: DEFAULT_SETTINGS });
  });

  it("keeps the first unlock time when unlocked twice", () => {
    assert.strictEqual(unlockMewbeat("u1", 1000).unlockedAt, 1000);
    assert.strictEqual(unlockMewbeat("u1", 2000).unlockedAt, 1000);
    assert.strictEqual(getMewbeatRecord("u1").unlockedAt, 1000);
  });

  it("locks an unlock from an earlier generation again, keeping its settings", () => {
    const settings = { ...DEFAULT_SETTINGS, keys: [...DEFAULT_SETTINGS.keys], offsetMs: 40 };
    fake.store.set("u1", { mewbeat: { unlocked: true, unlockedAt: 1000, settings } });
    fake.store.set("u2", { mewbeat: { unlocked: true, unlockedAt: 1000, settings, generation: UNLOCK_GENERATION - 1 } });
    for (const userId of ["u1", "u2"]) {
      assert.deepStrictEqual(getMewbeatRecord(userId), { unlocked: false, unlockedAt: null, settings });
      assert.throws(() => updateMewbeatSettings(userId, { offsetMs: 50 }), { statusCode: 403 });
    }
    const record = unlockMewbeat("u1", 5000);
    assert.strictEqual(record.unlocked, true);
    assert.strictEqual(record.unlockedAt, 5000);
    assert.strictEqual(record.settings.offsetMs, 40);
    assert.strictEqual(fake.store.get("u1").mewbeat.generation, UNLOCK_GENERATION);
    assert.strictEqual(getMewbeatRecord("u1").unlocked, true);
  });

  it("keeps the current generation through a settings change", () => {
    unlockMewbeat("u1", 1000);
    updateMewbeatSettings("u1", { offsetMs: 40 });
    assert.strictEqual(fake.store.get("u1").mewbeat.generation, UNLOCK_GENERATION);
    assert.strictEqual(getMewbeatRecord("u1").unlocked, true);
  });

  it("refuses a settings change before the unlock", () => {
    assert.throws(() => updateMewbeatSettings("u1", { offsetMs: 40 }), (error) => error.statusCode === 403 && /unlock/i.test(error.message));
  });

  it("stores settings per user after the unlock", () => {
    unlockMewbeat("u1", 1000);
    unlockMewbeat("u2", 1000);
    const record = updateMewbeatSettings("u1", { offsetMs: 40 });
    assert.strictEqual(record.settings.offsetMs, 40);
    assert.strictEqual(getMewbeatRecord("u1").settings.offsetMs, 40);
    assert.strictEqual(getMewbeatRecord("u2").settings.offsetMs, 0);
    assert.strictEqual(getMewbeatRecord("u1").unlockedAt, 1000);
  });

  it("keeps the old settings when a patch is refused", () => {
    unlockMewbeat("u1", 1000);
    updateMewbeatSettings("u1", { scrollSpeed: 8 });
    assert.throws(() => updateMewbeatSettings("u1", { scrollSpeed: 8, offsetMs: 5000 }), { statusCode: 400 });
    assert.strictEqual(getMewbeatRecord("u1").settings.scrollSpeed, 8);
    assert.strictEqual(getMewbeatRecord("u1").settings.offsetMs, 0);
  });
});
