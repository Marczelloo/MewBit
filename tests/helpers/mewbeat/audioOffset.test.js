const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { audioKeyFile } = require("../../../helpers/mewbeat/audioKey");
const { MIN_CONFIDENCE, bandsOf, createAudioOffset, runOffsetService } = require("../../../helpers/mewbeat/audioOffset");

const KEY = "youtube:abc:200000";
const STEM = audioKeyFile(KEY);

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-offset-test-"));
  fs.mkdirSync(path.join(dir, "audio"));
  fs.mkdirSync(path.join(dir, "features"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const audioFile = () => path.join(dir, "audio", `${STEM}.ogg`);
const featuresFile = () => path.join(dir, "features", `${STEM}.json`);
const recordFile = () => path.join(dir, "offset", `${STEM}.json`);

function writeAudio(fill = 1, size = 9000) {
  fs.writeFileSync(audioFile(), Buffer.alloc(size, fill));
}

function writeFeatures(extra = "") {
  const onsets = (name) => Array.from({ length: 30 }, (_, i) => ({ t: 500 + i * 400, s: 0.5 }));
  const bands = ["low", "lowmid", "highmid", "high"].map((name) => ({ name, onsets: onsets(name) }));
  fs.writeFileSync(featuresFile(), JSON.stringify({ featuresVersion: 4, bands, pad: "x".repeat(5000), extra }));
}

function setup({ answer = { offsetMs: 20, confidence: 0.9, peak: 0.9, margin: 0.4, onsets: 120, windowS: 40 }, ...options } = {}) {
  const calls = [];
  const warnings = [];
  let clock = 1_000_000;
  const audioOffset = createAudioOffset({
    dir,
    url: "http://decoder.invalid",
    run: async (request) => {
      calls.push(request);
      if (typeof answer === "function") return answer(request, calls.length);
      return answer;
    },
    log: { info() {}, warning: (...args) => warnings.push(args.join(" ")) },
    now: () => clock,
    ...options,
  });
  return { audioOffset, calls, warnings, advance: (ms) => { clock += ms; } };
}

describe("audio offset: the switch", () => {
  it("does nothing without a decoder service: null offsets, no request, no file, no warning", async () => {
    writeAudio();
    writeFeatures();
    const calls = [];
    const warnings = [];
    const audioOffset = createAudioOffset({ dir, url: undefined, run: async (r) => { calls.push(r); return {}; }, log: { info() {}, warning: (...a) => warnings.push(a) } });
    assert.strictEqual(audioOffset.configured(), false);
    assert.strictEqual(await audioOffset.lookup(KEY), null);
    assert.strictEqual((await audioOffset.ensure(KEY)).status, "off");
    assert.strictEqual(await audioOffset.peek(KEY), null);
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(fs.existsSync(path.join(dir, "offset")), false);
    assert.deepStrictEqual(warnings, []);
  });
});

describe("audio offset: measuring and the store", () => {
  it("measures once, stores the record next to the other mewbeat data, and answers from it afterwards", async () => {
    writeAudio();
    writeFeatures();
    const { audioOffset, calls } = setup();
    assert.strictEqual(await audioOffset.lookup(KEY), 20, "the service's number comes through unchanged (sign included)");
    assert.strictEqual(calls.length, 1);
    assert.ok(fs.existsSync(recordFile()), "the record is offset/<audio key file>.json");
    assert.strictEqual(await audioOffset.lookup(KEY), 20);
    assert.strictEqual((await audioOffset.ensure(KEY)).status, "present");
    assert.strictEqual(calls.length, 1, "the stored record answers: no second request");
    assert.deepStrictEqual(await audioOffset.peek(KEY), { offsetMs: 20, confidence: 0.9 });
  });

  it("keeps a negative offset negative", async () => {
    writeAudio();
    writeFeatures();
    const { audioOffset } = setup({ answer: { offsetMs: -40, confidence: 0.95, peak: 0.95, margin: 0.5, onsets: 100, windowS: 40 } });
    assert.strictEqual(await audioOffset.lookup(KEY), -40);
  });

  it("sends the audio bytes and the onsets of the four bands", async () => {
    writeAudio(7, 9000);
    writeFeatures();
    const { audioOffset, calls } = setup();
    await audioOffset.lookup(KEY);
    assert.strictEqual(calls[0].audio.length, 9000);
    assert.deepStrictEqual(Object.keys(calls[0].bands), ["low", "lowmid", "highmid", "high"]);
    assert.deepStrictEqual(calls[0].bands.low[0], [500, 0.5]);
    assert.strictEqual(calls[0].minConfidence, MIN_CONFIDENCE);
  });

  it("a confidence below the threshold is an unknown offset (null), stored with its raw estimate and not measured again", async () => {
    writeAudio();
    writeFeatures();
    const { audioOffset, calls } = setup({ answer: { offsetMs: 46, confidence: 0.41, peak: 0.41, margin: 0.14, onsets: 3000, windowS: 90 } });
    assert.strictEqual(await audioOffset.lookup(KEY), null);
    assert.strictEqual(await audioOffset.lookup(KEY), null);
    assert.strictEqual(calls.length, 1);
    const record = JSON.parse(fs.readFileSync(recordFile(), "utf8"));
    assert.strictEqual(record.rawOffsetMs, 46);
    assert.strictEqual(record.confidence, 0.41);
  });

  it("the threshold applies when a record is read: a lower one lets the stored estimate through without measuring again", async () => {
    writeAudio();
    writeFeatures();
    const first = setup({ answer: { offsetMs: 46, confidence: 0.41, peak: 0.41, margin: 0.14, onsets: 3000, windowS: 90 } });
    assert.strictEqual(await first.audioOffset.lookup(KEY), null);
    const second = setup({ minConfidence: 0.4 });
    assert.strictEqual(await second.audioOffset.lookup(KEY), 46);
    assert.strictEqual(second.calls.length, 0);
  });

  it("a song the service could not measure (too few onsets: nulls) is unknown", async () => {
    writeAudio();
    writeFeatures();
    const { audioOffset } = setup({ answer: { offsetMs: null, confidence: null, peak: null, margin: null, onsets: 10, windowS: 90 } });
    assert.strictEqual(await audioOffset.lookup(KEY), null);
  });
});

describe("audio offset: a record is tied to the files it was measured from", () => {
  async function measured() {
    writeAudio(1);
    writeFeatures();
    const state = setup();
    await state.audioOffset.lookup(KEY);
    assert.strictEqual(state.calls.length, 1);
    return state;
  }

  it("a re-rendered audio file (other bytes) makes the record stale and it is measured again", async () => {
    const { audioOffset, calls } = await measured();
    writeAudio(2); // same size, other content
    assert.strictEqual(await audioOffset.peek(KEY), null);
    await audioOffset.lookup(KEY);
    assert.strictEqual(calls.length, 2);
  });

  it("an audio file of another size makes it stale", async () => {
    const { audioOffset, calls } = await measured();
    writeAudio(1, 9001);
    await audioOffset.lookup(KEY);
    assert.strictEqual(calls.length, 2);
  });

  it("an edit in the middle of a large file is not seen, but its size and ends are", async () => {
    writeAudio(1, 300_000);
    writeFeatures();
    const { audioOffset, calls } = setup();
    await audioOffset.lookup(KEY);
    const bytes = fs.readFileSync(audioFile());
    bytes[150_000] = 9;
    fs.writeFileSync(audioFile(), bytes);
    assert.notStrictEqual(await audioOffset.peek(KEY), null, "documented limit: size plus the first and last 64 KB");
    bytes[10] = 9;
    fs.writeFileSync(audioFile(), bytes);
    assert.strictEqual(await audioOffset.peek(KEY), null);
    await audioOffset.lookup(KEY);
    assert.strictEqual(calls.length, 2);
  });

  it("new features (a file written again) make it stale", async () => {
    const { audioOffset, calls } = await measured();
    await new Promise((resolve) => setTimeout(resolve, 15));
    writeFeatures("again");
    assert.strictEqual(await audioOffset.peek(KEY), null);
    await audioOffset.lookup(KEY);
    assert.strictEqual(calls.length, 2);
  });

  it("the audio store touching the file's mtime (every use does) does not make it stale", async () => {
    const { audioOffset, calls } = await measured();
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(audioFile(), later, later);
    assert.notStrictEqual(await audioOffset.peek(KEY), null);
    await audioOffset.lookup(KEY);
    assert.strictEqual(calls.length, 1);
  });

  it("a record of another version, or a corrupt one, is measured again", async () => {
    const { audioOffset, calls } = await measured();
    const record = JSON.parse(fs.readFileSync(recordFile(), "utf8"));
    fs.writeFileSync(recordFile(), JSON.stringify({ ...record, version: 999 }));
    await audioOffset.lookup(KEY);
    assert.strictEqual(calls.length, 2);
    fs.writeFileSync(recordFile(), "{not json");
    await audioOffset.lookup(KEY);
    assert.strictEqual(calls.length, 3);
  });

  it("an audio file that is gone (evicted) means unknown, whatever was stored", async () => {
    const { audioOffset } = await measured();
    fs.rmSync(audioFile());
    assert.strictEqual(await audioOffset.lookup(KEY), null);
    assert.strictEqual((await audioOffset.ensure(KEY)).status, "no_audio");
  });
});

describe("audio offset: nothing to measure, a service that is down, and failures", () => {
  it("a song without audio or without features is not measured and not a failure", async () => {
    const { audioOffset, calls, warnings } = setup();
    assert.strictEqual((await audioOffset.ensure(KEY)).status, "no_audio");
    writeAudio();
    assert.strictEqual((await audioOffset.ensure(KEY)).status, "no_features");
    fs.writeFileSync(featuresFile(), JSON.stringify({ uncharted: true, reason: "x" })); // a marker is small
    assert.strictEqual((await audioOffset.ensure(KEY)).status, "no_features");
    assert.strictEqual(calls.length, 0);
    assert.deepStrictEqual(warnings, []);
  });

  it("a stub audio file is not sent", async () => {
    fs.writeFileSync(audioFile(), Buffer.alloc(185));
    writeFeatures();
    const { audioOffset, calls } = setup();
    assert.strictEqual(await audioOffset.lookup(KEY), null);
    assert.strictEqual(calls.length, 0);
  });

  it("a service nobody answers for gives null, warns once, and is not asked again until the re-probe time", async () => {
    writeAudio();
    writeFeatures();
    const { audioOffset, calls, warnings, advance } = setup({
      answer: () => { throw Object.assign(new Error("the decoder service is unreachable: ECONNREFUSED"), { unavailable: true }); },
    });
    assert.strictEqual(await audioOffset.lookup(KEY), null);
    assert.strictEqual(await audioOffset.lookup(KEY), null);
    assert.strictEqual((await audioOffset.ensure(KEY)).status, "off");
    assert.strictEqual(calls.length, 1, "no second request inside the outage window");
    assert.strictEqual(warnings.length, 1, "one warning");
    advance(5 * 60_000 + 1);
    await audioOffset.lookup(KEY);
    assert.strictEqual(calls.length, 2, "probed again after the window");
    assert.strictEqual(warnings.length, 1, "and still one warning");
  });

  it("a song's own failure (400) is final; a transient one is retried after its back-off, three times at most", async () => {
    writeAudio();
    writeFeatures();
    const permanent = setup({ answer: () => { throw Object.assign(new Error("the decoder service answered 400: bad"), { permanent: true }); } });
    assert.strictEqual(await permanent.audioOffset.lookup(KEY), null);
    permanent.advance(24 * 60 * 60_000);
    assert.strictEqual(await permanent.audioOffset.lookup(KEY), null);
    assert.strictEqual(permanent.calls.length, 1);

    const transient = setup({ answer: () => { throw new Error("the decoder service answered 500: boom"); } });
    await transient.audioOffset.lookup(KEY);
    await transient.audioOffset.lookup(KEY);
    assert.strictEqual(transient.calls.length, 1, "inside the back-off");
    transient.advance(10 * 60_000 + 1);
    await transient.audioOffset.lookup(KEY);
    transient.advance(30 * 60_000 + 1);
    await transient.audioOffset.lookup(KEY);
    transient.advance(24 * 60 * 60_000);
    await transient.audioOffset.lookup(KEY);
    assert.strictEqual(transient.calls.length, 3, "the third failure is final");
  });

  it("lookup never rejects, whatever the service does", async () => {
    writeAudio();
    writeFeatures();
    const { audioOffset } = setup({ answer: () => { throw new TypeError("weird"); } });
    assert.strictEqual(await audioOffset.lookup(KEY), null);
  });
});

describe("audio offset: the wait is bounded", () => {
  it("lookup answers null after waitMs while the measurement runs on; the next play has the value", async () => {
    writeAudio();
    writeFeatures();
    let release;
    const gateOpen = new Promise((resolve) => { release = resolve; });
    const { audioOffset } = setup({
      answer: async () => {
        await gateOpen;
        return { offsetMs: 20, confidence: 0.9, peak: 0.9, margin: 0.4, onsets: 100, windowS: 40 };
      },
    });
    const started = Date.now();
    assert.strictEqual(await audioOffset.lookup(KEY, { waitMs: 40 }), null);
    assert.ok(Date.now() - started < 1000, "it did not wait for the measurement");
    release();
    // The measurement ends on its own (file reads and the record write take as long as the machine is busy), so ask again until it has.
    let later = null;
    for (let tries = 0; tries < 100 && later === null; tries += 1) {
      later = await audioOffset.lookup(KEY, { waitMs: 40 });
    }
    assert.strictEqual(later, 20);
  });

  it("two lookups for one song share one measurement", async () => {
    writeAudio();
    writeFeatures();
    const { audioOffset, calls } = setup({ answer: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return { offsetMs: 0, confidence: 0.9, peak: 0.9, margin: 0.4, onsets: 100, windowS: 40 }; } });
    const [a, b] = await Promise.all([audioOffset.lookup(KEY), audioOffset.lookup(KEY)]);
    assert.deepStrictEqual([a, b], [0, 0]);
    assert.strictEqual(calls.length, 1);
  });
});

describe("audio offset: the request to the service", () => {
  it("bandsOf lists the four bands in order, empty when one is missing", () => {
    const bands = bandsOf({ bands: [{ name: "high", onsets: [{ t: 5, s: 0.5 }] }, { name: "low", onsets: [{ t: 1, s: 0.25 }] }] });
    assert.deepStrictEqual(bands, { low: [[1, 0.25]], lowmid: [], highmid: [], high: [[5, 0.5]] });
  });

  async function withServer(handler, test) {
    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await test(`http://127.0.0.1:${server.address().port}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it("POSTs /offset as a 4-byte length, the JSON, then the audio, and returns the answer", async () => {
    let seen;
    await withServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        seen = { method: request.method, url: request.url, body: Buffer.concat(chunks), timeout: request.headers["x-timeout-ms"] };
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ offsetMs: -20, confidence: 0.93 }));
      });
    }, async (url) => {
      const audio = Buffer.from("OggS-pretend-audio");
      const answer = await runOffsetService({ audio, bands: { low: [[1, 0.5]], lowmid: [], highmid: [], high: [] }, minConfidence: 0.6, timeoutMs: 5000, url });
      assert.deepStrictEqual(answer, { offsetMs: -20, confidence: 0.93 });
    });
    assert.strictEqual(seen.method, "POST");
    assert.strictEqual(seen.url, "/offset");
    assert.strictEqual(seen.timeout, "5000");
    const headLength = seen.body.readUInt32BE(0);
    const head = JSON.parse(seen.body.subarray(4, 4 + headLength).toString("utf8"));
    assert.deepStrictEqual(head.bands.low, [[1, 0.5]]);
    assert.strictEqual(head.minConfidence, 0.6);
    assert.strictEqual(seen.body.subarray(4 + headLength).toString(), "OggS-pretend-audio");
  });

  it("a 400 is permanent, a 503 is not, and a closed port is unavailable", async () => {
    await withServer((request, response) => {
      request.resume();
      request.on("end", () => {
        const bad = request.headers["x-timeout-ms"] === "4000";
        response.statusCode = bad ? 400 : 503;
        response.end(JSON.stringify({ error: "nope", permanent: bad }));
      });
    }, async (url) => {
      await assert.rejects(runOffsetService({ audio: Buffer.alloc(8), bands: {}, timeoutMs: 4000, url }), (error) => error.permanent === true);
      await assert.rejects(runOffsetService({ audio: Buffer.alloc(8), bands: {}, timeoutMs: 5000, url }), (error) => !error.permanent && !error.unavailable);
    });
    const closed = http.createServer();
    await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = closed.address().port;
    await new Promise((resolve) => closed.close(resolve));
    await assert.rejects(runOffsetService({ audio: Buffer.alloc(8), bands: {}, url: `http://127.0.0.1:${port}` }), (error) => error.unavailable === true);
  });

  it("an older decoder service without /offset (404) is unavailable, not a final verdict on the song", async () => {
    await withServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "not found", permanent: true }));
      });
    }, async (url) => {
      await assert.rejects(runOffsetService({ audio: Buffer.alloc(8), bands: {}, url }), (error) => error.unavailable === true && !error.permanent);
    });
  });
});
