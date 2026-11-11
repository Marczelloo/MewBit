// What a player listens to through the music bot, as seeds for the map suggestions (recommendations.js), next to what
// they played in the game. Three things in the bot say it, all per player:
//   the stats      the songs and artists they asked for most (a count each, no times)
//   the room log   what they asked for in the last two weeks (when, in this server)
//   Liked Songs    the songs they saved, with the time
// A track the bot's autoplay picked is nobody's request and counts for nothing here. Everything is read through the
// injected functions, so a test feeds made-up lists and nothing here opens a file:
//   topTracks(userId, limit) -> [{ track: "Artist - Title", count }]
//   topArtists(userId, limit) -> [{ artist, count }]
//   roomTracks(guildId) -> [{ info: { title, author, requesterId, autoplayed, isStream }, userData, ... }]
//   liked(userId) -> [{ title, author, addedAt }]
// The reader returns data only; the seeds are picked from it by listeningSeedsOf.

const { artistKeyOf, identityOf } = require("./songIdentity");

const DAY_MS = 86_400_000;
const TOP_TRACKS = 30;
const TOP_ARTISTS = 20;
const LIKED_TRACKS = 30;
const RECENT_DAYS = 14;
// An artist is named in a reason ("you listen to X") from this many plays or songs; below it the song is named.
const ARTIST_PLAYS = 6;
const ARTIST_SONGS = 3;
const MAX_LABEL = 60;

const recency = (at, now, halfLifeDays) => (Number.isFinite(at) ? 0.5 ** (Math.max(0, now - at) / (halfLifeDays * DAY_MS)) : 0);

// "Artist - Title" as the stats store keys a song. The artist may hold a " - " itself, rarely; the first one splits.
function splitTrackKey(key) {
  const text = String(key ?? "");
  // A YouTube "Artist - Topic" channel is one artist: "Camellia - Topic - GHOST" is GHOST by "Camellia - Topic".
  const topic = /^(.+?) - Topic - /i.exec(text);
  const at = topic ? topic[1].length + " - Topic".length : text.indexOf(" - ");
  if (at <= 0) return null;
  const artist = text.slice(0, at).trim();
  const title = text.slice(at + 3).trim();
  return artist && title ? { artist, title } : null;
}

