const assert = require("node:assert");
const { afterEach, describe, it } = require("node:test");

const { buildSessionProfile } = require("../../../helpers/lavalink/sessionProfile");
const { playbackState, pushTrackHistory } = require("../../../helpers/lavalink/state");

const GUILD_ID = "manual-memory-test";

function manual(title, artist, albumTitle) {
  return {
    track: `${artist}-${title}`,
    info: { identifier: `${artist}-${title}`, title, author: artist },
    userData: { albumTitle, genres: ["hip hop"] },
  };
}

afterEach(() => playbackState.delete(GUILD_ID));

describe("live player tracks", () => {
  it("treat the playing track as heard when the pick follows a queued one", () => {
    const playing = manual("KICK BACK", "Kenshi Yonezu");
    const queued = manual("IRIS OUT", "Kenshi Yonezu");
    const profile = buildSessionProfile(GUILD_ID, queued, { liveTracks: [playing, queued] });

    assert.ok(profile.cooldownTracks.includes(playing));
    assert.deepStrictEqual(profile.recentTracks.map((track) => track.info.title), ["KICK BACK", "IRIS OUT"]);
  });

  it("leave queued manual tracks to the upcoming list", () => {
    const playing = manual("KICK BACK", "Kenshi Yonezu");
    const queued = manual("IRIS OUT", "Kenshi Yonezu");
    const reference = manual("Lemon", "Kenshi Yonezu");
    const profile = buildSessionProfile(GUILD_ID, reference, { pendingManualTracks: [queued], liveTracks: [playing, queued, reference] });

    assert.deepStrictEqual(profile.recentTracks.map((track) => track.info.title), ["KICK BACK", "Lemon"]);
    assert.ok(profile.cooldownTracks.includes(queued));
  });
});

describe("manual autoplay memory", () => {
  it("keeps user-selected artists and albums after an autoplay detour", () => {
    const frascati = manual("Nostalgia", "Taco Hemingway", "Frascati");
    const anotherFrascati = manual("Wosk", "Taco Hemingway", "Frascati");
    const quebo = manual("Candy", "Quebonafide", "Romantic Psycho");
    const autoplayReference = {
      track: "automatic-track",
      info: { identifier: "automatic-track", title: "Automatic bridge", author: "Other Artist" },
      userData: { autoplay: true, genres: ["hip hop"] },
    };

    pushTrackHistory(GUILD_ID, frascati);
    pushTrackHistory(GUILD_ID, anotherFrascati);
    pushTrackHistory(GUILD_ID, quebo);
    pushTrackHistory(GUILD_ID, autoplayReference);

    const profile = buildSessionProfile(GUILD_ID, autoplayReference);

    assert.deepStrictEqual(
      profile.manualMemoryTracks.map((track) => track.info.title),
      ["Nostalgia", "Wosk", "Candy"]
    );
    assert.deepStrictEqual(profile.manualArtistMemory[0], { artist: "Taco Hemingway", count: 2 });
    assert.deepStrictEqual(profile.manualAlbumMemory[0], { artist: "Taco Hemingway", album: "Frascati", count: 2 });
  });
});
