const assert = require("node:assert");
const { afterEach, beforeEach, describe, it } = require("node:test");

const {
  LANE_COOLDOWN_MS,
  LANE_FAILURE_STREAK,
  clearSearchCache,
  isLaneResting,
  searchAcrossSources,
  searchSingleSource,
} = require("../../../helpers/lavalink/searchAggregator");
const {
  annotateSearchPopularity,
  clearSearchPopularityCache,
  getRecordingKey,
  getTrackKeys,
  isSearchPopularityEnabled,
  lookupSearchPopularity,
  toPopularity,
} = require("../../../helpers/lavalink/searchPopularity");
const {
  filterRelevantSearchResults,
  getFeaturedCredits,
  getPopularityBonus,
  getPopularityShare,
  rankSearchResults,
  scoreSearchResult,
} = require("../../../helpers/lavalink/searchRanking");
const realPools = require("../../fixtures/search/real-search-pools.json");

function createTrack(sourceName, author, title, identifier = `${author}-${title}`) {
  return { info: { sourceName, author, title, identifier } };
}

function deezerRow(id, name, title, rank) {
  return { id, title, artist: { name }, rank };
}

function jsonResponse(payload, { ok = true } = {}) {
  return { ok, json: async () => payload };
}

// Pools and Deezer rows captured from the production bot (Lavalink on the Pi)
// in October 2026: [sourceName, author, title, identifier] and
// [deezerId, artistName, title, rank].
function loadRealPool(query, { popularity = true } = {}) {
  const fixture = realPools[query];
  const pool = fixture.pool.map(([sourceName, author, title, identifier]) =>
    createTrack(sourceName, author, title, identifier)
  );
  if (popularity) {
    annotateSearchPopularity(
      pool,
      toPopularity({ data: fixture.deezer.map(([id, name, title, rank]) => deezerRow(id, name, title, rank)) })
    );
  }
  return { pool, rankQuery: fixture.rankQuery };
}

function rankRealPool(query, options) {
  const { pool, rankQuery } = loadRealPool(query, options);
  return rankSearchResults(filterRelevantSearchResults(pool, rankQuery), rankQuery, { limit: 48 });
}

const describeTrack = (track) => `${track.info.author} — ${track.info.title}`;

describe("Search popularity recording keys", () => {
  it("gives a VEVO upload and its catalogue row the same key", () => {
    assert.strictEqual(
      getRecordingKey("TheWeekndVEVO", "The Weeknd - Blinding Lights (Official Video)"),
      getRecordingKey("The Weeknd", "Blinding Lights")
    );
  });

  it("drops Topic channels, guests and soundtrack credits", () => {
    assert.strictEqual(getRecordingKey("Kenshi Yonezu - Topic", "KICK BACK"), "kenshi yonezu|kick back");
    assert.strictEqual(getRecordingKey("Sidney Polak", "Otwieram wino (feat. Pezet)"), "sidney polak|otwieram wino");
    assert.strictEqual(getRecordingKey("Drake", "Hotline Bling ft. Someone"), "drake|hotline bling");
    assert.strictEqual(getRecordingKey("Artist", "Song (from \"Some Film\")"), "artist|song");
  });

  it("keeps a remix, live take or demo apart from its original", () => {
    assert.strictEqual(getRecordingKey("Petite Meller", "High Forever (Marlon Hoffstadt Remix)"), "petite meller|high forever|remix");
    assert.notStrictEqual(getRecordingKey("Metallica", "One (November 1987, Writing in Progress)"), getRecordingKey("Metallica", "One"));
    assert.notStrictEqual(getRecordingKey("Linkin Park", "Numb (Live)"), getRecordingKey("Linkin Park", "Numb"));
  });

  it("treats a remaster as the same recording", () => {
    assert.strictEqual(getRecordingKey("Metallica", "One (Remastered)"), getRecordingKey("Metallica", "One"));
  });

  it("strips square brackets only when asked to", () => {
    const title = "High Forever [Cyberpunk Edgerunners 2]";
    assert.notStrictEqual(getRecordingKey("Petite Meller", title), "petite meller|high forever");
    assert.strictEqual(getRecordingKey("Petite Meller", title, { stripBrackets: true }), "petite meller|high forever");
  });

  it("has no key without an artist or a title", () => {
    assert.strictEqual(getRecordingKey("", "Song"), null);
    assert.strictEqual(getRecordingKey("Artist", ""), null);
  });

  it("adds the primary artist and bracket-free keys for a track", () => {
    const keys = getTrackKeys(createTrack("spotify", "Daft Punk & Pharrell Williams", "Get Lucky [Radio Edit]"));
    assert.ok(keys.includes("daft punk|get lucky"));
    assert.ok(keys.includes("daft punk and pharrell williams|get lucky"));
    assert.strictEqual(new Set(keys).size, keys.length);
    assert.ok(keys.length <= 4);
  });
});

