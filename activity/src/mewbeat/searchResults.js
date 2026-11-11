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

/** A search shows at most this many of the open tab's own songs ahead of the server's results. */
export const OPEN_TAB_LIMIT = 6;

/** Lower case, without accents: how a title, an artist and a query are compared. */
export function foldText(text) {
  return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Whether every word of the query is in the row's title or artist (case and accents ignored). An empty query matches nothing. */
export function rowMatchesQuery(row, query) {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const haystack = `${foldText(row?.title)} ${foldText(row?.artist)}`;
  return words.every((word) => haystack.includes(word));
}

const sameSong = (a, b) => (a.audioKey && b.audioKey ? a.audioKey === b.audioKey : a.uri === b.uri);

/**
 * The rows of a search, in two sections. First the songs of the open tab that match the query (at most OPEN_TAB_LIMIT,
 * in the tab's order, with their stars, bests and plays as the tab shows them), under `openLabel`. Then the server's
 * results without the songs already above (the same audio key, or the same link when a row has none), under `newLabel`.
 * A row carries its section's label as `section`. With nothing in the first section there is no header for either: the
 * results are one plain list (section null).
 */
export function mergeSearchRows({ openRows = [], foundRows = [], query = "", openLabel = "", newLabel = "New songs" } = {}) {
  const first = openRows.filter((row) => rowMatchesQuery(row, query)).slice(0, OPEN_TAB_LIMIT);
  const fresh = foundRows.filter((row) => !first.some((shown) => sameSong(shown, row)));
  return [
    ...first.map((row) => ({ ...row, section: openLabel })),
    ...fresh.map((row) => ({ ...row, section: first.length ? newLabel : null })),
  ];
}
