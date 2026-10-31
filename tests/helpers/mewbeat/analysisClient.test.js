const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { createAnalysisClient } = require("../../../helpers/mewbeat/analysisClient");
const { audioKeyFile, audioKeyOf } = require("../../../helpers/mewbeat/audioKey");

const MINUTE = 60 * 1000;

function makeTrack(info) {
  return {
    track: "ENCODED",
    info: { sourceName: "youtube", identifier: "abc123", length: 213000, isStream: false, ...info },
  };
}

function featuresFor(track, extra = {}) {
  return {
    featuresVersion: 1,
    durationMs: track.info.length,
    audio: { sourceName: "youtube", identifier: track.info.identifier, length: track.info.length },
    ...extra,
  };
}

function fakeNode(handler) {
  const calls = [];
  return {
    calls,
    rest: {
      post: async (route, body) => {
        calls.push({ route, body });
        return handler(route, body);
      },
    },
  };
}

describe("mewbeat analysis client", () => {
  let dir;
  let clock;
  let client;
  const silentLog = { warning() {}, error() {}, info() {}, debug() {} };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-analysis-"));
    clock = 1_000_000;
    client = createAnalysisClient({ dir, now: () => clock, log: silentLog });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function cacheFileOf(track) {
    return path.join(dir, "features", `${audioKeyFile(audioKeyOf(track))}.json`);
  }

  it("returnsNullForStreamsWithoutCallingLavalink", async () => {
    const node = fakeNode(() => assert.fail("must not be called"));
    const stream = makeTrack({ isStream: true });
    assert.strictEqual(await client.getFeatures(stream, node), null);
    assert.strictEqual(client.peek(stream), null);
    assert.strictEqual(node.calls.length, 0);
  });

  it("sends the encoded track to the analyze route", async () => {
    const track = makeTrack();
    const node = fakeNode(() => featuresFor(track));
    await client.getFeatures(track, node);
    assert.deepStrictEqual(node.calls, [{ route: "/v4/mewbeat/analyze", body: { encodedTrack: "ENCODED" } }]);
  });

  it("cachesFeaturesOnDisk", async () => {
    const track = makeTrack();
    const node = fakeNode(() => featuresFor(track, { tempo: 120 }));
    const first = await client.getFeatures(track, node);
    const second = await client.getFeatures(track, node);
    assert.strictEqual(node.calls.length, 1);
    assert.strictEqual(first.tempo, 120);
    assert.strictEqual(second, first);
    assert.ok(fs.existsSync(cacheFileOf(track)));
  });

  it("serves features from disk to a fresh client without calling Lavalink", async () => {
    const track = makeTrack();
    await client.getFeatures(track, fakeNode(() => featuresFor(track, { tempo: 99 })));

    const fresh = createAnalysisClient({ dir, now: () => clock, log: silentLog });
    const node = fakeNode(() => assert.fail("must not be called"));
    assert.strictEqual((await fresh.getFeatures(track, node)).tempo, 99);
    assert.strictEqual(node.calls.length, 0);
  });

  it("dedupesConcurrentRequests", async () => {
    const track = makeTrack();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const node = fakeNode(async () => {
      await gate;
      return featuresFor(track);
    });
    const a = client.getFeatures(track, node);
    const b = client.getFeatures(track, node);
    release();
    const [first, second] = await Promise.all([a, b]);
    assert.strictEqual(node.calls.length, 1);
    assert.strictEqual(first, second);
    assert.ok(first);
  });

  it("negativeCachesFailuresFor10Minutes", async () => {
    const track = makeTrack();
    const node = fakeNode(() => ({ error: "decode_failed", message: "boom" }));
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.strictEqual(node.calls.length, 1);

    clock += 10 * MINUTE;
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.strictEqual(node.calls.length, 1);

    clock += 1;
    await client.getFeatures(track, node);
    assert.strictEqual(node.calls.length, 2);
  });

  it("treats a null response as a failure", async () => {
    const track = makeTrack();
    const node = fakeNode(() => null);
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.strictEqual(node.calls.length, 1);
    clock += 10 * MINUTE + 1;
    await client.getFeatures(track, node);
    assert.strictEqual(node.calls.length, 2);
  });

  it("treats a rejected request as a failure without throwing", async () => {
    const track = makeTrack();
    const node = fakeNode(() => { throw new Error("socket closed"); });
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.strictEqual(node.calls.length, 1);
  });

  it("treats the Lavalink Not Found body as a failure", async () => {
    const track = makeTrack();
    const node = fakeNode(() => ({ timestamp: 1, status: 404, error: "Not Found", path: "/v4/mewbeat/analyze" }));
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.strictEqual(node.calls.length, 1);
    assert.ok(!fs.existsSync(cacheFileOf(track)));
  });

  it("retries a busy analysis after 30 seconds, not before", async () => {
    const track = makeTrack();
    const node = fakeNode(() => ({ error: "busy" }));
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.strictEqual(node.calls.length, 1);

    clock += 30_000;
    await client.getFeatures(track, node);
    assert.strictEqual(node.calls.length, 1);

    clock += 1;
    await client.getFeatures(track, node);
    assert.strictEqual(node.calls.length, 2);
  });

  it("rejectsMismatchedAudio", async () => {
    const track = makeTrack();
    const node = fakeNode(() => featuresFor(track, { audio: { sourceName: "youtube", identifier: "abc123", length: 999 } }));
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.ok(!fs.existsSync(cacheFileOf(track)));
    assert.strictEqual(client.peek(track), null);
  });

  it("rejects a response with a different identifier", async () => {
    const track = makeTrack();
    const node = fakeNode(() => featuresFor(track, { audio: { sourceName: "youtube", identifier: "other", length: 213000 } }));
    assert.strictEqual(await client.getFeatures(track, node), null);
  });

  it("unchartedIsPermanent", async () => {
    const track = makeTrack();
    const node = fakeNode(() => ({ error: "uncharted", reason: "too_short" }));
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(cacheFileOf(track), "utf8")), { uncharted: true, reason: "too_short" });

    clock += 24 * 60 * MINUTE;
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.strictEqual(node.calls.length, 1);

    const fresh = createAnalysisClient({ dir, now: () => clock, log: silentLog });
    assert.strictEqual(await fresh.getFeatures(track, node), null);
    assert.strictEqual(fresh.peek(track), null);
    assert.strictEqual(node.calls.length, 1);
  });

  describe("peek", () => {
    it("returns null when nothing is cached", () => {
      assert.strictEqual(client.peek(makeTrack()), null);
    });

    it("returns features already in memory", async () => {
      const track = makeTrack();
      const features = await client.getFeatures(track, fakeNode(() => featuresFor(track)));
      assert.strictEqual(client.peek(track), features);
    });

    it("returns features that are only on disk", async () => {
      const track = makeTrack();
      await client.getFeatures(track, fakeNode(() => featuresFor(track, { tempo: 140 })));
      const fresh = createAnalysisClient({ dir, now: () => clock, log: silentLog });
      assert.strictEqual(fresh.peek(track).tempo, 140);
    });

    it("returns null for a negative-cached track", async () => {
      const track = makeTrack();
      await client.getFeatures(track, fakeNode(() => null));
      assert.strictEqual(client.peek(track), null);
    });

    it("returns null for a corrupt cache file", () => {
      const track = makeTrack();
      fs.mkdirSync(path.dirname(cacheFileOf(track)), { recursive: true });
      fs.writeFileSync(cacheFileOf(track), "{not json");
      assert.strictEqual(client.peek(track), null);
    });
  });
});
