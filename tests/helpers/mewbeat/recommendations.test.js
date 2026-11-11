const assert = require("node:assert");
const { describe, it } = require("node:test");

const { CLASSICS } = require("../../../helpers/mewbeat/classics");
const { createDiscoverer } = require("../../../helpers/mewbeat/recommendDiscover");
const {
  MAX_PLAY_MS,
  createRecommender,
  createSearchBudget,
  identityOf,
  isOfferable,
  levelFor,
  playsOf,
  seedsOf,
  skillOf,
  stripOf,
} = require("../../../helpers/mewbeat/recommendations");
const { audioKeyOf, trackFromAudioKey } = require("../../../helpers/mewbeat/audioKey");

const CALIBRATION_AUDIO_KEY = audioKeyOf({ info: { sourceName: "mewbeat", identifier: "mewbeat:calibration:40:20:3000", length: 33_000 } });
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const keyOf = (id, length = 200_000) => `youtube:${id}:${length}`;
const song = (id, extra = {}) => ({
  audioKey: keyOf(id),
  uri: `https://y/${id}`,
  source: "youtube",
  title: `Song ${id}`,
  artist: `Artist ${id}`,
  artworkUrl: null,
  durationMs: 200_000,
  ...extra,
});
const round = (id, extra = {}) => ({ ...song(id), difficulty: "normal", accuracy: 95, grade: "S", ranked: true, failed: false, at: NOW - DAY, ...extra });

// Stars of the charts "that exist": id -> { level: stars }.
const starsTable = (table) => () => (audioKey) => table[audioKey] ?? null;

function storeOf({ rounds = [], played = [] } = {}) {
  const calls = [];
  return {
    calls,
    recent: (userId, limit) => { calls.push(["recent", userId, limit]); return rounds; },
    played: (options) => { calls.push(["played", options]); return options.userId ? rounds.filter((r, i, all) => all.findIndex((x) => x.audioKey === r.audioKey) === i).map((r) => ({ audioKey: r.audioKey, uri: r.uri, source: r.source, title: r.title, artist: r.artist, artworkUrl: r.artworkUrl, durationMs: r.durationMs, plays: 1, lastAt: r.at })) : played; },
  };
}

