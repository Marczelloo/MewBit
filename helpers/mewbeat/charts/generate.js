const { DENSITY_WINDOW_MS, GENERATOR_VERSION, LEAD_IN_MS, MIN_NOTES, SILENCE_ENERGY, levelOf } = require("./difficulty");
const { bandPathNotes } = require("./bandPath");
const { withFittedBeats } = require("./beatFit");
const { busyFactor, effectiveDifficulty } = require("./busyness");
const { CALM_ENOUGH, calmLookup, shareOver } = require("./calm");
const { planChords } = require("./chords");
const { applyDifficulty, enforceFloors, spacedMoments } = require("./difficultyFilter");
const { addGapHolds, addSustainHolds, clipHolds, limitHoldShare, oneHoldAtATime, settleHolds } = require("./holds");
const { assignLanes } = require("./lanes");
const { searchLanes } = require("./laneSearch");
const { withMergedLead } = require("./legato");
const { patternEvents } = require("./patterns");
const { TONAL_MIN_CONF, buildPhrases, chooseLeaders, hasSteadyPulse, isRepeatOf, isVocalSong, supportLayers } = require("./phrases");
const { copyRepeat, sourceTime, sourceWindow } = require("./repeats");
const { withIntensity } = require("./intensity");
const { localKeep, thinned } = require("./localThin");
const { flagsKey, normalFlags, withFlags } = require("./flags");
const { fillRests } = require("./rests");
const { laneTheRest, nested, rhythmOf, sortedOnsets, withBeats } = require("./rhythm");
const { accentSections, sectionStarts } = require("./sections");
const { fillGaps } = require("./seams");
const { extraMoments, openingLeadRates, phraseBudget, repeatPlan, selectMoments, snappedMoments } = require("./selection");
const { starsOf } = require("./stars");
const { buildTiming, energyLookup } = require("./timing");
const { createTrace } = require("./trace");
const { lowerBound } = require("./util");

const byTime = (a, b) => a.t - b.t || a.lane - b.lane;
const inWindow = (notes, fromMs, toMs) => notes.filter((n) => n.t >= fromMs && n.t < toMs);
const MIN_COPY_SHARE = 0.5; // a repeat keeping less of its source than this is charted fresh
const PLAYS_ON_ENERGY = 0.35; // a phrase at least this loud plays on, for a level cut from a harder one
const SAME_MOMENT_MS = 3; // a note this close to a time in the source is the one copied from there

// --- shared analysis (the same for every difficulty) ---------------------------------

function analyse(raw, flags) {
  const features = withFittedBeats(withMergedLead(raw));
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
    flags: normalFlags(flags), // the experimental switches that are on (flags.js); diffOf reads their overrides
    phrases,
    leaders,
    vocal,
    supports: phrases.map((phrase, i) => supportLayers(phrase, leaders[i], vocal)), // the layers charted beside the leader
    onsets,
    eventTimes: onsets.map((o) => o.t), // what a copied note may sit on
    final: {}, // difficulty -> its finished notes (finalNotes)
    localKeep: null, // the share of moments each second keeps (keptShare)
    calm: undefined, // t -> how calm the music is, null with nothing to tell it from (calmOf)
    rhythms: {}, // difficulty -> the moments the level below it is cut from (upperRhythm)
  };
}

// --- one difficulty ------------------------------------------------------------------------

function phraseEventTimes(ctx, phrase) {
  const { eventTimes } = ctx;
  return eventTimes.slice(lowerBound(eventTimes, phrase.startMs), lowerBound(eventTimes, phrase.endMs));
}

