const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, afterEach, beforeEach, describe, it } = require("node:test");

const { createMewbeatChannel } = require("../../../helpers/mewbeat/activityChannel");
const { createAnalysisClient } = require("../../../helpers/mewbeat/analysisClient");
const { audioKeyOf } = require("../../../helpers/mewbeat/audioKey");
const { createChartStore } = require("../../../helpers/mewbeat/chartStore");
const { generateAll } = require("../../../helpers/mewbeat/charts/generate");
const { createLiveBoard, PUSH_INTERVAL_MS } = require("../../../helpers/mewbeat/liveBoard");
const { createMelodyDecoder } = require("../../../helpers/mewbeat/melodyDecoder");
const { createPriorityGate } = require("../../../helpers/mewbeat/priorityGate");
const { createSoloTracks } = require("../../../helpers/mewbeat/soloTracks");
const { makeFeatures } = require("./fixtures");
const fixture = require("./fixtures/melody-export.json");

// Several servers at once on the real chart store, analysis client, melody decoder and generator gate. Only what is slow or
// outside the bot is replaced: the Lavalink plugin (a fake node that answers when the test says so, or "busy"), the decoder
// process, the audio render and the generator itself. Stages are released by the test, never by a sleep.

const quietLog = { warning() {} };
const decoded = { ...fixture.decoded, short: fixture.short };
const LENGTH = 180000;
const FEATURES = makeFeatures({ durationMs: LENGTH });
let charts = null;

const trackOf = (n) => ({ track: `song${n}`, info: { sourceName: "youtube", identifier: `song${n}`, length: LENGTH, isStream: false } });
const idOf = (n) => `song${n}`;

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function waitFor(condition, what = "a condition", timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await tick();
  }
}