describe("mewbeat suggestions: pure parts", () => {
  it("keeps the play limit equal to the search's", () => {
    // songSearch loads Lavalink, so it is only read here, never from recommendations.js.
    const searchFile = require("node:fs").readFileSync(require.resolve("../../../helpers/mewbeat/songSearch"), "utf8");
    const declared = /MAX_PLAY_MS\s*=\s*([\d_]+)/.exec(searchFile);
    assert.ok(declared, "songSearch declares MAX_PLAY_MS");
    assert.strictEqual(MAX_PLAY_MS, Number(declared[1].replaceAll("_", "")));
  });

  it("names a song by its title and first artist word, ignoring brackets and accents", () => {
    assert.strictEqual(identityOf("Café (Remix)", "Léa X"), identityOf("Cafe", "lea y"));
    assert.notStrictEqual(identityOf("Cafe", "Lea"), identityOf("Cafe", "Bob"));
    assert.strictEqual(identityOf("", "x"), null);
  });

  it("offers only songs that can be played", () => {
    assert.strictEqual(isOfferable(song("ok")), true);
    assert.strictEqual(isOfferable(song("long", { audioKey: keyOf("long", 1_200_001) })), false);
    assert.strictEqual(isOfferable(song("max", { audioKey: keyOf("max", 1_200_000) })), true);
    assert.strictEqual(isOfferable(song("short", { audioKey: keyOf("short", 5_000) })), false);
    assert.strictEqual(isOfferable(song("bigdur", { durationMs: 2_000_000 })), false);
    assert.strictEqual(isOfferable({ ...song("stream"), audioKey: null }), false);
    assert.strictEqual(isOfferable({ ...song("nouri"), uri: "" }), false);
    assert.strictEqual(isOfferable(song("cal", { audioKey: CALIBRATION_AUDIO_KEY })), false);
    assert.strictEqual(isOfferable(null), false);
  });

  it("takes the best finished run per song and level, and skips failed, autoplay and unrated rounds", () => {
    const stars = { [keyOf("a")]: { normal: 3.1, hard: 5 } };
    const plays = playsOf([
      round("a", { accuracy: 80 }),
      round("a", { accuracy: 93, grade: "S" }),
      round("a", { difficulty: "hard", accuracy: 70 }),
      round("a", { accuracy: 99, failed: true }),
      round("a", { accuracy: 99, ranked: false }),
      round("a", { difficulty: "weird", accuracy: 99 }),
      round("b", { accuracy: undefined }),
    ], starsTable(stars)());
    assert.deepStrictEqual(plays.map((p) => [p.difficulty, p.accuracy, p.stars]).sort(), [["hard", 70, 5], ["normal", 93, 3.1]]);
  });

  it("works out the skill from the hardest good runs, or a discounted middle of everything", () => {
    assert.strictEqual(skillOf([]), null);
    assert.strictEqual(skillOf([{ stars: null, accuracy: 99 }]), null);
    const good = skillOf([
      { stars: 7, accuracy: 95 }, { stars: 6, accuracy: 91 }, { stars: 5, accuracy: 90 }, { stars: 4, accuracy: 99 },
      { stars: 3, accuracy: 99 }, { stars: 2, accuracy: 99 }, { stars: 9, accuracy: 50 },
    ]);
    assert.deepStrictEqual([good.basis, good.stars], ["good", 5]); // middle of 7, 6, 5, 4, 3
    const poor = skillOf([{ stars: 4, accuracy: 70 }, { stars: 6, accuracy: 80 }]);
    assert.strictEqual(poor.basis, "all");
    assert.ok(Math.abs(poor.stars - 5 * 0.85) < 1e-9);
  });

  it("picks the level a little above the skill, Normal without a skill, nothing without charts", () => {
    const stars = { easy: 1.5, normal: 3, hard: 5, hell: 8 };
    assert.strictEqual(levelFor(null, { stars: 4 }), null);
    assert.strictEqual(levelFor({ easy: null }, { stars: 4 }), null);
    assert.strictEqual(levelFor(stars, null).level, "normal");
    assert.strictEqual(levelFor({ easy: 1, hard: 5 }, null).level, "easy");
    assert.strictEqual(levelFor(stars, { stars: 4.4 }).level, "hard"); // target 4.75
    assert.strictEqual(levelFor(stars, { stars: 2.5 }).level, "normal"); // target 2.7
    assert.deepStrictEqual(levelFor(stars, { stars: 7 }), { level: "hell", stars: 8 });
  });

  it("seeds from what was played lately and well, one per artist, the song just played first", () => {
    const rounds = [
      round("a", { artist: "Same", at: NOW - 1 * DAY }),
      round("b", { artist: "Same", at: NOW - 1 * DAY }),
      round("c", { artist: "Other", accuracy: 60, at: NOW - 30 * DAY }),
      round("d", { artist: "Third", at: NOW - 2 * DAY }),
    ];
    const seeds = seedsOf(rounds, { now: NOW });
    assert.strictEqual(seeds.length, 2);
    assert.strictEqual(new Set(seeds.map((seed) => seed.artist)).size, 2);
    assert.ok(seeds.every((seed) => seed.role === "well"));

    const just = seedsOf(rounds, { now: NOW, justPlayed: keyOf("c") });
    assert.deepStrictEqual([just[0].audioKey, just[0].role], [keyOf("c"), "just"]);
    assert.strictEqual(seedsOf([], { now: NOW }).length, 0);
    assert.strictEqual(seedsOf([{ audioKey: "x", title: "t", artist: "" }], { now: NOW }).length, 0);
  });

  it("mixes the strip across the kinds, drops played and repeated songs, and lets an empty kind give way", () => {
    const row = (id, kind, extra) => ({ ...song(id), kind, ...extra });
    const sections = [
      { kind: "similar", rows: [] },
      { kind: "again", rows: [row("a1", "again"), row("a2", "again")] },
      { kind: "here", rows: [row("h1", "here"), row("a1", "here")] },
      { kind: "classic", rows: [row("c0", "classic", { played: true }), row("c1", "classic"), row("c2", "classic")] },
    ];
    const strip = stripOf(sections, 4);
    assert.deepStrictEqual(strip.map((r) => r.audioKey), [keyOf("a1"), keyOf("h1"), keyOf("c1"), keyOf("a2")]);
    assert.deepStrictEqual(stripOf([], 4), []);
  });
});

