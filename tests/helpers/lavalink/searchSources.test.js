const assert = require("node:assert");
const { describe, it } = require("node:test");

const {
  beginAutocompleteRequest,
  isLatestAutocompleteRequest,
} = require("../../../helpers/interactions/autocompleteGuard");
const { buildFallbackQueries, isVerifiedFallbackMatch } = require("../../../helpers/lavalink/fallbacks");
const { clearSearchCache, getSearchCacheSize, searchAcrossSources, searchSingleSource } = require("../../../helpers/lavalink/searchAggregator");
const { parseSearchIdentifier } = require("../../../helpers/lavalink/searchIdentifier");
const {
  getFallbackSources,
  getFallbackSource,
  getSearchPrefix,
  resolveSearchSource,
} = require("../../../helpers/lavalink/searchSources");

describe("Search source selection", () => {
  it("keeps an explicit source, including auto", () => {
    assert.strictEqual(resolveSearchSource("spotify", "deezer", "youtube"), "spotify");
    assert.strictEqual(resolveSearchSource("auto", "deezer", "youtube"), "auto");
  });

  it("falls back to user, guild, and then Deezer preferences", () => {
    assert.strictEqual(resolveSearchSource(null, "spotify", "youtube"), "spotify");
    assert.strictEqual(resolveSearchSource(null, null, "youtube"), "youtube");
    assert.strictEqual(resolveSearchSource(null, null, null), "deezer");
  });

  it("maps sources to the correct Lavalink prefix and fallback", () => {
    assert.strictEqual(getSearchPrefix("deezer"), "dzsearch");
    assert.strictEqual(getSearchPrefix("youtube"), "ytsearch");
    assert.strictEqual(getSearchPrefix("spotify"), "spsearch");
    assert.strictEqual(getSearchPrefix("soundcloud"), "scsearch");
    assert.strictEqual(getFallbackSource("spotify"), "spotify");
    assert.strictEqual(getFallbackSource("auto"), "youtube");
    assert.deepStrictEqual(getFallbackSources("deezer"), ["soundcloud", "youtube", "spotify"]);
  });

  it("marks older autocomplete requests as stale", () => {
    const first = beginAutocompleteRequest("user:guild");
    const second = beginAutocompleteRequest("user:guild");

    assert.strictEqual(isLatestAutocompleteRequest("user:guild", first), false);
    assert.strictEqual(isLatestAutocompleteRequest("user:guild", second), true);
  });

  it("uses YouTube as the first playback fallback and prioritizes ISRC", () => {
    const withIsrc = buildFallbackQueries({
      title: "Kuki Cieple Dranie",
      author: "Example Artist",
      isrc: "PLABC1234567",
    });
    const withoutIsrc = buildFallbackQueries({ title: "Kuki Cieple Dranie", author: "Example Artist" });

    assert.deepStrictEqual(withIsrc[0], { source: "ytsearch", query: "PLABC1234567" });
    assert.strictEqual(withoutIsrc[0].source, "ytmsearch");
    assert.ok(withoutIsrc.some((entry) => entry.source === "scsearch"));
  });

  it("accepts a cross-provider fallback only when its recording identity matches", () => {
    const spotify = {
      info: {
        title: "Save Your Tears",
        author: "The Weeknd",
        isrc: "USUG12001870",
        length: 215_000,
      },
    };
    const youtube = {
      info: {
        title: "The Weeknd - Save Your Tears (Official Audio)",
        author: "The Weeknd - Topic",
        isrc: "US-UG1-20-01870",
        length: 216_000,
      },
    };

    assert.deepStrictEqual(isVerifiedFallbackMatch(spotify, youtube), { valid: true, reason: "ISRC match" });
  });

  it("rejects a title match when the fallback is a remix, cover, or wrong artist", () => {
    const spotify = {
      info: { title: "Tamagotchi", author: "TACONAFIDE", length: 198_000 },
    };
    const remix = {
      info: { title: "Tamagotchi (Remix)", author: "TACONAFIDE", length: 198_000 },
    };
    const wrongArtist = {
      info: { title: "Tamagotchi", author: "Different Artist", length: 198_000 },
    };

    assert.strictEqual(isVerifiedFallbackMatch(spotify, remix).valid, false);
    assert.strictEqual(isVerifiedFallbackMatch(spotify, wrongArtist).valid, false);
  });

  it("aggregates all providers so an exact popular match is not hidden by the preferred source", async () => {
    clearSearchCache();
    const calls = [];
    const poru = {
      resolve: async ({ query, source }) => {
        calls.push({ query, source });
        if (source === "ytsearch") {
          return { tracks: [{ info: { title: "Hit 'Em Up", author: "2Pac" } }] };
        }
        return { tracks: [{ info: { title: "Hit Em Up", author: "Other Artist" } }] };
      },
    };

    const tracks = await searchAcrossSources(poru, "hit em up", { preferredSource: "deezer" });

    assert.strictEqual(calls.length, 5);
    assert.ok(calls.some((call) => call.source === "ytmsearch" && call.query === "hit em up"));
    assert.ok(calls.some((call) => call.source === "ytsearch" && call.query === "hit em up"));
    assert.ok(tracks.some((track) => track.info.author === "2Pac"));
  });

  it("passes the provider prefix through Poru's source option", async () => {
    clearSearchCache();
    const calls = [];
    const poru = {
      resolve: async (options) => {
        calls.push(options);
        return { tracks: [] };
      },
    };

    await searchAcrossSources(poru, "8 kobiet", { preferredSource: "deezer" });

    assert.ok(calls.some((call) => call.query === "8 kobiet"));
    for (const source of ["dzsearch", "scsearch", "spsearch", "ytmsearch", "ytsearch"]) {
      assert.ok(calls.some((call) => call.source === source));
    }
  });

  it("queries likely accented variants so accent-sensitive catalogs remain searchable", async () => {
    clearSearchCache();
    const calls = [];
    const poru = {
      resolve: async (options) => {
        calls.push(options);
        return { tracks: [] };
      },
    };

    await searchAcrossSources(poru, "kuki cieple dranie", { preferredSource: "youtube" });

    assert.ok(calls.some((call) => call.query === "kuki ciepłe dranie"));
  });

  it("keeps single-provider Activity searches isolated to the chosen provider", async () => {
    clearSearchCache();
    const calls = [];
    const poru = {
      resolve: async (options) => {
        calls.push(options);
        return { tracks: [{ info: { title: "Ciepłe Dranie", author: "Kuki" } }] };
      },
    };

    const tracks = await searchSingleSource(poru, "kuki cieple dranie", "soundcloud");

    assert.strictEqual(tracks.length, 1);
    assert.ok(calls.length >= 1);
    assert.ok(calls.every((call) => call.source === "scsearch"));
  });

  it("coalesces simultaneous identical searches instead of multiplying provider work", async () => {
    clearSearchCache();
    let calls = 0;
    const poru = {
      resolve: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { tracks: [] };
      },
    };

    await Promise.all([
      searchAcrossSources(poru, "Tamagotchi", { preferredSource: "youtube" }),
      searchAcrossSources(poru, "Tamagotchi", { preferredSource: "youtube" }),
    ]);

    // Every lane comes back empty, so each provider escalates to its other
    // lanes and the three accent variants: 20 requests once, not twice for
    // the two Activity clients.
    assert.strictEqual(calls, 20);
    assert.strictEqual(getSearchCacheSize(), 1);
  });

  it("asks only the primary lane per provider when it already finds the song", async () => {
    clearSearchCache();
    const calls = [];
    const poru = {
      resolve: async (options) => {
        calls.push(options);
        return {
          tracks: ["Live", "Studio", "Remaster"].map((tag, index) => ({
            encoded: `${options.source}-${index}`,
            info: { title: `Ciepłe Dranie ${tag}`, author: "Kuki" },
          })),
        };
      },
    };

    const tracks = await searchAcrossSources(poru, "kuki cieple dranie", { preferredSource: "youtube" });

    assert.deepStrictEqual(calls.map((call) => call.source).sort(), ["dzsearch", "scsearch", "spsearch", "ytmsearch"]);
    assert.ok(calls.every((call) => call.query === "kuki cieple dranie"));
    assert.strictEqual(tracks.length, 12);
  });

  it("falls back to regular YouTube when YouTube Music finds nothing relevant", async () => {
    clearSearchCache();
    const calls = [];
    const poru = {
      resolve: async (options) => {
        calls.push(options);
        if (options.source !== "ytsearch") return { tracks: [] };
        return { tracks: [{ encoded: "yt", info: { title: "Numb", author: "Linkin Park" } }] };
      },
    };

    const tracks = await searchSingleSource(poru, "linkin park numb", "youtube");

    assert.deepStrictEqual(calls[0], { query: "linkin park numb", source: "ytmsearch" });
    assert.ok(calls.some((call) => call.source === "ytsearch" && call.query === "linkin park numb"));
    assert.deepStrictEqual(tracks.map((track) => track.encoded), ["yt"]);
  });

  it("keeps the results of a provider whose second pass misses the deadline", async () => {
    clearSearchCache();
    const poru = {
      resolve: (options) => {
        if (options.source === "ytmsearch") return Promise.resolve({ tracks: [{ encoded: "ytm", info: { title: "Numb", author: "Linkin Park" } }] });
        return new Promise(() => {});
      },
    };

    const tracks = await searchSingleSource(poru, "linkin park numb", "youtube");

    assert.deepStrictEqual(tracks.map((track) => track.encoded), ["ytm"]);
  });

  it("parses source-pinned autocomplete values without double-prefixing them", () => {
    assert.deepStrictEqual(parseSearchIdentifier("scsearch: Kuki Ciepłe Dranie"), {
      source: "scsearch",
      query: "Kuki Ciepłe Dranie",
    });
    assert.strictEqual(parseSearchIdentifier("https://soundcloud.com/kuki/cieple-dranie"), null);
    assert.strictEqual(parseSearchIdentifier("scsearch:"), null);
  });
});
