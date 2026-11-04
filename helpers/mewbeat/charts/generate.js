const { DENSITY_WINDOW_MS, GENERATOR_VERSION, LEAD_IN_MS, MIN_NOTES, SILENCE_ENERGY, levelOf } = require("./difficulty");
const { bandPathNotes } = require("./bandPath");
const { busyFactor, effectiveDifficulty } = require("./busyness");
const { planChords } = require("./chords");
const { applyDifficulty, enforceFloors, spacedMoments } = require("./difficultyFilter");
const { addGapHolds, addSustainHolds, clipHolds, limitHoldShare, oneHoldAtATime, settleHolds } = require("./holds");
const { assignLanes } = require("./lanes");
const { withMergedLead } = require("./legato");
const { patternEvents } = require("./patterns");
const { TONAL_MIN_CONF, buildPhrases, chooseLeaders, hasSteadyPulse, isRepeatOf, isVocalSong, supportLayers } = require("./phrases");
const { copyRepeat, sourceWindow } = require("./repeats");
const { withIntensity } = require("./intensity");
const { fillRests } = require("./rests");
const { laneTheRest, nested, rhythmOf, sortedOnsets, withBeats } = require("./rhythm");
const { accentSections, sectionStarts } = require("./sections");
const { fillGaps } = require("./seams");
const { phraseBudget, scoreMoments, selectMoments } = require("./selection");
const { starsOf } = require("./stars");
const { buildTiming, energyLookup } = require("./timing");
const { createTrace } = require("./trace");
const { lowerBound } = require("./util");

const byTime = (a, b) => a.t - b.t || a.lane - b.lane;
const inWindow = (notes, fromMs, toMs) => notes.filter((n) => n.t >= fromMs && n.t < toMs);
const MIN_COPY_SHARE = 0.5; // a repeat keeping less of its source than this is charted fresh
const PLAYS_ON_ENERGY = 0.35; // a phrase at least this loud plays on, for a level cut from a harder one

// --- shared analysis (the same for every difficulty) ---------------------------------

function analyse(raw) {
  const features = withMergedLead(raw);
  const durationMs = Math.round(features.durationMs);
  const timing = buildTiming(features, durationMs);
  const phrases = buildPhrases(features, timing, durationMs);
  const leaders = chooseLeaders(phrases);
  const vocal = isVocalSong(phrases);
  const energy = withIntensity(energyLookup(features), features, phrases); // with each section's intensity (intensity.js)
  const onsets = sortedOnsets(features);
  return {
    raw, // the features as measured: selection.js scores the candidates the scores were fitted on
    features,
    durationMs,
    timing,
    energy,
    sections: sectionStarts(features, timing, energy),
    busy: busyFactor(features),
    phrases,
    leaders,
    vocal,
    supports: phrases.map((phrase, i) => supportLayers(phrase, leaders[i], vocal)), // the layers charted beside the leader
    onsets,
    eventTimes: onsets.map((o) => o.t), // what a copied note may sit on
    final: {}, // difficulty -> its finished notes (finalNotes)
    rhythms: {}, // difficulty -> the moments the level below it is cut from (upperRhythm)
  };
}

// --- one difficulty ------------------------------------------------------------------------

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
  if (!isRepeatOf(phrase, i)) return null;
  const { from, to } = sourceWindow(phrase, phrases[phrase.repeatOf]);
  const sourceNotes = inWindow(all, from, to);
  if (sourceNotes.length === 0) return null;
  // A copy may end sooner than its source (or the song): its holds are clipped to fit.
  const fitted = clipHolds(copyRepeat(sourceNotes, phrase, phraseEventTimes(ctx, phrase), timing), Math.min(phrase.endMs, durationMs), diff, timing)
    .filter((n) => n.t >= LEAD_IN_MS && energy.at(n.t) >= SILENCE_ENERGY);
  const upper = upperRhythm(ctx, diff);
  const copied = upper ? nested(fitted, upper) : fitted;
  return copied.length > 0 && copied.length >= sourceNotes.length * MIN_COPY_SHARE ? copied : null;
}

