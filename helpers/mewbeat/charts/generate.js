const { DENSITY_WINDOW_MS, DIFFICULTIES, GENERATOR_VERSION, LEAD_IN_MS, MIN_NOTES, SILENCE_ENERGY } = require("./difficulty");
const { bandPathNotes } = require("./bandPath");
const { busyFactor, effectiveDifficulty } = require("./busyness");
const { deriveNotes } = require("./derive");
const { applyDifficulty, enforceFloors, limitJacks } = require("./difficultyFilter");
const { addGapHolds, addSustainHolds, clipHolds, limitHoldShare } = require("./holds");
const { withMergedLead } = require("./legato");
const { patternEvents } = require("./patterns");
const { REPEAT_SIMILARITY, TONAL_MIN_CONF, buildPhrases, chooseLeaders, hasSteadyPulse, isVocalSong, supportLayers } = require("./phrases");
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
  const leaders = chooseLeaders(phrases);
  const vocal = isVocalSong(phrases);
  return {
    features,
    durationMs,
    timing,
    energy: energyLookup(features),
    busy: busyFactor(features),
    phrases,
    leaders,
    supports: phrases.map((phrase, i) => supportLayers(phrase, leaders[i], vocal)), // the layers charted beside the leader
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

// The notes of repeat phrase i copied from its source in `all` (the notes so far), or null when phrase i is no
// repeat or the copy lost most of its source (the music differs, or the source overlaps this phrase): then it is
// charted fresh.
function copiedRepeat(ctx, all, i, diff) {
  const { timing, energy, phrases, durationMs } = ctx;
  const phrase = phrases[i];
  if (!isRepeat(phrase, i)) return null;
  const { from, to } = sourceWindow(phrase, phrases[phrase.repeatOf]);
  const sourceNotes = inWindow(all, from, to);
  if (sourceNotes.length === 0) return null;
  // A copy may end sooner than its source (or the song): its holds are clipped to fit.
  const copied = clipHolds(copyRepeat(sourceNotes, phrase, phraseEventTimes(ctx, phrase)), Math.min(phrase.endMs, durationMs), diff, timing)
    .filter((n) => n.t >= LEAD_IN_MS && energy.at(n.t) >= SILENCE_ENERGY);
  return copied.length > 0 && copied.length >= sourceNotes.length * MIN_COPY_SHARE ? copied : null;
}

const steadyDrums = (ctx, i) => ctx.leaders[i] === "drums" && hasSteadyPulse(ctx.phrases[i]);

// Hard: charted from the music, phrase by phrase.
function chartNotes(ctx, diff) {
  const { features, timing, energy, phrases, leaders, supports, durationMs } = ctx;
  const all = []; // final notes so far, time-ordered
  // Where a bass or lead line plays (or the features cannot tell), a phrase's resting hands hold through the rests;
  // no such hold runs into the next phrase, so a repeat copies it.
  const tonal = (p) => !p.confidence || ["bass", "lead"].some((l) => p.confidence[l] >= TONAL_MIN_CONF);
  const withGapHolds = (notes, tail, p, toMs) =>
    tonal(p)
      ? addGapHolds([...tail, ...notes], diff, timing, energy, Math.min(toMs, durationMs), p.startMs).filter((n) => n.t >= p.startMs)
      : notes;

  for (let i = 0; i < phrases.length; ) {
    const phrase = phrases[i];
    // The previous notes that still matter here: the last 2 s, and any hold still running.
    const tail = all.filter((n) => n.t < phrase.startMs && Math.max(n.t, n.t + (n.len ?? 0)) >= phrase.startMs - DENSITY_WINDOW_MS);

    // A repeat plays like its source.
    const copied = copiedRepeat(ctx, all, i, diff);
    if (copied) {
      all.push(...copied);
      i++;
      continue;
    }

    if (leaders[i] === "bands") {
      // Consecutive band-path phrases are one window (the band path keeps no
      // state across windows); a repeat ends it so the copy sees its source.
      let last = i;
      while (last + 1 < phrases.length && leaders[last + 1] === "bands" && !isRepeat(phrases[last + 1], last + 1)) last++;
      const toMs = last === phrases.length - 1 ? Math.max(phrases[last].endMs, durationMs + 1) : phrases[last].endMs;
      const notes = bandPathNotes(features, timing, diff, energy, { fromMs: phrase.startMs, toMs });
      all.push(...withGapHolds(limitJacks(notes, diff, tail, { strict: false, timing }), tail, phrase, toMs));
      i = last + 1;
      continue;
    }

    const events = patternEvents(phrase, leaders[i], features, timing, supports[i]);
    const charted = applyDifficulty(events, diff, timing, energy, tail, phrase.energy, phrase.endMs, steadyDrums(ctx, i));
    all.push(...withGapHolds(charted, tail, phrase, i === phrases.length - 1 ? durationMs : phrase.endMs));
    i++;
  }
  // Long bass/lead notes become holds wherever they were charted, drum-led phrases included. Those holds (and the
  // sustains planned with the phrase) are what a hold cap keeps longest: ctx.sustained.
  const key = (n) => `${n.t}:${n.lane}`;
  const gapHeld = new Set(all.filter((n) => n.len > 0 && n.gapHold).map(key));
  const notes = addSustainHolds(all.sort(byTime), features, diff, timing, durationMs).map(({ gapHold, ...n }) => n);
  ctx.sustained = new Set(notes.filter((n) => n.len > 0 && !gapHeld.has(key(n))).map(key));
  return notes;
}

// No hold runs past the end of the song, whatever produced it. Derived charts cap their hold share per phrase (a cap
// over the whole song would demote holds unevenly and break the repeats).
const finish = (ctx, notes, diff, capHolds = true) => {
  const floored = enforceFloors(clipHolds(notes.sort(byTime), ctx.durationMs, diff, ctx.timing), diff, ctx.timing);
  return capHolds ? limitHoldShare(floored, Math.floor, sustainedOf(ctx)) : floored;
};

// Is a note one of Hard's sustain holds (not a gap hold)?
const sustainedOf = (ctx) => (n) => ctx.sustained?.has(`${n.t}:${n.lane}`) ?? false;

const diffOf = (ctx, difficulty) => effectiveDifficulty(DIFFICULTIES[difficulty], ctx.busy);

// Hard's notes before the final floors (Easy and Normal are derived from these).
function hardNotes(ctx) {
  if (!ctx.hard) ctx.hard = chartNotes(ctx, diffOf(ctx, "hard"));
  return ctx.hard;
}

function notesFor(ctx, difficulty) {
  const diff = diffOf(ctx, difficulty);
  if (difficulty === "hard") return finish(ctx, [...hardNotes(ctx)], diff);
  const hard = finish(ctx, [...hardNotes(ctx)], diffOf(ctx, "hard"));
  const derived = deriveNotes(ctx, hard, diff, {
    copyRepeat: (all, i) => copiedRepeat(ctx, all, i, diff),
    steadyPulse: (i) => steadyDrums(ctx, i),
    sustained: sustainedOf(ctx),
  });
  return finish(ctx, derived, diff, false);
}

// --- public API --------------------------------------------------------------

function chartFrom(ctx, difficulty, audioKey) {
  const notes = notesFor(ctx, difficulty);
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
