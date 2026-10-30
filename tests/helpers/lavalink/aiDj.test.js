const assert = require("node:assert");
const { afterEach, beforeEach, describe, it } = require("node:test");

const {
  AI_DJ_DIRECTOR_RESPONSE_SCHEMA,
  AI_DJ_DIRECTOR_SYSTEM_PROMPT,
  buildDirectorInput,
  clearAIDJCacheForTests,
  filterPlanRepeats,
  planNextTrackWithAIDJ,
  setAIDJFetchForTests,
} = require("../../../helpers/lavalink/aiDj");

const envKeys = [
  "AI_DJ_ENABLED",
  "OPENAI_API_KEY",
  "AI_DJ_MODEL",
  "AI_DJ_REASONING_EFFORT",
  "AI_DJ_MIN_CONFIDENCE",
  "AI_DJ_MIN_FIT",
  "AI_DJ_CACHE_TTL_MS",
  "AI_DJ_WEB_SEARCH",
  "AI_DJ_MAX_PROPOSALS",
];
let savedEnvironment = {};

function track(title, artist, options = {}) {
  return {
    info: { title, author: artist, identifier: options.identifier || `${artist}-${title}` },
    userData: { genres: options.genres || ["hip hop"], albumTitle: options.albumTitle || null },
  };
}

function input() {
  return {
    guildId: "ai-dj-test",
    anchorTrack: track("Frascati", "Taco Hemingway", { albumTitle: "Frascati" }),
    referenceTrack: track("Nostalgia", "Taco Hemingway", { albumTitle: "Frascati" }),
    profile: {
      recentTracks: [], manualHistory: [], pendingManualTracks: [], manualTasteGenres: [], manualTasteGenreFamilies: [],
      verifiedCatalogCandidates: [{ artist: "Taco Hemingway", title: "Wosk", albumTitle: "Frascati", source: "same_album", genres: ["hip hop"] }],
    },
    context: {
      anchorFamilies: ["hiphop"],
      referenceFamilies: ["hiphop"],
      artistStreak: 1,
      albumStreak: 1,
      skippedArtists: new Set(),
      skippedArtistCounts: [{ artist: "Mata", skips: 2 }],
      recentSkips: [{ artist: "Mata", title: "Patointeligencja", reason: "listener-skip" }],
      repeatCooldownMs: 60 * 60 * 1000,
    },
  };
}

function proposal(overrides = {}) {
  return {
    artist: "Taco Hemingway",
    title: "Wosk",
    album: "Frascati",
    lane: "continuation",
    fit: 96,
    energy: 55,
    mood: "late-night reflective rap",
    reason: "Direct album continuation.",
    ...overrides,
  };
}

function plannedResponse(candidates = [proposal()]) {
  return {
    decision: "propose",
    confidence: 0.9,
    direction: { summary: "Stay in Frascati's intimate Warsaw rap lane.", energy: "steady-mid", mood: "late-night, reflective" },
    candidates,
    reasons: ["Manual anchor and current cut both favour reflective Polish rap."],
  };
}

