// A melody from a second detector in Normal's choice of moments (diff.melodyPick, the decoderPick flag). The decoder lost a
// listening test when it picked the moments itself: quiet melody notes took the place of loud, full ones and left holes. So
// here it only raises the score of a moment where it hears a melody note begin, and only of a moment at least as loud as
// rule.minStrength of the song's moments (a rank, 0 the quietest, 1 the loudest): a quiet melody note gains nothing.
// The budget, the gaps and the fills of selection.js stay as they are.
const { nearestIndex } = require("./util");

const ONSET_MS = 50; // a moment plays the melody note that begins this close to the sound it was heard at

// Within-song rank of each value in [0, 1], ties sharing their mean rank.
function ranks(values) {
  const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
  const out = new Array(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j++;
    for (let k = i; k <= j; k++) out[order[k]] = values.length > 1 ? (i + j) / 2 / (values.length - 1) : 1;
    i = j + 1;
  }
  return out;
}

// withMelody(scored, melody, rule) -> scored with rule.bonus added to the score of a loud enough moment on a melody note,
// marked `melody: true`. `scored` is selection.js snappedMoments (raw: where the sound was), `melody` the decoded notes
// ({ t }), time-ordered or not.
function withMelody(scored, melody, rule) {
  if (!rule || !Array.isArray(melody) || melody.length === 0) return scored;
  const starts = melody.map((n) => n.t).filter(Number.isFinite).sort((a, b) => a - b);
  const loud = ranks(scored.map((m) => m.s));
  return scored.map((m, i) => {
    const at = m.raw ?? m.t;
    const k = nearestIndex(starts, at);
    if (k < 0 || Math.abs(starts[k] - at) > ONSET_MS || loud[i] < rule.minStrength) return m;
    return { ...m, score: m.score + rule.bonus, melody: true };
  });
}

module.exports = { withMelody };