// The notes of repeat phrase i copied from its source in `all` (the notes so far) as { notes, extra }, `extra` being the
// moments a louder repeat of Normal takes on top (repeatPlan); or null when phrase i is no repeat, the plan has it charted
// fresh (a sparse source on a loud section) or the copy lost most of its source (the music differs, or the source overlaps
// this phrase): then it is charted fresh.
function copiedRepeat(ctx, all, i, diff) {
  const { timing, energy, phrases, durationMs } = ctx;
  const phrase = phrases[i];
  if (!isRepeatOf(phrase, i)) return null;
  const { from, to } = sourceWindow(phrase, phrases[phrase.repeatOf]);
  const sourceNotes = inWindow(all, from, to);
  if (sourceNotes.length === 0) return null;
  const plan = repeatPlan(phrase, phrases[phrase.repeatOf], ctx, diff, new Set(sourceNotes.map((n) => n.t)).size);
  if (!plan.copy) return null;
  // A copy may end sooner than its source (or the song): its holds are clipped to fit.
  const fitted = clipHolds(copyRepeat(sourceNotes, phrase, phraseEventTimes(ctx, phrase), timing), Math.min(phrase.endMs, durationMs), diff, timing)
    .filter((n) => n.t >= LEAD_IN_MS && energy.at(n.t) >= SILENCE_ENERGY);
  const upper = upperRhythm(ctx, diff);
  const copied = upper ? nested(fitted, upper) : fitted;
  return copied.length > 0 && copied.length >= sourceNotes.length * MIN_COPY_SHARE ? { notes: copied, extra: plan.extra } : null;
}

// The layer each phrase of this difficulty follows (diff.vocalLeads puts the voice over drums and bass).
function leadersOf(ctx, diff) {
  if (!diff.vocalLeads || !ctx.vocal) return ctx.leaders;
  const heard = (p) => p.confidence?.lead >= TONAL_MIN_CONF;
  return ctx.leaders.map((leader, i) => (leader !== "bands" && heard(ctx.phrases[i]) ? "lead" : leader));
}

// Whether the music plays at t: not in the lead-in, not in the silence.
const playable = (ctx, t) => t >= LEAD_IN_MS && ctx.energy.at(t) >= SILENCE_ENERGY;

// What phrase i of a level that picks its notes from the music may play: the moments the music plays, and `carry`, the sounds after `before` (the time of the last note of the phrases before) that this phrase's
// start leaves. The phrase takes those too, so no stretch with a sound in it is left open across the seam.
function momentsAround(ctx, i, diff, before) {
  const { phrases } = ctx;
  const phrase = phrases[i];
  const scored = snappedMoments(ctx, diff.scoreLevel);
  const times = scored.map((m) => m.t);
  const toMs = i === phrases.length - 1 ? Infinity : phrase.endMs;
  const heard = scored.slice(lowerBound(times, i === 0 ? 0 : phrase.startMs), lowerBound(times, toMs)).filter((m) => playable(ctx, m.t));
  const carry = before === null ? [] : scored.slice(lowerBound(times, before + 1e-9), lowerBound(times, phrase.startMs)).filter((m) => playable(ctx, m.t));
  return { heard, carry };
}

// The most moments phrase may take: what the music calls for, and at least as many as the level below plays there
// (diff.notBelow), or a stretch of a harder level would play fewer notes than an easier one.
function budgetOf(ctx, phrase, diff) {
  const own = phraseBudget(phrase, ctx, diff);
  if (!diff.notBelow) return own;
  const below = new Set(inWindow(finalNotes(ctx, diff.notBelow), phrase.startMs, phrase.endMs).map((n) => n.t)).size;
  return Math.max(own, below);
}

// Per second, the share of a phrase's moments the music keeps there (localThin.js); the same for every level.
function keptShare(ctx, diff) {
  ctx.localKeep ??= localKeep(ctx.features, ctx.durationMs, diff.localThin);
  return ctx.localKeep;
}

// The notes of a phrase with the slower seconds inside it thinned (diff.localThin), and never fewer moments than the level
// below plays there (diff.notBelow).
function followingTheMusic(ctx, notes, phrase, diff) {
  if (!diff.localThin) return notes;
  const below = diff.notBelow ? new Set(inWindow(finalNotes(ctx, diff.notBelow), phrase.startMs, phrase.endMs).map((n) => n.t)).size : 0;
  return thinned(notes, keptShare(ctx, diff), ctx.timing, Math.max(0, new Set(notes.map((n) => n.t)).size - below));
}

// How calm the music is at a time (calm.js), the same for every level; null where the level's holds do not read it.
function calmOf(ctx, diff) {
  if (!diff.holdsByCalm) return null;
  if (ctx.calm === undefined) ctx.calm = calmLookup(ctx.features, ctx.durationMs, diff.holdsByCalm);
  return ctx.calm;
}

// Moments selection.js chose as notes, each with a lane to hold its place (finish lays the lanes over the finished moments).
function placed(chosen, trace) {
  const events = laneTheRest(chosen);
  const made = trace ? trace.tagged(events) : events;
  return made.map((n) => (trace ? { t: n.t, lane: n.lane, tid: n.tid } : { t: n.t, lane: n.lane }));
}

