const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { melodyFileOf } = require("../../../scripts/mewbeat-melody/build");
const { audioKeyFile } = require("../../../helpers/mewbeat/audioKey");
const { createMelodyDecoder, runDocker, runService } = require("../../../helpers/mewbeat/melodyDecoder");
const fixture = require("./fixtures/melody-export.json");

const KEY = "youtube:abc123:180000";
const OTHER = "youtube:other:90000";
const track = { track: "ENCODED", info: { sourceName: "youtube", identifier: "abc123", length: 180000 } };
const decoded = { ...fixture.decoded, short: fixture.short };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeLog() {
  const warnings = [];
  return { warnings, warning: (...args) => warnings.push(args) };
}

// An audio store that never touches the disk; `calls` are the keys it was asked for.
function fakeAudio() {
  const calls = [];
  return { calls, get: async (key) => { calls.push(key); return `/audio/${audioKeyFile(key)}.ogg`; } };
}

function fakeRun(result = decoded) {
  const run = async (args) => {
    run.calls.push(args);
    run.active += 1;
    run.peak = Math.max(run.peak, run.active);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      return typeof result === "function" ? await result(args) : result;
    } finally {
      run.active -= 1;
    }
  };
  Object.assign(run, { calls: [], active: 0, peak: 0 });
  return run;
}

