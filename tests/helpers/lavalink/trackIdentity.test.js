const assert = require("node:assert");
const { describe, it } = require("node:test");

const { getTrackIdentity, hasTrackIdentity } = require("../../../helpers/lavalink/trackIdentity");

describe("Autoplay track identity", () => {
  it("recognizes provider variants of the same recording", () => {
    const played = {
      info: { title: "Hit Em Up", author: "2Pac - Topic", identifier: "youtube-id" },
    };
    const candidate = {
      title: "Hit 'Em Up (Official Audio)",
      artist: "2Pac",
      identifier: "soundcloud-id",
    };

    assert.strictEqual(hasTrackIdentity([played], candidate, { includeIdentifier: false }), true);
  });

  it("keeps different songs by the same artist distinct", () => {
    const first = getTrackIdentity({ info: { title: "Hit Em Up", author: "2Pac" } });
    const second = getTrackIdentity({ info: { title: "Changes", author: "2Pac" } });

    assert.notStrictEqual(first.textKey, second.textKey);
  });

  it("recognizes The Weeknd provider metadata variants as the same recording", () => {
    const youtube = {
      info: {
        title: "The Weeknd - Save Your Tears (Official Music Video)",
        author: "TheWeekndVEVO",
        identifier: "youtube-save-your-tears",
      },
    };
    const deezer = {
      title: "Save Your Tears",
      artist: "The Weeknd",
      identifier: "deezer-save-your-tears",
    };

    assert.strictEqual(hasTrackIdentity([youtube], deezer, { includeIdentifier: false }), true);
  });

  it("prefers canonical autoplay metadata for cross-provider cooldown matching", () => {
    const noisyPlayback = {
      info: { title: "Around Me [ChoppedNotSlopped]", author: "Metro Boomin - Topic" },
      userData: { autoplayReference: { title: "Around Me", artist: "Metro Boomin" } },
    };
    const cleanProviderVariant = { title: "Around Me", artist: "Metro Boomin" };

    assert.strictEqual(hasTrackIdentity([noisyPlayback], cleanProviderVariant, { includeIdentifier: false }), true);
  });

  it("recognizes featured-artist metadata variants without merging unrelated covers", () => {
    const original = { info: { title: "Save Your Tears", author: "The Weeknd" } };
    const remixMetadata = { title: "Save Your Tears (Remix)", artist: "The Weeknd & Ariana Grande" };
    const unrelatedCover = { title: "Save Your Tears", artist: "Different Artist" };

    assert.strictEqual(hasTrackIdentity([original], remixMetadata, { includeIdentifier: false }), true);
    assert.strictEqual(hasTrackIdentity([original], unrelatedCover, { includeIdentifier: false }), false);
  });

  it("uses ISRC as a provider-independent identity when available", () => {
    const youtube = {
      info: { title: "Save Your Tears", author: "The Weeknd - Topic", identifier: "youtube-save", isrc: "USUG12001870" },
    };
    const deezer = { title: "Save Your Tears", artist: "The Weeknd", identifier: "deezer-save", isrc: "US-UG1-20-01870" };

    assert.strictEqual(getTrackIdentity(youtube).preferredKey, "isrc:USUG12001870");
    assert.strictEqual(hasTrackIdentity([youtube], deezer, { includeIdentifier: false }), true);
  });

  it("matches re-uploads that credit the real artist in the title", () => {
    const retuned = { info: { title: "LSO - Serce 432hz", author: "Czarno432hzBóG", identifier: "a" } };
    const soundtrack = {
      info: { title: "Syberia TDW/LSO - Serce [Cyberpunk: Edgerunners II] (Talia Yang)", author: "Raven-VXV", identifier: "b" },
    };
    const original = { info: { title: "Serce", author: "LSO", identifier: "c" } };

    assert.strictEqual(hasTrackIdentity([retuned], soundtrack, { includeIdentifier: false }), true);
    assert.strictEqual(hasTrackIdentity([retuned], original, { includeIdentifier: false }), true);
    assert.strictEqual(hasTrackIdentity([soundtrack], original, { includeIdentifier: false }), true);
  });

  it("keeps same-titled songs by other artists distinct", () => {
    const original = { info: { title: "Serce", author: "LSO", identifier: "c" } };
    const otherBand = { info: { title: "Serce", author: "Some Band", identifier: "d" } };
    const otherCredit = { info: { title: "Ktoś Inny - Serce", author: "Kanał", identifier: "e" } };

    assert.strictEqual(hasTrackIdentity([original], otherBand, { includeIdentifier: false }), false);
    assert.strictEqual(hasTrackIdentity([original], otherCredit, { includeIdentifier: false }), false);
  });

  it("matches a live upload to the studio recording", () => {
    const live = { info: { title: "Numb (Live)", author: "Linkin Park", identifier: "live" } };
    const studio = { info: { title: "Numb", author: "Linkin Park", identifier: "studio" } };
    assert.strictEqual(hasTrackIdentity([studio], live, { includeIdentifier: false }), true);
  });
});
