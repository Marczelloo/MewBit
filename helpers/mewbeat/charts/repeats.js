// A repeated phrase (chorus) plays exactly like the phrase it repeats: its notes
// are copied from the source phrase, shifted by the lag between them.
const { beatPosition, timeAtPosition } = require("./grid");
const { metricLevel } = require("./rhythm");
const { nearestIndex } = require("./util");

const EVENT_TOLERANCE_MS = 60; // a copied note needs an event of the new phrase this close
const UNKNOWN_PLACE = 2; // without a grid no note counts as on a beat

// copyRepeat(sourceNotes, phrase, eventTimes, timing) -> notes
// `sourceNotes`: the source phrase's final notes for one difficulty ({ t, lane, len? }).
// `eventTimes`: sorted times of all layer events and band onsets of the new phrase;
// a copied note with none within +-60 ms (the music differs there) is dropped, unless it sits on a beat or a half beat:
// people keep the rhythm of a repeat through what changes on top of it.
// The plugin's lag is measured in ms and is rarely a whole number of beats (69269 ms = 164.14 beats). On a beat grid
// (`timing`, optional) a note keeps its place in the bar instead: it moves by the whole beats nearest the lag, so what
// sat on the grid in the source sits on the grid here, whatever the tempo did in between.
// sourceWindow(phrase, source, timing) -> { from, to }
// The span the repeat copies from. The plugin's lag includes the beat shift its
// match found (up to +-4 beats), so the copied music is the repeat's own window
// moved back by the lag, which need not be the source phrase's window.
// With a beat grid (`timing`, optional: flag phraseGrid) the window is moved back the way the notes are copied, by whole
// beats, so a bound on the grid stays on the grid point its moments have.
function sourceWindow(phrase, source, timing = null) {
  if (timing?.snapped && Number.isFinite(phrase.lagMs)) {
    const back = sourceTime(phrase, timing);
    return { from: back(phrase.startMs), to: back(phrase.endMs) };
  }
  const lag = Number.isFinite(phrase.lagMs) ? phrase.lagMs : phrase.startMs - source.startMs;
  return { from: phrase.startMs - lag, to: phrase.endMs - lag };
}

function shifter(phrase, lag, timing) {
  if (!timing?.snapped) return (t) => t + lag;
  const beats = Math.round(beatPosition(timing, phrase.startMs) - beatPosition(timing, phrase.startMs - lag));
  return (t) => timeAtPosition(timing, beatPosition(timing, t) + beats);
}

// The moment of a repeat's source that t plays again: the way back of `shifter`.
function sourceTime(phrase, timing = null) {
  const lag = Number.isFinite(phrase.lagMs) ? phrase.lagMs : 0;
  if (!timing?.snapped) return (t) => t - lag;
  const beats = Math.round(beatPosition(timing, phrase.startMs) - beatPosition(timing, phrase.startMs - lag));
  return (t) => timeAtPosition(timing, beatPosition(timing, t) - beats);
}

function copyRepeat(sourceNotes, phrase, eventTimes, timing = null) {
  const shift = shifter(phrase, Number.isFinite(phrase.lagMs) ? phrase.lagMs : 0, timing);
  const out = [];
  for (const note of sourceNotes) {
    const t = shift(note.t);
    if (!(t >= phrase.startMs && t < phrase.endMs)) continue;
    const i = nearestIndex(eventTimes, t);
    const heard = i >= 0 && Math.abs(eventTimes[i] - t) <= EVENT_TOLERANCE_MS;
    if (!heard && metricLevel(timing, t, UNKNOWN_PLACE) > 1) continue;
    out.push({ ...note, t });
  }
  return out;
}

module.exports = { copyRepeat, sourceTime, sourceWindow };
