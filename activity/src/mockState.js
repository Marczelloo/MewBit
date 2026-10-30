const artwork = "https://picsum.photos/seed/mewbit-neon-cat/720/720";

const tracks = [
  { id: "mock-current", title: "Tamagotchi", author: "TACONAFIDE", durationMs: 205000, artworkUrl: artwork, uri: "https://soundcloud.com/taconafide/tamagotchi", source: "soundcloud", sourceLabel: "SoundCloud", requester: "Local Listener", autoplay: false },
  { id: "mock-queue-1", title: "Hit Em Up", author: "2Pac", durationMs: 311000, artworkUrl: artwork, source: "youtube", sourceLabel: "YouTube", requester: "MewBit", autoplay: false },
  { id: "mock-queue-2", title: "Ciepłe Dranie", author: "Kuki", durationMs: 190000, artworkUrl: artwork, source: "soundcloud", sourceLabel: "SoundCloud", requester: "Neko", autoplay: true },
  { id: "mock-queue-3", title: "Afterglow Circuit", author: "MewBit Radio", durationMs: 226000, artworkUrl: artwork, source: "deezer", sourceLabel: "Deezer", requester: "MewBit", autoplay: true },
];

const SOURCE_LABELS = { youtube: "YouTube", soundcloud: "SoundCloud", spotify: "Spotify", deezer: "Deezer" };

function library(id, title, author, durationMs, source, seed) {
  return {
    id,
    title,
    author,
    durationMs,
    source,
    sourceLabel: SOURCE_LABELS[source] || source,
    artworkUrl: `https://picsum.photos/seed/mewbit-${seed}/720/720`,
    playQuery: `${title} ${author}`,
  };
}