describe("AI DJ director", () => {
  beforeEach(() => {
    savedEnvironment = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    process.env.AI_DJ_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.AI_DJ_MODEL = "gpt-5.6-luna";
    process.env.AI_DJ_REASONING_EFFORT = "low";
    process.env.AI_DJ_MIN_CONFIDENCE = "0.55";
    process.env.AI_DJ_CACHE_TTL_MS = "300000";
    process.env.AI_DJ_WEB_SEARCH = "true";
    process.env.AI_DJ_MAX_PROPOSALS = "8";
    clearAIDJCacheForTests();
    setAIDJFetchForTests(null);
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnvironment[key];
    }
    clearAIDJCacheForTests();
    setAIDJFetchForTests(null);
  });

  it("uses structured output and web-grounded music direction", async () => {
    let request;
    setAIDJFetchForTests(async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output_text: JSON.stringify(plannedResponse()) }) };
    });

    const result = await planNextTrackWithAIDJ(input());

    assert.strictEqual(result.status, "planned");
    assert.strictEqual(result.plan.candidates[0].title, "Wosk");
    assert.strictEqual(request.model, "gpt-5.6-luna");
    assert.strictEqual(request.store, false);
    assert.strictEqual(request.tools[0].type, "web_search");
    assert.strictEqual(request.tool_choice, "required");
    assert.strictEqual(request.text.format.name, "mewbit_ai_dj_plan");
    assert.match(request.input[0].content[0].text, /music director/);
    // Adaptive-run policy and vibe continuity live in the prompt itself.
    assert.match(AI_DJ_DIRECTOR_SYSTEM_PROMPT, /ADAPTIVE ARTIST RUNS/);
    assert.match(AI_DJ_DIRECTOR_SYSTEM_PROMPT, /distinctive sonic identity/);
    assert.match(AI_DJ_DIRECTOR_SYSTEM_PROMPT, /vibe-carriers/);
    assert.match(AI_DJ_DIRECTOR_SYSTEM_PROMPT, /honest energy value/);
    assert.match(AI_DJ_DIRECTOR_SYSTEM_PROMPT, /web search is available/);
    assert.match(AI_DJ_DIRECTOR_SYSTEM_PROMPT, /durable taste map/);
    assert.match(AI_DJ_DIRECTOR_SYSTEM_PROMPT, /FEEL OF THE NEXT SONG/);
    assert.match(AI_DJ_DIRECTOR_SYSTEM_PROMPT, /selectionIntent.mode is "refresh"/);
    assert.match(AI_DJ_DIRECTOR_SYSTEM_PROMPT, /Another version of currentTrack/);
    assert.match(request.input[1].content[0].text, /verifiedCatalog/);
    // Every candidate must carry an energy/mood verdict on one shared scale.
    assert.deepStrictEqual(
      AI_DJ_DIRECTOR_RESPONSE_SCHEMA.properties.candidates.items.required.sort(),
      ["album", "artist", "energy", "fit", "lane", "mood", "reason", "title"].sort()
    );
  });

  it("passes a direct surprise intent to the music director", () => {
    const nextInput = input();
    nextInput.context.selectionIntent = {
      mode: "discovery",
      goal: "Find a fitting hidden gem.",
      preferredLanes: ["explore", "bridge"],
    };

    const prompt = buildDirectorInput({ ...nextInput, maxProposals: 8 });
    assert.deepStrictEqual(prompt.selectionIntent, nextInput.context.selectionIntent);
  });

  it("feeds skips, streaks and cooldown context to the director", () => {
    const directorInput = buildDirectorInput({ ...input(), maxProposals: 8 });
    assert.deepStrictEqual(directorInput.constraints.skippedArtists, [{ artist: "Mata", skips: 2 }]);
    assert.deepStrictEqual(directorInput.recentSkips, [{ artist: "Mata", title: "Patointeligencja", reason: "listener-skip" }]);
    assert.strictEqual(directorInput.constraints.sameArtistStreak, 1);
    assert.strictEqual(directorInput.constraints.repeatCooldownMinutes, 60);
    assert.ok(Number.isFinite(directorInput.timeOfDay.hour));
  });

  it("caches an identical listening context", async () => {
    let calls = 0;
    setAIDJFetchForTests(async () => {
      calls += 1;
      return { ok: true, json: async () => ({ output_text: JSON.stringify(plannedResponse()) }) };
    });

    const first = await planNextTrackWithAIDJ(input());
    const second = await planNextTrackWithAIDJ(input());

    assert.strictEqual(calls, 1);
    assert.strictEqual(first.cached, false);
    assert.strictEqual(second.cached, true);
  });

  it("does not invoke a paid web search unless explicitly enabled", async () => {
    process.env.AI_DJ_WEB_SEARCH = "false";
    let request;
    setAIDJFetchForTests(async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output_text: JSON.stringify(plannedResponse()) }) };
    });

    const result = await planNextTrackWithAIDJ(input());

    assert.strictEqual(result.status, "planned");
    assert.strictEqual(request.tools, undefined);
    assert.strictEqual(request.tool_choice, undefined);
  });

  it("deduplicates proposals and falls back if the plan is unsafe or invalid", async () => {
    setAIDJFetchForTests(async () => ({
      ok: true,
      json: async () => ({ output_text: JSON.stringify(plannedResponse([
        proposal(),
        proposal({ fit: 84, reason: "Duplicate" }),
      ])) }),
    }));
    const result = await planNextTrackWithAIDJ(input());
    assert.strictEqual(result.status, "planned");
    assert.strictEqual(result.plan.candidates.length, 1);

    clearAIDJCacheForTests();
    setAIDJFetchForTests(async () => ({ ok: true, json: async () => ({ output_text: "not-json" }) }));
    const fallback = await planNextTrackWithAIDJ(input());
    assert.strictEqual(fallback.status, "fallback-error");
  });

  it("removes a current or short-session repeat from an otherwise valid AI plan", () => {
    const repeated = track("Nostalgia", "Taco Hemingway", { albumTitle: "Frascati" });
    repeated.userData.autoplayPlayedAt = Date.now() - 1000;
    const plan = plannedResponse([
      proposal({ title: "Nostalgia", reason: "Repeat." }),
      proposal({ title: "Wosk", reason: "Continue." }),
    ]);

    const filtered = filterPlanRepeats(plan, {
      ...input(),
      referenceTrack: repeated,
      profile: { cooldownTracks: [repeated], recentTracks: [], manualHistory: [] },
      context: { repeatCooldownMs: 60 * 60 * 1000 },
    });

    assert.deepStrictEqual(filtered.candidates.map((candidate) => candidate.title), ["Wosk"]);
  });

  it("requires bounded transition-fit and honest energy from the director", async () => {
    setAIDJFetchForTests(async () => ({
      ok: true,
      json: async () => ({ output_text: JSON.stringify(plannedResponse([proposal({ fit: 101 })])) }),
    }));

    const outOfBoundsFit = await planNextTrackWithAIDJ(input());
    assert.strictEqual(outOfBoundsFit.status, "fallback-error");

    clearAIDJCacheForTests();
    setAIDJFetchForTests(async () => ({
      ok: true,
      json: async () => ({ output_text: JSON.stringify(plannedResponse([proposal({ energy: 140 })])) }),
    }));

    const outOfBoundsEnergy = await planNextTrackWithAIDJ(input());
    assert.strictEqual(outOfBoundsEnergy.status, "fallback-error");

    clearAIDJCacheForTests();
    setAIDJFetchForTests(async () => ({
      ok: true,
      json: async () => ({ output_text: JSON.stringify(plannedResponse([{ ...proposal(), mood: undefined }])) }),
    }));

    const missingMood = await planNextTrackWithAIDJ(input());
    assert.strictEqual(missingMood.status, "fallback-error");
  });

  it("normalizes fit and energy emitted as 0-1 fractions instead of rejecting the plan", async () => {
    setAIDJFetchForTests(async () => ({
      ok: true,
      json: async () => ({ output_text: JSON.stringify(plannedResponse([
        proposal({ fit: 0.94, energy: 0.58, title: "Fraction Cut" }),
      ])) }),
    }));

    const result = await planNextTrackWithAIDJ(input());
    assert.strictEqual(result.status, "planned");
    assert.strictEqual(result.plan.candidates[0].fit, 94);
    assert.strictEqual(result.plan.candidates[0].energy, 58);
  });

  it("accepts confidence on either the 0-1 or the 0-100 scale", async () => {
    setAIDJFetchForTests(async () => ({
      ok: true,
      json: async () => {
        const plan = plannedResponse();
        plan.confidence = 88;
        return { output_text: JSON.stringify(plan) };
      },
    }));

    const result = await planNextTrackWithAIDJ(input());
    assert.strictEqual(result.status, "planned");
    assert.strictEqual(result.plan.confidence, 0.88);
  });

  it("keeps a whole plan alive even when only weak proposals exist (per-candidate gate)", async () => {
    setAIDJFetchForTests(async () => ({
      ok: true,
      json: async () => ({ output_text: JSON.stringify(plannedResponse([
        proposal({ title: "Weak Cut", lane: "bridge", fit: 40 }),
      ])) }),
    }));

    const result = await planNextTrackWithAIDJ(input());
    // The old whole-plan minTopFit gate is gone: weak candidates are dropped
    // per-candidate during V3 selection instead of discarding the plan here.
    assert.strictEqual(result.status, "planned");
    assert.strictEqual(result.plan.candidates[0].title, "Weak Cut");
  });
});
