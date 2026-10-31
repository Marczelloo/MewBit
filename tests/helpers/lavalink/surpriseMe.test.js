const assert = require("node:assert/strict");
const { beforeEach, describe, test } = require("node:test");
const {
  MOODS,
  buildIntent,
  buildSurpriseSeedPool,
  clearSurpriseMemory,
  getMoodEnergyCenter,
  normalizeMood,
  rememberFreestyleCandidate,
  selectFreestyleCandidates,
  selectSurpriseSeed,
} = require("../../../helpers/lavalink/surpriseMe");

function track(title, author) {
  return { info: { title, author, identifier: `${author}-${title}`, sourceName: "deezer" } };
}

describe("Surprise me selector", () => {
  beforeEach(() => clearSurpriseMemory());

  test("combines room, personal, liked, and frequent-listening signals", () => {
    const pool = buildSurpriseSeedPool({
      currentTrack: track("Current", "Room Artist"),
      roomHistory: [track("Room Pick", "Room Artist")],
      userHistory: [{ track: { title: "Personal Pick", author: "User Artist" } }],
      likedTracks: [{ title: "Liked Pick", author: "Liked Artist" }],
      topTracks: [{ track: "User Artist - Personal Pick", count: 8 }],
    });

    assert.equal(pool.length, 4);
    const personal = pool.find((seed) => seed.key === "user artist - personal pick");
    assert.ok(personal.sources.includes("history"));
    assert.ok(personal.sources.includes("top"));
    assert.equal(personal.frequency, 9);
  });

  test("does not repeat an intent and avoids recently used seeds", () => {
    const input = {
      roomHistory: [track("One", "Artist A"), track("Two", "Artist B"), track("Three", "Artist C")],
    };
    const first = selectSurpriseSeed(input, { random: () => 0, memoryKey: "listener" });
    const second = selectSurpriseSeed(input, { random: () => 0, memoryKey: "listener" });

    assert.notEqual(first.intent.mode, second.intent.mode);
    assert.notEqual(first.seedKey, second.seedKey);
  });

  test("returns null when no taste signal exists", () => {
    assert.equal(selectSurpriseSeed({}, { memoryKey: "empty" }), null);
  });

  test("uses positive feedback as a taste signal and excludes a rejected equivalent", () => {
    const pool = buildSurpriseSeedPool({
      feedbackTracks: [track("Keep This Feeling", "Artist A")],
      avoidTracks: [track("Skip This Direction", "Artist B")],
      roomHistory: [track("Skip This Direction", "Artist B")],
    });

    assert.equal(pool.length, 1);
    assert.equal(pool[0].key, "artist a - keep this feeling");
    assert.ok(pool[0].sources.includes("feedback"));
  });

  test("keeps empty-room freestyle inside a fresh, high-quality chart window", () => {
    const candidates = [
      { artist: "Chart One", title: "Top Signal", chartPosition: 1, popularity: 100 },
      { artist: "Chart Two", title: "Fresh Signal", chartPosition: 2, popularity: 96 },
      { artist: "Chart Three", title: "Third Signal", chartPosition: 3, popularity: 92 },
      { artist: "Chart Four", title: "Low Signal", chartPosition: 20, popularity: 88 },
    ];
    const memoryKey = "freestyle";
    const first = selectFreestyleCandidates(candidates.map((candidate) => ({ ...candidate, duration: 180_000 })), { memoryKey, count: 1, random: () => 0 })[0];
    rememberFreestyleCandidate(first, memoryKey);
    const second = selectFreestyleCandidates(candidates.map((candidate) => ({ ...candidate, duration: 180_000 })), { memoryKey, count: 1, random: () => 0 })[0];

    assert.equal(first.title, "Top Signal");
    assert.notEqual(second.title, first.title);
    assert.notEqual(second.title, "Low Signal");
  });

  test("uses distinct artists in a freestyle fallback shortlist when possible", () => {
    const selected = selectFreestyleCandidates([
      { artist: "Artist A", title: "One", chartPosition: 1, popularity: 100, duration: 180_000 },
      { artist: "Artist A", title: "Two", chartPosition: 2, popularity: 99, duration: 180_000 },
      { artist: "Artist B", title: "Three", chartPosition: 3, popularity: 98, duration: 180_000 },
      { artist: "Artist C", title: "Four", chartPosition: 4, popularity: 97, duration: 180_000 },
    ], { count: 3, random: () => 0, memoryKey: "artists" });

    assert.deepEqual(selected.map((candidate) => candidate.artist), ["Artist A", "Artist B", "Artist C"]);
  });

  test("accepts only whitelisted moods", () => {
    assert.equal(normalizeMood(" Chill "), "chill");
    assert.equal(normalizeMood("late"), "late");
    assert.equal(normalizeMood("__proto__"), null);
    assert.equal(normalizeMood("rage"), null);
    assert.equal(normalizeMood(undefined), null);
  });

  test("a mood forces its intent and carries goal and energy", () => {
    const input = { roomHistory: [track("One", "Artist A"), track("Two", "Artist B")] };
    // random 0 would otherwise pick the first non-blocked intent ("flow").
    const selection = selectSurpriseSeed(input, { random: () => 0, memoryKey: "mood", mood: "hype" });
    assert.equal(selection.intent.mode, MOODS.hype.intent);
    assert.equal(selection.intent.mood, "hype");
    assert.equal(selection.intent.goal, MOODS.hype.goal);
    assert.deepEqual(selection.intent.targetEnergy, { min: 70, max: 95 });
    assert.equal(getMoodEnergyCenter("hype"), 83);
    assert.equal(getMoodEnergyCenter("discover"), null);
  });

  test("a mood favours seeds already rated near its energy", () => {
    const calm = track("Calm", "Artist A");
    calm.userData = { aiDJ: { energy: 30 } };
    const loud = track("Loud", "Artist B");
    loud.userData = { aiDJ: { energy: 90 } };
    const picks = { calm: 0, loud: 0 };
    for (let index = 0; index < 40; index += 1) {
      clearSurpriseMemory();
      const roll = index / 40;
      const selection = selectSurpriseSeed({ roomHistory: [calm, loud] }, { random: () => roll, memoryKey: "energy", mood: "chill" });
      picks[selection.seed.info.title.toLowerCase()] += 1;
    }
    assert.ok(picks.calm > picks.loud * 2, `expected calm seeds to dominate: ${JSON.stringify(picks)}`);
  });

  test("intents without a mood keep their original shape", () => {
    assert.deepEqual(Object.keys(buildIntent("flow")).sort(), ["goal", "mode", "preferredLanes"]);
    assert.equal(buildIntent("freestyle", "focus").mood, "focus");
  });

  test("freestyle selection keeps tag candidates without a known duration", () => {
    const selected = selectFreestyleCandidates([
      { title: "Tagged", artist: "Artist A", duration: null, chartPosition: 1 },
      { title: "Too Short", artist: "Artist B", duration: 30_000, chartPosition: 2 },
    ], { count: 2, random: () => 0, memoryKey: "tags", window: 30 });
    assert.deepEqual(selected.map((candidate) => candidate.title), ["Tagged"]);
  });
});
