const assert = require("node:assert");
const { describe, it } = require("node:test");

const { audioKeyFile, audioKeyOf } = require("../../../helpers/mewbeat/audioKey");

function track(info) {
  return { info: { sourceName: "YouTube", identifier: "dQw4w9WgXcQ", length: 213000, isStream: false, ...info } };
}

describe("mewbeat audio key", () => {
  it("joins lower-cased source, identifier and length", () => {
    assert.strictEqual(audioKeyOf(track()), "youtube:dQw4w9WgXcQ:213000");
  });

  it("gives a different key when the length differs", () => {
    assert.notStrictEqual(audioKeyOf(track({ length: 214000 })), audioKeyOf(track()));
  });

  it("returns null for streams, zero length and a missing identifier", () => {
    assert.strictEqual(audioKeyOf(track({ isStream: true })), null);
    assert.strictEqual(audioKeyOf(track({ length: 0 })), null);
    assert.strictEqual(audioKeyOf(track({ identifier: "" })), null);
    assert.strictEqual(audioKeyOf(null), null);
  });

  it("maps a key to a stable 40-char hex file name", () => {
    const name = audioKeyFile("youtube:dQw4w9WgXcQ:213000");
    assert.match(name, /^[0-9a-f]{40}$/);
    assert.strictEqual(audioKeyFile("youtube:dQw4w9WgXcQ:213000"), name);
  });
});