// Phrase i of a level that picks its notes from the music (diff.selector "music"): the moments selection.js chooses.
// `before` is the time of the last note of the phrases before.
function musicNotes(ctx, i, diff, trace, before = null) {
  const phrase = ctx.phrases[i];
  const { heard, carry } = momentsAround(ctx, i, diff, before);
  const chosen = selectMoments(phrase, heard, budgetOf(ctx, phrase, diff), diff, ctx.timing, { before, carry });
  return placed(chosen.filter((m) => playable(ctx, m.t)), trace);
}

// The moments a copied repeat of Normal takes besides its copy (selection.js extraMoments): at most `extra`, and no more than
// its budget leaves above the copy; the sound the stretch from the phrase before to the copy may need is one of them.
function repeatNotes(ctx, i, diff, trace, copied, extra, before = null) {
  const phrase = ctx.phrases[i];
  const { heard, carry } = momentsAround(ctx, i, diff, before);
  const room = Math.max(0, budgetOf(ctx, phrase, diff) - new Set(copied.map((n) => n.t)).size);
  return placed(extraMoments(phrase, heard, copied.map((n) => n.t), Math.min(extra, room), diff, ctx.timing, { before, carry }), trace);
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
  const followed = (notes, p) => step("localThin", notes, followingTheMusic(ctx, notes, p, diff));
  const calmAt = calmOf(ctx, diff);
  const withGapHolds = (notes, tail, p, toMs) =>
    tonal(p) || (calmAt !== null && notes.some((n) => calmAt(n.t) >= CALM_ENOUGH))
      ? step("gapHolds", notes, addGapHolds([...tail, ...notes], features, diff, timing, energy, Math.min(toMs, durationMs), p.startMs, calmAt).filter((n) => n.t >= p.startMs))
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
    const copy = copiedRepeat(ctx, all, i, diff);
    const info = { leader: leaders[i], supports: supports[i], repeat: isRepeatOf(phrase, i) };
    const before = all.reduce((last, n) => (n.t < phrase.startMs && n.t > last ? n.t : last), -Infinity);
    if (copy) {
      trace?.enter(i, { ...info, charted: "copy" });
      const notes = bridged(trace ? trace.copied(copy.notes) : copy.notes, i, true);
      // Normal picks its moments from the music: a louder repeat takes more of them above the copy.
      const added = diff.selector === "music" ? repeatNotes(ctx, i, diff, trace, copy.notes, copy.extra, i > 0 && before > -Infinity ? before : null) : [];
      all.push(...notes, ...added);
      i++;
      continue;
    }

    if (diff.selector === "music") {
      trace?.enter(i, { ...info, charted: "music" });
      const charted = musicNotes(ctx, i, diff, trace, i > 0 && before > -Infinity ? before : null);
      // A sound the phrase takes from the end of the one before stays where it is (gap holds start with the phrase).
      all.push(...charted.filter((n) => n.t < phrase.startMs), ...withGapHolds(followed(charted.filter((n) => n.t >= phrase.startMs), phrase), tail, phrase, i === phrases.length - 1 ? durationMs : phrase.endMs));
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
      all.push(...bridged(withGapHolds(followed(notes, phrase), tail, phrase, toMs), i, false, last));
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
    // A level with diff.openingLead keeps at least that share of a quiet opening's lead line, whatever the loudness allows it.
    const leadFloor = diff.openingLead ? Math.min(1, (diff.openingLead * openingLeadRates(ctx)[i]) / diff.maxNps) : 0;
    const charted = applyDifficulty(events, leadFloor > 0 ? { ...diff, leadPowerFloor: leadFloor } : diff, timing, energy, tail, phrase.energy, phrase.endMs, steady, trace, cut);
    all.push(...bridged(withGapHolds(followed(charted, phrase), tail, phrase, i === phrases.length - 1 ? durationMs : phrase.endMs), i));
    i++;
  }
  // Long bass/lead notes become holds wherever they were charted, drum-led phrases included. Those holds (and the
  // sustains planned with the phrase) are what a hold cap keeps longest.
  const key = (n) => `${n.t}:${n.lane}`;
  const gapHeld = new Set(all.filter((n) => n.len > 0 && n.gapHold).map(key));
  const notes = step("sustainHolds", all, addSustainHolds(all.sort(byTime), features, diff, timing, durationMs).map(({ gapHold, ...n }) => n));
  return { notes, sustained: new Set(notes.filter((n) => n.len > 0 && !gapHeld.has(key(n))).map(key)) };
}