describe("mewbeat melody decoder", () => {
  let dir;
  const melodyPath = (key = KEY) => path.join(dir, "melody", `${audioKeyFile(key)}.json`);
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-melody-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("decodes the audio and writes the melody file the export gives", async () => {
    const audio = fakeAudio();
    const run = fakeRun();
    const decoder = createMelodyDecoder({ dir, audio, run, log: fakeLog(), timeoutMs: 1234 });

    assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "decoded");

    assert.deepStrictEqual(audio.calls, [KEY]);
    assert.deepStrictEqual(run.calls, [{ audioFile: `/audio/${audioKeyFile(KEY)}.ogg`, timeoutMs: 1234 }]);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(melodyPath(), "utf8")), melodyFileOf(decoded, fixture.features, fixture.short));
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, "melody")), [`${audioKeyFile(KEY)}.json`]);
    assert.ok(decoder.has(KEY));
  });

  it("leaves a song that has a melody file alone", async () => {
    fs.mkdirSync(path.join(dir, "melody"));
    fs.writeFileSync(melodyPath(), "{}");
    const audio = fakeAudio();
    const run = fakeRun();
    const decoder = createMelodyDecoder({ dir, audio, run, log: fakeLog() });

    assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "present");
    assert.strictEqual(run.calls.length, 0);
    assert.strictEqual(audio.calls.length, 0);
  });

  it("does nothing when it is switched off", async () => {
    const audio = fakeAudio();
    const run = fakeRun();
    const decoder = createMelodyDecoder({ dir, audio, run, log: fakeLog(), enabled: false });

    assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "off");
    assert.strictEqual(run.calls.length, 0);
    assert.strictEqual(audio.calls.length, 0);
    assert.ok(!fs.existsSync(path.join(dir, "melody")));
  });

  it("decodes a key once however many ask, and one key at a time", async () => {
    const gate = deferred();
    const run = fakeRun(() => gate.promise.then(() => decoded));
    const decoder = createMelodyDecoder({ dir, audio: fakeAudio(), run, log: fakeLog() });

    const first = [decoder.ensure(KEY, track, "node", fixture.features), decoder.ensure(KEY, track, "node", fixture.features)];
    const second = decoder.ensure(OTHER, track, "node", fixture.features);
    // The first run starts after a look at the audio file, however long the disk takes; then the others get time to start too.
    for (let waited = 0; run.calls.length === 0 && waited < 5000; waited += 5) await new Promise((resolve) => setTimeout(resolve, 5));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.strictEqual(run.calls.length, 1);
    gate.resolve();

    assert.deepStrictEqual(await Promise.all([...first, second]), ["decoded", "decoded", "decoded"]);
    assert.strictEqual(run.calls.length, 2);
    assert.strictEqual(run.peak, 1);
  });

  it("remembers a failure and does not try the key again", async () => {
    const log = fakeLog();
    const run = fakeRun(() => { throw new Error("exit 1"); });
    const decoder = createMelodyDecoder({ dir, audio: fakeAudio(), run, log });

    assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "failed");
    assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "failed");
    assert.strictEqual(run.calls.length, 1);
    assert.strictEqual(log.warnings.length, 1);
    assert.ok(!decoder.has(KEY));

    run.calls.length = 0;
    assert.strictEqual(await decoder.ensure(OTHER, track, "node", fixture.features), "failed");
    assert.strictEqual(run.calls.length, 1);
  });

  it("fails a key whose audio cannot be fetched, without running the decoder", async () => {
    const run = fakeRun();
    const audio = { get: async () => { throw new Error("no audio"); } };
    const decoder = createMelodyDecoder({ dir, audio, run, log: fakeLog() });

    assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "failed");
    assert.strictEqual(run.calls.length, 0);
  });

  it("warns once and stops trying when Docker or the image is missing", async () => {
    const log = fakeLog();
    const run = fakeRun(() => { throw Object.assign(new Error("no image"), { unavailable: true }); });
    const decoder = createMelodyDecoder({ dir, audio: fakeAudio(), run, log });

    assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "off");
    assert.strictEqual(await decoder.ensure(OTHER, track, "node", fixture.features), "off");
    assert.strictEqual(run.calls.length, 1);
    assert.strictEqual(log.warnings.length, 1);
    assert.strictEqual(decoder.isEnabled(), false);
  });

  it("does not decode a track that is too long", async () => {
    const run = fakeRun();
    const decoder = createMelodyDecoder({ dir, audio: fakeAudio(), run, log: fakeLog() });
    const long = { ...track, info: { ...track.info, length: 3 * 3600 * 1000 } };

    assert.strictEqual(await decoder.ensure(KEY, long, "node", fixture.features), "failed");
    assert.strictEqual(run.calls.length, 0);
  });

  describe("after a failure", () => {
    const MIN = 60_000;
    function clock() {
      const clock = { at: 1_000_000, now: () => clock.at, advance: (ms) => { clock.at += ms; } };
      return clock;
    }

    it("tries a key again after 10 minutes, then after 30, and gives up after the third failure", async () => {
      const time = clock();
      const log = fakeLog();
      const run = fakeRun(() => { throw new Error("exit 1"); });
      const decoder = createMelodyDecoder({ dir, audio: fakeAudio(), run, log, now: time.now });
      const ensure = () => decoder.ensure(KEY, track, "node", fixture.features);

      assert.strictEqual(await ensure(), "failed");
      assert.strictEqual(decoder.wants(KEY), false);
      time.advance(9 * MIN);
      assert.strictEqual(await ensure(), "failed");
      assert.strictEqual(run.calls.length, 1);

      time.advance(1 * MIN);
      assert.strictEqual(decoder.wants(KEY), true);
      assert.strictEqual(await ensure(), "failed");
      assert.strictEqual(run.calls.length, 2);

      time.advance(29 * MIN);
      assert.strictEqual(await ensure(), "failed");
      assert.strictEqual(run.calls.length, 2);
      time.advance(1 * MIN);
      assert.strictEqual(await ensure(), "failed");
      assert.strictEqual(run.calls.length, 3);

      time.advance(1000 * MIN);
      assert.strictEqual(decoder.wants(KEY), false);
      assert.strictEqual(await ensure(), "failed");
      assert.strictEqual(run.calls.length, 3);
      assert.strictEqual(log.warnings.length, 3);
    });

    it("decodes the key on a retry that succeeds and forgets the failure", async () => {
      const time = clock();
      let fail = true;
      const run = fakeRun(() => { if (fail) throw new Error("exit 1"); return decoded; });
      const decoder = createMelodyDecoder({ dir, audio: fakeAudio(), run, log: fakeLog(), now: time.now });

      assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "failed");
      fail = false;
      time.advance(10 * MIN);
      assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "decoded");
      assert.ok(decoder.has(KEY));
    });

    it("keeps a failure that comes from the audio for good", async () => {
      const time = clock();
      const run = fakeRun(() => { throw Object.assign(new Error("the audio cannot be decoded"), { permanent: true }); });
      const decoder = createMelodyDecoder({ dir, audio: fakeAudio(), run, log: fakeLog(), now: time.now });

      assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "failed");
      time.advance(1000 * MIN);
      assert.strictEqual(decoder.wants(KEY), false);
      assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "failed");
      assert.strictEqual(run.calls.length, 1);
    });

    it("tries every key on its own", async () => {
      const run = fakeRun(({ audioFile }) => { if (audioFile.includes(audioKeyFile(KEY))) throw new Error("exit 1"); return decoded; });
      const decoder = createMelodyDecoder({ dir, audio: fakeAudio(), run, log: fakeLog() });

      assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "failed");
      assert.strictEqual(await decoder.ensure(OTHER, track, "node", fixture.features), "decoded");
    });
  });

  describe("when the decoder cannot be reached", () => {
    const unreachable = () => { throw Object.assign(new Error("connection refused"), { unavailable: true }); };

    it("asks again after a few minutes instead of staying off until a restart", async () => {
      let at = 5_000_000;
      let up = false;
      const log = fakeLog();
      const run = fakeRun(() => (up ? decoded : unreachable()));
      const decoder = createMelodyDecoder({ dir, audio: fakeAudio(), run, log, now: () => at });

      assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "off");
      assert.strictEqual(decoder.isEnabled(), false);
      at += 4 * 60_000;
      assert.strictEqual(await decoder.ensure(OTHER, track, "node", fixture.features), "off");
      assert.strictEqual(run.calls.length, 1);

      at += 61_000;
      assert.strictEqual(decoder.isEnabled(), true);
      assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "off");
      assert.strictEqual(run.calls.length, 2);
      assert.strictEqual(log.warnings.length, 1, "one warning for one outage");

      at += 5 * 60_000;
      up = true;
      assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "decoded");
      assert.strictEqual(decoder.isEnabled(), true);

      up = false;
      at += 5 * 60_000;
      assert.strictEqual(await decoder.ensure(OTHER, track, "node", fixture.features), "off");
      assert.strictEqual(log.warnings.length, 2, "a new outage warns again");
    });

    it("does not count an unreachable decoder against the key", async () => {
      let at = 9_000_000;
      let up = false;
      const run = fakeRun(() => (up ? decoded : unreachable()));
      const decoder = createMelodyDecoder({ dir, audio: fakeAudio(), run, log: fakeLog(), now: () => at });

      assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "off");
      up = true;
      at += 6 * 60_000;
      assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "decoded");
    });
  });

  describe("audio that is too short", () => {
    it("skips a stub file without running the decoder or counting a failure", async () => {
      const stub = path.join(dir, "stub.ogg");
      fs.writeFileSync(stub, Buffer.alloc(185));
      const log = fakeLog();
      const run = fakeRun();
      const decoder = createMelodyDecoder({ dir, audio: { get: async () => stub }, run, log });

      assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "short");
      assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "short");
      assert.strictEqual(run.calls.length, 0);
      assert.strictEqual(log.warnings.length, 0);
      assert.strictEqual(decoder.wants(KEY), false);
      assert.strictEqual(decoder.isEnabled(), true);
      assert.ok(!decoder.has(KEY));
    });

    it("skips a track that is only moments long, before fetching its audio", async () => {
      const audio = fakeAudio();
      const run = fakeRun();
      const decoder = createMelodyDecoder({ dir, audio, run, log: fakeLog() });
      const blip = { ...track, info: { ...track.info, length: 900 } };

      assert.strictEqual(await decoder.ensure(KEY, blip, "node", fixture.features), "short");
      assert.strictEqual(audio.calls.length, 0);
      assert.strictEqual(run.calls.length, 0);
    });

    it("decodes audio above the minimum", async () => {
      const real = path.join(dir, "real.ogg");
      fs.writeFileSync(real, Buffer.alloc(50_000));
      const run = fakeRun();
      const decoder = createMelodyDecoder({ dir, audio: { get: async () => real }, run, log: fakeLog() });

      assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "decoded");
      assert.strictEqual(run.calls.length, 1);
    });
  });
});