const libraryTracks = [
  library("lib-glass-hours", "Glass Hours", "Nova Static", 214000, "spotify", "glass"),
  library("lib-night-bus", "Night Bus to Nowhere", "Pale Harbor", 241000, "youtube", "bus"),
  library("lib-neon-rain", "Neon Rain", "DJ Neko", 198000, "soundcloud", "rain"),
  library("lib-slow-orbit", "Slow Orbit", "Hana Vale", 267000, "deezer", "orbit"),
  library("lib-paper-moons", "Paper Moons", "Kuki", 183000, "soundcloud", "moons"),
  library("lib-tail-lights", "Tail Lights", "Pale Harbor", 229000, "youtube", "lights"),
  library("lib-static-hearts", "Static Hearts", "Nova Static", 205000, "spotify", "hearts"),
  library("lib-afterimage", "Afterimage", "Hana Vale", 252000, "deezer", "after"),
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Played tracks spread over today, yesterday and a few days back, with a mix of
// people and autoplay so the History filters and day groups have something to do.
function createMockHistory(now) {
  const entries = [
    [0, 12 * MINUTE, "Local Listener", false],
    [1, 38 * MINUTE, "MewBit", true],
    [2, 71 * MINUTE, "Neko", false],
    [3, 2 * HOUR, "Local Listener", false],
    [4, DAY + 40 * MINUTE, "Neko", false],
    [5, DAY + 2 * HOUR, "MewBit", true],
    [6, DAY + 3 * HOUR, "Local Listener", false],
    [7, 4 * DAY + HOUR, "Neko", false],
    [0, 4 * DAY + 2 * HOUR, "MewBit", true],
    [2, 4 * DAY + 5 * HOUR, "Local Listener", false],
  ];
  return entries.map(([index, ago, requester, autoplay]) => ({
    ...libraryTracks[index],
    requester,
    autoplay,
    playedAt: now - ago,
  }));
}

function createMockPlaylistDetails(now) {
  const nightDrive = libraryTracks.map((track, index) => ({ ...track, addedAt: now - (index + 1) * DAY * 2 }));
  const liked = [libraryTracks[3], libraryTracks[0], libraryTracks[6], libraryTracks[1], libraryTracks[5]].map((track, index) => ({ ...track, addedAt: now - (index + 1) * 3 * DAY }));
  return {
    liked: { id: "liked", name: "Liked Songs", description: "Your saved tracks", thumbnail: "", public: false, collaborative: false, isDefault: true, tracks: liked },
    "night-drive": { id: "night-drive", name: "Night Drive.exe", description: "Blue lights, no skips. Late-night streets and a slow bassline.", thumbnail: "", public: true, collaborative: true, isDefault: false, tracks: nightDrive },
  };
}

export function createMockState({ idle = false } = {}) {
  const currentTrack = idle ? null : tracks[0];
  const now = Date.now();
  return {
    guild: { id: "demo", name: "MewBit test room", iconUrl: null, voiceChannelName: "Neon Listening Room" },
    botStatus: "the bassline has been peer reviewed",
    activity: {
      active: true,
      events: [
        { id: "mock-event-skip", timestamp: Date.now() - 42_000, level: "info", title: "Room activity", detail: "skipped a queued track", actor: "Neko" },
        { id: "mock-event-fallback", timestamp: Date.now() - 95_000, level: "warning", title: "Trying an alternate source", detail: "Retrying a verified mirror for Tamagotchi." },
      ],
    },
    player: {
      connected: true,
      paused: idle,
      playing: !idle,
      positionMs: idle ? 0 : 73500,
      lyricsSyncOffsetMs: -450,
      lyricsDefaultSyncOffsetMs: -450,
      durationMs: idle ? 0 : tracks[0].durationMs,
      volume: 52,
      muted: false,
      loop: "NONE",
      shuffleActive: false,
      autoplay: !idle,
      currentTrack,
      queue: idle ? [] : tracks.slice(1).map((track, index) => ({ ...track, index, queueItemId: `mock-queue-item-${index}` })),
      history: createMockHistory(now),
      sessionStartedAt: now - 3 * HOUR,
      filters: {
        preset: "rnb",
        effectPreset: "off",
        equalizer: [
          { band: 0, gain: 0.08 },
          { band: 1, gain: 0.12 },
          { band: 2, gain: 0.1 },
          { band: 3, gain: 0.03 },
        ],
      },
      lyrics: {
        provider: "LRCLIB",
        synced: true,
        text: "Signal in the midnight\nNeon in the rain",
        lines: [
          { timestamp: 65000, line: "Signal in the midnight" },
          { timestamp: 70500, line: "Neon in the rain" },
          { timestamp: 79000, line: "Keep the room alive" },
          { timestamp: 85500, line: "Let the bassline guide" },
        ],
      },
      updatedAt: Date.now(),
    },
    lavalink: { connected: true, latencyMs: 24 },
    playlists: [
      { id: "liked", name: "Liked Songs", type: "user", description: "Your saved tracks", trackCount: 5, thumbnail: "", public: false, collaborative: false, isDefault: true },
      { id: "night-drive", name: "Night Drive.exe", type: "user", description: "Blue lights, no skips", trackCount: libraryTracks.length, thumbnail: "", public: true, collaborative: true, isDefault: false },
    ],
    playlistDetails: createMockPlaylistDetails(now),
    likedTrackIds: ["mock-queue-1"],
    equalizerPresets: [],
    filterPresets: ["nightcore", "vaporwave", "chipmunk", "deepvoice", "eightd", "karaoke", "wobble", "vibrato", "robot", "telephone", "mono", "surround", "meme"],
  };
}

export const mockSearchResults = [
  { ...tracks[1], id: "search-2pac", title: "Hit Em Up", author: "2Pac", source: "youtube", sourceLabel: "YouTube", playQuery: "https://www.youtube.com/watch?v=41qC3w3UUkU" },
  { ...tracks[0], id: "search-taco", title: "Tamagotchi", author: "TACONAFIDE", source: "soundcloud", sourceLabel: "SoundCloud", playQuery: "Tamagotchi TACONAFIDE" },
  { ...tracks[2], id: "search-kuki", title: "Ciepłe Dranie", author: "Kuki", source: "soundcloud", sourceLabel: "SoundCloud", playQuery: "Ciepłe Dranie Kuki" },
  { ...tracks[3], id: "search-afterglow", title: "Afterglow Circuit (Extended Mix)", author: "MewBit Radio", durationMs: 371000, source: "deezer", sourceLabel: "Deezer", playQuery: "Afterglow Circuit MewBit Radio" },
  { id: "search-live", title: "NEON NIGHTS - lo-fi radio 24/7", author: "MewBit Radio", durationMs: 0, isStream: true, source: "youtube", sourceLabel: "YouTube", playQuery: "neon nights lofi radio" },
  { id: "search-noart", title: "Midnight Catwalk", author: "DJ Neko", durationMs: 254000, source: "soundcloud", sourceLabel: "SoundCloud", playQuery: "Midnight Catwalk DJ Neko" },];

export function createEmptyState() {
  return {
    guild: { id: null, name: null, iconUrl: null, voiceChannelName: null },
    botStatus: null,
    activity: { active: false, events: [] },
    player: {
      connected: false,
      paused: true,
      playing: false,
      positionMs: 0,
      lyricsSyncOffsetMs: -450,
      lyricsDefaultSyncOffsetMs: -450,
      durationMs: 0,
      volume: 100,
      muted: false,
      loop: "NONE",
      shuffleActive: false,
      autoplay: false,
      currentTrack: null,
      queue: [],
      filters: { preset: "off", effectPreset: "off", equalizer: [] },
      lyrics: null,
    },
    lavalink: { connected: true, latencyMs: 24 },
    playlists: [],
    likedTrackIds: [],
    equalizerPresets: [],
    filterPresets: [],
  };
}