describe("mewbeat suggestions: search budget", () => {
  it("allows a few searches a minute for everybody and a few an hour for one player", () => {
    let clock = 0;
    const budget = createSearchBudget({ now: () => clock, perMinute: 3, perPlayer: 4, playerWindowMs: 3_600_000 });
    assert.deepStrictEqual([budget.take("a"), budget.take("b"), budget.take("c"), budget.take("d")], [true, true, true, false]);
    clock += 61_000;
    assert.strictEqual(budget.take("a"), true);
    assert.strictEqual(budget.take("a"), true);
    assert.strictEqual(budget.take("a"), true);
    clock += 61_000;
    assert.strictEqual(budget.take("a"), false); // a has had four in the hour
    assert.strictEqual(budget.take("z"), true);
    clock += 3_600_000;
    assert.strictEqual(budget.take("a"), true);
  });

  it("does not spend a place for a refused ask", () => {
    let clock = 0;
    const budget = createSearchBudget({ now: () => clock, perMinute: 1, perPlayer: 5 });
    assert.strictEqual(budget.take("a"), true);
    for (let i = 0; i < 10; i += 1) assert.strictEqual(budget.take("a"), false);
    clock += 61_000;
    assert.strictEqual(budget.take("a"), true);
  });
});

describe("mewbeat suggestions: recommender", () => {
  const stars = {
    [keyOf("known")]: { normal: 3, hard: 4 },
    [keyOf("here")]: { normal: 4 },
    [keyOf("close")]: { normal: 3 },
  };
  const build = (options = {}) => {
    const store = options.historyStore ?? storeOf({
      rounds: [
        round("known", { accuracy: 96, grade: "S", title: "Known" }),
        round("close", { accuracy: 75, grade: "C", title: "Close", at: NOW - 2 * DAY }),
      ],
      played: [
        { ...song("here"), plays: 4, lastAt: NOW - DAY },
        { ...song("known"), plays: 9, lastAt: NOW - DAY },
        { ...song("long", { audioKey: keyOf("long", 1_300_000) }), plays: 8, lastAt: NOW },
        { ...song("cal", { audioKey: CALIBRATION_AUDIO_KEY }), plays: 8, lastAt: NOW },
        { ...song("just"), plays: 3, lastAt: NOW },
      ],
    });
    return createRecommender({ historyStore: store, starsReader: starsTable(stars), now: () => NOW, ...options });
  };
  const rowsOf = (reply, kind) => reply.sections.find((section) => section.kind === kind).rows;

  it("answers from the stores alone and says what to try next", () => {
    const reply = build().forPlayer({ userId: "u", guildId: "g" });
    assert.strictEqual(reply.pending, false);
    assert.strictEqual(reply.skill.basis, "good");

    const again = rowsOf(reply, "again");
    const known = again.find((row) => row.audioKey === keyOf("known"));
    assert.deepStrictEqual([known.level, known.levelStars, known.reason], ["hard", 4, "S on Normal, try Hard"]);
    const close = again.find((row) => row.audioKey === keyOf("close"));
    assert.deepStrictEqual([close.level, close.reason], ["normal", "75% on Normal, one more go"]);

    const here = rowsOf(reply, "here");
    const fresh = here.find((row) => row.audioKey === keyOf("here"));
    assert.strictEqual(fresh.reason, "Played 4 times by others here");
    assert.strictEqual(fresh.level, "normal");
    assert.ok(here.every((row) => row.audioKey !== keyOf("known")), "a song the player knows is not a server pick");
  });

  it("never offers a song that cannot be played, the calibration track or the song just played", () => {
    const reply = build().forPlayer({ userId: "u", guildId: "g", seedKey: keyOf("just") });
    const all = reply.sections.flatMap((section) => section.rows).concat(reply.strip);
    const keys = new Set(all.map((row) => row.audioKey));
    assert.ok(!keys.has(keyOf("long", 1_300_000)));
    assert.ok(!keys.has(CALIBRATION_AUDIO_KEY));
    assert.ok(!keys.has(keyOf("just")));
    for (const row of all) assert.strictEqual(isOfferable(row), true, row.audioKey);
  });

  it("keeps a freshly played song out of the retry list for a while", () => {
    const store = storeOf({ rounds: [round("close", { accuracy: 70, at: NOW - 60_000 })] });
    const reply = build({ historyStore: store }).forPlayer({ userId: "u", guildId: "g" });
    assert.deepStrictEqual(rowsOf(reply, "again"), []);
  });

  it("gives a player with no history the classics and what the server plays", () => {
    const store = storeOf({ played: [{ ...song("here"), plays: 5, lastAt: NOW }] });
    const reply = build({ historyStore: store }).forPlayer({ userId: "new", guildId: "g" });
    assert.strictEqual(reply.skill, null);
    assert.strictEqual(rowsOf(reply, "again").length, 0);
    assert.strictEqual(rowsOf(reply, "similar").length, 0);
    assert.strictEqual(rowsOf(reply, "here").length, 1);
    assert.strictEqual(rowsOf(reply, "classic").length, CLASSICS.length);
    assert.ok(reply.strip.length > 0);
  });

  it("orders the classics per player and puts those the player has played last", () => {
    const first = CLASSICS[0];
    const store = storeOf({ rounds: [round("x", { ...song("x"), audioKey: first.audioKey, title: first.title, artist: first.artist })] });
    const mine = build({ historyStore: store }).forPlayer({ userId: "u", guildId: "g" });
    const classics = rowsOf(mine, "classic");
    assert.strictEqual(classics.length, CLASSICS.length);
    assert.strictEqual(classics[classics.length - 1].audioKey, first.audioKey);
    assert.strictEqual(classics[classics.length - 1].played, true);
    const orders = new Set(["a", "b", "c", "d", "e"].map((id) => rowsOf(build().forPlayer({ userId: id, guildId: "g" }), "classic")[0].audioKey));
    assert.ok(orders.size > 1, "everybody does not start with the same classic");
  });

  it("reads the stores only, never anything that makes a chart", () => {
    const store = storeOf({ rounds: [round("known")] });
    let starsReads = 0;
    const recommender = createRecommender({
      historyStore: store,
      starsReader: () => { starsReads += 1; return () => null; },
      now: () => NOW,
    });
    recommender.forPlayer({ userId: "u", guildId: "g" });
    assert.strictEqual(starsReads, 1, "one read of the chart flags for the whole reply");
    assert.ok(store.calls.every(([name]) => name === "recent" || name === "played"));
  });

  it("works out a player's rows once until a new run makes them stale", () => {
    const store = storeOf({ rounds: [round("known")] });
    const recommender = build({ historyStore: store });
    recommender.forPlayer({ userId: "u", guildId: "g" });
    const reads = store.calls.length;
    recommender.forPlayer({ userId: "u", guildId: "g" });
    assert.strictEqual(store.calls.length, reads);
    recommender.forget("u");
    recommender.forPlayer({ userId: "u", guildId: "g" });
    assert.ok(store.calls.length > reads);
  });

  describe("new songs", () => {
    const found = (id, score = 70, extra) => ({ ...song(id), score, ...extra });
    const seededRounds = [round("known", { artist: "Seed Artist", title: "Seed Song" })];

    it("starts no search without a discoverer, and answers at once with one", async () => {
      const store = storeOf({ rounds: seededRounds });
      const plain = build({ historyStore: store }).forPlayer({ userId: "u", guildId: "g" });
      assert.deepStrictEqual([plain.pending, rowsOf(plain, "similar")], [false, []]);

      const asked = [];
      const recommender = build({
        historyStore: store,
        discover: async (seed) => { asked.push(seed); return [found("n1"), found("n2", 60), found("weak", 10)]; },
      });
      const first = recommender.forPlayer({ userId: "u", guildId: "g" });
      assert.strictEqual(first.pending, true);
      assert.deepStrictEqual(rowsOf(first, "similar"), []);
      assert.ok(rowsOf(first, "classic").length > 0, "the other kinds are there while the search runs");
      await recommender.idle();
      const second = recommender.forPlayer({ userId: "u", guildId: "g" });
      assert.strictEqual(second.pending, false);
      const similar = rowsOf(second, "similar");
      assert.deepStrictEqual(similar.map((row) => row.audioKey), [keyOf("n1"), keyOf("n2")]);
      assert.strictEqual(similar[0].reason, "Because you did well on Seed Song");
      assert.deepStrictEqual(asked, [{ title: "Seed Song", artist: "Seed Artist" }]);
    });

    it("shares one discovery between players and does not repeat it", async () => {
      const store = storeOf({ rounds: seededRounds });
      let calls = 0;
      const recommender = build({ historyStore: store, discover: async () => { calls += 1; return [found("n1")]; } });
      recommender.forPlayer({ userId: "u1", guildId: "g" });
      recommender.forPlayer({ userId: "u2", guildId: "g" });
      await recommender.idle();
      recommender.forPlayer({ userId: "u3", guildId: "g" });
      assert.strictEqual(calls, 1);
    });

    it("does not offer a found song the player already has, one too long, or a repeat of another seed's", async () => {
      const store = storeOf({ rounds: [...seededRounds, round("other", { artist: "Second", title: "Second Song" })] });
      const recommender = build({
        historyStore: store,
        discover: async () => [
          found("known", 90), found("long", 90, { audioKey: keyOf("long", 1_500_000) }), found("dupe", 80), found("dupe2", 70, { title: "Song dupe", artist: "Artist dupe" }),
          found("fine", 60),
        ],
      });
      recommender.forPlayer({ userId: "u", guildId: "g" });
      await recommender.idle();
      const keys = rowsOf(recommender.forPlayer({ userId: "u", guildId: "g" }), "similar").map((row) => row.audioKey);
      assert.deepStrictEqual(keys, [keyOf("dupe"), keyOf("fine")]);
    });

    it("falls back to the other kinds when the search fails, and tries again only later", async () => {
      let clock = NOW;
      let calls = 0;
      const recommender = build({
        historyStore: storeOf({ rounds: seededRounds }),
        now: () => clock,
        discover: async () => { calls += 1; throw new Error("lavalink down"); },
      });
      recommender.forPlayer({ userId: "u", guildId: "g" });
      await recommender.idle();
      const reply = recommender.forPlayer({ userId: "u", guildId: "g" });
      assert.strictEqual(reply.pending, false);
      assert.deepStrictEqual(rowsOf(reply, "similar"), []);
      assert.ok(rowsOf(reply, "classic").length > 0);
      assert.strictEqual(calls, 1);
      clock += 60_000;
      recommender.forPlayer({ userId: "u", guildId: "g" });
      assert.strictEqual(calls, 1, "a failure is not asked again at once");
      clock += 6 * 60_000;
      recommender.forPlayer({ userId: "u", guildId: "g" });
      await recommender.idle();
      assert.strictEqual(calls, 2);
    });

    it("gives up on a search that takes too long", async () => {
      const recommender = build({
        historyStore: storeOf({ rounds: seededRounds }),
        discoverTimeoutMs: 20,
        discover: () => new Promise(() => {}),
      });
      assert.strictEqual(recommender.forPlayer({ userId: "u", guildId: "g" }).pending, true);
      await recommender.idle();
      const reply = recommender.forPlayer({ userId: "u", guildId: "g" });
      assert.strictEqual(reply.pending, false);
      assert.deepStrictEqual(rowsOf(reply, "similar"), []);
    });

    it("stops searching when the budget is spent, and still answers", async () => {
      let calls = 0;
      const recommender = build({
        historyStore: storeOf({ rounds: seededRounds }),
        budget: { take: () => false },
        discover: async () => { calls += 1; return [found("n1")]; },
      });
      const reply = recommender.forPlayer({ userId: "u", guildId: "g" });
      await recommender.idle();
      assert.strictEqual(calls, 0);
      assert.strictEqual(reply.pending, false);
      assert.ok(rowsOf(reply, "again").length + rowsOf(reply, "classic").length > 0);
    });

    it("limits the searches one player can start with the default budget", async () => {
      let calls = 0;
      const recommender = build({
        historyStore: storeOf({ rounds: ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => round(id, { artist: `Band ${id}`, title: `T ${id}` })) }),
        discover: async () => { calls += 1; return []; },
      });
      for (let i = 0; i < 6; i += 1) {
        recommender.forPlayer({ userId: "u", guildId: "g", seedKey: keyOf("abcdefgh"[i]) });
        await recommender.idle();
      }
      assert.ok(calls <= 3, `at most three searches a minute, saw ${calls}`);
    });
  });
});

