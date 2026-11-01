const { DENSITY_WINDOW_MS, DIFFICULTIES, GENERATOR_VERSION, LEAD_IN_MS, MIN_NOTES, SILENCE_ENERGY } = require("./difficulty");
const { bandPathNotes } = require("./bandPath");
const { busyFactor, effectiveDifficulty } = require("./busyness");
const { applyDifficulty, enforceFloors, limitJacks } = require("./difficultyFilter");
const { clipHolds, limitHoldShare } = require("./holds");
const { withMergedLead } = require("./legato");
const { patternEvents } = require("./patterns");
const { REPEAT_SIMILARITY, buildPhrases, chooseLeaders, hasSteadyPulse } = require("./phrases");
const { copyRepeat, sourceWindow } = require("./repeats");
const { starsOf } = require("./stars");
const { buildTiming, energyLookup } = require("./timing");
const { lowerBound } = require("./util");

const byTime = (a, b) => a.t - b.t || a.lane - b.lane;
const inWindow = (notes, fromMs, toMs) => notes.filter((n) => n.t >= fromMs && n.t < toMs);
const MIN_COPY_SHARE = 0.5; // a repeat keeping less of its source than this is charted fresh

// --- shared analysis (the same for every difficulty) ---------------------------------

function analyse(raw) {
  const features = withMergedLead(raw);
  const durationMs = Math.round(features.durationMs);
  const timing = buildTiming(features, durationMs);
  const phrases = buildPhrases(features, timing, durationMs);
  return {
    features,
    durationMs,
    timing,
    energy: energyLookup(features),
    busy: busyFactor(features),
    phrases,
    leaders: chooseLeaders(phrases),
    eventTimes: sortedEventTimes(features),
  };
}

// Every layer event and band onset, sorted: what a copied note may sit on.
function sortedEventTimes(features) {
  const times = [];
  for (const layer of ["drums", "bass", "lead"]) {
    for (const e of Array.isArray(features[layer]) ? features[layer] : []) if (Number.isFinite(e?.t)) times.push(e.t);
  }
  for (const band of features.bands) {
    for (const o of Array.isArray(band?.onsets) ? band.onsets : []) if (Number.isFinite(o?.t)) times.push(o.t);
  }
  return times.sort((a, b) => a - b);
}

// --- one difficulty ------------------------------------------------------------------------

function isRepeat(phrase, index) {
  return Number.isInteger(phrase.repeatOf) && phrase.repeatOf >= 0 && phrase.repeatOf < index && phrase.similarity >= REPEAT_SIMILARITY;
}

function phraseEventTimes(ctx, phrase) {
  const { eventTimes } = ctx;
  return eventTimes.slice(lowerBound(eventTimes, phrase.startMs), lowerBound(eventTimes, phrase.endMs));
}

function chartNotes(ctx, diff) {
  const { features, timing, energy, phrases, leaders, durationMs } = ctx;
  const all = []; // final notes so far, time-ordered

  for (let i = 0; i < phrases.length; ) {
    const phrase = phrases[i];
    // The previous notes that still matter here: the last 2 s, and any hold still running.
    const tail = all.filter((n) => n.t < phrase.startMs && Math.max(n.t, n.t + (n.len ?? 0)) >= phrase.startMs - DENSITY_WINDOW_MS);

    // A repeat plays like its source.
    if (isRepeat(phrase, i)) {
      const source = phrases[phrase.repeatOf];
      const { from, to } = sourceWindow(phrase, source);
      const sourceNotes = inWindow(all, from, to);
      // A copy may end sooner than its source (or the song): its holds are clipped to fit.
      const copied = sourceNotes.length > 0
        ? clipHolds(copyRepeat(sourceNotes, phrase, phraseEventTimes(ctx, phrase)), Math.min(phrase.endMs, durationMs), diff, timing)
          .filter((n) => n.t >= LEAD_IN_MS && energy.at(n.t) >= SILENCE_ENERGY)
        : [];
      // A copy that lost most of its source (the music differs, or the source
      // overlaps this phrase) is generated fresh instead.
      if (copied.length > 0 && copied.length >= sourceNotes.length * MIN_COPY_SHARE) {
        all.push(...copied);
        i++;
        continue;
      }
    }

    if (leaders[i] === "bands") {
      // Consecutive band-path phrases are one window (the band path keeps no
      // state across windows); a repeat ends it so the copy sees its source.
      let last = i;
      while (last + 1 < phrases.length && leaders[last + 1] === "bands" && !isRepeat(phrases[last + 1], last + 1)) last++;
      const toMs = last === phrases.length - 1 ? Math.max(phrases[last].endMs, durationMs + 1) : phrases[last].endMs;
      const notes = bandPathNotes(features, timing, diff, energy, { fromMs: phrase.startMs, toMs });
      all.push(...limitJacks(notes, diff, tail, { strict: false, timing }));
      i = last + 1;
      continue;
    }

    const events = patternEvents(phrase, leaders[i], features, timing);
    all.push(...applyDifficulty(events, diff, timing, energy, tail, phrase.energy, phrase.endMs, leaders[i] === "drums" && hasSteadyPulse(phrase)));
    i++;
  }

  // No hold runs past the end of the song, whatever produced it.
  return limitHoldShare(enforceFloors(clipHolds(all.sort(byTime), durationMs, diff, timing), diff, timing));
}

// --- public API --------------------------------------------------------------

function chartFrom(ctx, difficulty, audioKey) {
  const notes = chartNotes(ctx, effectiveDifficulty(DIFFICULTIES[difficulty], ctx.busy));
  if (notes.length < MIN_NOTES) return null;
  const { features, durationMs } = ctx;
  return {
    version: GENERATOR_VERSION,
    audioKey,
    difficulty,
    durationMs,
    stars: starsOf({ notes }),
    highlightMs: Number.isFinite(features.highlightMs) && features.highlightMs >= 0 && features.highlightMs <= durationMs
      ? features.highlightMs
      : null,
    notes,
  };
}

function usable(features) {
  return !!features && Array.isArray(features.bands) && Number.isFinite(features.durationMs);
}

function generateChart(features, difficulty, audioKey) {
  if (!DIFFICULTIES[difficulty]) throw new Error(`Unknown difficulty: ${difficulty}`);
  if (!usable(features)) return null;
  return chartFrom(analyse(features), difficulty, audioKey);
}

function generateAll(features, audioKey) {
  if (!usable(features)) return null;
  const ctx = analyse(features);
  const easy = chartFrom(ctx, "easy", audioKey);
  const normal = chartFrom(ctx, "normal", audioKey);
  const hard = chartFrom(ctx, "hard", audioKey);
  return easy && normal && hard ? { easy, normal, hard } : null;
}

module.exports = { GENERATOR_VERSION, generateAll, generateChart, starsOf };
