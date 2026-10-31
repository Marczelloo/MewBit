const assert = require("node:assert");
const { describe, it } = require("node:test");

const {
  filterRelevantSearchResults,
  filterPlayableSearchResults,
  getPopularity,
  rankSearchResults,
  scoreSearchResult,
} = require("../../../helpers/lavalink/searchRanking");

function createTrack(title, author, popularity = 0) {
  return {
    info: { title, author },
    pluginInfo: { popularity },
  };
}

function createViewRankedTrack(title, author, views) {
  return { info: { title, author, viewCount: views } };
}

describe("Search result ranking", () => {
  it("prefers an exact artist/title match over a more popular wrong song", () => {
    const tracks = [
      createTrack("Get Lucky", "Daft Punk", 98),
      createTrack("One More Time", "Daft Punk", 55),
      createTrack("One More Time (Official Video)", "Daft Punk", 80),
    ];

    const ranked = rankSearchResults(tracks, "Daft Punk - One More Time");

    assert.strictEqual(ranked[0].info.title, "One More Time");
    assert.notStrictEqual(ranked[0].info.title, "Get Lucky");
  });

  it("matches artist and title tokens when the query has no separator", () => {
    const tracks = [
      createTrack("Starboy", "The Weeknd", 99),
      createTrack("Blinding Lights", "The Weeknd", 75),
      createTrack("Blinding Lights (Live)", "The Weeknd", 90),
    ];

    const ranked = rankSearchResults(tracks, "The Weeknd Blinding Lights");

    assert.strictEqual(ranked[0].info.title, "Blinding Lights");
  });

  it("uses popularity as a tie-breaker for equally matching results", () => {
    const tracks = [
      createTrack("Ocean Eyes", "Billie Eilish", 20),
      createTrack("Ocean Eyes", "Billie Eilish", 90),
    ];

    const ranked = rankSearchResults(tracks, "Billie Eilish - Ocean Eyes");

    assert.strictEqual(getPopularity(ranked[0]), 90);
  });

  it("keeps provider order stable when candidates have the same score", () => {
    const tracks = [createTrack("Unknown", "Artist"), createTrack("Unknown", "Artist")];
    const ranked = rankSearchResults(tracks, "Artist - Unknown", { withScores: true });

    assert.strictEqual(ranked[0].index, 0);
    assert.ok(scoreSearchResult(tracks[0], "Artist - Unknown").score > 0);
  });

  it("normalizes curly apostrophes and uses view count for title ties", () => {
    const tracks = [
      createViewRankedTrack("Hit Em Up", "мэйби бэйби", 12000),
      createViewRankedTrack("Hit 'Em Up", "2Pac", 250000000),
    ];

    const ranked = rankSearchResults(tracks, "hit em up");

    assert.strictEqual(ranked[0].info.author, "2Pac");
  });

  it("prefers a canonical official version over an exact-title cover", () => {
    const tracks = [
      createTrack("Hit 'Em Up", "Bedoes 2115"),
      createTrack("Hit 'Em Up (Single Version)", "2Pac"),
    ];

    const ranked = rankSearchResults(tracks, "hit em up");

    assert.strictEqual(ranked[0].info.author, "2Pac");
  });

  it("filters unrelated provider results from a multi-word query", () => {
    const tracks = [
      createTrack("Why does YouTube Search Suck So Much", "Paul Yu"),
      createTrack("Hit 'Em Up (Single Version)", "2Pac"),
      createTrack("Hit Em Up Tutorial", "Random Channel"),
    ];

    const filtered = filterRelevantSearchResults(tracks, "hit em up");

    assert.deepStrictEqual(filtered.map((track) => track.info.author), ["2Pac"]);
  });

  it("keeps one-word autocomplete queries relevant", () => {
    const tracks = [
      createTrack("Ciepłe Dranie", "Kuki"),
      createTrack("Unrelated Song", "Another Artist"),
    ];

    const filtered = filterRelevantSearchResults(tracks, "kuki");

    assert.deepStrictEqual(filtered.map((track) => track.info.author), ["Kuki"]);
  });

  it("keeps a close spelling match while rejecting unrelated results", () => {
    const tracks = [
      createTrack("Tamagotchi", "TACONAFIDE"),
      createTrack("Completely Different", "Another Artist"),
    ];

    const filtered = filterRelevantSearchResults(tracks, "tamagoczi");
    const ranked = rankSearchResults(filtered, "tamagoczi");

    assert.deepStrictEqual(filtered.map((track) => track.info.title), ["Tamagotchi"]);
    assert.strictEqual(ranked[0].info.author, "TACONAFIDE");
  });

  it("prefers the original Kuki recording over a remix", () => {
    const tracks = [
      createTrack("Ciepłe Dranie", "Kuki"),
      createTrack("Ciepłe Dranie (feat. Kuki) (Remix)", "Stock Wudeczka"),
      createTrack("KUKI CIEPŁE DRANIE", "Ali Baba"),
    ];

    const ranked = rankSearchResults(tracks, "kuki cieple dranie");

    assert.strictEqual(ranked[0].info.author, "Kuki");
    assert.strictEqual(ranked[0].info.title, "Ciepłe Dranie");
  });

  it("prefers the official Tamagotchi recording over an anonymous exact-title upload", () => {
    const tracks = [
      createTrack("TAMAGOTCHI", "😂"),
      createTrack("Tamagotchi (Remix)", "Kenia Os"),
      createTrack("Tamagotchi", "TACONAFIDE"),
      createTrack("Tamagotchi", "TACONAFIDE"),
      createTrack("Tamagotchi", "TACONAFIDE"),
      createTrack("Tamagotchi", "TACONAFIDE"),
    ];
    tracks[2].info.sourceName = "deezer";
    tracks[3].info.sourceName = "spotify";
    tracks[4].info.sourceName = "youtube";
    tracks[5].info.sourceName = "soundcloud";

    const ranked = rankSearchResults(tracks, "tamagotchi");

    assert.strictEqual(ranked[0].info.author, "TACONAFIDE");
    assert.strictEqual(ranked[0].info.title, "Tamagotchi");
  });

  it("penalizes remix and slowed variants when the query asks only for the base title", () => {
    const ranked = rankSearchResults(
      [
        createTrack("Tamagotchi (Remix)", "TACONAFIDE"),
        createTrack("Tamagotchi (slowed)", "Tuzera"),
        createTrack("Tamagotchi", "TACONAFIDE"),
      ],
      "tamagotchi"
    );

    assert.strictEqual(ranked[0].info.title, "Tamagotchi");
    assert.strictEqual(ranked[0].info.author, "TACONAFIDE");
  });

  it("filters a clean recording unless the user explicitly asks for it", () => {
    const clean = createTrack("Hit 'Em Up (Clean)", "2Pac", 99);
    const explicit = createTrack("Hit 'Em Up", "2Pac", 55);

    assert.deepStrictEqual(filterPlayableSearchResults([clean, explicit], "2pac hit em up"), [explicit]);
    assert.deepStrictEqual(filterPlayableSearchResults([clean, explicit], "2pac hit em up clean"), [clean]);
  });

  it("keeps a matching YouTube recording ahead of the same Spotify recording in YouTube-first search", () => {
    const youtube = createTrack("Hit 'Em Up (Official Audio)", "2Pac - Topic", 95);
    youtube.info.sourceName = "youtube";
    const spotify = createTrack("Hit 'Em Up", "2Pac", 50);
    spotify.info.sourceName = "spotify";

    const ranked = rankSearchResults([youtube, spotify], "2pac hit em up");
    assert.strictEqual(ranked[0].info.sourceName, "youtube");
  });

  it("shows one preferred Spotify or YouTube representative for provider copies of the same recording", () => {
    const providers = ["soundcloud", "deezer", "youtube", "spotify"].map((source) => {
      const track = createTrack("Hit 'Em Up", "2Pac", 80);
      track.info.sourceName = source;
      track.info.uri = `https://${source}.example/hit-em-up`;
      return track;
    });

    const ranked = rankSearchResults(providers, "2pac hit em up");

    assert.strictEqual(ranked.length, 1);
    assert.strictEqual(ranked[0].info.sourceName, "youtube");
  });

  it("keeps a substantially better Deezer or SoundCloud match ahead of a loose preferred-provider result", () => {
    const looseYoutube = createTrack("One More Time", "Random Uploader", 99);
    looseYoutube.info.sourceName = "youtube";
    const exactDeezer = createTrack("One More Time", "Daft Punk", 30);
    exactDeezer.info.sourceName = "deezer";

    const ranked = rankSearchResults([looseYoutube, exactDeezer], "daft punk one more time");

    assert.strictEqual(ranked[0].info.sourceName, "deezer");
    assert.strictEqual(ranked[0].info.author, "Daft Punk");
  });

  it("suppresses uploader-name and long-title noise after an exact one-word title match", () => {
    const exactTrack = createTrack("Frascati", "Taco Hemingway", 50);
    exactTrack.info.sourceName = "spotify";
    const uploaderNoise = createTrack("Gloria - Vivaldi - Frascati", "Frascati", 99);
    uploaderNoise.info.sourceName = "soundcloud";

    const ranked = rankSearchResults([uploaderNoise, exactTrack], "frascati");

    assert.deepStrictEqual(ranked.map((track) => track.info.title), ["Frascati"]);
  });

  it("excludes alternate-only results at the playback boundary", () => {
    const acoustic = createTrack("Pink Pony Club (Acoustic)", "Chappell Roan");
    assert.deepStrictEqual(filterPlayableSearchResults([acoustic], "Pink Pony Club"), []);
    assert.deepStrictEqual(filterPlayableSearchResults([acoustic], "Pink Pony Club acoustic"), [acoustic]);
  });

  it("prefers an explicitly requested acoustic version over the base recording", () => {
    const ranked = rankSearchResults(
      [
        createTrack("Pink Pony Club", "Chappell Roan"),
        createTrack("Pink Pony Club (Acoustic)", "Chappell Roan"),
      ],
      "Chappell Roan Pink Pony Club acoustic"
    );

    assert.strictEqual(ranked[0].info.title, "Pink Pony Club (Acoustic)");
  });
  describe("typo and as-you-type tolerance", () => {
    const cases = [
      ["metalica nothing else matters", "Metallica", "Nothing Else Matters"],
      ["metallica nothing else maters", "Metallica", "Nothing Else Matters"],
      ["queen bohemian rapsody", "Queen", "Bohemian Rhapsody"],
      ["bohemian rhap", "Queen", "Bohemian Rhapsody"],
      ["queen bohem", "Queen", "Bohemian Rhapsody"],
      ["queen b", "Queen", "Bohemian Rhapsody"],
      ["the weekend blinding lights", "The Weeknd", "Blinding Lights"],
      ["eminem lose yourslef", "Eminem", "Lose Yourself"],
      ["dua lipa levitatin", "Dua Lipa", "Levitating"],
      ["sza kil bill", "SZA", "Kill Bill"],
      ["taco hemingway tamagoczi", "Taco Hemingway", "Tamagotchi"],
      ["acdc highway to hell", "AC/DC", "Highway to Hell"],
      ["linkinpark numb", "Linkin Park", "Numb"],
      ["oasis - live forever", "Oasis", "Live Forever"],
    ];

    for (const [query, author, title] of cases) {
      it(`keeps ${author} - ${title} for "${query}"`, () => {
        const track = createTrack(title, author);
        assert.deepStrictEqual(filterPlayableSearchResults([track], query), [track]);
      });
    }

    it("still rejects a candidate that misses a whole word of a short query", () => {
      assert.deepStrictEqual(filterRelevantSearchResults([createTrack("Hit The Road Jack", "Ray Charles")], "hit em up"), []);
    });

    it("ranks the misspelt artist's recording above covers of the same title", () => {
      const ranked = rankSearchResults(
        [
          createTrack("Nothing Else Matters (Cover)", "Random Covers"),
          createTrack("Nothing Else Matters", "Apocalyptica"),
          createTrack("Nothing Else Matters", "Metallica"),
        ],
        "metalica nothing else maters"
      );

      assert.strictEqual(ranked[0].info.author, "Metallica");
    });

    it("ranks the artist's song first while the last word is still being typed", () => {
      const ranked = rankSearchResults(
        filterPlayableSearchResults(
          [createTrack("Bicycle Race", "Queen"), createTrack("Bohemian Rhapsody", "Queen"), createTrack("Live Set", "Bohemian Club")],
          "queen bohem"
        ),
        "queen bohem"
      );

      assert.strictEqual(ranked[0].info.title, "Bohemian Rhapsody");
    });
  });
});