describe("mewbeat suggestions: discovery", () => {
  const fakeModules = (scored) => ({
    candidates: {
      cleanTrackInfo: (title, author) => ({ cleanTitle: title, searchArtist: author }),
      fetchLastFmCandidates: async () => scored.map((entry) => entry.candidate),
    },
    v3: {
      buildSelectionContext: () => ({}),
      scoreCandidateV3: (candidate) => scored.find((entry) => entry.candidate === candidate).result,
    },
    tags: { getLastFmTagProfile: async () => ({ tags: ["rock"] }) },
  });
  const candidate = (id, info) => ({ title: `T${id}`, artist: `A${id}`, track: { info: { sourceName: "youtube", identifier: id, length: 200_000, uri: `https://y/${id}`, isStream: false, ...info } } });

  it("answers nothing without a Last.fm key, and loads nothing", async () => {
    let loaded = 0;
    const discover = createDiscoverer({ hasKey: () => false, loadAutoplay: () => { loaded += 1; return {}; } });
    assert.deepStrictEqual(await discover({ title: "a", artist: "b" }), []);
    assert.strictEqual(loaded, 0);
  });

  it("keeps the playable songs autoplay's score accepts, best first", async () => {
    const modules = fakeModules([
      { candidate: candidate("low"), result: { score: 50, details: {} } },
      { candidate: candidate("high"), result: { score: 90, details: { genreFlow: { allowed: true } } } },
      { candidate: candidate("flow"), result: { score: 99, details: { genreFlow: { allowed: false } } } },
      { candidate: candidate("weak"), result: { score: 20, details: {} } },
      { candidate: candidate("stream", { isStream: true }), result: { score: 99, details: {} } },
    ]);
    const discover = createDiscoverer({ hasKey: () => true, loadAutoplay: () => modules });
    const rows = await discover({ title: "Seed", artist: "Band" });
    assert.deepStrictEqual(rows.map((row) => row.title), ["Thigh", "Tlow"]);
    assert.deepStrictEqual(rows[0].audioKey, keyOf("high"));
    assert.ok(rows.every((row) => trackFromAudioKey(row.audioKey)));
  });
});

