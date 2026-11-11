// The per-song audio alignment (setting `audioAlign`, off by default). The bot measures how far a song's stored audio file and its
// chart are apart (helpers/mewbeat/audioOffset.js) and sends it as `audioOffsetMs` with the chart.
//
// Sign, the same as on the bot: offset D > 0 means the chart lies later than the same sounds in the audio, so
//   chart time = audio position + D        (a note at chart time T is heard at audio position T - D)
// soloAudio's lag is the other way round ("song time t is buffer time t + lag"), so lag = -D.
//
// This is the only place that turns the offset into a lag. It composes with the player's own calibration offset
// (settings offsetMs / soloOffsetMs, applied by run.js to the player's inputs): that one is the player's hardware latency,
// measured with the calibration clicks, which are not a rendered song and are never shifted; this one moves the song's audio
// against its chart. They do not overlap, so neither is reduced by the other.

// Beyond this the number is not a plausible 20 ms chunk difference (the measurement searches +-120 ms); it is not applied.
export const MAX_APPLIED_OFFSET_MS = 150;

// The lag (ms) to give soloAudio.setLagMs, or null when the shift must not be applied and the old alignment stays as it is:
// the setting is off, the mode is Live (the bot plays that audio, no stored file), the chart is the calibration track,
// or the offset is unknown (null, absent, not a number).
export function alignmentLagMs({ enabled, mode, calibration = false, audioOffsetMs }) {
  if (enabled !== true) return null;
  if (mode !== "solo" && mode !== "room") return null;
  if (calibration) return null;
  if (typeof audioOffsetMs !== "number" || !Number.isFinite(audioOffsetMs)) return null;
  if (Math.abs(audioOffsetMs) > MAX_APPLIED_OFFSET_MS) return null;
  return audioOffsetMs === 0 ? 0 : -audioOffsetMs;
}

// "+20 ms", "-40 ms", "0 ms": the offset as the settings panel shows it.
export function formatSongOffset(offsetMs) {
  const rounded = Math.round(offsetMs);
  return `${rounded > 0 ? "+" : ""}${rounded === 0 ? 0 : rounded} ms`;
}