describe("Search popularity payload", () => {
  it("indexes ranks by recording key and Deezer id and keeps the best rank", () => {
    const popularity = toPopularity({
      data: [
        deezerRow(1, "The Weeknd", "Blinding Lights", 900_000),
        deezerRow(2, "The Weeknd", "Blinding Lights", 950_000),
        deezerRow(3, "Quartet", "Blinding Lights", 400_000),
      ],
    });

    assert.strictEqual(popularity.byKey.get("the weeknd|blinding lights"), 950_000);
    assert.strictEqual(popularity.byDeezerId.get("1"), 900_000);
    assert.strictEqual(popularity.maxRank, 950_000);
  });

  it("skips rows without a positive rank, a title or an artist", () => {
    const popularity = toPopularity({
      data: [
        deezerRow(1, "A", "Song", 0),
        deezerRow(2, "A", "Song", "nope"),
        { id: 3, title: "Song", rank: 10 },
        deezerRow(4, "A", "", 10),
        null,
        deezerRow(5, "B", "Song", 20),
      ],
    });

    assert.deepStrictEqual([...popularity.byKey.keys()], ["b|song"]);
    assert.strictEqual(popularity.maxRank, 20);
  });

  it("tolerates a payload without data", () => {
    for (const payload of [null, {}, { data: "x" }, { error: { code: 4 } }]) {
      assert.strictEqual(toPopularity(payload).maxRank, 0);
    }
  });
});

describe("Search popularity lookup", () => {
  beforeEach(() => clearSearchPopularityCache());

  it("asks Deezer's public search for the query with fifty results", async () => {
    const urls = [];
    const popularity = await lookupSearchPopularity("Blinding Lights", {
      fetchImpl: async (url) => {
        urls.push(url);
        return jsonResponse({ data: [deezerRow(1, "The Weeknd", "Blinding Lights", 900)] });
      },
    });

    assert.strictEqual(urls.length, 1);
    const url = new URL(urls[0]);
    assert.strictEqual(url.origin + url.pathname, "https://api.deezer.com/search/track");
    assert.strictEqual(url.searchParams.get("q"), "Blinding Lights");
    assert.strictEqual(url.searchParams.get("limit"), "50");
    assert.strictEqual(popularity.maxRank, 900);
  });

  it("caches by normalized query", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({ data: [deezerRow(1, "Pezet", "Plan B", 10)] });
    };

    const first = await lookupSearchPopularity("Pezet", { fetchImpl });
    const second = await lookupSearchPopularity("  pezet ", { fetchImpl });

    assert.strictEqual(calls, 1);
    assert.strictEqual(second, first);
  });

  it("shares one request between simultaneous lookups", async () => {
    let calls = 0;
    let release;
    const fetchImpl = () => {
      calls += 1;
      return new Promise((resolve) => {
        release = () => resolve(jsonResponse({ data: [deezerRow(1, "Queen", "Bohemian Rhapsody", 5)] }));
      });
    };

    const pending = [lookupSearchPopularity("bohemian rhapsody", { fetchImpl }), lookupSearchPopularity("Bohemian Rhapsody", { fetchImpl })];
    await new Promise((resolve) => setImmediate(resolve));
    release();
    const [first, second] = await Promise.all(pending);

    assert.strictEqual(calls, 1);
    assert.strictEqual(first, second);
  });

  it("returns null for an HTTP error, a thrown fetch or bad JSON, and does not cache it", async () => {
    const failures = [
      async () => jsonResponse({}, { ok: false }),
      async () => {
        throw new Error("ECONNRESET");
      },
      async () => ({ ok: true, json: async () => JSON.parse("{") }),
    ];

    for (const fetchImpl of failures) {
      assert.strictEqual(await lookupSearchPopularity("numb", { fetchImpl }), null);
    }

    const recovered = await lookupSearchPopularity("numb", {
      fetchImpl: async () => jsonResponse({ data: [deezerRow(1, "Linkin Park", "Numb", 7)] }),
    });
    assert.strictEqual(recovered.maxRank, 7);
  });

  it("gives up after its timeout instead of holding search back", async () => {
    let aborted = false;
    const started = Date.now();
    const popularity = await lookupSearchPopularity("slow", {
      timeoutMs: 30,
      fetchImpl: (url, { signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    });

    assert.strictEqual(popularity, null);
    assert.ok(aborted);
    assert.ok(Date.now() - started < 1_000);
  });

  it("does nothing for an empty query or without fetch", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({ data: [] });
    };
    assert.strictEqual(await lookupSearchPopularity("   ", { fetchImpl }), null);
    assert.strictEqual(await lookupSearchPopularity("?!", { fetchImpl }), null);
    assert.strictEqual(await lookupSearchPopularity("numb", { fetchImpl: null }), null);
    assert.strictEqual(calls, 0);
  });

  it("is on unless SEARCH_POPULARITY is false", () => {
    const previous = process.env.SEARCH_POPULARITY;
    try {
      delete process.env.SEARCH_POPULARITY;
      assert.strictEqual(isSearchPopularityEnabled(), true);
      process.env.SEARCH_POPULARITY = "TRUE";
      assert.strictEqual(isSearchPopularityEnabled(), true);
      process.env.SEARCH_POPULARITY = " False ";
      assert.strictEqual(isSearchPopularityEnabled(), false);
    } finally {
      if (previous === undefined) delete process.env.SEARCH_POPULARITY;
      else process.env.SEARCH_POPULARITY = previous;
    }
  });
});

