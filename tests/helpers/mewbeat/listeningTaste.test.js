const assert = require("node:assert");
const { describe, it } = require("node:test");

const { anchorOf, labelOf, listeningSeedsOf, readTaste, splitTrackKey } = require("../../../helpers/mewbeat/listeningTaste");
const { artistKeyOf } = require("../../../helpers/mewbeat/songIdentity");

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

// A made-up bot: ann asked for songs by Band A a lot, bo for something else; autoplay played a third song to both.
const roomEntry = (userId, title, author, daysAgo, extra = {}) => ({
  track: "x",
  info: { title, author, requesterId: userId, ...extra.info },
  userData: { autoplayPlayedAt: NOW - daysAgo * DAY, ...extra.userData },
});
const sourcesOf = (overrides = {}) => ({
  topTracks: (userId) => ({
    ann: [{ track: "Band A - Song One", count: 9 }, { track: "Band A - Song Two", count: 4 }, { track: "Band B - Song Three", count: 2 }],
    bo: [{ track: "Band Z - Other Song", count: 5 }],
  })[userId] ?? [],
  topArtists: (userId) => ({
    ann: [{ artist: "Band A", count: 13 }, { artist: "Band B - Topic", count: 2 }],
    bo: [{ artist: "Band Z", count: 5 }],
  })[userId] ?? [],
  roomTracks: () => [
    roomEntry("ann", "Song Four", "Band C", 1),
    roomEntry("bo", "Bo Song", "Band Y", 1),
    roomEntry("ann", "Autoplay Song", "Band D", 1, { info: { autoplayed: true } }),
    roomEntry("ann", "Autoplay Flag", "Band D2", 1, { userData: { autoplay: true } }),
    roomEntry("ann", "Radio", "Station", 1, { info: { isStream: true } }),
    roomEntry("ann", "Old Song", "Band E", 30),
  ],
  liked: (userId) => (userId === "ann" ? [{ title: "Saved Song", author: "Band F", addedAt: NOW - 2 * DAY }] : []),
  ...overrides,
});

describe("mewbeat listening taste: reading", () => {
  it("reads one player's songs from the stats, the room log and Liked Songs", () => {
    const taste = readTaste({ userId: "ann", guildId: "g", sources: sourcesOf(), now: NOW });
    const titles = taste.tracks.map((song) => song.title).sort();
    assert.deepStrictEqual(titles, ["Saved Song", "Song Four", "Song One", "Song Three", "Song Two"]);
    assert.strictEqual(taste.tracks.find((song) => song.title === "Saved Song").likedAt, NOW - 2 * DAY);
    assert.strictEqual(taste.artists.get("band a").plays, 13);
    assert.strictEqual(taste.artists.get("band a").songs, 2);
  });

  it("leaves out what autoplay chose, a stream, another player's request and what is older than two weeks", () => {
    const taste = readTaste({ userId: "ann", guildId: "g", sources: sourcesOf(), now: NOW });
    const artists = taste.tracks.map((song) => song.artist);
    for (const absent of ["Band D", "Band D2", "Station", "Band E", "Band Y", "Band Z"]) assert.ok(!artists.includes(absent), absent);
  });

  it("is empty for a player the bot has never seen, and survives a store that throws", () => {
    assert.deepStrictEqual(readTaste({ userId: "nobody", guildId: "g", sources: sourcesOf(), now: NOW }).tracks, []);
    const broken = sourcesOf({ topTracks: () => { throw new Error("disk"); }, liked: () => "not a list" });
    const taste = readTaste({ userId: "ann", guildId: "g", sources: broken, now: NOW });
    assert.deepStrictEqual(taste.tracks.map((song) => song.title), ["Song Four"]);
    assert.deepStrictEqual(readTaste({ userId: "ann", now: NOW }).tracks, []);
  });

  it("splits the stats key at the first dash and cleans how a title or an artist reads", () => {
    assert.deepStrictEqual(splitTrackKey("Rick - Rick - Never Gonna"), { artist: "Rick", title: "Rick - Never Gonna" });
    assert.strictEqual(splitTrackKey("no separator"), null);
    assert.deepStrictEqual(splitTrackKey("Band Q - Topic - Some Song"), { artist: "Band Q - Topic", title: "Some Song" }, "a Topic channel is the artist");
    assert.strictEqual(labelOf("Big Song (Remix) - Cover | Game | Channel"), "Big Song - Cover");
    assert.strictEqual(labelOf("Rick - Never Gonna (Official Video)", "Rick - Topic"), "Never Gonna");
    assert.strictEqual(labelOf("Camellia - Topic"), "Camellia");
    assert.ok(labelOf("x".repeat(200)).length <= 60);
    assert.strictEqual(artistKeyOf("Camellia - Topic"), "camellia");
  });
});

describe("mewbeat listening taste: seeds", () => {
  const seedsFor = (userId, options = {}) => listeningSeedsOf(readTaste({ userId, guildId: "g", sources: sourcesOf(), now: NOW }), { now: NOW, ...options });

  it("takes one song per artist, a recently saved song and the most played first, and says what each is by", () => {
    const seeds = seedsFor("ann", { limit: 10 });
    assert.deepStrictEqual(seeds.map((seed) => seed.artist), ["Band F", "Band A", "Band C", "Band B"]);
    assert.deepStrictEqual(seeds.map((seed) => seed.role), ["liked", "artist", "listen", "listen"]);
    assert.deepStrictEqual(seeds.map((seed) => seed.label), ["Saved Song", "Band A", "Song Four", "Song Three"]);
    assert.strictEqual(seeds[1].title, "Song One"); // the artist's most played song is the one asked about
  });

  it("respects the limit and the artists to skip", () => {
    assert.strictEqual(seedsFor("ann", { limit: 2 }).length, 2);
    const skipped = seedsFor("ann", { limit: 10, skip: new Set(["band a"]) });
    assert.ok(skipped.every((seed) => seed.artist !== "Band A"));
  });

  it("answers nothing for a player with no listening", () => {
    assert.deepStrictEqual(seedsFor("nobody"), []);
    assert.deepStrictEqual(listeningSeedsOf(null, { now: NOW }), []);
  });

  it("picks the song that stands for the taste apart from an artist, or nothing", () => {
    const taste = readTaste({ userId: "ann", guildId: "g", sources: sourcesOf(), now: NOW });
    assert.strictEqual(anchorOf(taste, { now: NOW, artist: "Nobody" }).title, "Saved Song"); // saved lately outweighs nine plays
    assert.notStrictEqual(anchorOf(taste, { now: NOW, artist: "Band A - Topic" }).artist, "Band A");
    const alone = readTaste({ userId: "bo", guildId: "g", sources: { topTracks: sourcesOf().topTracks }, now: NOW });
    assert.strictEqual(anchorOf(alone, { now: NOW, artist: "Band Z" }), null);
    assert.strictEqual(anchorOf(null, { now: NOW }), null);
  });
});
