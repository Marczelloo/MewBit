// A repeated phrase (chorus) plays exactly like the phrase it repeats: its notes
// are copied from the source phrase, shifted by the lag between them.
const { nearestIndex } = require("./util");

const EVENT_TOLERANCE_MS = 60; // a copied note needs an event of the new phrase this close

// copyRepeat(sourceNotes, phrase, eventTimes) -> notes
// `sourceNotes`: the source phrase's final notes for one difficulty ({ t, lane, len? }).
// `eventTimes`: sorted times of all layer events and band onsets of the new phrase;
// a copied note with none within +-60 ms (the music differs there) is dropped.
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

module.exports = { copyRepeat };