describe("mewbeat melody decoder service client", () => {
  let dir;
  let server;
  let url;
  let audioFile;
  const received = [];

  // Starts a server that answers every POST /decode with `answer(request, body)` -> { status, body, headers } or a function that
  // takes the response itself.
  async function serve(answer) {
    server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        received.push({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks) });
        const result = answer(request, response);
        if (!result) return;
        response.writeHead(result.status, { "Content-Type": "application/json" });
        response.end(typeof result.body === "string" ? result.body : JSON.stringify(result.body));
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-service-"));
    audioFile = path.join(dir, "song.ogg");
    fs.writeFileSync(audioFile, Buffer.from("OggS-test-bytes"));
    received.length = 0;
  });
  afterEach(async () => {
    if (server) await new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); });
    server = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("posts the bytes of the file and returns the JSON the service answers", async () => {
    await serve(() => ({ status: 200, body: decoded }));

    assert.deepStrictEqual(await runService({ audioFile, url, timeoutMs: 5000 }), decoded);

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].method, "POST");
    assert.strictEqual(received[0].url, "/decode");
    assert.strictEqual(received[0].headers["x-timeout-ms"], "5000");
    assert.deepStrictEqual(received[0].body, Buffer.from("OggS-test-bytes"));
  });

  it("calls audio the service cannot read a permanent failure", async () => {
    await serve(() => ({ status: 400, body: { error: "the audio cannot be decoded: malformed", permanent: true } }));

    await assert.rejects(runService({ audioFile, url }), (error) => error.permanent === true && !error.unavailable && /400/.test(error.message));
  });

  it("calls a busy service a failure that may pass", async () => {
    await serve(() => ({ status: 503, body: { error: "the queue is full", permanent: false } }));

    await assert.rejects(runService({ audioFile, url }), (error) => !error.permanent && !error.unavailable && /503/.test(error.message));
  });

  it("calls an answer that is not JSON a failure that may pass", async () => {
    await serve(() => ({ status: 502, body: "<html>bad gateway</html>" }));

    await assert.rejects(runService({ audioFile, url }), (error) => !error.permanent && !error.unavailable && /502/.test(error.message));
  });

  it("calls a service nobody answers for unavailable", async () => {
    await serve(() => ({ status: 200, body: decoded }));
    const closed = url;
    await new Promise((resolve) => server.close(resolve));
    server = null;

    await assert.rejects(runService({ audioFile, url: closed }), (error) => error.unavailable === true);
  });

  it("calls a connection that is cut mid-decode a failure that may pass, not an outage", async () => {
    await serve((request, response) => { response.destroy(); return null; });

    await assert.rejects(runService({ audioFile, url }), (error) => !error.unavailable && !error.permanent);
  });

  it("gives up on a service that does not answer in time", async () => {
    await serve(() => null);

    await assert.rejects(runService({ audioFile, url, timeoutMs: 60 }), (error) => /did not answer/.test(error.message) && !error.unavailable);
  });

  it("is what the decoder uses when MEWBEAT_DECODER_URL is set", async () => {
    await serve(() => ({ status: 200, body: decoded }));
    const earlier = process.env.MEWBEAT_DECODER_URL;
    process.env.MEWBEAT_DECODER_URL = url;
    try {
      const decoder = createMelodyDecoder({ dir, audio: { get: async () => audioFile }, log: fakeLog(), timeoutMs: 5000 });
      // the stand-in audio is a few bytes: the size check is for real files
      fs.writeFileSync(audioFile, Buffer.alloc(8000));
      assert.strictEqual(await decoder.ensure(KEY, track, "node", fixture.features), "decoded");
      assert.strictEqual(received.length, 1);
      assert.ok(fs.existsSync(path.join(dir, "melody", `${audioKeyFile(KEY)}.json`)));
    } finally {
      if (earlier === undefined) delete process.env.MEWBEAT_DECODER_URL;
      else process.env.MEWBEAT_DECODER_URL = earlier;
    }
  });
});

