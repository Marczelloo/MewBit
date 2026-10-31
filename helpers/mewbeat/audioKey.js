const { createHash } = require("node:crypto");

// Charts are tied to the exact audio, so the length is part of the key:
// a re-upload or edit under the same identifier gets its own chart.
function audioKeyOf(track) {
  const info = track?.info;
  if (!info || info.isStream) return null;
  const source = String(info.sourceName || "").toLowerCase();
  const identifier = info.identifier;
  const length = Number(info.length);
  if (!source || !identifier || !Number.isFinite(length) || length <= 0) return null;
  return `${source}:${identifier}:${length}`;
}

function audioKeyFile(key) {
  return createHash("sha1").update(key).digest("hex");
}

module.exports = { audioKeyFile, audioKeyOf };
