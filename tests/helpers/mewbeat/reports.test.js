const assert = require("node:assert");
const { describe, it } = require("node:test");

const { MAX_TEXT, MIN_TEXT, REPORT_COOLDOWN_MS, createReporter, createRunLookup, debuggerUrl, placeLabel, validateReport } = require("../../../helpers/mewbeat/reports");

const GOOD_TEXT = "The notes stop falling after the pause.";

const HOOK = "https://discord.test/hook";

function fakeHook({ sent = [], fail = false } = {}) {
  return {
    sent,
    post: async (url, message) => {
      assert.strictEqual(url, HOOK);
      if (fail) throw new Error("Unknown Webhook");
      sent.push(message);
    },
  };
}

function report(overrides = {}) {
  return {
    type: "bug",
    text: GOOD_TEXT,
    reporter: { id: "u1", name: "Ann" },
    source: "activity",
    place: "Test Server (g1)",
    mode: "solo",
    song: "Some Song",
    level: "Normal",
    ...overrides,
  };
}

const fields = (message) => Object.fromEntries(message.embeds[0].toJSON().fields.map((field) => [field.name, field.value]));

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected a rejection");
}

describe("validateReport", () => {
  it("accepts a bug, a map problem or an idea and trims the text", () => {
    assert.strictEqual(validateReport({ type: "map", text: GOOD_TEXT }).type, "map");
    assert.deepStrictEqual(validateReport({ type: "bug", text: `  ${GOOD_TEXT}  ` }), { type: "bug", text: GOOD_TEXT });
    assert.strictEqual(validateReport({ type: "idea", text: GOOD_TEXT }).type, "idea");
  });

  it("refuses text that is too short or too long, counted after trimming", () => {
    assert.strictEqual(MIN_TEXT, 10);
    assert.strictEqual(MAX_TEXT, 1000);
    for (const text of ["", "short", `   ${"a".repeat(MIN_TEXT - 1)}   `, "a".repeat(MAX_TEXT + 1), undefined, 42]) {
      const error = (() => { try { validateReport({ type: "bug", text }); } catch (caught) { return caught; } })();
      assert.strictEqual(error?.statusCode, 400, `text ${JSON.stringify(text)}`);
      assert.ok(error.message.length > 0);
    }
    assert.doesNotThrow(() => validateReport({ type: "bug", text: "a".repeat(MIN_TEXT) }));
    assert.doesNotThrow(() => validateReport({ type: "bug", text: "a".repeat(MAX_TEXT) }));
  });

  it("refuses an unknown type", () => {
    for (const type of ["feature", "", undefined, "BUG", {}]) {
      assert.throws(() => validateReport({ type, text: GOOD_TEXT }), (error) => error.statusCode === 400);
    }
  });
});

