const { audioKeyOf } = require("./audioKey");
const { GENERATOR_VERSION } = require("./charts/generate");

// The calibration track is a metronome the mewbeat Lavalink plugin synthesises
// from its identifier, mewbeat:calibration:<bpm>:<beats>:<leadInMs>. The chart
// is built from the same identifier, so a click and its note share one time.
const SOURCE_NAME = "mewbeat";
const PREFIX = "mewbeat:calibration:";
const IDENTIFIER = /^mewbeat:calibration:(\d{1,3}):(\d{1,3}):(\d{1,5})$/;
const CALIBRATION = { bpm: 120, beats: 64, leadInMs: 3000 };
const DIFFICULTIES = ["easy", "normal", "hard", "hell"];
// The two middle lanes in turn, so either hand can take every other click.
const LANES = [1, 2];

// What to resolve with source "mewbeat": the plugin's own source manager
// answers to the full identifier.
function calibrationQuery({ bpm, beats, leadInMs } = CALIBRATION) {
  return `calibration:${bpm}:${beats}:${leadInMs}`;
}

function parseCalibration(identifier) {
  const match = IDENTIFIER.exec(String(identifier ?? ""));
  if (!match) return null;
  const [bpm, beats, leadInMs] = match.slice(1).map(Number);
  return { bpm, beats, leadInMs };
}

function isCalibrationTrack(track) {
  const info = track?.info;
  return String(info?.sourceName || "").toLowerCase() === SOURCE_NAME
    && String(info?.identifier || "").startsWith(PREFIX)
    && parseCalibration(info.identifier) !== null;
}

// The same chart on every difficulty: one note per click.
function calibrationCharts(track) {
  const clicks = parseCalibration(track?.info?.identifier);
  const audioKey = audioKeyOf(track);
  if (!clicks || !audioKey) return null;
  const beatMs = 60_000 / clicks.bpm;
  const notes = Array.from({ length: clicks.beats }, (_, i) => ({
    t: Math.round(clicks.leadInMs + i * beatMs),
    lane: LANES[i % LANES.length],
  }));
  return Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, {
    version: GENERATOR_VERSION,
    audioKey,
    difficulty,
    durationMs: Math.round(Number(track.info.length)),
    stars: 1,
    highlightMs: null,
    calibration: true,
    notes,
  }]));
}

module.exports = { CALIBRATION, SOURCE_NAME, calibrationCharts, calibrationQuery, isCalibrationTrack, parseCalibration };
