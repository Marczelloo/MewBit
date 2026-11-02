const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const { validateSettingsPatch, DEFAULT_SETTINGS } = require("../../../helpers/mewbeat/userSettings");

const SFX = path.resolve(__dirname, "../../../activity/src/mewbeat/sfx");
let HIT_SOUNDS;
let hitSoundOf;

test.before(async () => {
  ({ HIT_SOUNDS, hitSoundOf } = await import(
    pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/hitSounds.js")).href
  ));
});

test("every hit sound has its sample, and the server takes its value", () => {
  for (const { value, name } of HIT_SOUNDS) {
    assert.ok(fs.existsSync(path.join(SFX, `${name}.wav`)), `no sample for ${value}`);
    assert.strictEqual(validateSettingsPatch({ hitSound: value }, DEFAULT_SETTINGS).hitSound, value);
  }
});

test("the default hit sound is the first, and an unknown choice falls back to it", () => {
  assert.strictEqual(HIT_SOUNDS[0].value, DEFAULT_SETTINGS.hitSound);
  assert.strictEqual(hitSoundOf(undefined), HIT_SOUNDS[0]);
  assert.strictEqual(hitSoundOf("cowbell"), HIT_SOUNDS[0]);
  assert.strictEqual(hitSoundOf("taiko").name, "hit-taiko");
});