describe("Search popularity annotation", () => {
  const popularity = toPopularity({
    data: [
      deezerRow(908604612, "The Weeknd", "Blinding Lights", 984_833),
      deezerRow(42, "Sidney Polak", "Otwieram wino (feat. Pezet)", 500_000),
      deezerRow(43, "Quartet", "Blinding Lights", 480_000),
    ],
  });

  it("matches a Deezer track by id even when its title differs", () => {
    const track = createTrack("deezer", "The Weeknd", "Blinding Lights - Radio", "908604612");
    assert.strictEqual(annotateSearchPopularity([track], popularity), 1);
    assert.strictEqual(track.searchPopularity, 984_833);
  });

  it("matches other providers by recording key and primary artist", () => {
    const vevo = createTrack("youtube", "TheWeekndVEVO", "The Weeknd - Blinding Lights (Official Video)");
    const duet = createTrack("spotify", "Sidney Polak, Pezet", "Otwieram wino");
    const stranger = createTrack("youtube", "Somebody", "Blinding Lights");

    assert.strictEqual(annotateSearchPopularity([vevo, duet, stranger], popularity), 2);
    assert.strictEqual(vevo.searchPopularity, 984_833);
    assert.strictEqual(duet.searchPopularity, 500_000);
    assert.strictEqual(stranger.searchPopularity, undefined);
  });

  it("annotates Poru's class instances in place", () => {
    class Track {
      constructor(info) {
        this.info = info;
      }
      resolve() {
        return "resolved";
      }
    }
    const track = new Track({ sourceName: "youtube", author: "The Weeknd", title: "Blinding Lights" });
    const tracks = [track];

    annotateSearchPopularity(tracks, popularity);

    assert.strictEqual(tracks[0], track);
    assert.ok(track instanceof Track);
    assert.strictEqual(track.resolve(), "resolved");
    assert.strictEqual(track.searchPopularity, 984_833);
  });

  it("leaves tracks alone without popularity", () => {
    const track = createTrack("youtube", "The Weeknd", "Blinding Lights");
    assert.strictEqual(annotateSearchPopularity([track], null), 0);
    assert.strictEqual(annotateSearchPopularity([track], toPopularity({ data: [] })), 0);
    assert.strictEqual(annotateSearchPopularity(null, popularity), 0);
    assert.strictEqual(track.searchPopularity, undefined);
  });
});