// The hold share, phrase by phrase. A repeat of a level that picks from the music gives up first the holds its source gave
// up: a hold lost at the seam would leave the repeat's cap room for one its source had to let go, and the two would differ.
// With the calm of the music to go by (diff.holdsByCalm) the share follows it, and the calm holds are given up last.
function holdsCappedByPhrase(notes, ctx, diff, isSustain) {
  const { phrases, timing } = ctx;
  const calmAt = calmOf(ctx, diff);
  const keptLongest = calmAt ? (n) => isSustain(n) || calmAt(n.t) >= CALM_ENOUGH : isSustain;
  const last = phrases.length - 1;
  const inPhrase = (n, i) => (i === 0 || n.t >= phrases[i].startMs) && (i === last || n.t < phrases[i].endMs);
  const gaveUp = []; // per phrase: the times of the holds it no longer plays
  return phrases.flatMap((phrase, i) => {
    const own = notes.filter((n) => inPhrase(n, i));
    let open = own;
    if (diff.selector === "music" && isRepeatOf(phrase, i)) {
      const inSource = sourceTime(phrase, timing);
      const lost = (n) => gaveUp[phrase.repeatOf].some((t) => Math.abs(t - inSource(n.t)) <= SAME_MOMENT_MS);
      open = own.map((n) => {
        if (!(n.len > 0) || !lost(n)) return n;
        const { len, ...tap } = n;
        return tap;
      });
    }
    const capped = limitHoldShare(open, Math.round, keptLongest, calmAt ? shareOver(open, calmAt, diff.holdsByCalm.maxShare) : diff.maxHoldShare);
    gaveUp[i] = own.filter((n, k) => n.len > 0 && !(capped[k].len > 0)).map((n) => n.t);
    return capped;
  }).sort(byTime);
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
  const capped = step("holdShare", floored, ctx.phrases.length === 0
    ? limitHoldShare(floored, Math.floor, isSustain, diff.maxHoldShare)
    : holdsCappedByPhrase(floored, ctx, diff, isSustain));
  const chorded = step("chords", capped, planChords(capped, ctx, diff, upper));
  const layLanes = diff.laneSearch ? searchLanes : assignLanes;
  const laid = step("lanes", chorded, layLanes(chorded, ctx, diff, upper));
  return step("finalFloors", laid, enforceFloors(laid, diff, ctx.timing));
}

// Flag overrides go in before the busyness scaling, so every stage that reads diff sees them.
const diffOf = (ctx, difficulty) => effectiveDifficulty(withFlags(levelOf(difficulty), difficulty, ctx.flags), ctx.busy);

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
  const flagged = flagsKey(ctx.flags);
  return {
    version: flagged ? `${GENERATOR_VERSION}-${flagged}` : GENERATOR_VERSION, // scores and stale runs follow it
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

function generateChart(features, difficulty, audioKey, flags) {
  if (!levelOf(difficulty)) throw new Error(`Unknown difficulty: ${difficulty}`);
  if (!usable(features)) return null;
  return chartFrom(analyse(features, flags), difficulty, audioKey);
}

function generateAll(features, audioKey, flags) {
  if (!usable(features)) return null;
  const ctx = analyse(features, flags);
  const easy = chartFrom(ctx, "easy", audioKey);
  const normal = chartFrom(ctx, "normal", audioKey);
  const hard = chartFrom(ctx, "hard", audioKey);
  const hell = chartFrom(ctx, "hell", audioKey);
  return easy && normal && hard && hell ? { easy, normal, hard, hell } : null;
}

// generateChart plus the chart's story, for the debugger: the same chart, every candidate with what became of it
// (trace.js), the grid and phrases it was charted on, and the difficulty's parameters for this song. `chart` is null
// when too few notes survive; the story is there all the same.
function traceChart(features, difficulty, audioKey, flags) {
  if (!levelOf(difficulty)) throw new Error(`Unknown difficulty: ${difficulty}`);
  if (!usable(features)) return null;
  const ctx = analyse(features, flags);
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
