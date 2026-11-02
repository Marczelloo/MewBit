const { DENSITY_WINDOW_MS, DIFFICULTIES, GENERATOR_VERSION, LEAD_IN_MS, MIN_NOTES, SILENCE_ENERGY } = require("./difficulty");
const { bandPathNotes } = require("./bandPath");
const { repeatBarLanes } = require("./barRepeats");
const { busyFactor, effectiveDifficulty } = require("./busyness");
const { applyDifficulty, enforceFloors, limitJacks, spreadLanes } = require("./difficultyFilter");
const { addGapHolds, addSustainHolds, clipHolds, limitHoldShare, oneHoldAtATime } = require("./holds");
const { withMergedLead } = require("./legato");
const { patternEvents } = require("./patterns");
const { REPEAT_SIMILARITY, TONAL_MIN_CONF, buildPhrases, chooseLeaders, hasSteadyPulse, isVocalSong, supportLayers } = require("./phrases");
const { copyRepeat, sourceWindow } = require("./repeats");
const { withIntensity } = require("./intensity");
const { fillRests } = require("./rests");
const { balanceHands, fillGaps, orientDrums } = require("./seams");
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
    energy: withIntensity(energyLookup(features), features, phrases), // with each section's intensity (intensity.js)
    busy: busyFactor(features),
    phrases,
    leaders,
    vocal,
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
  const copied = clipHolds(copyRepeat(sourceNotes, phrase, phraseEventTimes(ctx, phrase), timing), Math.min(phrase.endMs, durationMs), diff, timing)
    .filter((n) => n.t >= LEAD_IN_MS && energy.at(n.t) >= SILENCE_ENERGY);
  return copied.length > 0 && copied.length >= sourceNotes.length * MIN_COPY_SHARE ? copied : null;
}

// The layer each phrase of this difficulty follows (diff.vocalLeads puts the voice over drums and bass).
function leadersOf(ctx, diff) {
  if (!diff.vocalLeads || !ctx.vocal) return ctx.leaders;
  const heard = (p) => p.confidence?.lead >= TONAL_MIN_CONF;
  return ctx.leaders.map((leader, i) => (leader !== "bands" && heard(ctx.phrases[i]) ? "lead" : leader));
}

