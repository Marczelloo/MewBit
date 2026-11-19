const { getAllVersions, getPatchNotes, getCurrentVersion } = require("./announcer");

// How many lines the "What's new" window shows when a release has no summary of its own.
const SUMMARY_FALLBACK_LINES = 3;

function textList(value) {
  return Array.isArray(value) ? value.filter((line) => typeof line === "string" && line.trim()).map((line) => line.trim()) : [];
}

/**
 * One release in the shape every surface reads: the website, the Activity's patch notes and its "What's new" window.
 * `summary` is the short list for the window; a release without one falls back to its first lines.
 */
function describeRelease(version) {
  const notes = getPatchNotes(version);
  if (!notes) return null;
  const features = textList(notes.features);
  const fixes = textList(notes.fixes);
  const changes = textList(notes.changes);
  const summary = textList(notes.summary);
  return {
    version: notes.version || version,
    date: notes.date || null,
    title: notes.title || "",
    // A fixes-only release still has something to say.
    summary: summary.length ? summary : [...features, ...changes, ...fixes].slice(0, SUMMARY_FALLBACK_LINES),
    features,
    fixes,
    changes,
  };
}

/** Release history, newest first. The same JSON `/changelog` reads in Discord. */
function describeChangelog() {
  return getAllVersions().map(describeRelease).filter(Boolean);
}

/**
 * The release this account has not been shown yet, or null. Only the running version counts: someone who skipped
 * a few releases sees the latest one, and the full history is one click away.
 */
function unseenRelease(seenVersion) {
  const current = getCurrentVersion();
  if (!current || seenVersion === current) return null;
  const release = describeRelease(current);
  if (!release) return null;
  const { version, date, title, summary } = release;
  return { version, date, title, summary };
}

module.exports = {
  describeRelease,
  describeChangelog,
  unseenRelease,
};