describe("createReporter", () => {
  it("posts one embed carrying every field, with mentions switched off", async () => {
    const { post, sent } = fakeHook();
    const reporter = createReporter({ post, webhookUrl: HOOK });
    await reporter.send(report());

    assert.strictEqual(sent.length, 1);
    assert.deepStrictEqual(sent[0].allowedMentions, { parse: [] });
    const embed = sent[0].embeds[0].toJSON();
    assert.match(embed.title, /Bug/);
    assert.strictEqual(embed.description, GOOD_TEXT);
    const all = fields(sent[0]);
    assert.match(all.Reporter, /Ann/);
    assert.match(all.Reporter, /u1/);
    assert.match(all.Source, /Activity/);
    assert.strictEqual(all.Place, "Test Server (g1)");
    assert.strictEqual(all.Mode, "solo");
    assert.strictEqual(all.Song, "Some Song");
    assert.strictEqual(all.Level, "Normal");
  });

  it("marks an idea differently and leaves out context a command report does not have", async () => {
    const { post, sent } = fakeHook();
    const reporter = createReporter({ post, webhookUrl: HOOK });
    await reporter.send(report({ type: "idea", source: "command", place: "private conversation", mode: undefined, song: undefined, level: undefined }));

    const embed = sent[0].embeds[0].toJSON();
    assert.match(embed.title, /Idea/);
    const all = fields(sent[0]);
    assert.match(all.Source, /command/i);
    assert.strictEqual(all.Place, "private conversation");
    assert.deepStrictEqual(Object.keys(all).filter((name) => ["Mode", "Song", "Level"].includes(name)), []);
  });

  it("keeps the text inside the embed and cuts what the browser sends", async () => {
    const { post, sent } = fakeHook();
    const reporter = createReporter({ post, webhookUrl: HOOK });
    const nasty = "@everyone <@123> ``` # heading\n[x](https://evil.example) tail";
    await reporter.send(report({
      text: nasty,
      reporter: { id: "u1", name: "*Ann*\n@everyone".padEnd(500, "x") },
      mode: "m".repeat(2000),
      song: "s".repeat(2000),
      level: "`".repeat(2000),
    }));

    assert.deepStrictEqual(sent[0].allowedMentions, { parse: [] });
    const embed = sent[0].embeds[0].toJSON();
    assert.strictEqual(embed.description, nasty);
    for (const field of embed.fields) assert.ok(field.value.length <= 200, `${field.name} is ${field.value.length} long`);
    assert.ok(embed.fields.length <= 25);
  });

  it("refuses a second send from the same player within a minute, and accepts one after", async () => {
    let time = 1_000_000;
    const { post, sent } = fakeHook();
    const reporter = createReporter({ post, webhookUrl: HOOK, now: () => time });
    await reporter.send(report());

    time += REPORT_COOLDOWN_MS - 1;
    const refused = await rejection(reporter.send(report()));
    assert.strictEqual(refused.statusCode, 429);
    assert.ok(refused.message.length > 0);
    assert.strictEqual(sent.length, 1);

    time += 1;
    await reporter.send(report());
    assert.strictEqual(sent.length, 2);
  });

  it("keeps the cooldown per player", async () => {
    const { post, sent } = fakeHook();
    const reporter = createReporter({ post, webhookUrl: HOOK, now: () => 1 });
    await reporter.send(report());
    await reporter.send(report({ reporter: { id: "u2", name: "Bo" } }));
    assert.strictEqual(sent.length, 2);
  });

  it("counts two sends at once from one player as one report", async () => {
    const { post, sent } = fakeHook();
    const reporter = createReporter({ post, webhookUrl: HOOK, now: () => 1 });
    const results = await Promise.allSettled([reporter.send(report()), reporter.send(report())]);
    assert.deepStrictEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
    assert.strictEqual(sent.length, 1);
  });

  it("validates before it posts and before the cooldown starts", async () => {
    const { post, sent } = fakeHook();
    const reporter = createReporter({ post, webhookUrl: HOOK, now: () => 1 });
    const error = await rejection(reporter.send(report({ text: "no" })));
    assert.strictEqual(error.statusCode, 400);
    await reporter.send(report());
    assert.strictEqual(sent.length, 1);
  });

  it("rejects with a plain message when no webhook is configured, and starts no cooldown", async () => {
    const { post, sent } = fakeHook();
    let url = "";
    const reporter = createReporter({ post, webhookUrl: () => url, now: () => 1 });
    const error = await rejection(reporter.send(report()));
    assert.strictEqual(error.statusCode, 503);
    assert.match(error.message, /not set up|configured|available/i);
    assert.strictEqual(sent.length, 0);

    url = HOOK;
    await reporter.send(report());
    assert.strictEqual(sent.length, 1);
  });

  it("rejects when the post fails, keeps Discord's error from the player, and starts no cooldown", async () => {
    let hook = fakeHook({ fail: true });
    const reporter = createReporter({ post: (...args) => hook.post(...args), webhookUrl: HOOK, now: () => 1 });
    const failed = await rejection(reporter.send(report()));
    assert.strictEqual(failed.statusCode, 503);
    assert.ok(!/Unknown Webhook/.test(failed.message), "the Discord error stays out of the player's message");

    hook = fakeHook();
    await reporter.send(report());
    assert.strictEqual(hook.sent.length, 1);
  });

  it("treats a malformed webhook address as a failed post, without showing it", async () => {
    const reporter = createReporter({ webhookUrl: "not-a-webhook-secret", now: () => 1 });
    const failed = await rejection(reporter.send(report()));
    assert.strictEqual(failed.statusCode, 503);
    assert.ok(!failed.message.includes("not-a-webhook-secret"));
  });

  it("reads the webhook address when it sends, not when it is created", async () => {
    const { post, sent } = fakeHook();
    const previous = process.env.MEWBEAT_REPORT_WEBHOOK_URL;
    try {
      delete process.env.MEWBEAT_REPORT_WEBHOOK_URL;
      const reporter = createReporter({ post, now: () => 1 });
      assert.strictEqual((await rejection(reporter.send(report()))).statusCode, 503);
      process.env.MEWBEAT_REPORT_WEBHOOK_URL = HOOK;
      await reporter.send(report());
      assert.strictEqual(sent.length, 1);
    } finally {
      if (previous === undefined) delete process.env.MEWBEAT_REPORT_WEBHOOK_URL;
      else process.env.MEWBEAT_REPORT_WEBHOOK_URL = previous;
    }
  });
});