// One difficulty charted from the music, phrase by phrase: { notes, sustained }. Every difficulty is charted on its
// own (its grid, gaps and density pick from the music's events), not thinned from a harder one, so an Easy pattern
// is made for Easy. `sustained` holds the keys ("t:lane") of the real sustain holds, which the hold cap keeps longest.
function chartNotes(ctx, diff) {
  const { features, timing, energy, phrases, durationMs } = ctx;
  const leaders = leadersOf(ctx, diff);
  const supports = diff.oneLayer ? phrases.map(() => []) : ctx.supports;
  const all = []; // final notes so far, time-ordered
  const drumTimes = new Set(); // the moments of drum hits (a groove repeat keeps their lane roles)
  // Where a bass or lead line plays (or the features cannot tell), a phrase's resting hands hold through the rests;
  // no such hold runs into the next phrase, so a repeat copies it.
  const tonal = (p) => !p.confidence || ["bass", "lead"].some((l) => p.confidence[l] >= TONAL_MIN_CONF);
  const withGapHolds = (notes, tail, p, toMs) =>
    tonal(p)
      ? addGapHolds([...tail, ...notes], diff, timing, energy, Math.min(toMs, durationMs), p.startMs).filter((n) => n.t >= p.startMs)
      : notes;

  // A bar that plays like one just before it takes that bar's lanes, so a groove keeps its pattern.
  const grooved = (notes, fromMs, toMs, fixed) => repeatBarLanes(notes, timing, { fromMs, toMs, fixed });

  // Where the charted layer rests (a sung line pausing, a lead dropping out, the leading layer changing at a seam) while
  // the drums play on, the drums carry the beat through; a drum pattern starts on the side the hands are on.
  const changes = (i) => i > 0 && leaders[i] !== leaders[i - 1];
  // A copied repeat already carries its source's fills: only the rest before it, up to its start, is filled.
  // A rest still left a hole while the music plays on (on Easy and Normal) gets a sound of the music there (rests.js).
  // `last` is the last phrase the notes cover (a band-path window spans several).
  const bridged = (notes, i, copy = false, last = i) => {
    const end = last === phrases.length - 1;
    // Hard and Hell carry the beat through with every drum hit; Easy and Normal take single sounds (fillRests) instead.
    const fill = diff.fillRestBeats > 0
      ? []
      : fillGaps(all, notes, features, timing, energy, end && !copy ? durationMs : null).filter((n) => !copy || n.t < phrases[i].startMs);
    for (const n of fill) drumTimes.add(n.t);
    if (copy) return [...fill, ...notes];
    const before = new Set(all);
    const window = { fromMs: phrases[i].startMs, toMs: end ? Infinity : phrases[last].endMs, untilMs: end ? durationMs : null };
    return fillRests([...all, ...fill, ...notes], ctx, diff, window).filter((n) => !before.has(n));
  };

  // Where the phrase's notes join the chart. A repeat keeps its source's hands; only a jack at its seam may move.
  const place = (notes, tail, copy = false) => {
    const balanced = diff.balanceHands && !copy ? balanceHands(notes, all, tail) : notes;
    all.push(...spreadLanes(balanced, diff, timing, tail));
  };

  for (let i = 0; i < phrases.length; ) {
    const phrase = phrases[i];
    // The previous notes that still matter here: the last 2 s, and any hold still running.
    const tail = all.filter((n) => n.t < phrase.startMs && Math.max(n.t, n.t + (n.len ?? 0)) >= phrase.startMs - DENSITY_WINDOW_MS);

    // A repeat plays like its source.
    const copied = copiedRepeat(ctx, all, i, diff);
    if (copied) {
      place(bridged(copied, i, true), tail, true);
      i++;
      continue;
    }

    if (leaders[i] === "bands") {
      // Consecutive band-path phrases are one window (the band path keeps no
      // state across windows); a repeat ends it so the copy sees its source.
      let last = i;
      while (last + 1 < phrases.length && leaders[last + 1] === "bands" && !isRepeat(phrases[last + 1], last + 1)) last++;
      const toMs = last === phrases.length - 1 ? Math.max(phrases[last].endMs, durationMs + 1) : phrases[last].endMs;
      const notes = grooved(bandPathNotes(features, timing, diff, energy, { fromMs: phrase.startMs, toMs }), phrase.startMs, toMs);
      place(bridged(withGapHolds(limitJacks(notes, diff, tail, { strict: false, timing }), tail, phrase, toMs), i, false, last), tail);
      i = last + 1;
      continue;
    }

    const events = patternEvents(phrase, leaders[i], features, timing, supports[i]);
    const charted = applyDifficulty(events, diff, timing, energy, tail, phrase.energy, phrase.endMs, leaders[i] === "drums" && hasSteadyPulse(phrase));
    // Drum hits keep their lane roles (kicks outside, snares inside); the tonal notes take the earlier bar's lanes freely.
    for (const e of events) if (e.source === "drums") drumTimes.add(e.t);
    let patterned = grooved(charted, phrase.startMs, phrase.endMs, (n) => drumTimes.has(n.t));
    if (changes(i) && leaders[i] === "drums" && supports[i].length === 0) patterned = orientDrums(patterned, tail);
    // A drum hit moved out of a jack keeps its role (limitJacks tries the role partner first for a drums source).
    const asDrum = (n) => (drumTimes.has(n.t) ? { ...n, source: "drums" } : n);
    const repeated = limitJacks(patterned.map(asDrum), diff, tail, { strict: true, timing }).map(({ source, ...n }) => n);
    place(bridged(withGapHolds(repeated, tail, phrase, i === phrases.length - 1 ? durationMs : phrase.endMs), i), tail);
    i++;
  }
  // Long bass/lead notes become holds wherever they were charted, drum-led phrases included. Those holds (and the
  // sustains planned with the phrase) are what a hold cap keeps longest.
  const key = (n) => `${n.t}:${n.lane}`;
  const gapHeld = new Set(all.filter((n) => n.len > 0 && n.gapHold).map(key));
  const notes = addSustainHolds(all.sort(byTime), features, diff, timing, durationMs).map(({ gapHold, ...n }) => n);
  return { notes, sustained: new Set(notes.filter((n) => n.len > 0 && !gapHeld.has(key(n))).map(key)) };
}

// No hold runs past the end of the song, whatever produced it. The hold share is capped per phrase (a cap over the
// whole song would demote holds unevenly and break the repeats); real sustains are kept before gap holds.
function finish(ctx, { notes, sustained }, diff) {
  const clipped = enforceFloors(clipHolds([...notes].sort(byTime), ctx.durationMs, diff, ctx.timing), diff, ctx.timing);
  const floored = diff.oneHoldAtATime ? oneHoldAtATime(clipped) : clipped;
  const isSustain = (n) => sustained.has(`${n.t}:${n.lane}`);
  const last = ctx.phrases.length - 1;
  const inPhrase = (n, i) => (i === 0 || n.t >= ctx.phrases[i].startMs) && (i === last || n.t < ctx.phrases[i].endMs);
  if (last < 0) return limitHoldShare(floored, Math.floor, isSustain, diff.maxHoldShare);
  return ctx.phrases.flatMap((_, i) => limitHoldShare(floored.filter((n) => inPhrase(n, i)), Math.round, isSustain, diff.maxHoldShare)).sort(byTime);
}

const diffOf = (ctx, difficulty) => effectiveDifficulty(DIFFICULTIES[difficulty], ctx.busy);

const notesFor = (ctx, difficulty) => {
  const diff = diffOf(ctx, difficulty);
  return finish(ctx, chartNotes(ctx, diff), diff);
};

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
    bpm: ctx.timing.snapped ? Math.round(60000 / ctx.timing.medianMs) : null, // the activity scales the fall speed by it
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
  const hell = chartFrom(ctx, "hell", audioKey);
  return easy && normal && hard && hell ? { easy, normal, hard, hell } : null;
}

module.exports = { GENERATOR_VERSION, generateAll, generateChart, starsOf };
