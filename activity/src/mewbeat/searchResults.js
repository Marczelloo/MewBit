// What the song select does with the server's search answer: which results it lists, why a listed one cannot be
// played, and what to say when a pasted link gave nothing.

// Mirrors `plugins.mewbeat.maxTrackMs` in helpers/lavalink/application.yml: a longer song is refused at chart time.
export const MAX_PLAY_MS = 1_200_000;
export const SEARCH_LIMIT = 20;
export const LINK_LIST_LIMIT = 48;

/** Why a result cannot be played ("stream" | "too_long"), or null. The server says; a reply without it is judged here. */
export function playIssueOf(track) {
  if (track?.playIssue === "stream" || track?.playIssue === "too_long") return track.playIssue;
  if (track?.isStream) return "stream";
  return Number(track?.durationMs) > MAX_PLAY_MS ? "too_long" : null;
}

const PLAY_ISSUES = {
  stream: "Live stream",
  too_long: "Over 20 min",
};

/** The short label of a row that cannot be played. */
export function describePlayIssue(issue) {
  return PLAY_ISSUES[issue] ?? null;
}

const LINK_ERRORS = {
  unsupported_host: "That link isn't supported. Paste a YouTube, Spotify or SoundCloud link to one song.",
  profile: "That link is an artist or channel page. Paste a link to one song, or search for the artist by name.",
  playlist_unsupported: "Deezer playlists and albums can't be opened here. Paste a link to one song.",
  not_found: "Nothing was found at that link. It may be private, removed or not available here.",
  failed: "Couldn't load that link. Try again, or search for the song by name.",
  no_copy: "That Deezer song has no playable copy. Search for it by name instead.",
};

/** The empty-state text for a pasted link that gave no songs. */
export function describeLinkError(link) {
  return LINK_ERRORS[link?.error] ?? LINK_ERRORS.failed;
}

/** A note above a link's results, or null: a playlist says what was opened and how many songs it has. */
export function describeLinkNote(link, shown) {
  if (link?.kind !== "playlist") return null;
  const total = Number(link.total) || shown;
  const name = link.name ? `"${link.name}"` : "This playlist";
  return total > shown ? `${name}: showing the first ${shown} of ${total} songs.` : `${name}: ${total} ${total === 1 ? "song" : "songs"}.`;
}

/** The results to list, from the server's answer: no Deezer tracks (the game plays from the other sources). */
export function listedTracks(response) {
  const limit = response?.link?.kind === "playlist" ? LINK_LIST_LIMIT : SEARCH_LIMIT;
  return (response?.tracks || []).filter((track) => track?.uri && track.source !== "deezer").slice(0, limit);
}
