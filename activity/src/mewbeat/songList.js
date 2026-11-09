// Orders and filters the played-songs list for the song select. The input is in "recent" order (the server
// sends the last played song first). Sorting is stable: equal values keep the order they came in, and a row
// with no value (no stars for the level, no BPM, no length) stays last whichever way the list is flipped.

const KEYS = {
  recent: (row, level, index) => -index, // desc then reads the server's order; asc reverses it
  stars: (row, level) => {
    const value = row.stars?.[level];
    return Number.isFinite(value) ? value : null;
  },
  bpm: (row) => (Number.isFinite(row.bpm) ? row.bpm : null),
  length: (row) => (Number.isFinite(row.durationMs) && row.durationMs > 0 ? row.durationMs : null),
  plays: (row, level) => row.playsBy?.[level] ?? 0,
  title: (row) => String(row.title ?? "").toLowerCase(),
};

function compareValues(a, b) {
  if (typeof a === "string" || typeof b === "string") return a.localeCompare(b);
  return a - b;
}

export function arrangeRows(rows, { sort = "recent", level = "normal", direction = "desc", filter = "all" } = {}) {
  const keyOf = KEYS[sort] ?? KEYS.recent;
  const flip = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, key: keyOf(row, level, index) }))
    .filter(({ row }) => filter === "all" || Boolean(row.bests?.[level]) === (filter === "played"))
    .sort((a, b) => {
      if (a.key === null || b.key === null) {
        if (a.key !== b.key) return a.key === null ? 1 : -1;
        return a.index - b.index;
      }
      return flip * compareValues(a.key, b.key) || a.index - b.index;
    })
    .map(({ row }) => row);
}