describe("mewbeat melody decoder docker run", () => {
  // A stand-in for child_process.spawn: `docker run` hangs until it is killed, `docker rm` is recorded.
  function fakeSpawn({ removeAnswers = true } = {}) {
    const calls = [];
    const spawnFn = (command, args) => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      calls.push({ command, args, child });
      if (args[0] === "rm") {
        if (removeAnswers) setImmediate(() => child.emit("close", 0));
      } else {
        child.kill = () => setImmediate(() => child.emit("close", null));
      }
      return child;
    };
    spawnFn.calls = calls;
    return spawnFn;
  }

  it("removes the container by name when the run outlasts its timeout", async () => {
    const spawnFn = fakeSpawn();

    await assert.rejects(runDocker({ audioFile: path.join(os.tmpdir(), "x.ogg"), timeoutMs: 30, spawnFn }), /ran past 30 ms/);

    const run = spawnFn.calls.find((call) => call.args[0] === "run");
    const name = run.args[run.args.indexOf("--name") + 1];
    assert.match(name, /^mewbeat-decode-/);
    const removals = spawnFn.calls.filter((call) => call.args[0] === "rm");
    assert.ok(removals.length >= 1);
    for (const removal of removals) assert.deepStrictEqual(removal.args, ["rm", "-f", name]);
  });

  it("still fails when docker rm itself does not answer", async () => {
    const spawnFn = fakeSpawn({ removeAnswers: false });
    // the removal is waited for, but not for ever: the stand-in answers its second call late
    const started = Date.now();
    const result = runDocker({ audioFile: path.join(os.tmpdir(), "x.ogg"), timeoutMs: 20, spawnFn });
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const call of spawnFn.calls) if (call.args[0] === "rm") call.child.emit("error", new Error("spawn docker ENOENT"));

    await assert.rejects(result, /ran past 20 ms/);
    assert.ok(Date.now() - started < 5000);
  });

  it("calls a missing docker unavailable", async () => {
    const spawnFn = () => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => child.emit("error", Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" })));
      return child;
    };

    await assert.rejects(runDocker({ audioFile: path.join(os.tmpdir(), "x.ogg"), spawnFn }), (error) => error.unavailable === true);
  });
});