const AUDIO_KEY = "youtube:abc123:200000";
const AUDIO_SHA = "8c5b38201497693eed9f22cf9145304e91d79c3c"; // sha1 of AUDIO_KEY, the debugger's id for the song
const PLAYED_AT = 1_700_000_000_000;

function storedRound(overrides = {}) {
  return {
    audioKey: AUDIO_KEY,
    uri: "https://www.youtube.com/watch?v=abc123",
    title: "Stored Title",
    artist: "Stored Artist",
    difficulty: "hard",
    score: 612345,
    accuracy: 96.42,
    grade: "A",
    mode: "solo",
    chartVersion: 31,
    at: PLAYED_AT,
    ...overrides,
  };
}

const mapReport = (overrides = {}) => report({
  type: "map",
  text: "The notes drift early after the second chorus.",
  run: { audioKey: AUDIO_KEY, difficulty: "hard", at: PLAYED_AT },
  ...overrides,
});

describe("debuggerUrl", () => {
  it("opens the played song at the level, from the sha of its key", () => {
    assert.strictEqual(debuggerUrl(AUDIO_KEY, "hard", "http://dbg.test"), `http://dbg.test/#played%3A${AUDIO_SHA}/hard/0`);
    assert.strictEqual(debuggerUrl(AUDIO_KEY, "hard", "http://dbg.test///"), `http://dbg.test/#played%3A${AUDIO_SHA}/hard/0`);
    assert.strictEqual(debuggerUrl(AUDIO_KEY, "easy", ""), `http://localhost:5180/#played%3A${AUDIO_SHA}/easy/0`);
  });

  it("reads MEWBEAT_DEBUG_URL when no base is given", () => {
    const previous = process.env.MEWBEAT_DEBUG_URL;
    try {
      process.env.MEWBEAT_DEBUG_URL = "https://debug.example.test/";
      assert.match(debuggerUrl(AUDIO_KEY, "normal"), /^https:\/\/debug\.example\.test\/#played%3A8c5b/);
      delete process.env.MEWBEAT_DEBUG_URL;
      assert.match(debuggerUrl(AUDIO_KEY, "normal"), /^http:\/\/localhost:5180\/#/);
    } finally {
      if (previous === undefined) delete process.env.MEWBEAT_DEBUG_URL;
      else process.env.MEWBEAT_DEBUG_URL = previous;
    }
  });
});

describe("map reports", () => {
  const chart = { version: 33, stars: 4.46, bpm: 171.6, notes: 1240 };

  it("carries everything about the run from the server's record, with a debugger link", async () => {
    const { post, sent } = fakeHook();
    const asked = [];
    const reporter = createReporter({
      post,
      webhookUrl: HOOK,
      debugUrl: "http://dbg.test",
      findRun: (userId, run) => { asked.push([userId, run]); return { round: storedRound(), chart }; },
    });
    await reporter.send(mapReport());

    assert.deepStrictEqual(asked, [["u1", { audioKey: AUDIO_KEY, difficulty: "hard", at: PLAYED_AT }]]);
    const embed = sent[0].embeds[0].toJSON();
    assert.match(embed.title, /Map/);
    assert.strictEqual(embed.description, "The notes drift early after the second chorus.");
    const all = fields(sent[0]);
    assert.strictEqual(all.Song, "Stored Title - Stored Artist");
    assert.strictEqual(all.Link, "https://www.youtube.com/watch?v=abc123");
    assert.strictEqual(all.Level, "Hard");
    assert.strictEqual(all.Played, `<t:${PLAYED_AT / 1000}:f>`);
    assert.strictEqual(all.Mode, "solo");
    assert.strictEqual(all.Result, "612345 points · 96.42% · A");
    assert.strictEqual(all["Chart version"], "31 (current: 33)");
    assert.strictEqual(all.Stars, "4.5");
    assert.strictEqual(all.Notes, "1240");
    assert.strictEqual(all.BPM, "172");
    assert.strictEqual(all["Audio key"], `\`${AUDIO_KEY}\``);
    assert.strictEqual(all.Debugger, `http://dbg.test/#played%3A${AUDIO_SHA}/hard/0`);
    assert.ok(embed.fields.length <= 25);
    for (const field of embed.fields) assert.ok(field.value.length <= 1024);
  });

  it("leaves out what is not known, and shows a combo only when one is stored", async () => {
    const { post, sent } = fakeHook();
    const reporter = createReporter({
      post,
      webhookUrl: HOOK,
      findRun: () => ({ round: storedRound({ uri: null, mode: undefined, chartVersion: 33, maxCombo: 812 }), chart: { version: 33 } }),
    });
    await reporter.send(mapReport());

    const all = fields(sent[0]);
    for (const name of ["Link", "Mode", "Stars", "Notes", "BPM"]) assert.ok(!(name in all), name);
    assert.strictEqual(all["Chart version"], "33");
    assert.strictEqual(all.Result, "612345 points · 96.42% · A · 812 combo");
    assert.match(all.Debugger, /^http:\/\/localhost:5180\/#played%3A/);
  });

  it("refuses a run that is not in the history, tells the player so and does not use up the minute", async () => {
    const { post, sent } = fakeHook();
    const reporter = createReporter({ post, webhookUrl: HOOK, findRun: () => null, now: () => 5 });
    const error = await rejection(reporter.send(mapReport()));
    assert.strictEqual(error.statusCode, 400);
    assert.match(error.message, /could not find that run/i);
    assert.strictEqual(sent.length, 0);

    const found = createReporter({ post, webhookUrl: HOOK, findRun: () => ({ round: storedRound(), chart: null }), now: () => 5 });
    await found.send(mapReport());
    assert.strictEqual(sent.length, 1);
  });

  it("ignores the song, level and mode the browser sends along", async () => {
    const { post, sent } = fakeHook();
    const reporter = createReporter({ post, webhookUrl: HOOK, findRun: () => ({ round: storedRound(), chart }) });
    await reporter.send(mapReport({ song: "Forged Song", level: "Forged Level", mode: "forged", run: { audioKey: AUDIO_KEY, difficulty: "hard", at: PLAYED_AT, title: "Forged Title", uri: "https://evil.example" } }));

    const all = fields(sent[0]);
    assert.doesNotMatch(JSON.stringify(all), /forged|evil/i);
    assert.strictEqual(all.Song, "Stored Title - Stored Artist");
  });

  it("shows a hostile title as plain text and keeps long values inside a field", async () => {
    const { post, sent } = fakeHook();
    const reporter = createReporter({
      post,
      webhookUrl: HOOK,
      findRun: () => ({ round: storedRound({ title: "@everyone [x](https://evil.example) ```".padEnd(3000, "t"), artist: "a".repeat(3000) }), chart }),
    });
    await reporter.send(mapReport());
    const embed = sent[0].embeds[0].toJSON();
    for (const field of embed.fields) assert.ok(field.value.length <= 1024, field.name);
    assert.deepStrictEqual(sent[0].allowedMentions, { parse: [] });
    assert.doesNotMatch(fields(sent[0]).Song, /\]\(|`/);
  });

  it("does not look a run up for a bug or an idea, and they carry no map fields", async () => {
    const { post, sent } = fakeHook();
    let asked = 0;
    const reporter = createReporter({ post, webhookUrl: HOOK, findRun: () => { asked += 1; return null; }, now: () => 1 });
    await reporter.send(report({ run: { audioKey: AUDIO_KEY, difficulty: "hard", at: PLAYED_AT } }));
    await reporter.send(report({ type: "idea", reporter: { id: "u2", name: "Bo" } }));
    assert.strictEqual(asked, 0);
    for (const message of sent) {
      const all = fields(message);
      assert.strictEqual(all.Song, "Some Song");
      assert.ok(!("Debugger" in all) && !("Audio key" in all));
    }
  });
});

describe("createRunLookup", () => {
  const round = storedRound();
  const historyStore = { roundOf: (userId, audioKey, difficulty, at) => (userId === "u1" && audioKey === AUDIO_KEY && difficulty === "hard" && at === PLAYED_AT ? round : null) };
  const summaryReader = () => (track) => (track?.info.identifier === "abc123" ? { hard: { version: 33, stars: 4.4 } } : {});
  const lookup = createRunLookup({ historyStore, summaryReader });

  it("finds the player's own round with the chart now in use", () => {
    assert.deepStrictEqual(lookup("u1", { audioKey: AUDIO_KEY, difficulty: "hard", at: PLAYED_AT }), { round, chart: { version: 33, stars: 4.4 } });
  });

  it("finds nothing for somebody else's round, a wrong level or time, or a malformed run", () => {
    for (const [userId, run] of [
      ["u2", { audioKey: AUDIO_KEY, difficulty: "hard", at: PLAYED_AT }],
      ["u1", { audioKey: AUDIO_KEY, difficulty: "easy", at: PLAYED_AT }],
      ["u1", { audioKey: AUDIO_KEY, difficulty: "hard", at: PLAYED_AT + 1 }],
      ["u1", { audioKey: AUDIO_KEY, difficulty: "hard", at: "1700000000000" }],
      ["u1", { audioKey: 5, difficulty: "hard", at: PLAYED_AT }],
      ["u1", null],
      ["u1", undefined],
    ]) assert.strictEqual(lookup(userId, run), null);
  });

  it("has no chart for a song the chart store has not seen", () => {
    const other = createRunLookup({ historyStore, summaryReader: () => () => ({}) });
    assert.strictEqual(other("u1", { audioKey: AUDIO_KEY, difficulty: "hard", at: PLAYED_AT }).chart, null);
  });
});

describe("placeLabel", () => {
  it("names a server with its id, and calls anything else a private conversation", () => {
    assert.strictEqual(placeLabel("Test Server", "g1"), "Test Server (g1)");
    assert.strictEqual(placeLabel(null, "g1"), "g1");
    assert.strictEqual(placeLabel("Test Server", null), "private conversation");
    assert.strictEqual(placeLabel(null, null), "private conversation");
  });
});
