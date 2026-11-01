// A repeated phrase (chorus) plays exactly like the phrase it repeats: its notes
// are copied from the source phrase, shifted by the lag between them.
const { nearestIndex } = require("./util");

const EVENT_TOLERANCE_MS = 60; // a copied note needs an event of the new phrase this close

// copyRepeat(sourceNotes, phrase, eventTimes) -> notes
// `sourceNotes`: the source phrase's final notes for one difficulty ({ t, lane, len? }).
// `eventTimes`: sorted times of all layer events and band onsets of the new phrase;
// a copied note with none within +-60 ms (the music differs there) is dropped.
// sourceWindow(phrase, source) -> { from, to }
// The span the repeat copies from. The plugin's lag includes the beat shift its
// match found (up to +-4 beats), so the copied music is the repeat's own window
// moved back by the lag, which need not be the source phrase's window.
function sourceWindow(phrase, source) {
  const lag = Number.isFinite(phrase.lagMs) ? phrase.lagMs : phrase.startMs - source.startMs;
  return { from: phrase.startMs - lag, to: phrase.endMs - lag };
}

function copyRepeat(sourceNotes, phrase, eventTimes) {
  const lag = Number.isFinite(phrase.lagMs) ? phrase.lagMs : 0;
  const out = [];
  for (const note of sourceNotes) {
    const t = note.t + lag;
    if (!(t >= phrase.startMs && t < phrase.endMs)) continue;
    const i = nearestIndex(eventTimes, t);
    if (i < 0 || Math.abs(eventTimes[i] - t) > EVENT_TOLERANCE_MS) continue;
    out.push({ ...note, t });
  }
  return out;
}

module.exports = { copyRepeat, sourceWindow };
