// Recent stream outcomes per provider. A search or a link resolve can succeed
// while the stream itself is refused (Deezer answers some with a 403), so
// "Play from…" reads this before offering a provider.
const FAILURE_WINDOW_MS = 15 * 60_000;
const FAILURES_TO_FLAG = 2;
const health = new Map();

function normalizeSourceName(source) {
  const name = String(source || "").trim().toLowerCase();
  return name === "ytmsearch" || name === "ytsearch" ? "youtube" : name;
}

function recordSourcePlayback(source, ok, now = Date.now()) {
  const name = normalizeSourceName(source);
  if (!name) return;
  const entry = health.get(name) || { failures: [], lastSuccessAt: 0 };
  if (ok) {
    entry.lastSuccessAt = now;
    entry.failures = [];
  } else {
    entry.failures = [...entry.failures.filter((at) => now - at < FAILURE_WINDOW_MS), now];
  }
  health.set(name, entry);
}

// Failing: repeated stream errors lately with no stream starting since.
function isSourcePlaybackFailing(source, now = Date.now()) {
  const entry = health.get(normalizeSourceName(source));
  if (!entry) return false;
  const recent = entry.failures.filter((at) => now - at < FAILURE_WINDOW_MS && at > entry.lastSuccessAt);
  return recent.length >= FAILURES_TO_FLAG;
}

function clearSourceHealth() {
  health.clear();
}

module.exports = { clearSourceHealth, isSourcePlaybackFailing, recordSourcePlayback };