describe("Search ranking with catalogue popularity", () => {
  it("measures popularity against the pool's best rank", () => {
    assert.strictEqual(getPopularityShare({ searchPopularity: 500 }, 1_000), 0.5);
    assert.strictEqual(getPopularityShare({ searchPopularity: 2_000 }, 1_000), 1);
    assert.strictEqual(getPopularityShare({}, 1_000), 0);
    assert.strictEqual(getPopularityShare({ searchPopularity: 500 }, 0), 0);
  });

  it("only rewards strong matches, mostly near the top", () => {
    assert.strictEqual(getPopularityBonus({ popularityShare: 1, score: 400 }), 70);
    assert.strictEqual(getPopularityBonus({ popularityShare: 0.5, score: 400 }), 9);
    assert.strictEqual(getPopularityBonus({ popularityShare: 1, score: 200 }), 0);
    assert.strictEqual(getPopularityBonus({ popularityShare: 0, score: 400 }), 0);
    assert.strictEqual(getPopularityBonus(null), 0);
  });

  it("splits guest credits from the main title", () => {
    const credits = getFeaturedCredits("Otwieram wino (feat. Pezet)");
    assert.deepStrictEqual(credits.featuredTokens, ["pezet"]);
    assert.ok(!credits.mainTitleTokens.includes("pezet"));
    assert.deepStrictEqual(getFeaturedCredits("Song ft. Guest").featuredTokens, ["guest"]);
    assert.deepStrictEqual(getFeaturedCredits("Plan B").featuredTokens, []);
  });

  it("marks a song that names the searched artist only as a guest", () => {
    const guest = scoreSearchResult(createTrack("spotify", "Sidney Polak", "Otwieram wino (feat. Pezet)"), "pezet");
    const own = scoreSearchResult(createTrack("spotify", "Pezet", "Plan B"), "pezet");
    assert.ok(guest.reasons.includes("featured artist only"));
    assert.ok(!own.reasons.includes("featured artist only"));
  });

  it("does not mark a guest credit the query also names in the title", () => {
    const entry = scoreSearchResult(createTrack("spotify", "Artist", "Pezet (feat. Pezet)"), "pezet");
    assert.ok(!entry.reasons.includes("featured artist only"));
  });

  it("waives the single-word uploader penalty only for catalogued artists", () => {
    const track = createTrack("youtube", "sanah", "Szampan");
    const unknown = scoreSearchResult(track, "sanah");
    const catalogued = scoreSearchResult(track, "sanah", 0, { popularityShare: 0.6 });

    assert.ok(unknown.reasons.includes("uploader-only single-word penalty"));
    assert.ok(catalogued.reasons.includes("catalogued artist"));
    assert.ok(catalogued.reasons.includes("catalog popularity:0.60"));
    assert.strictEqual(catalogued.score - unknown.score, 220);
  });

  it("puts the original above its slowed, 8-bit and parody versions", () => {
    const tracks = [
      createTrack("youtube", "Fan", "Not Like Us (8-Bit Emulation)"),
      createTrack("youtube", "Fan", "Not Like Us (Slowed + Reverb)"),
      createTrack("youtube", "Fan", "Not Like Us (Parody)"),
      createTrack("youtube", "Kendrick Lamar", "Not Like Us"),
    ];
    const ranked = rankSearchResults(tracks, "not like us");
    assert.strictEqual(ranked[0].info.author, "Kendrick Lamar");
  });

  it("lifts the popular recording among same-titled results", () => {
    const tracks = [
      createTrack("youtube", "Vitamin String Quartet", "Blinding Lights"),
      createTrack("youtube", "The Weeknd", "Blinding Lights"),
    ];
    tracks[0].searchPopularity = 480_000;
    tracks[1].searchPopularity = 984_833;

    assert.strictEqual(rankSearchResults(tracks, "blinding lights")[0].info.author, "The Weeknd");
  });

  it("does not make a weak match relevant because it is popular", () => {
    const tracks = [createTrack("youtube", "Someone", "Blinding Lights"), createTrack("youtube", "The Weeknd", "Save Your Tears")];
    tracks[1].searchPopularity = 1_000_000;
    tracks[0].searchPopularity = 1;

    assert.strictEqual(rankSearchResults(tracks, "blinding lights")[0].info.title, "Blinding Lights");
  });

  it("ranks exactly as before when no track carries popularity", () => {
    const tracks = [
      createTrack("youtube", "Linkin Park", "Numb"),
      createTrack("spotify", "Marshmello", "Numb"),
      createTrack("youtube", "Elderbrook", "Numb"),
    ];
    const plain = rankSearchResults(tracks, "numb", { withScores: true });
    const zeroed = rankSearchResults(
      tracks.map((track) => ({ ...track, searchPopularity: 0 })),
      "numb",
      { withScores: true }
    );

    assert.deepStrictEqual(
      plain.map((entry) => [entry.track.info.author, entry.effectiveScore]),
      zeroed.map((entry) => [entry.track.info.author, entry.effectiveScore])
    );
  });
});

