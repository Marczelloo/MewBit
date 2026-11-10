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

// A key is source:identifier:length, so a stored chart can be looked up without the original track (after a restart,
// for old history). Null for anything that is not a key.
function trackFromAudioKey(audioKey) {
  if (typeof audioKey !== "string") return null;
  const first = audioKey.indexOf(":");
  const last = audioKey.lastIndexOf(":");
  if (first <= 0 || last <= first) return null;
  return {
    info: {
      sourceName: audioKey.slice(0, first),
      identifier: audioKey.slice(first + 1, last),
      length: Number(audioKey.slice(last + 1)),
    },
  };
}

module.exports = { audioKeyFile, audioKeyOf, trackFromAudioKey };
