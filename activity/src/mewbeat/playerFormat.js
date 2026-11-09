// Number and time formats for the profile, stats and leaderboard panels. A missing value reads "—", never "NaN".

const DASH = "—";
const ON_TIME_MS = 2; // a mean offset this close to zero is not worth calling early or late

export function formatDuration(ms) {
  const minutes = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 60_000) : 0;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

// A span too short for formatDuration, like the longest hold: "14.2 s".
export function formatSeconds(ms) {
  return Number.isFinite(ms) && ms > 0 ? `${(ms / 1000).toFixed(1)} s` : DASH;
}

export function formatOffsetMs(mean) {
  if (!Number.isFinite(mean)) return DASH;
  const rounded = Math.round(mean);
  return `${rounded > 0 ? "+" : ""}${rounded} ms`;
}

export function timingWord(mean) {
  if (!Number.isFinite(mean)) return "";
  if (Math.abs(mean) <= ON_TIME_MS) return "on time";
  return mean > 0 ? "a little late" : "a little early";
}

// Accuracy is already a percentage (0-100) everywhere in mewbeat.
export function formatPercent(value, digits = 1) {
  return Number.isFinite(value) ? `${value.toFixed(digits)}%` : DASH;
}

// A count with thousands separators; anything that is not a number counts as zero.
export function formatCount(value) {
  return (Number.isFinite(value) ? value : 0).toLocaleString("en-US");
}

// A rank is 1-based; null (unranked) reads as a dash.
export function formatRank(rank) {
  return Number.isFinite(rank) && rank > 0 ? `#${rank}` : DASH;
}

// "Oct 2026", for "playing since". Empty when the player has no first play yet.
export function formatSince(at) {
  if (!Number.isFinite(at)) return "";
  return new Date(at).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