describe("Search ranking on real provider pools", () => {
  const firstAuthor = (query) => rankRealPool(query)[0].info.author;

  it("finds The Weeknd for blinding lights, which a cover used to lead", () => {
    assert.notStrictEqual(rankRealPool("blinding lights", { popularity: false })[0].info.author, "The Weeknd");
    assert.strictEqual(firstAuthor("blinding lights"), "The Weeknd");
  });

  for (const [query, author, title] of [
    ["lose yourself", "Eminem", "Lose Yourself"],
    ["kickback", "Kenshi Yonezu", "KICK BACK"],
    ["bohemian rhapsody", "Queen", "Bohemian Rhapsody"],
    ["numb", "Linkin Park", "Numb"],
    ["smells like teen spirit", "Nirvana", "Smells Like Teen Spirit"],
    ["kendrick lamar not like us", "Kendrick Lamar", "Not Like Us"],
    ["metalica one", "Metallica", "One"],
  ]) {
    it(`puts ${author} — ${title} first for "${query}"`, () => {
      const [top] = rankRealPool(query);
      assert.strictEqual(top.info.author, author, describeTrack(top));
      assert.strictEqual(top.info.title, title, describeTrack(top));
    });
  }

  it("leads with Pezet's own songs, not the ones he guests on", () => {
    const ranked = rankRealPool("pezet");
    const top = ranked.slice(0, 5);
    assert.ok(top.every((track) => track.info.author === "Pezet"), top.map(describeTrack).join("; "));
    assert.ok(!ranked.slice(0, 3).some((track) => /feat/i.test(track.info.title)));
  });

  it("keeps the High Forever original first and its Edgerunners remix second", () => {
    const [first, second] = rankRealPool("high forever");
    assert.strictEqual(describeTrack(first), "Petite Meller — High Forever");
    assert.strictEqual(describeTrack(second), "Petite Meller — High Forever (Marlon Hoffstadt Remix)");
  });

  it("keeps 8-bit, parody and instrumental takes out of the top two for not like us", () => {
    const top = rankRealPool("kendrick lamar not like us").slice(0, 2);
    assert.ok(!top.some((track) => /8.?bit|parody|instrumental|emulation/i.test(track.info.title)), top.map(describeTrack).join("; "));
  });

  it("lists Metallica's studio One before its live and demo takes", () => {
    const ranked = rankRealPool("metalica one");
    assert.strictEqual(ranked[0].info.title, "One");
    const demo = ranked.findIndex((track) => /Writing in Progress/.test(track.info.title));
    assert.ok(demo === -1 || demo > 0);
  });

  for (const [query, author] of [
    ["sanah", "sanah"],
    ["taco hemingway", "Taco Hemingway"],
    ["bletka", "Bletka"],
  ]) {
    it(`fills the top five for "${query}" with the artist's own songs`, () => {
      const top = rankRealPool(query).slice(0, 5);
      assert.ok(
        top.every((track) => track.info.author.toLowerCase() === author.toLowerCase()),
        top.map(describeTrack).join("; ")
      );
    });
  }

  it("leads an artist search with their most played song", () => {
    for (const query of ["taco hemingway", "sanah", "pezet"]) {
      const ranked = rankRealPool(query);
      const best = Math.max(...ranked.map((track) => track.searchPopularity || 0));
      assert.ok(ranked.slice(0, 5).every((track) => track.searchPopularity > 0), query);
      assert.ok(ranked.slice(0, 2).some((track) => track.searchPopularity === best), query);
    }
  });

  it("annotates a meaningful share of every real pool", () => {
    for (const query of Object.keys(realPools)) {
      const { pool } = loadRealPool(query);
      const matched = pool.filter((track) => track.searchPopularity > 0).length;
      assert.ok(matched >= 3, `${query}: ${matched} of ${pool.length}`);
    }
  });
});

