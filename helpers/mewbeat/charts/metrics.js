// Quality numbers of a finished chart, for tests and for tuning by ear.
const { DENSITY_WINDOW_MS } = require("./difficulty");
const { REPEAT_SIMILARITY, buildPhrases } = require("./phrases");
const { buildTiming } = require("./timing");
const { sourceWindow } = require("./repeats");
const { lowerBound, nearestIndex } = require("./util");

const ON_LAYER_MS = 20; // a note this close to a layer event "sits on" it
const IDENTITY_MS = 5; // a repeated note may be this far from the shifted source note

function layerTimes(features) {
  const times = [];
  for (const layer of ["drums", "bass", "lead"]) {
    for (const e of Array.isArray(features[layer]) ? features[layer] : []) if (Number.isFinite(e?.t)) times.push(e.t);
  }
  return times.sort((a, b) => a - b);
}

function peakNps(notes) {
  let best = 0;
  let start = 0;
  for (let end = 0; end < notes.length; end++) {
    while (notes[end].t - notes[start].t >= DENSITY_WINDOW_MS) start++;
    best = Math.max(best, end - start + 1);
  }
  return best / (DENSITY_WINDOW_MS / 1000);
}

// chartMetrics(chart, features) ->
//   { onLayerShare, repeatIdentity: [{ phrase, source, identity }], handBalance: { left, right }, nps: { mean, peak } }
function chartMetrics(chart, features) {
  const notes = chart?.notes ?? [];
  const times = layerTimes(features);
  const share = (count) => (notes.length === 0 ? 0 : count / notes.length);

  const onLayer = notes.filter((n) => {
    const i = nearestIndex(times, n.t);
    return i >= 0 && Math.abs(times[i] - n.t) <= ON_LAYER_MS;
  }).length;

  const durationMs = Number(chart?.durationMs) > 0 ? chart.durationMs : Number(features.durationMs) || 0;
  const timing = buildTiming(features, durationMs);
  const phrases = buildPhrases(features, timing, durationMs);
  const times0 = notes.map((n) => n.t);
  const within = (p) => notes.slice(lowerBound(times0, p.startMs), lowerBound(times0, p.endMs));
  const repeatIdentity = [];
  for (const p of phrases) {
    const source = phrases[p.repeatOf];
    if (p.repeatOf === null || !source || p.repeatOf >= p.index || !(p.similarity >= REPEAT_SIMILARITY)) continue;
    const { from, to } = sourceWindow(p, source);
    const sourceNotes = notes.slice(lowerBound(times0, from), lowerBound(times0, to));
    if (sourceNotes.length === 0) continue;
    const mine = within(p);
    const same = sourceNotes.filter((s) =>
      mine.some((n) => n.lane === s.lane && Math.abs(n.t - (s.t + p.lagMs)) <= IDENTITY_MS),
    ).length;
    repeatIdentity.push({ phrase: p.index, source: p.repeatOf, identity: same / sourceNotes.length });
  }

  const left = notes.filter((n) => n.lane < 2).length;
  return {
    onLayerShare: share(onLayer),
    repeatIdentity,
    handBalance: { left: share(left), right: share(notes.length - left) },
    nps: { mean: durationMs > 0 ? notes.length / (durationMs / 1000) : 0, peak: peakNps(notes) },
  };
}

module.exports = { chartMetrics };