// The layer each phrase of this difficulty follows (diff.vocalLeads puts the voice over drums and bass).
function leadersOf(ctx, diff) {
  if (!diff.vocalLeads || !ctx.vocal) return ctx.leaders;
  const heard = (p) => p.confidence?.lead >= TONAL_MIN_CONF;
  return ctx.leaders.map((leader, i) => (leader !== "bands" && heard(ctx.phrases[i]) ? "lead" : leader));
}

// Phrase i of a level that picks its notes from the music (diff.selector "music"): the moments selection.js chooses, those
// the music plays (not the lead-in, not the silence), each with a lane to hold its place.
function musicNotes(ctx, i, diff, trace) {
  const { phrases, energy, timing } = ctx;
  const phrase = phrases[i];
  const scored = scoreMoments(ctx, diff.scoreLevel);
  const times = scored.map((m) => m.t);
  const toMs = i === phrases.length - 1 ? Infinity : phrase.endMs;
  const playable = (t) => t >= LEAD_IN_MS && energy.at(t) >= SILENCE_ENERGY;
  const heard = scored.slice(lowerBound(times, i === 0 ? 0 : phrase.startMs), lowerBound(times, toMs)).filter((m) => playable(m.t));
  const chosen = selectMoments(phrase, heard, phraseBudget(phrase, ctx, diff), diff, timing).filter((m) => playable(m.t));
  const events = laneTheRest(chosen);
  const made = trace ? trace.tagged(events) : events;
  return made.map((n) => (trace ? { t: n.t, lane: n.lane, tid: n.tid } : { t: n.t, lane: n.lane }));
}