describe("Search aggregation with popularity", () => {
  beforeEach(() => clearSearchCache());
  afterEach(() => clearSearchCache());

  const lookupFor = (rows) => async () => toPopularity({ data: rows });

  it("annotates tracks from every source with the lookup's ranks", async () => {
    const poru = {
      resolve: async ({ source }) =>
        source === "ytmsearch"
          ? { tracks: [createTrack("youtube", "The Weeknd", "Blinding Lights")] }
          : { tracks: [createTrack("spotify", "Quartet", "Blinding Lights")] },
    };
    const queries = [];
    const tracks = await searchAcrossSources(poru, "blinding lights", {
      preferredSource: "youtube",
      popularityLookup: async (query) => {
        queries.push(query);
        return toPopularity({ data: [deezerRow(1, "The Weeknd", "Blinding Lights", 900)] });
      },
    });

    assert.deepStrictEqual(queries, ["blinding lights"]);
    assert.strictEqual(tracks.find((track) => track.info.author === "The Weeknd").searchPopularity, 900);
    assert.strictEqual(tracks.find((track) => track.info.author === "Quartet").searchPopularity, undefined);
  });

  it("keeps ranks on a cached result", async () => {
    let lookups = 0;
    const poru = { resolve: async () => ({ tracks: [createTrack("youtube", "Pezet", "Plan B")] }) };
    const popularityLookup = async () => {
      lookups += 1;
      return toPopularity({ data: [deezerRow(1, "Pezet", "Plan B", 50)] });
    };

    await searchSingleSource(poru, "pezet plan b", "youtube", { popularityLookup });
    const cached = await searchSingleSource(poru, "pezet plan b", "youtube", { popularityLookup });

    assert.strictEqual(lookups, 1);
    assert.strictEqual(cached[0].searchPopularity, 50);
  });

  it("still returns tracks when the lookup fails or finds nothing", async () => {
    const poru = { resolve: async () => ({ tracks: [createTrack("youtube", "Linkin Park", "Numb")] }) };
    for (const popularityLookup of [
      async () => {
        throw new Error("Deezer down");
      },
      () => {
        throw new Error("sync failure");
      },
      async () => null,
    ]) {
      clearSearchCache();
      const tracks = await searchAcrossSources(poru, "numb", { preferredSource: "youtube", popularityLookup });
      assert.ok(tracks.length > 0);
      assert.ok(tracks.every((track) => track.searchPopularity === undefined));
    }
  });

  it("skips the lookup when popularity is off and caches that separately", async () => {
    let lookups = 0;
    const poru = { resolve: async () => ({ tracks: [createTrack("youtube", "Linkin Park", "Numb")] }) };
    const popularityLookup = async () => {
      lookups += 1;
      return toPopularity({ data: [deezerRow(1, "Linkin Park", "Numb", 9)] });
    };

    const plain = await searchSingleSource(poru, "numb", "youtube", { popularity: false, popularityLookup });
    assert.strictEqual(lookups, 0);
    assert.strictEqual(plain[0].searchPopularity, undefined);

    const ranked = await searchSingleSource(poru, "numb", "youtube", { popularityLookup: lookupFor([deezerRow(1, "Linkin Park", "Numb", 9)]) });
    assert.strictEqual(ranked[0].searchPopularity, 9);
  });

  it("asks for popularity while the providers are still searching", async () => {
    const events = [];
    const poru = {
      resolve: async () => {
        events.push("provider");
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { tracks: [createTrack("youtube", "Queen", "Bohemian Rhapsody")] };
      },
    };

    await searchSingleSource(poru, "bohemian rhapsody", "youtube", {
      popularityLookup: async () => {
        events.push("lookup");
        return null;
      },
    });

    assert.ok(events.indexOf("lookup") !== -1 && events.indexOf("lookup") < events.length - 1);
  });
});

