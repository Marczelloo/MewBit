// What the song select's "For you" tab knows about this session: how many runs were saved and which song was played last.
// It lives here, not in the screen, because the screen is unmounted while a run is on and comes back after it.
// The bot rotates its lists once per saved run (the `rotate` of mewbeat_recs), so opening "For you" after a run shows
// other rows, with songs like the one just played first (the `seedKey`).

let session = { runs: 0, seedKey: null, lastId: null };

/**
 * A run was saved (its submit came back ok). Counts it once per id and remembers its song as the one just played.
 * Returns whether it counted: a calibration or autoplay run, a run without a song and a repeated id do not.
 */
export function noteRunSaved({ id = null, audioKey = null, calibration = false, autoplay = false } = {}) {
  if (calibration || autoplay || !audioKey) return false;
  if (id !== null && id === session.lastId) return false;
  session = { runs: session.runs + 1, seedKey: audioKey, lastId: id };
  return true;
}

/** { runs, seedKey } as it stands: runs saved in this session and the audio key of the last one's song (or null). */
export function suggestionsSession() {
  return { runs: session.runs, seedKey: session.seedKey };
}

/** The tests' way back to a fresh session. */
export function resetSuggestionsSession() {
  session = { runs: 0, seedKey: null, lastId: null };
}
