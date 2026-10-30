const assert = require("node:assert");
const { describe, it } = require("node:test");

const { normalizeGenreTags } = require("../../../helpers/lavalink/genreUtils");
const {
  cleanTrackMetadata,
  getAutoplayVersionCompatibility,
  getBaseTitle,
  getCoreTitle,
  getVariantKinds,
  isUnrequestedAlternateVersion,
} = require("../../../helpers/lavalink/trackNormalization");

describe("Autoplay track normalization", () => {
  it("rejects alternate versions for a base-title query", () => {
    const query = "Chappell Roan Pink Pony Club";
    const variants = [
      "Pink Pony Club (Acoustic)",
      "Pink Pony Club - Live at Coachella",
      "Pink Pony Club [Demo]",
      "Pink Pony Club (Slowed + Reverb)",
      "Pink Pony Club (Chopped and Screwed)",
    ];

    assert.ok(variants.every((title) => isUnrequestedAlternateVersion(title, query)));
    assert.strictEqual(isUnrequestedAlternateVersion("Pink Pony Club", query), false);
  });

  it("permits only the explicitly requested version family", () => {
    assert.strictEqual(isUnrequestedAlternateVersion("Pink Pony Club (Acoustic)", "Pink Pony Club acoustic"), false);
    assert.strictEqual(isUnrequestedAlternateVersion("Pink Pony Club (Live)", "Pink Pony Club acoustic"), true);
    assert.strictEqual(isUnrequestedAlternateVersion("Song (Acoustic Remix)", "Song Remix"), true);
  });

  it("keeps tempo styles available to autoplay without opening unrelated alternates", () => {
    assert.strictEqual(getAutoplayVersionCompatibility("Song (Nightcore)").allowed, true);
    assert.strictEqual(getAutoplayVersionCompatibility("Song (Slowed + Reverb)").mode, "tempo-style");
    assert.strictEqual(getAutoplayVersionCompatibility("Song (Nightcore)", "Reference (Nightcore)").mode, "tempo-consistent");
    assert.strictEqual(getAutoplayVersionCompatibility("Song (Remix)").allowed, false);
    assert.strictEqual(getAutoplayVersionCompatibility("Song (Remix)", "Reference (Remix)").allowed, true);
  });

  it("keeps base identity stable across Unicode, provider noise, and variants", () => {
    assert.strictEqual(getBaseTitle("Ciepłe Dranie [Official Audio]"), "cieple dranie");
    assert.strictEqual(getBaseTitle("Ciepłe Dranie (Acoustic Version)"), "cieple dranie");
    assert.strictEqual(getBaseTitle("Song Acoustic"), "song");
    assert.deepStrictEqual(getVariantKinds("Song - Radio Edit"), ["edit"]);
  });

  it("uses the provider artist only when a title prefix is not an artist", () => {
    assert.deepStrictEqual(cleanTrackMetadata("The Weeknd - Save Your Tears (Official Video)", "TheWeekndVEVO"), {
      cleanTitle: "Save Your Tears",
      searchArtist: "The Weeknd",
    });
    assert.deepStrictEqual(cleanTrackMetadata("Pink Pony Club - Acoustic", "Chappell Roan"), {
      cleanTitle: "Pink Pony Club",
      searchArtist: "Chappell Roan",
    });
  });

  it("recognises 8-bit, parody, type beat and lullaby uploads as novelty versions", () => {
    for (const title of [
      "Not Like Us (8-Bit Emulation)",
      "Blinding Lights [16 bit]",
      "Numb - Chiptune",
      "Not Like Us (Parody)",
      "Kendrick Lamar Not Like Us Type Beat",
      "Bohemian Rhapsody (Lullaby Version)",
      "Smells Like Teen Spirit (Music Box)",
      "KICK BACK [GAME BOY Sound]",
    ]) {
      assert.ok(getVariantKinds(title).includes("novelty"), title);
      assert.strictEqual(isUnrequestedAlternateVersion(title, "not like us"), true, title);
    }
  });

  it("treats a work-in-progress take as a demo", () => {
    assert.deepStrictEqual(getVariantKinds("One (November 1987, Writing in Progress)"), ["demo"]);
    assert.deepStrictEqual(getVariantKinds("Song (Work in Progress)"), ["demo"]);
  });

  it("does not see novelty in ordinary titles", () => {
    for (const title of ["Bit by Bit", "8 kobiet", "Orbit", "Beat It", "A Little Bit", "Progress"]) {
      assert.deepStrictEqual(getVariantKinds(title), [], title);
    }
  });

  it("reads live, 8-bit and retuned uploads as versions of the song", () => {
    assert.strictEqual(getBaseTitle("Numb (Live)"), "numb");
    assert.strictEqual(getBaseTitle("Not Like Us (8-Bit Emulation)"), "not like us");
    assert.strictEqual(getBaseTitle("Song (8D Audio)"), "song");
    assert.strictEqual(getBaseTitle("Song - Bass Boosted"), "song");
    assert.strictEqual(getBaseTitle("Song - Live at Wembley"), "song");
    assert.strictEqual(getBaseTitle("Song - Mark Ronson Remix"), "song");
    assert.deepStrictEqual(getVariantKinds("Serce 432hz"), ["pitch"]);
    assert.deepStrictEqual(getVariantKinds("Numb (Live)"), ["live"]);
  });

  it("keeps the song in a ' - ' suffix that only ends in a processing label", () => {
    assert.strictEqual(getBaseTitle("LSO - Serce 432hz"), "lso serce");
    assert.strictEqual(getBaseTitle("Artist - Song Nightcore"), "artist song");
  });

  it("drops credit and soundtrack brackets from the core title, not part numbers", () => {
    assert.strictEqual(getCoreTitle("Syberia TDW/LSO - Serce [Cyberpunk: Edgerunners II] (Talia Yang)"), "syberia tdw lso serce");
    assert.strictEqual(getCoreTitle("Mask Off (Part 2)"), "mask off part 2");
    assert.strictEqual(getCoreTitle("Serce 432hz"), "serce");
  });
});

describe("Autoplay genre normalization", () => {
  it("merges aliases and removes community-tag noise", () => {
    assert.deepStrictEqual(
      normalizeGenreTags(
        ["Hip-Hop", "hip hop", "R & B", "synth pop", "2020s", "favorite", "The Weeknd", "Save Your Tears"],
        { artist: "The Weeknd", title: "Save Your Tears" }
      ),
      ["hiphop", "rnb", "synthpop"]
    );
  });
});