describe("Search lane health", () => {
  beforeEach(() => clearSearchCache());
  afterEach(() => clearSearchCache());

  function createBrokenSoundCloudPoru(calls) {
    return {
      resolve: async ({ query, source }) => {
        calls.push({ query, source });
        if (source === "scsearch") return { loadType: "error", tracks: [] };
        return { loadType: "search", tracks: [createTrack("youtube", "Kuki", "Ciepłe Dranie")] };
      },
    };
  }

  const scCalls = (calls) => calls.filter((call) => call.source === "scsearch").length;

  it("rests a provider after a streak of error results and skips it in mixed search", async () => {
    const calls = [];
    const poru = createBrokenSoundCloudPoru(calls);

    for (let index = 0; index < LANE_FAILURE_STREAK; index += 1) {
      assert.strictEqual(isLaneResting("soundcloud"), false);
      await searchAcrossSources(poru, `query ${index}`, { preferredSource: "youtube", popularity: false });
    }
    assert.strictEqual(isLaneResting("soundcloud"), true);

    const before = scCalls(calls);
    await searchAcrossSources(poru, "another query", { preferredSource: "youtube", popularity: false });
    assert.strictEqual(scCalls(calls), before);
    assert.strictEqual(isLaneResting("youtube"), false);
  });

  it("asks a resting provider again once its rest is over", async () => {
    const poru = createBrokenSoundCloudPoru([]);
    for (let index = 0; index < LANE_FAILURE_STREAK; index += 1) {
      await searchAcrossSources(poru, `query ${index}`, { preferredSource: "youtube", popularity: false });
    }

    assert.strictEqual(isLaneResting("soundcloud", Date.now() + LANE_COOLDOWN_MS - 1_000), true);
    assert.strictEqual(isLaneResting("soundcloud", Date.now() + LANE_COOLDOWN_MS + 1), false);
  });

  it("still asks a resting provider when it is preferred or picked explicitly", async () => {
    const calls = [];
    const poru = createBrokenSoundCloudPoru(calls);
    for (let index = 0; index < LANE_FAILURE_STREAK; index += 1) {
      await searchAcrossSources(poru, `query ${index}`, { preferredSource: "youtube", popularity: false });
    }

    let before = scCalls(calls);
    await searchAcrossSources(poru, "preferred", { preferredSource: "soundcloud", popularity: false });
    assert.strictEqual(scCalls(calls), before + 1);

    before = scCalls(calls);
    await searchSingleSource(poru, "explicit", "soundcloud", { popularity: false });
    assert.strictEqual(scCalls(calls), before + 1);
  });

  it("does not retry accent variants on a provider that answered with an error", async () => {
    const calls = [];
    await searchSingleSource(createBrokenSoundCloudPoru(calls), "kuki cieple dranie", "soundcloud", { popularity: false });

    assert.strictEqual(scCalls(calls), 1);
  });

  it("forgets a failure streak after a successful search", async () => {
    let broken = true;
    const poru = {
      resolve: async ({ source }) =>
        source === "scsearch" && broken
          ? { loadType: "error", tracks: [] }
          : { loadType: "search", tracks: [createTrack("soundcloud", "Kuki", "Ciepłe Dranie")] },
    };

    for (let index = 0; index < LANE_FAILURE_STREAK - 1; index += 1) {
      await searchSingleSource(poru, `query ${index}`, "soundcloud", { popularity: false });
    }
    broken = false;
    await searchSingleSource(poru, "working", "soundcloud", { popularity: false });
    broken = true;
    await searchSingleSource(poru, "broken again", "soundcloud", { popularity: false });

    assert.strictEqual(isLaneResting("soundcloud"), false);
  });

  it("does not count an empty result as a failure", async () => {
    const poru = { resolve: async () => ({ loadType: "empty", tracks: [] }) };
    for (let index = 0; index < LANE_FAILURE_STREAK + 1; index += 1) {
      await searchSingleSource(poru, `nothing ${index}`, "soundcloud", { popularity: false });
    }

    assert.strictEqual(isLaneResting("soundcloud"), false);
  });

  it("clears lane health with the search cache", async () => {
    const poru = createBrokenSoundCloudPoru([]);
    for (let index = 0; index < LANE_FAILURE_STREAK; index += 1) {
      await searchSingleSource(poru, `query ${index}`, "soundcloud", { popularity: false });
    }
    assert.strictEqual(isLaneResting("soundcloud"), true);

    clearSearchCache();
    assert.strictEqual(isLaneResting("soundcloud"), false);
  });
});