// How a song or an artist reads in a reason: no "- Topic" channel suffix, no "Artist - " in front of a title, no
// bracketed "(Official Video)", cut to a short length.
function labelOf(text, artist = "") {
  let label = String(text ?? "").replace(/\s*-\s*topic\s*$/i, "");
  const front = String(artist ?? "").replace(/\s*-\s*topic\s*$/i, "").trim();
  if (front && label.toLowerCase().startsWith(`${front.toLowerCase()} - `)) label = label.slice(front.length + 3);
  // A long video title runs on with " | Beat Saber | Channel": what is before the first bar is the song.
  const bare = label.split(/\s+\|\s+/)[0].replace(/\s*[([{][^)\]}]*[)\]}]/g, "").replace(/\s+/g, " ").trim();
  label = (bare || label).trim();
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1).trimEnd()}…` : label;
}

// { tracks, artists } for one player. Never throws: a store that fails is a store with nothing in it.
function readTaste({ userId, guildId = null, sources = {}, now = Date.now() } = {}) {
  const tracks = new Map(); // identity -> { title, artist, plays, recent, lastAt, likedAt }
  const artists = new Map(); // artist key -> { name, plays, songs }
  const safe = (read, fallback) => {
    try {
      const value = read?.();
      return Array.isArray(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const track = (title, artist) => {
    const identity = identityOf(title, artist);
    if (!identity || !artistKeyOf(artist)) return null;
    if (!tracks.has(identity)) tracks.set(identity, { title, artist, plays: 0, recent: 0, lastAt: null, likedAt: null });
    return tracks.get(identity);
  };

  for (const { track: key, count } of safe(() => sources.topTracks?.(userId, TOP_TRACKS), [])) {
    const parts = splitTrackKey(key);
    const entry = parts && track(parts.title, parts.artist);
    if (entry) entry.plays = Math.max(entry.plays, Number(count) || 0);
  }
  for (const { artist, count } of safe(() => sources.topArtists?.(userId, TOP_ARTISTS), [])) {
    const id = artistKeyOf(artist);
    if (!id) continue;
    const known = artists.get(id) ?? { name: artist, plays: 0, songs: 0 };
    known.plays += Number(count) || 0;
    artists.set(id, known);
  }

  const since = now - RECENT_DAYS * DAY_MS;
  for (const entry of safe(() => sources.roomTracks?.(guildId), [])) {
    const info = entry?.info;
    if (!info || info.requesterId !== userId || info.autoplayed || entry.userData?.autoplay || info.isStream) continue;
    const at = Number(entry.userData?.autoplayPlayedAt);
    if (!info.title || !info.author || !(at >= since)) continue;
    const song = track(info.title, info.author);
    if (!song) continue;
    song.recent += 1;
    song.plays = Math.max(song.plays, song.recent);
    song.lastAt = Math.max(song.lastAt ?? 0, at);
  }

  const liked = safe(() => sources.liked?.(userId), []).slice(-LIKED_TRACKS);
  for (const item of liked) {
    const song = item?.title && item?.author ? track(item.title, item.author) : null;
    if (song) song.likedAt = Math.max(song.likedAt ?? 0, Number(item.addedAt) || 0) || 1;
  }

  for (const song of tracks.values()) {
    const id = artistKeyOf(song.artist);
    const known = artists.get(id) ?? { name: song.artist, plays: 0, songs: 0 };
    known.songs += 1;
    artists.set(id, known);
  }
  return { tracks: [...tracks.values()], artists };
}

// How much a song says about the player's taste: how often they asked for it, how lately, and whether they saved it.
function weightOf(song, now) {
  return Math.log2(1 + song.plays) * 0.5
    + recency(song.lastAt, now, 7) * 1.2
    + (song.likedAt ? 1.5 + recency(song.likedAt, now, 60) * 0.5 : 0);
}

// The songs to ask "what is like this?" about, best first, one per artist: [{ title, artist, role, label, weight }].
// role "artist" names the artist in the reason (a lot of plays or several songs), "liked" a saved song, "listen" a song.
// `skip` is a set of artist keys that are taken already (the game seeds').
function listeningSeedsOf(taste, { now, limit = 3, skip = new Set() } = {}) {
  if (!taste?.tracks?.length) return [];
  const ranked = taste.tracks
    .map((song) => ({ song, weight: weightOf(song, now) }))
    .sort((a, b) => b.weight - a.weight);
  const seeds = [];
  const taken = new Set(skip);
  for (const { song, weight } of ranked) {
    const id = artistKeyOf(song.artist);
    if (taken.has(id)) continue;
    taken.add(id);
    const artist = taste.artists.get(id);
    const wide = artist && (artist.plays >= ARTIST_PLAYS || artist.songs >= ARTIST_SONGS);
    seeds.push({
      title: song.title,
      artist: song.artist,
      role: wide ? "artist" : song.likedAt ? "liked" : "listen",
      label: wide ? labelOf(artist.name) : labelOf(song.title, song.artist),
      weight,
    });
    if (seeds.length >= limit) break;
  }
  return seeds;
}

// The song that stands for the player's taste in general, apart from `artist` (a seed's own artist says nothing new):
// the heaviest one. Null when there is no other artist.
function anchorOf(taste, { now, artist = "" } = {}) {
  const apart = artistKeyOf(artist);
  let best = null;
  for (const song of taste?.tracks ?? []) {
    if (artistKeyOf(song.artist) === apart) continue;
    const weight = weightOf(song, now);
    if (!best || weight > best.weight) best = { title: song.title, artist: song.artist, weight };
  }
  return best && { title: best.title, artist: best.artist };
}

module.exports = { anchorOf, labelOf, listeningSeedsOf, readTaste, splitTrackKey, weightOf };