// One difficulty's rhythm charted from the music, phrase by phrase: { notes, sustained }. A difficulty with diff.cutFrom
// takes its moments from that harder level (rhythm.js). The lanes here only hold a place: chords and lanes are laid out
// over the finished moments (finish). `sustained` holds the keys ("t:lane") of the real sustain holds, which the hold
// cap keeps longest.
// `trace` (optional, trace.js) hears what every stage did.
function chartNotes(ctx, diff, trace = null) {
  const { features, timing, energy, phrases, durationMs } = ctx;
  const step = (stage, before, after) => (trace ? trace.step(stage, before, after) : after);
  const leaders = leadersOf(ctx, diff);
  const rhythm = upperRhythm(ctx, diff);
  const supports = diff.oneLayer ? phrases.map(() => []) : ctx.supports;
  const all = []; // final notes so far, time-ordered
  // Where a bass or lead line plays (or the features cannot tell), a phrase's rests are held through; the holds are
  // part of the phrase, so a repeat copies them.
  const tonal = (p) => !p.confidence || ["bass", "lead"].some((l) => p.confidence[l] >= TONAL_MIN_CONF);
  const withGapHolds = (notes, tail, p, toMs) =>
    tonal(p)
      ? step("gapHolds", notes, addGapHolds([...tail, ...notes], features, diff, timing, energy, Math.min(toMs, durationMs), p.startMs).filter((n) => n.t >= p.startMs))
      : notes;

  // Where the charted layer rests (a sung line pausing, a lead dropping out, the leading layer changing at a seam) while
  // the drums play on, the drums carry the beat through.
  // A copied repeat already carries its source's fills: only the rest before it, up to its start, is filled.
  // A rest still left a hole while the music plays on (on Easy and Normal) gets a sound of the music there (rests.js).
  // `last` is the last phrase the notes cover (a band-path window spans several).
  const bridged = (notes, i, copy = false, last = i) => {
    if (diff.selector === "music") return notes; // the music picks the moments: no rest is filled with another sound
    const end = last === phrases.length - 1;
    // Hard and Hell carry the beat through with every drum hit; Easy and Normal take single sounds (fillRests) instead.
    const fill = diff.fillRestBeats > 0
      ? []
      : step("fillGaps", [], fillGaps(all, notes, features, timing, energy, end && !copy ? durationMs : null).filter((n) => !copy || n.t < phrases[i].startMs));
    if (copy) return [...fill, ...notes];
    const before = new Set(all);
    const window = { fromMs: phrases[i].startMs, toMs: end ? Infinity : phrases[last].endMs, untilMs: end ? durationMs : null };
    return step("fillRests", [...fill, ...notes], fillRests([...all, ...fill, ...notes], ctx, diff, window, rhythm).filter((n) => !before.has(n)));
  };

  for (let i = 0; i < phrases.length; ) {
    const phrase = phrases[i];
    // The previous notes that still matter here: the last 2 s, and any hold still running.
    const tail = all.filter((n) => n.t < phrase.startMs && Math.max(n.t, n.t + (n.len ?? 0)) >= phrase.startMs - DENSITY_WINDOW_MS);

    // A repeat plays like its source.
    const copied = copiedRepeat(ctx, all, i, diff);
    const info = { leader: leaders[i], supports: supports[i], repeat: isRepeatOf(phrase, i) };
    if (copied) {
      trace?.enter(i, { ...info, charted: "copy" });
      all.push(...bridged(trace ? trace.copied(copied) : copied, i, true));
      i++;
      continue;
    }

    if (diff.selector === "music") {
      trace?.enter(i, { ...info, charted: "music" });
      const charted = musicNotes(ctx, i, diff, trace);
      all.push(...withGapHolds(charted, tail, phrase, i === phrases.length - 1 ? durationMs : phrase.endMs));
      i++;
      continue;
    }

    if (leaders[i] === "bands" && !rhythm) {
      // Consecutive band-path phrases are one window (the band path keeps no
      // state across windows); a repeat ends it so the copy sees its source.
      let last = i;
      while (last + 1 < phrases.length && leaders[last + 1] === "bands" && !isRepeatOf(phrases[last + 1], last + 1)) last++;
      const toMs = last === phrases.length - 1 ? Math.max(phrases[last].endMs, durationMs + 1) : phrases[last].endMs;
      trace?.enter(i, { ...info, charted: "bands", lastPhrase: last });
      const notes = step("bandPath", [], bandPathNotes(features, timing, diff, energy, { fromMs: phrase.startMs, toMs }));
      all.push(...bridged(withGapHolds(notes, tail, phrase, toMs), i, false, last));
      i = last + 1;
      continue;
    }

    trace?.enter(i, { ...info, charted: "pattern" });
    const found = patternEvents(phrase, leaders[i], features, timing, supports[i]);
    const made = rhythm ? found : withBeats(found, phrase, ctx);
    const events = trace ? trace.tagged(made) : made;
    // Cut from a harder level, a phrase that plays on gets its beats whatever leads it.
    const steady = (leaders[i] === "drums" && hasSteadyPulse(phrase)) || (!!rhythm && phrase.energy >= PLAYS_ON_ENERGY);
    const cut = rhythm && { rhythm, fromMs: i === 0 ? 0 : phrase.startMs, toMs: i === phrases.length - 1 ? Infinity : phrase.endMs };
    const charted = applyDifficulty(events, diff, timing, energy, tail, phrase.energy, phrase.endMs, steady, trace, cut);
    all.push(...bridged(withGapHolds(charted, tail, phrase, i === phrases.length - 1 ? durationMs : phrase.endMs), i));
    i++;
  }
  // Long bass/lead notes become holds wherever they were charted, drum-led phrases included. Those holds (and the
  // sustains planned with the phrase) are what a hold cap keeps longest.
  const key = (n) => `${n.t}:${n.lane}`;
  const gapHeld = new Set(all.filter((n) => n.len > 0 && n.gapHold).map(key));
  const notes = step("sustainHolds", all, addSustainHolds(all.sort(byTime), features, diff, timing, durationMs).map(({ gapHold, ...n }) => n));
  return { notes, sustained: new Set(notes.filter((n) => n.len > 0 && !gapHeld.has(key(n))).map(key)) };
}

