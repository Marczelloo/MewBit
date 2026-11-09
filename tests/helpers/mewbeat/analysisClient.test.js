const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it, mock } = require("node:test");

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
    featuresVersion: 4,
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
    assert.strictEqual(await client.peek(stream), null);
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
    assert.strictEqual(await client.peek(track), null);
  });

  it("rejects a truncated decode and blocks the track for 10 minutes", async () => {
    const track = makeTrack({ length: 180000 });
    const node = fakeNode(() => featuresFor(track, { durationMs: 30000 }));
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.ok(!fs.existsSync(cacheFileOf(track)));
    assert.strictEqual(await client.peek(track), null);

    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.strictEqual(node.calls.length, 1);
    clock += 10 * MINUTE + 1;
    await client.getFeatures(track, node);
    assert.strictEqual(node.calls.length, 2);
  });

  it("accepts a decode that drifts by 1.5 seconds", async () => {
    const track = makeTrack({ length: 180000 });
    const features = await client.getFeatures(track, fakeNode(() => featuresFor(track, { durationMs: 181500 })));
    assert.ok(features);
    assert.ok(fs.existsSync(cacheFileOf(track)));
  });

  it("gives up on a plugin call that never answers and retries after the busy TTL", async () => {
    const warnings = [];
    const impatient = createAnalysisClient({
      dir,
      now: () => clock,
      requestTimeoutMs: 20,
      log: { ...silentLog, warning: (...args) => warnings.push(args) },
    });
    const track = makeTrack();
    const node = fakeNode(() => new Promise(() => {}));

    assert.strictEqual(await impatient.getFeatures(track, node), null);
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0][0], /timed out/);
    assert.strictEqual(await impatient.getFeatures(track, node), null);
    assert.strictEqual(node.calls.length, 1);

    clock += 30_000 + 1;
    await impatient.getFeatures(track, node);
    assert.strictEqual(node.calls.length, 2);
  });

  it("drops a response that arrives after the timeout", async () => {
    const impatient = createAnalysisClient({ dir, now: () => clock, requestTimeoutMs: 20, log: silentLog });
    const track = makeTrack();
    const node = fakeNode(() => new Promise((resolve) => setTimeout(() => resolve(featuresFor(track)), 60)));

    assert.strictEqual(await impatient.getFeatures(track, node), null);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.strictEqual(await impatient.peek(track), null);
    assert.ok(!fs.existsSync(cacheFileOf(track)));
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
    assert.strictEqual(await fresh.peek(track), null);
    assert.strictEqual(node.calls.length, 1);
  });

  it("evicts the oldest entry from memory after 32 tracks but still serves it from disk", async () => {
    const tracks = Array.from({ length: 33 }, (_, index) => makeTrack({ identifier: `id${index}` }));
    const node = fakeNode((route, body) => featuresFor(tracks.find((track) => track.track === body.encodedTrack), { tempo: 100 }));
    tracks.forEach((track, index) => { track.track = `ENC${index}`; });
    for (const track of tracks) await client.getFeatures(track, node);
    assert.strictEqual(node.calls.length, 33);

    // Changing the file shows which source answers: memory would still say 100.
    fs.writeFileSync(cacheFileOf(tracks[0]), JSON.stringify(featuresFor(tracks[0], { tempo: 77 })));
    assert.strictEqual((await client.getFeatures(tracks[0], node)).tempo, 77);
    assert.strictEqual(node.calls.length, 33);
  });

  it("keeps a recently read entry when the memory cache is full", async () => {
    const tracks = Array.from({ length: 33 }, (_, index) => makeTrack({ identifier: `id${index}` }));
    for (const track of tracks.slice(0, 32)) {
      await client.getFeatures(track, fakeNode(() => featuresFor(track)));
    }
    await client.getFeatures(tracks[0], fakeNode(() => assert.fail("must not be called")));
    await client.getFeatures(tracks[32], fakeNode(() => featuresFor(tracks[32])));

    fs.rmSync(cacheFileOf(tracks[0]));
    fs.rmSync(cacheFileOf(tracks[1]));
    assert.ok(await client.peek(tracks[0]), "recently read entry survives");
    assert.strictEqual(await client.peek(tracks[1]), null, "least recently used entry is evicted");
  });

  it("treats a disk file with another featuresVersion as a miss and overwrites it", async () => {
    const track = makeTrack();
    fs.mkdirSync(path.dirname(cacheFileOf(track)), { recursive: true });
    fs.writeFileSync(cacheFileOf(track), JSON.stringify(featuresFor(track, { featuresVersion: 1 })));
    assert.strictEqual(await client.peek(track), null);

    const node = fakeNode(() => featuresFor(track, { tempo: 120 }));
    assert.strictEqual((await client.getFeatures(track, node)).tempo, 120);
    assert.strictEqual(node.calls.length, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(cacheFileOf(track), "utf8")).featuresVersion, 4);
  });

  it("treats a response with another featuresVersion as a failure for 10 minutes", async () => {
    const track = makeTrack();
    const node = fakeNode(() => featuresFor(track, { featuresVersion: 1 }));
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.ok(!fs.existsSync(cacheFileOf(track)));
    assert.strictEqual(await client.getFeatures(track, node), null);
    assert.strictEqual(node.calls.length, 1);
    clock += 10 * MINUTE + 1;
    await client.getFeatures(track, node);
    assert.strictEqual(node.calls.length, 2);
  });

  it("blocks mismatched and missing audio for 10 minutes and warns", async () => {
    const warnings = [];
    const recording = createAnalysisClient({
      dir,
      now: () => clock,
      log: { ...silentLog, warning: (...args) => warnings.push(args) },
    });
    const mismatched = makeTrack({ identifier: "mismatch" });
    const missing = makeTrack({ identifier: "missing" });
    const mismatchedNode = fakeNode(() => featuresFor(mismatched, { audio: { identifier: "mismatch", length: 1 } }));
    const missingNode = fakeNode(() => {
      const { audio, ...withoutAudio } = featuresFor(missing);
      return withoutAudio;
    });

    for (const [track, node] of [[mismatched, mismatchedNode], [missing, missingNode]]) {
      assert.strictEqual(await recording.getFeatures(track, node), null);
      assert.strictEqual(await recording.getFeatures(track, node), null);
      assert.strictEqual(node.calls.length, 1);
      clock += 10 * MINUTE + 1;
      await recording.getFeatures(track, node);
      assert.strictEqual(node.calls.length, 2);
    }
    assert.ok(warnings.length >= 2);
    assert.match(warnings[0][0], /does not match/);
    assert.ok(warnings[0].includes("youtube:mismatch:213000"));
  });

  it("falls through to Lavalink on a corrupt cache file and overwrites it", async () => {
    const track = makeTrack();
    fs.mkdirSync(path.dirname(cacheFileOf(track)), { recursive: true });
    fs.writeFileSync(cacheFileOf(track), "{not json");
    const node = fakeNode(() => featuresFor(track, { tempo: 90 }));
    assert.strictEqual((await client.getFeatures(track, node)).tempo, 90);
    assert.strictEqual(node.calls.length, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(cacheFileOf(track), "utf8")).tempo, 90);
  });

  describe("statusOf", () => {
    it("is null when nothing is known, and for tracks without an audio key", () => {
      assert.strictEqual(client.statusOf(makeTrack()), null);
      assert.strictEqual(client.statusOf(makeTrack({ isStream: true })), null);
    });

    it("reports an uncharted track with the plugin's reason, now and from disk", async () => {
      const track = makeTrack();
      await client.getFeatures(track, fakeNode(() => ({ error: "uncharted", reason: "too_long" })));
      assert.deepStrictEqual(client.statusOf(track), { status: "uncharted", reason: "too_long" });

      const fresh = createAnalysisClient({ dir, now: () => clock, log: silentLog });
      assert.deepStrictEqual(fresh.statusOf(track), { status: "uncharted", reason: "too_long" });
    });

    it("reports busy for a 503 and for a timeout until the busy TTL passes", async () => {
      const track = makeTrack();
      await client.getFeatures(track, fakeNode(() => ({ error: "busy" })));
      assert.deepStrictEqual(client.statusOf(track), { status: "busy" });
      clock += 30_000 + 1;
      assert.strictEqual(client.statusOf(track), null);

      const impatient = createAnalysisClient({ dir, now: () => clock, requestTimeoutMs: 10, log: silentLog });
      await impatient.getFeatures(track, fakeNode(() => new Promise(() => {})));
      assert.deepStrictEqual(impatient.statusOf(track), { status: "busy" });
    });

    it("reports failed for other failures until the failure TTL passes", async () => {
      const track = makeTrack();
      await client.getFeatures(track, fakeNode(() => ({ error: "decode_failed" })));
      assert.deepStrictEqual(client.statusOf(track), { status: "failed" });
      clock += 10 * MINUTE;
      assert.deepStrictEqual(client.statusOf(track), { status: "failed" });
      clock += 1;
      assert.strictEqual(client.statusOf(track), null);
    });

    it("is null for a track whose features are cached", async () => {
      const track = makeTrack();
      await client.getFeatures(track, fakeNode(() => featuresFor(track)));
      assert.strictEqual(client.statusOf(track), null);
    });

    it("does not read a features file from disk", async () => {
      const track = makeTrack();
      await client.getFeatures(track, fakeNode(() => featuresFor(track, { padding: "x".repeat(10_000) })));
      const fresh = createAnalysisClient({ dir, now: () => clock, log: silentLog });
      const reads = mock.method(fs, "readFileSync", fs.readFileSync);
      try {
        assert.strictEqual(fresh.statusOf(track), null);
        assert.strictEqual(reads.mock.calls.length, 0);
      } finally {
        reads.mock.restore();
      }
    });
  });

  describe("peek", () => {
    it("returns null when nothing is cached", async () => {
      assert.strictEqual(await client.peek(makeTrack()), null);
    });

    it("returns features already in memory", async () => {
      const track = makeTrack();
      const features = await client.getFeatures(track, fakeNode(() => featuresFor(track)));
      assert.strictEqual(await client.peek(track), features);
    });

    it("returns features that are only on disk", async () => {
      const track = makeTrack();
      await client.getFeatures(track, fakeNode(() => featuresFor(track, { tempo: 140 })));
      const fresh = createAnalysisClient({ dir, now: () => clock, log: silentLog });
      assert.strictEqual((await fresh.peek(track)).tempo, 140);
    });

    it("returns null for a negative-cached track", async () => {
      const track = makeTrack();
      await client.getFeatures(track, fakeNode(() => null));
      assert.strictEqual(await client.peek(track), null);
    });

    it("reads the features file without blocking", async () => {
      const track = makeTrack();
      await client.getFeatures(track, fakeNode(() => featuresFor(track, { tempo: 140 })));
      const fresh = createAnalysisClient({ dir, now: () => clock, log: silentLog });
      const reads = mock.method(fs, "readFileSync", fs.readFileSync);
      try {
        assert.strictEqual((await fresh.peek(track)).tempo, 140);
        assert.strictEqual(reads.mock.calls.length, 0);
      } finally {
        reads.mock.restore();
      }
    });

    it("returns null for a corrupt cache file", async () => {
      const track = makeTrack();
      fs.mkdirSync(path.dirname(cacheFileOf(track)), { recursive: true });
      fs.writeFileSync(cacheFileOf(track), "{not json");
      assert.strictEqual(await client.peek(track), null);
    });
  });
});
