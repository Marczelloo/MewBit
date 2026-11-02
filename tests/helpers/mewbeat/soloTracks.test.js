const assert = require("node:assert");
const { describe, it } = require("node:test");

const { createSoloTracks } = require("../../../helpers/mewbeat/soloTracks");

describe("mewbeat solo track registry", () => {
  it("returns what was put and null for an unknown key", () => {
    const tracks = createSoloTracks();
    tracks.put("a", { track: 1 });
    assert.deepStrictEqual(tracks.get("a"), { track: 1 });
    assert.strictEqual(tracks.get("b"), null);
  });

  it("evicts the least recently used entry beyond max", () => {
    const tracks = createSoloTracks({ max: 2 });
    tracks.put("a", 1);
    tracks.put("b", 2);
    tracks.put("c", 3);
    assert.strictEqual(tracks.get("a"), null);
    assert.strictEqual(tracks.get("b"), 2);
    assert.strictEqual(tracks.get("c"), 3);
  });

  it("counts a get as a use", () => {
    const tracks = createSoloTracks({ max: 2 });
    tracks.put("a", 1);
    tracks.put("b", 2);
    tracks.get("a");
    tracks.put("c", 3);
    assert.strictEqual(tracks.get("b"), null);
    assert.strictEqual(tracks.get("a"), 1);
  });

  it("drops an entry once its ttl has passed", () => {
    let time = 1000;
    const tracks = createSoloTracks({ ttlMs: 500, now: () => time });
    tracks.put("a", 1);
    time = 1500;
    assert.strictEqual(tracks.get("a"), null);
  });

  it("keeps an entry alive while it is read", () => {
    let time = 1000;
    const tracks = createSoloTracks({ ttlMs: 500, now: () => time });
    tracks.put("a", 1);
    time = 1499;
    assert.strictEqual(tracks.get("a"), 1);
    time = 1998;
    assert.strictEqual(tracks.get("a"), 1);
    time = 2497;
    assert.strictEqual(tracks.get("a"), 1);
  });

  it("restarts the lifetime when an entry is put again", () => {
    let time = 0;
    const tracks = createSoloTracks({ ttlMs: 100, now: () => time });
    tracks.put("a", 1);
    time = 80;
    tracks.put("a", 2);
    time = 150;
    assert.strictEqual(tracks.get("a"), 2);
  });
});