// No hold runs past the end of the song, whatever produced it. Sections open on a note; only then, with every moment
// of the chart known, do holds let go on the next one. The hold share is capped per phrase (a cap over the whole song
// would demote holds unevenly and break the repeats); real sustains are kept before gap holds. With the moments
// settled, each one gets its size (chords.js) and its lanes (lanes.js).
function finish(ctx, { notes, sustained }, diff, trace = null) {
  const step = (stage, before, after) => (trace ? trace.step(stage, before, after) : after);
  const held = step("clipHolds", notes, clipHolds([...notes].sort(byTime), ctx.durationMs, diff, ctx.timing));
  const accented = step("accents", held, accentSections(held, ctx.sections, diff, ctx.timing, ctx.energy));
  const upper = upperRhythm(ctx, diff);
  const inside = upper ? step("nested", accented, nested(accented, upper)) : accented;
  const settled = step("settleHolds", inside, settleHolds(inside, diff, ctx.timing, ctx.durationMs));
  const spaced = step("spacedMoments", settled, spacedMoments(settled, diff));
  const floored = diff.oneHoldAtATime ? step("oneHold", spaced, oneHoldAtATime(spaced)) : spaced;
  const isSustain = (n) => sustained.has(`${n.t}:${n.lane}`);
  const last = ctx.phrases.length - 1;
  const inPhrase = (n, i) => (i === 0 || n.t >= ctx.phrases[i].startMs) && (i === last || n.t < ctx.phrases[i].endMs);
  const capped = step("holdShare", floored, last < 0
    ? limitHoldShare(floored, Math.floor, isSustain, diff.maxHoldShare)
    : ctx.phrases.flatMap((_, i) => limitHoldShare(floored.filter((n) => inPhrase(n, i)), Math.round, isSustain, diff.maxHoldShare)).sort(byTime));
  const chorded = step("chords", capped, planChords(capped, ctx, diff, upper));
  const laid = step("lanes", chorded, assignLanes(chorded, ctx, diff, upper));
  return step("finalFloors", laid, enforceFloors(laid, diff, ctx.timing));
}

const diffOf = (ctx, difficulty) => effectiveDifficulty(levelOf(difficulty), ctx.busy);

const notesFor = (ctx, difficulty, trace = null) => {
  const diff = diffOf(ctx, difficulty);
  return finish(ctx, chartNotes(ctx, diff, trace), diff, trace);
};

// A level's finished notes, once per song: the levels below it are cut from them.
function finalNotes(ctx, difficulty) {
  ctx.final[difficulty] ??= notesFor(ctx, difficulty);
  return ctx.final[difficulty];
}

// The moments diff is cut from, or null for a level charted straight from the music.
function upperRhythm(ctx, diff) {
  if (!diff.cutFrom) return null;
  ctx.rhythms[diff.cutFrom] ??= rhythmOf(finalNotes(ctx, diff.cutFrom), ctx);
  return ctx.rhythms[diff.cutFrom];
}

// --- public API --------------------------------------------------------------

function chartFrom(ctx, difficulty, audioKey) {
  const notes = finalNotes(ctx, difficulty);
  if (new Set(notes.map((n) => n.t)).size < MIN_NOTES) return null; // chords don't make a sparse song playable
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
  if (!levelOf(difficulty)) throw new Error(`Unknown difficulty: ${difficulty}`);
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

// generateChart plus the chart's story, for the debugger: the same chart, every candidate with what became of it
// (trace.js), the grid and phrases it was charted on, and the difficulty's parameters for this song. `chart` is null
// when too few notes survive; the story is there all the same.
function traceChart(features, difficulty, audioKey) {
  if (!levelOf(difficulty)) throw new Error(`Unknown difficulty: ${difficulty}`);
  if (!usable(features)) return null;
  const ctx = analyse(features);
  const trace = createTrace();
  const notes = notesFor(ctx, difficulty, trace);
  const chart = chartFrom(ctx, difficulty, audioKey);
  const { timing, phrases } = ctx;
  const story = trace.report(notes);
  // A band-path window enters at its first phrase; the ones it spans are charted with it.
  const chartedAs = (i) => story.phrases[i] ?? { leader: ctx.leaders[i], supports: ctx.supports[i], repeat: false, charted: "bands" };
  return {
    chart,
    ...story,
    phrases: phrases.map((p, i) => ({ startMs: p.startMs, endMs: p.endMs, repeatOf: p.repeatOf, similarity: p.similarity, energy: p.energy, confidence: p.confidence, ...chartedAs(i), index: i })),
    grid: { snapped: !!timing.snapped, medianMs: timing.medianMs ?? null, foldFactor: timing.foldFactor ?? 1, beats: timing.beats ?? [], downbeats: timing.downbeats ?? [] },
    diff: diffOf(ctx, difficulty),
    vocal: ctx.vocal,
    busy: ctx.busy,
  };
}

module.exports = { GENERATOR_VERSION, analyse, generateAll, generateChart, starsOf, traceChart };