// A request that neither answers nor fails is the bug this suite is about: it must settle.
function settles(promise, what = "a request", timeoutMs = 15000) {
  let timer;
  const hang = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle`)), timeoutMs);
  });
  return Promise.race([promise, hang]).finally(() => clearTimeout(timer));
}

// One step of the pipeline: records who entered it and in which order, how many run at once, and either answers at once (a
// tick later) or holds each job until release(id).
function createStage({ manual = false } = {}) {
  const stage = { order: [], running: 0, maxRunning: 0, waiting: new Map() };
  stage.work = async (id, produce) => {
    stage.order.push(id);
    stage.running += 1;
    stage.maxRunning = Math.max(stage.maxRunning, stage.running);
    try {
      if (manual) await new Promise((resolve) => stage.waiting.set(id, resolve));
      else await tick();
      return produce();
    } finally {
      stage.running -= 1;
    }
  };
  stage.release = async (id) => {
    await waitFor(() => stage.waiting.has(id), `${id} to reach the stage`);
    const resolve = stage.waiting.get(id);
    stage.waiting.delete(id);
    resolve();
  };
  // Releases whichever jobs arrive next, `count` of them, for the jobs whose mutual order is not what a test is about.
  stage.releaseAny = async (count) => {
    for (let released = 0; released < count; released++) {
      await waitFor(() => stage.waiting.size > 0, "a job to reach the stage");
      const [id, resolve] = stage.waiting.entries().next().value;
      stage.waiting.delete(id);
      resolve();
    }
  };
  stage.holds = (id) => stage.waiting.has(id);
  return stage;
}

// Asks for the songs one after another, each only once the one before is in its line, so "the order they were asked" is a
// fact of the test and not a race between the disk reads that come first.
async function askInOrder(world, numbers, options) {
  const asked = [];
  for (const n of numbers) {
    let settled = false;
    const request = world.store.getCharts(trackOf(n), world.node, options);
    request.then(() => { settled = true; }, () => { settled = true; });
    asked.push(request);
    await waitFor(() => settled || world.store.queueOf(trackOf(n)) !== null, `song ${n} to join the line`);
  }
  return asked;
}

// Builds the bot's own pieces around fakes. `stages` say which steps hold their jobs; busy is how many calls the plugin
// answers "busy" before it works normally (another bot or the debugger using it).
function createWorld(dir, { analysisManual = false, decodeManual = false, generateManual = false, busy = 0, node = undefined, melody = true, melodyWaitMs, storeOptions = {}, analysisOptions = {}, runDecoder = null, generateOverride = null } = {}) {
  const analysisStage = createStage({ manual: analysisManual });
  const decodeStage = createStage({ manual: decodeManual });
  const generateStage = createStage({ manual: generateManual });
  const clock = { t: 1_000_000 };
  const plugin = { busyLeft: busy, busyAnswers: 0, calls: 0 };
  const fakeNode = node !== undefined ? node : {
    rest: {
      post: async (route, { encodedTrack }) => {
        plugin.calls += 1;
        if (plugin.busyLeft > 0) {
          plugin.busyLeft -= 1;
          plugin.busyAnswers += 1;
          return { error: "busy" };
        }
        return analysisStage.work(encodedTrack, () => ({ ...FEATURES, featuresVersion: 4, audio: { sourceName: "youtube", identifier: encodedTrack, length: LENGTH } }));
      },
    },
  };
  const analysis = createAnalysisClient({ dir, now: () => clock.t, log: quietLog, busyRetryMs: 1, busyRetries: 50, ...analysisOptions });

  const audioCalls = [];
  const audio = {
    get: async (key, track, nodeArg, { priority } = {}) => {
      audioCalls.push({ id: track.track, priority });
      const file = path.join(dir, `${track.track}.ogg`);
      fs.writeFileSync(file, Buffer.alloc(5000));
      return file;
    },
  };
  const run = runDecoder ?? (async ({ audioFile }) => decodeStage.work(path.basename(audioFile, ".ogg"), () => decoded));
  const decoder = melody ? createMelodyDecoder({ dir, audio, run, log: quietLog }) : null;

  // The generator waits in a gate of its own, as chartRunner's does.
  const gate = createPriorityGate({ concurrency: 1 });
  const flagsKey = (audioKey, flags) => `${audioKey}|${JSON.stringify(flags ?? {})}`;
  const generate = generateOverride ?? ((features, audioKey, flags, { priority } = {}) => gate.run(
    () => generateStage.work(features.audio.identifier, () => {
      generate.seen.push({ id: features.audio.identifier, noMelody: features.noMelody === true });
      return charts;
    }),
    { priority, key: flagsKey(audioKey, flags) },
  ));
  generate.seen = [];
  generate.promote = (audioKey, flags) => gate.promote(flagsKey(audioKey, flags));
  generate.place = (audioKey, flags) => gate.place(flagsKey(audioKey, flags));

  const store = createChartStore({ dir, analysis, generate, log: quietLog, melodyDecoder: decoder, melodyWaitMs, ...storeOptions });
  return { analysis, analysisStage, audioCalls, clock, decodeStage, decoder, generate, generateStage, node: fakeNode, plugin, store };
}

describe("mewbeat with several servers at once", () => {
  let dir;
  const dirs = [];

  before_all();
  function before_all() {
    // The charts are made once with the real generator; the fake generator step returns them after its delay.
    charts = generateAll(makeFeatures(), "youtube:fixture:180000", {});
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-concurrency-"));
    dirs.push(dir);
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  after(() => { for (const leftover of dirs) fs.rmSync(leftover, { recursive: true, force: true }); });

  describe("different new songs from many rooms", () => {
    it("works through eight songs one at a time and in the order they were asked, every room ends with charts", async () => {
      const world = createWorld(dir);
      const asked = await askInOrder(world, [1, 2, 3, 4, 5, 6, 7, 8]);
      const results = await settles(Promise.all(asked), "eight songs");
      assert.deepStrictEqual(results.map((result) => result.status), Array(8).fill("ready"));
      const expected = [1, 2, 3, 4, 5, 6, 7, 8].map(idOf);
      assert.deepStrictEqual(world.analysisStage.order, expected, "analysis: first come, first served");
      assert.deepStrictEqual(world.decodeStage.order, expected, "decoder: in the same order");
      // The generator's line is fed as each song finishes its melody, a few milliseconds apart: each song once, not a fixed order.
      assert.deepStrictEqual([...world.generateStage.order].sort(), [...expected].sort(), "generator: every song once");
      // The plugin was never asked for two songs at once: its own line (four, then "busy") is never what the rooms queue in.
      assert.strictEqual(world.analysisStage.maxRunning, 1);
      assert.strictEqual(world.decodeStage.maxRunning, 1);
      assert.strictEqual(world.generateStage.maxRunning, 1);
      assert.strictEqual(world.plugin.busyAnswers, 0);
    });

    it("tells each waiting room the step its song is at and how many jobs are ahead of it", async () => {
      const world = createWorld(dir, { analysisManual: true, decodeManual: true });
      const tracks = [1, 2, 3].map(trackOf);
      const asked = await askInOrder(world, [1, 2, 3]);
      await waitFor(() => world.analysisStage.holds("song1"), "the first analysis");
      await waitFor(() => world.store.queueOf(tracks[2])?.ahead === 2, "the last song to join the line");
      assert.deepStrictEqual(world.store.queueOf(tracks[0]), { step: "analysis", ahead: 0, running: true });
      assert.deepStrictEqual(world.store.queueOf(tracks[1]), { step: "analysis", ahead: 1, running: false });
      assert.deepStrictEqual(world.store.queueOf(tracks[2]), { step: "analysis", ahead: 2, running: false });

      await world.analysisStage.release("song1");
      await waitFor(() => world.decodeStage.holds("song1"), "the first decode");
      assert.deepStrictEqual(world.store.queueOf(tracks[0]), { step: "melody", ahead: 0, running: true });
      await waitFor(() => world.analysisStage.holds("song2"), "the second analysis");
      assert.deepStrictEqual(world.store.queueOf(tracks[1]), { step: "analysis", ahead: 0, running: true });
      assert.deepStrictEqual(world.store.queueOf(tracks[2]), { step: "analysis", ahead: 1, running: false });
      assert.strictEqual(world.store.queueOf(trackOf(9)), null, "a song nobody asked for is not in any line");

      for (const id of ["song2", "song3"]) await world.analysisStage.release(id);
      for (const id of ["song1", "song2", "song3"]) await world.decodeStage.release(id);
      const results = await settles(Promise.all(asked), "three songs");
      assert.deepStrictEqual(results.map((result) => result.status), ["ready", "ready", "ready"]);
      assert.strictEqual(world.store.queueOf(tracks[0]), null, "nothing is queued for a finished song");
    });
  });

  describe("the same new song from many rooms", () => {
    it("is analysed, decoded and charted once, and every room gets the same charts", async () => {
      const world = createWorld(dir, { analysisManual: true, decodeManual: true });
      const asked = Array.from({ length: 8 }, () => world.store.getCharts(trackOf(1), world.node));
      // Later asks, between the steps, join the same work too (a room queue add, a solo play).
      await waitFor(() => world.analysisStage.holds("song1"), "the analysis");
      asked.push(world.store.getCharts(trackOf(1), world.node, { priority: "background" }));
      await world.analysisStage.release("song1");
      await waitFor(() => world.decodeStage.holds("song1"), "the decode");
      asked.push(world.store.getCharts(trackOf(1), world.node));
      await world.decodeStage.release("song1");
      const results = await settles(Promise.all(asked), "ten requests for one song");
      assert.ok(results.every((result) => result.status === "ready"));
      assert.ok(results.every((result) => result.charts === results[0].charts), "one set of charts for everybody");
      assert.deepStrictEqual(world.analysisStage.order, ["song1"]);
      assert.deepStrictEqual(world.decodeStage.order, ["song1"]);
      assert.deepStrictEqual(world.generateStage.order, ["song1"]);
      assert.strictEqual(world.plugin.calls, 1);
      assert.strictEqual(world.audioCalls.length, 1);
    });

    it("works through three songs asked by eight rooms in a mix, once each", async () => {
      const world = createWorld(dir);
      const asked = [1, 2, 3, 1, 2, 3, 1, 1].map((n, i) => world.store.getCharts(trackOf(n), world.node, { priority: i % 2 ? "background" : "play" }));
      const results = await settles(Promise.all(asked), "eight requests");
      assert.ok(results.every((result) => result.status === "ready"));
      assert.strictEqual(world.plugin.calls, 3);
      assert.deepStrictEqual([...world.analysisStage.order].sort(), ["song1", "song2", "song3"]);
      assert.deepStrictEqual([...world.decodeStage.order].sort(), ["song1", "song2", "song3"]);
      assert.deepStrictEqual([...world.generateStage.order].sort(), ["song1", "song2", "song3"]);
    });
  });

  describe("a player waits before background work", () => {
    it("goes ahead of the queued background analyses, behind the one that runs", async () => {
      const world = createWorld(dir, { analysisManual: true });
      const asked = await askInOrder(world, [1, 2, 3, 4], { priority: "background" });
      await waitFor(() => world.analysisStage.holds("song1"), "the first analysis");
      asked.push(world.store.getCharts(trackOf(5), world.node)); // a player
      asked.push(world.store.getCharts(trackOf(6), world.node)); // a second player, behind the first
      for (const id of ["song1", "song5", "song6", "song2", "song3", "song4"]) await world.analysisStage.release(id);
      const results = await settles(Promise.all(asked), "six songs");
      assert.ok(results.every((result) => result.status === "ready"));
      assert.deepStrictEqual(world.analysisStage.order, ["song1", "song5", "song6", "song2", "song3", "song4"]);
    });

    it("goes ahead of the queued background decodes too", async () => {
      const world = createWorld(dir, { decodeManual: true });
      const asked = await askInOrder(world, [1, 2, 3, 4], { priority: "background" });
      await waitFor(() => world.decodeStage.holds("song1"), "the first decode");
      await waitFor(() => world.decoder.queueOf(audioKeyOf(trackOf(4))) !== null, "the background decodes to queue");
      asked.push(world.store.getCharts(trackOf(5), world.node)); // a player
      await waitFor(() => world.decoder.queueOf(audioKeyOf(trackOf(5))) !== null, "the player's decode to queue");
      for (const id of ["song1", "song5"]) await world.decodeStage.release(id);
      await world.decodeStage.releaseAny(3);
      const results = await settles(Promise.all(asked), "five songs");
      assert.ok(results.every((result) => result.status === "ready"));
      assert.deepStrictEqual(world.decodeStage.order.slice(0, 2), ["song1", "song5"], "the player's decode went before the three background ones");
      assert.deepStrictEqual([...world.decodeStage.order.slice(2)].sort(), ["song2", "song3", "song4"]);
      // The audio the decoder needs is asked for as the decode runs, with the priority the decode runs under.
      const audioFor = Object.fromEntries(world.audioCalls.map((call) => [call.id, call.priority]));
      assert.strictEqual(audioFor.song5, "play");
      assert.strictEqual(audioFor.song2, "background");
    });

    it("goes ahead of the queued background chart jobs too", async () => {
      const world = createWorld(dir, { generateManual: true });
      const asked = await askInOrder(world, [1, 2, 3, 4], { priority: "background" });
      await waitFor(() => world.generateStage.holds("song1"), "the first chart job");
      await waitFor(() => world.generate.place(audioKeyOf(trackOf(4)), {}) !== null, "the background chart jobs to queue");
      asked.push(world.store.getCharts(trackOf(5), world.node));
      await waitFor(() => world.generate.place(audioKeyOf(trackOf(5)), {}) !== null, "the player's chart job to queue");
      for (const id of ["song1", "song5"]) await world.generateStage.release(id);
      await world.generateStage.releaseAny(3);
      const results = await settles(Promise.all(asked), "five songs");
      assert.ok(results.every((result) => result.status === "ready"));
      assert.deepStrictEqual(world.generateStage.order.slice(0, 2), ["song1", "song5"], "the player's chart job went before the three background ones");
      assert.deepStrictEqual([...world.generateStage.order.slice(2)].sort(), ["song2", "song3", "song4"]);
    });

    it("moves a song that was asked as background up in every line when a player asks for it", async () => {
      const world = createWorld(dir, { analysisManual: true });
      const background = await askInOrder(world, [1, 2, 3], { priority: "background" });
      await waitFor(() => world.analysisStage.holds("song1"), "the first analysis");
      await waitFor(() => world.store.queueOf(trackOf(3))?.ahead === 2, "the background songs to join the line");
      const player = world.store.getCharts(trackOf(3), world.node);
      for (const id of ["song1", "song3", "song2"]) await world.analysisStage.release(id);
      const results = await settles(Promise.all([...background, player]), "three songs");
      assert.ok(results.every((result) => result.status === "ready"));
      assert.deepStrictEqual(world.analysisStage.order, ["song1", "song3", "song2"], "song 3 jumped the queue");
      assert.strictEqual(results[2], results[3], "it is one request");
    });
  });

  describe("the plugin answers busy", () => {
    it("keeps a waiting player's analyses in their place and loses none", async () => {
      const world = createWorld(dir, { busy: 3 });
      const asked = [1, 2].map((n) => world.store.getCharts(trackOf(n), world.node));
      const results = await settles(Promise.all(asked), "two songs");
      assert.deepStrictEqual(results.map((result) => result.status), ["ready", "ready"]);
      assert.strictEqual(world.plugin.busyAnswers, 3);
      assert.deepStrictEqual(world.analysisStage.order, ["song1", "song2"], "the song behind waited, it did not overtake");
      assert.strictEqual(world.analysis.statusOf(trackOf(1)), null, "no busy block is left for the player's song");
    });

    it("answers background work pending, not failed, and serves it once the block has passed", async () => {
      const world = createWorld(dir, { busy: 1 });
      const first = await settles(world.store.getCharts(trackOf(1), world.node, { priority: "background" }), "the busy song");
      assert.strictEqual(first.status, "pending");
      assert.deepStrictEqual(world.analysis.statusOf(trackOf(1)), { status: "busy" });
      world.clock.t += 31_000;
      const second = await settles(world.store.getCharts(trackOf(1), world.node, { priority: "background" }), "the busy song again");
      assert.strictEqual(second.status, "ready");
      assert.strictEqual(world.plugin.busyAnswers, 1);
    });

    it("lets a player's request through a busy block that only background work met", async () => {
      const world = createWorld(dir, { busy: 1 });
      const background = await world.store.getCharts(trackOf(1), world.node, { priority: "background" });
      assert.strictEqual(background.status, "pending");
      // No waiting for the 30 s: the plugin's busy was an answer to background work, not a verdict on the song.
      const player = await settles(world.store.getCharts(trackOf(1), world.node), "the player's request");
      assert.strictEqual(player.status, "ready");
    });

    it("answers a plugin that never replies with pending once its time is up", async () => {
      const world = createWorld(dir, { node: { rest: { post: () => new Promise(() => {}) } }, analysisOptions: { requestTimeoutMs: 20 } });
      const result = await settles(world.store.getCharts(trackOf(1), world.node), "a silent plugin");
      assert.strictEqual(result.status, "pending");
    });
  });

  describe("queues are bounded", () => {
    it("refuses background songs past the cap with full and still takes players", async () => {
      const world = createWorld(dir, { analysisManual: true, storeOptions: { backgroundCap: 3 } });
      const background = await askInOrder(world, [1, 2, 3, 4, 5], { priority: "background" });
      const full = await Promise.all([background[3], background[4]]);
      assert.deepStrictEqual(full.map((result) => result.status), ["full", "full"]);
      const player = world.store.getCharts(trackOf(6), world.node);
      for (const id of ["song1", "song6", "song2", "song3"]) await world.analysisStage.release(id); // the player goes first
      const results = await settles(Promise.all([background[0], background[1], background[2], player]), "the songs that fit");
      assert.ok(results.every((result) => result.status === "ready"));
      assert.ok(!world.analysisStage.order.includes("song4") && !world.analysisStage.order.includes("song5"), "no work was queued for the refused ones");
    });

    it("refuses melody decodes past the cap without counting them as the song's failure", async () => {
      const release = [];
      const decoder = createMelodyDecoder({
        dir,
        audio: { get: async (key, track) => { const file = path.join(dir, `${track.track}.ogg`); fs.writeFileSync(file, Buffer.alloc(5000)); return file; } },
        run: () => new Promise((resolve) => release.push(() => resolve(decoded))),
        log: quietLog,
      });
      const outcomes = [];
      const asks = [];
      for (let n = 1; n <= 53; n++) {
        asks.push(decoder.ensure(audioKeyOf(trackOf(n)), trackOf(n), "node", FEATURES, { priority: "background" }).then((outcome) => outcomes.push([n, outcome])));
      }
      await waitFor(() => release.length === 1, "the first decode to run");
      await tick();
      assert.deepStrictEqual(outcomes, [[52, "failed"], [53, "failed"]], "one runs, fifty wait, the rest are refused at once");
      assert.ok(decoder.wants(audioKeyOf(trackOf(52))), "a refused key is asked for again when something asks next");
      // Let the rest drain so nothing is left running.
      while (outcomes.length < 53) {
        release.shift()?.();
        await tick();
      }
      await settles(Promise.all(asks), "the decodes");
    });
  });

  describe("every waiting request ends in charts or a clear status", () => {
    const STATUSES = ["ready", "pending", "failed", "uncharted", "full"];

    it("a plugin failure is a failed chart", async () => {
      const world = createWorld(dir, { node: { rest: { post: async () => ({ error: "failed", message: "decoder crashed" }) } } });
      const result = await settles(world.store.getCharts(trackOf(1), world.node), "a failing analysis");
      assert.strictEqual(result.status, "failed");
    });

    it("an uncharted verdict is final and carries its reason", async () => {
      const world = createWorld(dir, { node: { rest: { post: async () => ({ error: "uncharted", reason: "too_short" }) } } });
      const result = await settles(world.store.getCharts(trackOf(1), world.node), "an uncharted song");
      assert.deepStrictEqual(result, { status: "uncharted", reason: "too_short" });
    });

    it("no Lavalink node is a failed chart, not a hang", async () => {
      const world = createWorld(dir, { node: null });
      const result = await settles(world.store.getCharts(trackOf(1), world.node), "a song without a node");
      assert.ok(STATUSES.includes(result.status));
      assert.notStrictEqual(result.status, "ready");
    });

    it("a decoder that fails still gives charts, made without the melody", async () => {
      const world = createWorld(dir, { runDecoder: async () => { throw new Error("decoder crashed"); } });
      const result = await settles(world.store.getCharts(trackOf(1), world.node), "a failing decode");
      assert.strictEqual(result.status, "ready");
      assert.deepStrictEqual(world.generate.seen, [{ id: "song1", noMelody: true }]);
    });

    it("a decoder that is slower than the player may wait gives charts without the melody and finishes the decode after", async () => {
      const world = createWorld(dir, { decodeManual: true, melodyWaitMs: 20 });
      const result = await settles(world.store.getCharts(trackOf(1), world.node), "a slow decode");
      assert.strictEqual(result.status, "ready");
      assert.deepStrictEqual(world.generate.seen, [{ id: "song1", noMelody: true }]);
      await world.decodeStage.release("song1");
      await waitFor(() => world.decoder.has(audioKeyOf(trackOf(1))), "the melody file");
    });

    it("a generator that throws rejects the request, which the socket answers as a failed chart", async () => {
      const world = createWorld(dir, { generateOverride: async () => { throw new Error("worker gone"); } });
      await assert.rejects(settles(world.store.getCharts(trackOf(1), world.node), "a failing generator"), /worker gone/);
      // The song is not stuck: the failure is not remembered as pending, and a later ask tries again.
      assert.strictEqual(world.store.queueOf(trackOf(1)), null);
    });

    it("a song with no usable audio key is an uncharted verdict at once", async () => {
      const world = createWorld(dir);
      const result = await settles(world.store.getCharts({ track: "x", info: { isStream: true } }, world.node), "a stream");
      assert.strictEqual(result.status, "uncharted");
    });
  });

  describe("the bot restarts in the middle of the queue", () => {
    it("serves what was finished from disk and asks the plugin again only for what was not", async () => {
      const before = createWorld(dir, { analysisManual: true });
      const finished = before.store.getCharts(trackOf(1), before.node);
      const unfinished = before.store.getCharts(trackOf(2), before.node);
      await before.analysisStage.release("song1");
      assert.strictEqual((await settles(finished, "the first song")).status, "ready");
      await waitFor(() => before.analysisStage.holds("song2"), "the second analysis");
      // The process dies here: everything in memory is gone, song 2 was never finished.

      const after = createWorld(dir);
      const results = await settles(Promise.all([1, 2].map((n) => after.store.getCharts(trackOf(n), after.node))), "both songs after the restart");
      assert.deepStrictEqual(results.map((result) => result.status), ["ready", "ready"]);
      assert.deepStrictEqual(after.analysisStage.order, ["song2"], "song 1 came from disk");
      assert.strictEqual(after.plugin.calls, 1);
      assert.deepStrictEqual(after.decodeStage.order, ["song2"], "song 1 already had its melody");

      await before.analysisStage.release("song2"); // the dead process's request ends; nothing waits for it
      await settles(unfinished, "the first process's last request");
    });
  });

  describe("what a player sees at the socket", () => {
    // One bot, four servers, each asking for its own new song through the Activity channel. The channel answers pending with the
    // place in line once a song takes longer than its limit, then the charts when they are there.
    it("gets pending with its place in line, then the charts", async () => {
      const world = createWorld(dir, { analysisManual: true });
      const soloTracks = createSoloTracks();
      const timers = [];
      const channel = createMewbeatChannel({
        readPlayback: () => null,
        chartStore: world.store,
        soloTracks,
        setTimer: (fn) => { timers.push(fn); return timers.length; },
        clearTimer: () => {},
        log: quietLog,
      });
      const guilds = ["g1", "g2", "g3", "g4"];
      const keys = [1, 2, 3, 4].map((n) => audioKeyOf(trackOf(n)));
      [1, 2, 3, 4].forEach((n, i) => soloTracks.put(keys[i], { track: trackOf(n), node: world.node }));
      const ask = (i) => channel.handle(guilds[i], `u${i}`, { type: "mewbeat_chart", audioKey: keys[i], difficulty: "easy" });

      // The four servers ask one after another, each once the song before it is in its line.
      const firstAsks = [];
      for (const i of [0, 1, 2, 3]) {
        firstAsks.push(ask(i));
        await waitFor(() => world.store.queueOf(trackOf(i + 1)) !== null, `song ${i + 1} to join the line`);
      }
      assert.strictEqual(timers.length, 4, "every request started its pending timer");
      // The limit is eight seconds in life, by which time every song is in its line.
      timers.forEach((fire) => fire());
      const pending = await settles(Promise.all(firstAsks), "the four pending answers");
      assert.deepStrictEqual(pending.map((reply) => reply.status), ["pending", "pending", "pending", "pending"]);
      assert.deepStrictEqual(pending.map((reply) => reply.queue), [
        { step: "analysis", ahead: 0, running: true },
        { step: "analysis", ahead: 1, running: false },
        { step: "analysis", ahead: 2, running: false },
        { step: "analysis", ahead: 3, running: false },
      ]);
      // Each reply names its own song: one room never gets another's answer.
      assert.deepStrictEqual(pending.map((reply) => reply.audioKey), keys);

      for (const n of [1, 2, 3, 4]) await world.analysisStage.release(idOf(n));
      const ready = await settles(Promise.all([0, 1, 2, 3].map(ask)), "the four charts");
      assert.deepStrictEqual(ready.map((reply) => reply.status), ["ready", "ready", "ready", "ready"]);
      assert.deepStrictEqual(ready.map((reply) => reply.audioKey), keys);
      assert.ok(ready.every((reply) => reply.chart), "the chart of the difficulty asked for");
    });
  });

  describe("live play keeps the servers apart", () => {
    function liveSetup() {
      const pushes = [];
      let now = 0;
      const timers = [];
      const board = createLiveBoard({
        now: () => now,
        setTimer: (fn, ms) => { timers.push({ fn, at: now + ms }); return timers.length; },
        clearTimer: () => {},
        broadcast: (guildId, userIds, payload) => pushes.push({ guildId, userIds: [...userIds], payload }),
      });
      const profile = (id) => ({ username: id, avatarUrl: null });
      const message = (score) => ({ session: "live:youtube:abc:200000", audioKey: "youtube:abc:200000", difficulty: "normal", score, combo: 1, accuracy: 90 });
      return { board, pushes, profile, message, advance: (ms) => { now += ms; } };
    }

    it("never sends one server's standings to another server, for the same song at the same time", () => {
      const live = liveSetup();
      live.board.update("g1", "ann", live.profile("ann"), live.message(100));
      live.board.update("g2", "bo", live.profile("bo"), live.message(500));
      assert.deepStrictEqual(live.pushes.map((push) => [push.guildId, push.userIds]), [["g1", ["ann"]], ["g2", ["bo"]]]);
      assert.deepStrictEqual(live.pushes[0].payload.entries.map((entry) => entry.userId), ["ann"]);
      assert.deepStrictEqual(live.pushes[1].payload.entries.map((entry) => entry.userId), ["bo"]);
    });

    it("keeps pushing to the other servers when one server's broadcast throws", () => {
      const pushes = [];
      const board = createLiveBoard({
        now: () => 0,
        setTimer: () => 1,
        clearTimer: () => {},
        broadcast: (guildId, userIds, payload) => {
          if (guildId === "g1") throw new Error("socket closed");
          pushes.push({ guildId, userIds, payload });
        },
      });
      const profile = { username: "x", avatarUrl: null };
      const message = { session: "live:youtube:abc:200000", difficulty: "normal", score: 1, combo: 1 };
      assert.strictEqual(board.update("g1", "ann", profile, message).ok, true);
      assert.strictEqual(board.update("g2", "bo", profile, message).ok, true);
      assert.deepStrictEqual(pushes.map((push) => push.guildId), ["g2"]);
    });

    it("a burst of updates in one server is throttled per session, so it cannot starve another server's push", () => {
      const live = liveSetup();
      live.board.update("g1", "ann", live.profile("ann"), live.message(1));
      for (let i = 0; i < 20; i++) live.board.update("g1", "ann", live.profile("ann"), live.message(2 + i));
      live.board.update("g2", "bo", live.profile("bo"), live.message(5));
      live.advance(PUSH_INTERVAL_MS);
      assert.strictEqual(live.pushes.filter((push) => push.guildId === "g1").length, 1, "one leading push, the rest wait for the interval");
      assert.strictEqual(live.pushes.filter((push) => push.guildId === "g2").length, 1, "the other server's first push was not held back");
    });
  });

  describe("time sync", () => {
    it("answers every sync with that server's own anchor and no state is shared between servers", () => {
      const playbacks = {
        g1: { track: trackOf(1), node: null, positionMs: 1000, paused: false, durationMs: LENGTH },
        g2: { track: trackOf(2), node: null, positionMs: 90000, paused: true, durationMs: LENGTH },
      };
      const channel = createMewbeatChannel({ readPlayback: (guildId) => playbacks[guildId] ?? null, chartStore: {}, now: () => 5000, audioLatencyMs: 40 });
      const a = channel.handle("g1", "u1", { type: "mewbeat_sync", id: "a", clientSentAt: 1 });
      const b = channel.handle("g2", "u2", { type: "mewbeat_sync", id: "b", clientSentAt: 2 });
      const none = channel.handle("g3", "u3", { type: "mewbeat_sync", id: "c", clientSentAt: 3 });
      return Promise.all([a, b, none]).then(([ra, rb, rc]) => {
        assert.deepStrictEqual([ra.anchor.audioKey, rb.anchor.audioKey, rc.anchor], [audioKeyOf(trackOf(1)), audioKeyOf(trackOf(2)), null]);
        assert.deepStrictEqual([ra.anchor.positionMs, rb.anchor.positionMs], [1000, 90000]);
        assert.deepStrictEqual([ra.anchor.paused, rb.anchor.paused], [false, true]);
        assert.deepStrictEqual([ra.id, rb.id, rc.id], ["a", "b", "c"]);
      });
    });
  });
});
