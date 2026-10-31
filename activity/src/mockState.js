const artwork = "https://picsum.photos/seed/mewbit-neon-cat/720/720";

const tracks = [
  { id: "mock-current", title: "Tamagotchi", author: "TACONAFIDE", durationMs: 205000, artworkUrl: artwork, uri: "https://soundcloud.com/taconafide/tamagotchi", source: "soundcloud", sourceLabel: "SoundCloud", requester: "Local Listener", autoplay: false },
  { id: "mock-queue-1", title: "Hit Em Up", author: "2Pac", durationMs: 311000, artworkUrl: artwork, source: "youtube", sourceLabel: "YouTube", requester: "MewBit", autoplay: false },
  { id: "mock-queue-2", title: "Ciepłe Dranie", author: "Kuki", durationMs: 190000, artworkUrl: artwork, source: "soundcloud", sourceLabel: "SoundCloud", requester: "Neko", autoplay: true },
  { id: "mock-queue-3", title: "Afterglow Circuit", author: "MewBit Radio", durationMs: 226000, artworkUrl: artwork, source: "deezer", sourceLabel: "Deezer", requester: "MewBit", autoplay: true },
];

// Same literal as DEFAULT_SETTINGS in helpers/mewbeat/userSettings.js (the activity cannot import that CJS file).
const MEWBEAT_DEFAULT_SETTINGS = { keys: ["KeyD", "KeyF", "KeyJ", "KeyK"], offsetMs: 0, scrollSpeed: 5, liveDifficulty: "normal", effects: "full", hitSounds: false };

export function createMockState({ idle = false, locked = false } = {}) {
  const currentTrack = idle ? null : tracks[0];
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
      queue: idle ? [] : tracks.slice(1).map((track, index) => ({ ...track, index })),
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
    mewbeat: { unlocked: !locked, settings: { ...MEWBEAT_DEFAULT_SETTINGS, keys: [...MEWBEAT_DEFAULT_SETTINGS.keys] } },
    playlists: [
      { id: "liked", name: "Liked Songs", type: "user", description: "Your saved tracks", trackCount: 42, thumbnail: artwork, public: false, collaborative: false, isDefault: true },
      { id: "night-drive", name: "Night Drive.exe", type: "user", description: "Blue lights, no skips", trackCount: 18, thumbnail: artwork, public: true, collaborative: true, isDefault: false },
    ],
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
