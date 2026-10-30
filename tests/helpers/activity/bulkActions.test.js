const assert = require("node:assert/strict");
const test = require("node:test");

function stub(relative, exports) {
  const resolved = require.resolve(relative);
  const real = require(resolved);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { ...real, ...exports } };
}

const played = [];
const playlists = new Map();
stub("../../../helpers/lavalink/index", {
  getPlayer: () => ({ voiceChannel: "voice-1", textChannel: "text-1" }),
  lavalinkPlay: async (options) => {
    played.push(options);
    return { success: true };
  },
});
stub("../../../helpers/guildState", {
  getGuildState: () => ({ playerChannel: "text-1" }),
  updateGuildState: () => {},
});
stub("../../../helpers/playlists/store", {
  createPlaylist: (userId, guildId, name) => {
    const clean = String(name || "").trim().replace(/\s+/g, " ");
    if (!clean) return { success: false, error: "Playlist name cannot be empty." };
    if (playlists.has(clean.toLowerCase())) return { success: false, error: `A user playlist named "${name}" already exists.` };
    const playlist = { name: clean, tracks: [] };
    playlists.set(clean.toLowerCase(), playlist);
    return { success: true, playlist };
  },
  addTrack: (userId, guildId, name, track) => {
    const playlist = playlists.get(name.toLowerCase());
    if (!playlist) return { success: false, error: "not found" };
    if (playlist.tracks.some((item) => item.uri === track.uri)) return { success: true, duplicate: true };
    playlist.tracks.push(track);
    return { success: true };
  },
});
const { runActivityAction } = require("../../../helpers/activity/server");

const identity = { id: "user-1", username: "Listener", dev: true };
const tracks = [
  { title: "Not Like Us", author: "Kendrick Lamar", uri: "https://youtube.example/a", source: "youtube", durationMs: 274_000 },
  { title: "Luther", author: "Kendrick Lamar", uri: "https://spotify.example/b", source: "spotify", durationMs: 177_000 },
  { title: "Not Like Us", author: "Kendrick Lamar", uri: "https://youtube.example/a", source: "youtube", durationMs: 274_000 },
];

test.beforeEach(() => {
  played.length = 0;
  playlists.clear();
});

test("queue_tracks plays every track in order by its own link", async () => {
  const result = await runActivityAction({ guildId: "g", identity, action: "queue_tracks", payload: { tracks } });
  assert.equal(result.count, 3);
  assert.deepEqual(played.map((call) => call.query), tracks.map((track) => track.uri));
  assert.equal(played[1].source, "spotify");
});

test("queue_tracks caps the batch and rejects an empty one", async () => {
  const many = Array.from({ length: 80 }, (_, index) => ({ title: `Song ${index}`, author: "A", uri: `https://youtube.example/${index}` }));
  const result = await runActivityAction({ guildId: "g", identity, action: "queue_tracks", payload: { tracks: many } });
  assert.equal(result.count, 50);
  await assert.rejects(runActivityAction({ guildId: "g", identity, action: "queue_tracks", payload: { tracks: [] } }), /Choose some tracks/);
});

test("save_tracks_as_playlist creates the playlist and skips duplicates", async () => {
  const result = await runActivityAction({ guildId: "g", identity, action: "save_tracks_as_playlist", payload: { name: "  Late   night ", tracks } });
  assert.deepEqual(result, { success: true, playlistName: "Late night", count: 2 });
  assert.equal(playlists.get("late night").tracks[1].length, 177_000);
});

test("save_tracks_as_playlist refuses a name that is already taken", async () => {
  await runActivityAction({ guildId: "g", identity, action: "save_tracks_as_playlist", payload: { name: "Mix", tracks } });
  const again = await runActivityAction({ guildId: "g", identity, action: "save_tracks_as_playlist", payload: { name: "mix", tracks } });
  assert.equal(again.success, false);
  assert.match(again.error, /already exists/);
});