describe("mewbeat suggestions: rhythm game classics", () => {
  it("has between forty and sixty entries with unique ids and keys", () => {
    assert.ok(CLASSICS.length >= 40 && CLASSICS.length <= 60, `count ${CLASSICS.length}`);
    assert.strictEqual(new Set(CLASSICS.map((entry) => entry.id)).size, CLASSICS.length);
    assert.strictEqual(new Set(CLASSICS.map((entry) => entry.audioKey)).size, CLASSICS.length);
    assert.strictEqual(new Set(CLASSICS.map((entry) => identityOf(entry.title, entry.artist))).size, CLASSICS.length);
  });

  it("holds only playable songs whose key matches the link", () => {
    for (const entry of CLASSICS) {
      for (const field of ["id", "title", "artist", "game", "uri", "audioKey"]) assert.ok(typeof entry[field] === "string" && entry[field], `${entry.id} ${field}`);
      const track = trackFromAudioKey(entry.audioKey);
      assert.ok(track, entry.audioKey);
      assert.strictEqual(track.info.sourceName, entry.source);
      assert.strictEqual(track.info.identifier, new URL(entry.uri).searchParams.get("v"));
      assert.strictEqual(entry.audioKey, `youtube:${track.info.identifier}:${entry.durationMs}`);
            assert.strictEqual(isOfferable(entry), true, entry.id);
      assert.ok(entry.durationMs <= MAX_PLAY_MS);
    }
  });

  it("is frozen, so no request can change it", () => {
    assert.strictEqual(Object.isFrozen(CLASSICS), true);
  });
});