describe("Search results from several providers", () => {
  const fromProvider = (sourceName, title, author) => ({ info: { title, author, sourceName, uri: `${sourceName}:${author}:${title}` } });

  it("matches a title however the query spaces its words", () => {
    // Real ytmsearch/dzsearch results for "kickback": the Chainsaw Man song
    // is spelt "KICK BACK" and used to be dropped as irrelevant.
    const tracks = [
      fromProvider("youtube", "KICK BACK", "Kenshi Yonezu"),
      fromProvider("youtube", "kickback", "nafla"),
      fromProvider("youtube", "Kickback", "Cabaret Voltaire"),
      fromProvider("deezer", "KICK BACK", "Kenshi Yonezu"),
      fromProvider("deezer", "Kick Back", "Marta"),
      fromProvider("spotify", "Kickback", "Omar Apollo"),
    ];

    for (const query of ["kickback", "kick back"]) {
      const relevant = filterRelevantSearchResults(tracks, query);
      assert.strictEqual(relevant.length, tracks.length, query);
      assert.strictEqual(rankSearchResults(relevant, query)[0].info.author, "Kenshi Yonezu", query);
    }
  });

  it("keeps a remix the providers lead with as its own result, under the original", () => {
    // Real results for "high forever": the Cyberpunk: Edgerunners 2 remix.
    const tracks = [
      fromProvider("youtube", "High Forever", "Petite Meller"),
      fromProvider("youtube", "High Forever (Marlon Hoffstadt Remix)", "Petite Meller"),
      fromProvider("youtube", "High Forever", "Catie St.Germain"),
      fromProvider("youtube", "High Forever", "Ryan King"),
      fromProvider("deezer", "High Forever (Marlon Hoffstadt Remix)", "Petite Meller"),
      fromProvider("deezer", "High Forever", "Petite Meller"),
      fromProvider("deezer", "High Forever", "Tatsunoshin"),
      fromProvider("deezer", "High Forever", "The Maine"),
    ];

    const ranked = rankSearchResults(filterRelevantSearchResults(tracks, "high forever"), "high forever");
    assert.deepStrictEqual(
      ranked.slice(0, 2).map((track) => track.info.title),
      ["High Forever", "High Forever (Marlon Hoffstadt Remix)"]
    );
    // With one provider selected there is no second opinion, but the remix
    // that provider lists second still sits right under the original.
    const youtubeOnly = tracks.filter((track) => track.info.sourceName === "youtube");
    assert.deepStrictEqual(
      rankSearchResults(filterRelevantSearchResults(youtubeOnly, "high forever"), "high forever")
        .slice(0, 2)
        .map((track) => track.info.title),
      ["High Forever", "High Forever (Marlon Hoffstadt Remix)"]
    );
    // Implicit playback still never substitutes the remix for the original.
    assert.ok(filterPlayableSearchResults(tracks, "high forever").every((track) => !/remix/i.test(track.info.title)));
  });
});
