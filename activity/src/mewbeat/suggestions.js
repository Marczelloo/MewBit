// Song suggestions (mewbeat_recs): the helpers the song-select's "For you" and "Popular" tabs and the results strip
// share. The bot only looks suggestions up; showing one starts no analysis and no charting.

// While the bot is still looking for songs like the ones played (pending), the screen asks again now and then.
export const SUGGEST_POLL_MS = 4000;
export const SUGGEST_POLL_MAX = 4;

// Server reasons from mewbeat_recs, as short copy.
const SUGGEST_ERRORS = {
  unavailable: "Suggestions aren't available right now.",
  bad_request: "Suggestions aren't available right now.",
};

export function describeSuggestError(reason) {
  return SUGGEST_ERRORS[reason] ?? (typeof reason === "string" && reason ? reason : "Couldn't load suggestions.");
}

// A suggestion as the song-select's row shape, plus why it is there (reason), which list it came from (section,
// kind), the level it suggests (level, levelStars; null when the song has no charts yet) and whether the player
// has played a popular song already.
export function suggestionRow(row, section = null) {
  return {
    key: row.audioKey ?? row.uri,
    audioKey: row.audioKey ?? null,
    uri: row.uri,
    source: row.source,
    title: row.title ?? "Unknown title",
    artist: row.artist ?? "",
    artworkUrl: row.artworkUrl ?? null,
    durationMs: row.durationMs ?? 0,
    bpm: row.bpm ?? null,
    plays: null,
    playsBy: {},
    stars: row.stars ?? null,
    bests: row.bests ?? {},
    highlightMs: row.highlightMs ?? null,
    playIssue: null,
    kind: row.kind ?? null,
    section,
    reason: row.reason ?? "",
    level: row.level ?? null,
    levelStars: Number.isFinite(row.levelStars) ? row.levelStars : null,
    played: Boolean(row.played),
  };
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row.uri || seen.has(row.key)) return false;
    seen.add(row.key);
    return true;
  });
}

// The rows of a tab. "foryou": songs like the player's, songs worth another go and what the server plays; the
// popular songs (the bot's "classic" kind) fill in when none of those has anything (a new player). "popular": that curated list alone.
export function suggestionRows(reply, tab) {
  const sections = Array.isArray(reply?.sections) ? reply.sections : [];
  const rowsOf = (kinds) => sections.filter((section) => kinds.includes(section.kind)).flatMap((section) => (Array.isArray(section.rows) ? section.rows : []).map((row) => suggestionRow(row, section.title)));
  if (tab === "popular") return uniqueRows(rowsOf(["classic"]));
  const own = uniqueRows(rowsOf(["similar", "again", "here"]));
  return own.length ? own : uniqueRows(rowsOf(["classic"]));
}

// The few songs of the results screen's strip.
export function stripRows(reply) {
  return uniqueRows((Array.isArray(reply?.strip) ? reply.strip : []).map((row) => suggestionRow(row, null)));
}

// "★ 6.4 Hard" for a suggested level; empty when the song has no charts yet.
export function suggestedLevelText(row, labelOf) {
  if (!row?.level || row.levelStars === null) return "";
  return `${labelOf(row.level)} ★ ${row.levelStars.toFixed(1)}`;
}
