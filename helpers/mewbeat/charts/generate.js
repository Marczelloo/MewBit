const { DENSITY_WINDOW_MS, GENERATOR_VERSION, LEAD_IN_MS, MIN_NOTES, SILENCE_ENERGY, levelOf } = require("./difficulty");
const { bandPathNotes } = require("./bandPath");
const { bridgeRests } = require("./bridges");
const { withFittedBeats } = require("./beatFit");
const { busyFactor, effectiveDifficulty } = require("./busyness");
const { CALM_ENOUGH, calmLookup, shareOver } = require("./calm");
const { holdQuietLone, limitChordShare, planChords, slowChords } = require("./chords");
const { applyDifficulty, enforceFloors, groupByTime, spacedMoments } = require("./difficultyFilter");
const { addGapHolds, addSustainHolds, clipHolds, keptHolds, limitHoldShare, longHolds, oneHoldAtATime, settleHolds, slowHolds } = require("./holds");
const { assignLanes } = require("./lanes");
const { searchLanes } = require("./laneSearch");
const { withMergedLead } = require("./legato");
const { withMelody, withMelodyRuns, withRunNotes } = require("./melodyPick");
const { silentUpper, thinDips } = require("./dips");
const { thinDrumless } = require("./drumless");
const { holdSustains, keepMelodyOnly, padLanes, withShortLine } = require("./sustain");
const { patternEvents } = require("./patterns");
const { TONAL_MIN_CONF, buildPhrases, chooseLeaders, hasSteadyPulse, isRepeatOf, isVocalSong, supportLayers } = require("./phrases");
const { copyRepeat, sourceTime, sourceWindow } = require("./repeats");
const { withIntensity } = require("./intensity");
const { localKeep, thinned } = require("./localThin");
const { flagsKey, normalFlags, withFlags } = require("./flags");
const { fillRests } = require("./rests");
const { laneTheRest, nested, rhythmOf, sameCuts, sortedOnsets, withBeats } = require("./rhythm");
const { accentSections, openWithFirstSound, sectionStarts } = require("./sections");
const { fillGaps } = require("./seams");
const { figureTimes } = require("./figures");
const { holdFadeOut, thinFadeOut } = require("./fades");
const { extraMoments, isFlatLoud, openingLeadRates, phraseBudget, plusFigures, plusMoments, repeatPlan, scoreMoments, selectMoments, snappedMoments } = require("./selection");
const { starsOf } = require("./stars");
const { buildTiming, energyLookup } = require("./timing");
const { createTrace } = require("./trace");
const { lowerBound } = require("./util");

const byTime = (a, b) => a.t - b.t || a.lane - b.lane;
const inWindow = (notes, fromMs, toMs) => notes.filter((n) => n.t >= fromMs && n.t < toMs);
const MIN_COPY_SHARE = 0.5; // a repeat keeping less of its source than this is charted fresh
const PLAYS_ON_ENERGY = 0.35; // a phrase at least this loud plays on, for a level cut from a harder one
const MAX_CROWDING_ROUNDS = 4; // withoutCrowding: tries at keeping every moment the level is built on
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
  if (diff.copyFrom && phrase.heard !== true && !(phrase.similarity >= diff.copyFrom)) return null;
  const { from, to } = sourceWindow(phrase, phrases[phrase.repeatOf], timing);
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

// The second detector's melody a level reads, if one was decoded: its tuned line with diff.melodyTuned, where there is one.
// With diff.melodyOnsetShift it is moved by features.decodedMelodyShift (chartStore.js: the export's shift to the onsets of
// all our layers, less its shift to the lead line); kept on the ctx, so each line is moved once. With diff.melodyShiftPick (a
// flag) the shift is found here instead, against the sounds the level scores (pickedMelodyShift).
function decodedMelodyOf(ctx, diff) {
  const { decodedMelody, decodedMelodyTuned, decodedMelodyShift } = ctx.features;
  const line = diff.melodyTuned && Array.isArray(decodedMelodyTuned) ? decodedMelodyTuned : Array.isArray(decodedMelody) ? decodedMelody : null;
  if (!line) return line;
  const applied = diff.melodyOnsetShift && Number.isFinite(decodedMelodyShift) ? decodedMelodyShift : 0;
  const shift = diff.melodyShiftPick ? pickedMelodyShift(ctx, line, diff, applied) : applied;
  if (shift === 0) return line;
  ctx.shiftedMelody ??= new Map();
  ctx.shiftedMelody.has(line) || ctx.shiftedMelody.set(line, new Map());
  const byShift = ctx.shiftedMelody.get(line);
  if (!byShift.has(shift)) byShift.set(shift, line.map((n) => ({ ...n, t: n.t + shift })));
  return byShift.get(shift);
}

// The shift that puts the most notes of a decoded line within rule.matchMs of a sound the level scores (selection.js
// scoreMoments, the times as measured), looked for within rule.reachMs of the file's own times. The two shifts of the melody
// file are medians over the nearest lead note or onset, and where the onsets are dense or the lead is thin the median lands
// between two sounds (Rush E: 52 ms applied where 0 fits; 15 of 69 bot songs sit 10 points of matched notes under their
// best). `applied` stays unless another shift matches rule.margin more of the notes; equal counts take the nearer to it.
function pickedMelodyShift(ctx, line, diff, applied) {
  const rule = diff.melodyShiftPick;
  ctx.pickedShift ??= new Map();
  ctx.pickedShift.has(line) || ctx.pickedShift.set(line, new Map());
  const byKey = ctx.pickedShift.get(line);
  const key = `${diff.scoreLevel}|${applied}`;
  if (byKey.has(key)) return byKey.get(key);
  const sounds = scoreMoments(ctx, diff.scoreLevel, diff.feltTempo).map((m) => m.t);
  const starts = line.map((n) => n.t).filter(Number.isFinite);
  const matched = (shift) => {
    let count = 0;
    for (const t of starts) {
      const i = lowerBound(sounds, t + shift);
      if ((i < sounds.length && sounds[i] - (t + shift) <= rule.matchMs) || (i > 0 && t + shift - sounds[i - 1] <= rule.matchMs)) count++;
    }
    return count;
  };
  let best = applied, bestCount = -1;
  for (let shift = -rule.reachMs; shift <= rule.reachMs; shift += rule.stepMs) {
    const count = matched(shift);
    if (count > bestCount || (count === bestCount && Math.abs(shift - applied) < Math.abs(best - applied))) { best = shift; bestCount = count; }
  }
  const picked = bestCount > matched(applied) + rule.margin * starts.length ? best : applied;
  byKey.set(key, picked);
  return picked;
}

// diff.heardChords (a flag): the shift at which chords.js reads all the decoder's notes, which the melody file moved as it
// moved its line: the line's shift to the onsets, or the one that meets Normal's sounds better (pickedMelodyShift).
function heardShiftOf(ctx, rule) {
  const { decodedMelody, decodedMelodyTuned, decodedMelodyShift } = ctx.features;
  const line = Array.isArray(decodedMelodyTuned) ? decodedMelodyTuned : decodedMelody;
  const applied = Number.isFinite(decodedMelodyShift) ? decodedMelodyShift : 0;
  return Array.isArray(line) && line.length > 0 ? pickedMelodyShift(ctx, line, { ...diffOf(ctx, "normal"), melodyShiftPick: rule.shift }, applied) : applied;
}

// The moments a level that picks from the music scores, with the second detector's melody raised (diff.melodyPick,
// melodyPick.js) where one was decoded (chartStore.js). Kept on the ctx, as every phrase asks.
function scoredFor(ctx, diff) {
  const scored = snappedMoments(ctx, diff.scoreLevel, diff.feltTempo);
  const melody = decodedMelodyOf(ctx, diff);
  if (!diff.melodyPick || !melody) return scored;
  ctx.melodyScored ??= new Map();
  ctx.melodyScored.has(melody) || ctx.melodyScored.set(melody, new Map());
  const byScored = ctx.melodyScored.get(melody);
  // diff.melodyRuns (a flag): the moments where the melody runs fast are marked, for finish to add
  const key = diff.melodyRuns ? "runs" : "plain";
  byScored.has(scored) || byScored.set(scored, {});
  const cached = byScored.get(scored);
  if (!cached[key]) {
    const picked = withMelody(scored, melody, diff.melodyPick);
    cached[key] = diff.melodyRuns ? withMelodyRuns(picked, melody, diff.melodyRuns) : picked;
  }
  return cached[key];
}

// What phrase i of a level that picks its notes from the music may play: the moments the music plays, and `carry`, the sounds after `before` (the time of the last note of the phrases before) that this phrase's
// start leaves. The phrase takes those too, so no stretch with a sound in it is left open across the seam.
function momentsAround(ctx, i, diff, before) {
  const { phrases } = ctx;
  const phrase = phrases[i];
  const scored = scoredFor(ctx, diff);
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

// diff.melodyKeep (a flag): the moments on a note of the decoded melody, as the level scores them, which the stages that thin
// a slower stretch, an energy dip or the fade-out take last or leave; null without the flag or a melody.
function melodyMoments(ctx, diff) {
  if (!diff.melodyKeep) return null;
  ctx.melodyMoments ??= new Map();
  if (!ctx.melodyMoments.has(diff)) {
    const on = scoredFor(ctx, diff).filter((m) => m.melody).map((m) => m.t);
    ctx.melodyMoments.set(diff, on.length > 0 ? new Set(on) : null);
  }
  return ctx.melodyMoments.get(diff);
}

// Per second, the share of a phrase's moments the music keeps there (localThin.js); the same for every level.
function keptShare(ctx, diff) {
  ctx.localKeep ??= localKeep(ctx.features, ctx.durationMs, diff.localThin);
  return ctx.localKeep;
}

// The notes of a phrase with the slower seconds inside it thinned (diff.localThin), and never fewer moments than the level
// below plays there (diff.notBelow). A song loud all through (selection.js isFlatLoud) is not thinned.
function followingTheMusic(ctx, notes, phrase, diff) {
  if (!diff.localThin || isFlatLoud(ctx, diff)) return notes;
  const below = diff.notBelow ? new Set(inWindow(finalNotes(ctx, diff.notBelow), phrase.startMs, phrase.endMs).map((n) => n.t)).size : 0;
  return thinned(notes, keptShare(ctx, diff), ctx.timing, Math.max(0, new Set(notes.map((n) => n.t)).size - below), melodyMoments(ctx, diff));
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
  const budget = budgetOf(ctx, phrase, diff);
  const figures = diff.figures ? figureTimes(ctx, diff.figures) : null;
  const weakLead = diff.figures && (phrase.rate?.lead ?? 0) * (ctx.timing.medianMs / 1000) < diff.figures.weakLead;
  const figureRoom = weakLead ? Math.round(diff.figures.extra * budget) : 0;
  const chosen = selectMoments(phrase, heard, budget, diff, ctx.timing, { before, carry, figures, figureRoom });
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

// Hard built on Normal (diff.buildOn = "normal", from v44), and Hell on Hard: every moment of that level's finished chart stays, with its size
// and its hold, and each phrase takes extras on top, chosen from the music with this level's weights up to its own budget
// (selection.js plusMoments, or plusFigures with diff.plusFigures). A repeat whose source took extras takes the same ones
// where the music repeats. finish then lays holds, chords and lanes over the whole of it with this level's rules; `protect`
// holds the times it may not take a moment from.
function plusNotes(ctx, diff) {
  const { phrases } = ctx;
  const normal = finalNotes(ctx, diff.buildOn).map((n) => ({ ...n }));
  const moments = [...new Set(normal.map((n) => n.t))].sort((a, b) => a - b);
  const occupied = [...moments];
  const scored = snappedMoments(ctx, diff.scoreLevel, diff.feltTempo);
  const scoredTimes = scored.map((m) => m.t);
  // diff.plusMelody (a flag): an extra on a note of the decoded melody scores more, on the line Normal reads; the chord keys
  // of diff.plusDense go by the sound alone
  const melody = diff.plusMelody ? decodedMelodyOf(ctx, diffOf(ctx, "normal")) : null;
  const wanted = melody ? withMelody(scored, melody, diff.plusMelody) : scored;
  // diff.keepNormalHolds (flag normalHolds): no extra under a long hold of Normal or just after it, where it would cut it
  const held = diff.keepNormalHolds ? longHolds(normal, diff.keepNormalHolds.minBeats, ctx.timing) : [];
  const after = Math.max(diff.minNoteGapMs ?? 0, diff.minLaneGapMs ?? 0);
  const free = (m) => playable(ctx, m.t) && !held.some((h) => m.t > h.t && m.t < h.t + h.len + after);
  // and a phrase's room shrinks by the share of it those holds take, or the extras crowd into what is left
  const heldShare = (phrase) => held.reduce((sum, h) => sum + Math.max(0, Math.min(h.t + h.len, phrase.endMs) - Math.max(h.t, phrase.startMs)), 0) / Math.max(1, phrase.endMs - phrase.startMs);
  const extras = [];
  const keyed = []; // the chord keys of diff.plusDense, kept apart from the extras a repeat copies
  phrases.forEach((phrase, i) => {
    const fromMs = i === 0 ? 0 : phrase.startMs;
    const toMs = i === phrases.length - 1 ? Infinity : phrase.endMs;
    const mine = lowerBound(moments, toMs) - lowerBound(moments, fromMs);
    const open = held.length > 0 ? 1 - Math.min(1, heldShare(phrase)) : 1;
    const room = Math.round(open * Math.max(Math.ceil((diff.plusFloor ?? 0) * mine), budgetOf(ctx, phrase, diff) - mine));
    if (room === 0) return;
    // diff.plusDense (flag hellPlus): the denser the phrase already is, the fewer moments it takes on top, and the room it does not
    // fill with moments (cut here, or no sound left where one fits) goes to chords on its strongest moments, never more keys than
    // the share of moments it could have taken
    const dense = diff.plusDense;
    const rate = mine / Math.max(1, (phrase.endMs - phrase.startMs) / 1000);
    const w = dense ? Math.min(1, Math.max(0, (rate - dense.fromNps) / (dense.toNps - dense.fromNps))) : 0;
    const most = dense ? Math.round(mine * (dense.sparseShare + w * (dense.denseShare - dense.sparseShare))) : Infinity;
    const copy = copiedRepeat(ctx, extras, i, diff);
    const heard = wanted.slice(lowerBound(scoredTimes, fromMs), lowerBound(scoredTimes, toMs)).filter(free);
    const candidates = copy ? copy.notes.filter(free).map((n) => ({ t: n.t, s: 0.5, score: Infinity, source: "copy" })) : heard;
    const take = Math.min(room, most);
    const chosen = take === 0 ? [] : diff.plusFigures ? plusFigures(candidates, occupied, take, diff, ctx.timing, fromMs, toMs) : plusMoments(candidates, occupied, take, diff, ctx.timing);
    for (const m of chosen) occupied.splice(lowerBound(occupied, m.t), 0, m.t);
    if (dense) keyed.push(...chordKeys(normal, scored, scoredTimes, fromMs, toMs, Math.min(room - chosen.length, most), ctx.timing));
    extras.push(...placed(chosen, null));
  });
  const key = (n) => `${n.t}:${n.lane}`;
  const all = [...normal, ...extras, ...keyed].sort(byTime);
  const sustained = new Set(normal.filter((n) => n.len > 0).map(key));
  if (!diff.plusHolds) return { notes: all, sustained, protect: new Set(moments) };
  // diff.plusHolds (flag hardHolds): the level's own holds on top of the ones it was built on, as a level charted from the
  // music lays them: long bass and lead notes held, then rests held up to its gap-hold share
  const own = addSustainHolds(all, ctx.features, diff, ctx.timing, ctx.durationMs).map(({ gapHold, ...n }) => n);
  for (const n of own) if (n.len > 0) sustained.add(key(n));
  const notes = diff.plusHolds.gaps ? addGapHolds(own, ctx.features, diff, ctx.timing, ctx.energy, ctx.durationMs, -Infinity, calmOf(ctx, diff)).map(({ gapHold, ...n }) => n) : own;
  return { notes, sustained, protect: new Set(moments) };
}

// The keys a dense phrase of a level built on another adds as chords (diff.plusDense): one more key, up to `keys`, on the
// strongest moments of [fromMs, toMs) the level was built on, singles first, then two-key chords becoming three; strongest
// by the score of their sound, a beat before a half beat before the rest. A moment with a hold is left as it is. keepSizes in
// chords.js plays the moment at its new size.
function chordKeys(built, scored, scoredTimes, fromMs, toMs, keys, timing) {
  if (keys <= 0) return [];
  const scoreAt = (t) => {
    const i = lowerBound(scoredTimes, t);
    return scoredTimes[i] === t ? scored[i].score : -Infinity;
  };
  const grid = timing?.snapped ? [timing.gridPoints(1), timing.gridPoints(2)].map((g) => new Set(g)) : [new Set(), new Set()];
  const place = (t) => (grid[0].has(t) ? 0 : grid[1].has(t) ? 1 : 2);
  const moments = groupByTime(built.filter((n) => n.t >= fromMs && n.t < toMs));
  const open = moments.filter((m) => m.length < 3 && !m.some((n) => n.len > 0));
  const rank = (m) => [m.length, place(m[0].t), -scoreAt(m[0].t)];
  const order = open.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a[0].t - b[0].t;
  });
  return order.slice(0, keys).map((m) => ({ t: m[0].t, lane: [0, 1, 2, 3].find((l) => !m.some((n) => n.lane === l)) }));
}

// One difficulty's rhythm charted from the music, phrase by phrase: { notes, sustained }. A difficulty with diff.cutFrom
// takes its moments from that harder level (rhythm.js). The lanes here only hold a place: chords and lanes are laid out
// over the finished moments (finish). `sustained` holds the keys ("t:lane") of the real sustain holds, which the hold
// cap keeps longest.
// `trace` (optional, trace.js) hears what every stage did.
function chartNotes(ctx, diff, trace = null) {
  if (diff.buildOn) return plusNotes(ctx, diff);
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
function finish(ctx, { notes, sustained, protect = null }, diff, trace = null) {
  const step = (stage, before, after) => (trace ? trace.step(stage, before, after) : after);
  const held = step("clipHolds", notes, clipHolds([...notes].sort(byTime), ctx.durationMs, diff, ctx.timing));
  const sectioned = step("accents", held, accentSections(held, ctx.sections, diff, ctx.timing, ctx.energy, protect));
  const accented = diff.firstSound ? step("firstSound", sectioned, openWithFirstSound(sectioned, ctx.onsets, diff, ctx.timing, ctx.energy)) : sectioned;
  const upper = upperRhythm(ctx, diff);
  const inside = upper ? step("nested", accented, nested(accented, upper)) : accented;
  const released = step("settleHolds", inside, settleHolds(inside, diff, ctx.timing, ctx.durationMs));
  // With the holds let go, a rest is what the player feels: a mini rest keeps its best moment (bridges.js).
  const settled = diff.restBridge
    ? step("restBridges", released, bridgeRests(released, snappedMoments(ctx, diff.scoreLevel, diff.feltTempo), ctx.energy, ctx.timing, diff.restBridge))
    : released;
  const ran = diff.melodyRuns ? step("melodyRuns", settled, withRunNotes(settled, scoredFor(ctx, diff), ctx.timing, diff.melodyRuns)) : settled;
  const dipped = diff.dipThin ? step("dipThin", ran, thinDips(ran, ctx, diff.dipThin, melodyMoments(ctx, diff))) : ran;
  const hushed = diff.dipSilence ? step("dipSilence", dipped, silentUpper(dipped, ctx, diff.dipSilence)) : dipped;
  const thinned = diff.drumless ? step("drumless", hushed, thinDrumless(hushed, ctx, diff.drumless, decodedMelodyOf(ctx, diff))) : hushed;
  const spaced = step("spacedMoments", thinned, spacedMoments(thinned, diff));
  const floored = diff.oneHoldAtATime ? step("oneHold", spaced, oneHoldAtATime(spaced)) : spaced;
  const isSustain = (n) => sustained.has(`${n.t}:${n.lane}`);
  const shared = step("holdShare", floored, ctx.phrases.length === 0
    ? limitHoldShare(floored, Math.floor, isSustain, diff.maxHoldShare)
    : holdsCappedByPhrase(floored, ctx, diff, isSustain));
  // diff.keepNormalHolds: a long hold of the level this one is built on or cut from plays as it does there (holds.js keptHolds).
  const source = diff.keepNormalHolds && (diff.buildOn ?? diff.cutFrom);
  const capped = source ? step("normalHolds", shared, keptHolds(shared, finalNotes(ctx, source), diff, ctx.timing, ctx.durationMs)) : shared;
  const planned = step("chords", capped, planChords(capped, ctx, diff, upper, diff.heardChords ? heardShiftOf(ctx, diff.heardChords) : 0));
  const quietHeld = diff.quietLone?.hold ? step("quietLone", planned, holdQuietLone(planned, ctx, diff.quietLone)) : planned;
  // After the hold cap and the chords (sustain.js): the long notes it holds are not cut back to taps, and the passages it
  // rewrites play one note at a time.
  const heldLong = diff.sustainHolds ? step("sustainHolds", quietHeld, holdSustains(quietHeld, ctx, diff.sustainHolds, ctx.timing)) : quietHeld;
  const chorded = diff.melodyOnly ? step("melodyOnly", heldLong, keepMelodyOnly(heldLong, ctx, diff.melodyOnly, ctx.timing)) : heldLong;
  const layLanes = diff.laneSearch ? searchLanes : assignLanes;
  // diff.melodyLine: the lanes follow the second detector's melody where one was decoded (chartStore.js); the moments do not.
  // With diff.melodyOnly, the windows it rewrites follow its short-note line instead (sustain.js).
  const line = diff.melodyLine ? decodedMelodyOf(ctx, diff) : null;
  const decoded = line && diff.melodyOnly ? withShortLine(line, ctx, diff.melodyOnly) : line;
  const laneCtx = decoded ? { ...ctx, features: { ...ctx.features, melodyLine: decoded } } : ctx;
  const searched = step("lanes", chorded, layLanes(chorded, laneCtx, diff, upper));
  const laid = diff.sustainHolds?.pad ? step("padLanes", searched, padLanes(searched, ctx, diff.sustainHolds, ctx.timing)) : searched;
  const limited = step("chordShare", laid, limitChordShare(laid, ctx.timing, diff));
  // The fade-out thins its moments with their lanes laid, so the search keeps the lanes of the rest of the song.
  const faded = diff.fadeOut ? step("fadeOut", limited, holdFadeOut(thinFadeOut(limited, ctx, diff.fadeOut, melodyMoments(ctx, diff)), ctx, diff.fadeOut)) : limited;
  const final = step("finalFloors", faded, enforceFloors(faded, diff, ctx.timing));
  if (!(diff.sameCuts && diff.cutFrom)) return final;
  const above = [...new Set(finalNotes(ctx, diff.cutFrom).map((n) => n.t))].sort((a, b) => a - b);
  return step("sameCuts", final, sameCuts(final, above, ctx.timing, diff.sameCuts));
}

// Flag overrides go in before the busyness scaling, so every stage that reads diff sees them.
const diffOf = (ctx, difficulty) => slowHolds(slowChords(effectiveDifficulty(withFlags(levelOf(difficulty), difficulty, ctx.flags), ctx.busy), ctx.timing), ctx.timing);

const notesFor = (ctx, difficulty, trace = null) => {
  const diff = diffOf(ctx, difficulty);
  const charted = chartNotes(ctx, diff, trace);
  if (!charted.protect) return finish(ctx, charted, diff, trace);
  const settled = withoutCrowding(ctx, charted, diff);
  // The round that lost no moment ran finish on exactly these notes and this diff: untraced, its notes are the real run's.
  if (!trace && settled.done) return settled.done;
  return finish(ctx, { ...charted, notes: settled.notes }, settled.diff, trace);
};

// A level built on another (diff.buildOn) must keep every moment it was built on. Where the lanes find no free one for such a
// moment (a chord just before it and another just after it, closer than the lane gap), the extras around it give way and the
// moments within two lane gaps play only the size they were built with (chords.js diff.sizedAsBuilt), and with diff.plusHolds a
// hold over it lets go of it (a tap where it was charted as a hold): finish runs untraced
// until no moment is lost, and the notes and diff it was happy with are what the real run gets.
function withoutCrowding(ctx, { notes, sustained, protect }, diff) {
  const reach = Math.max(diff.minLaneGapMs ?? 0, diff.minNoteGapMs ?? 0);
  let kept = notes;
  let used = diff;
  const sized = new Set();
  let settledRun = null; // finish's notes of the round that lost no moment
  for (let round = 0; round < MAX_CROWDING_ROUNDS; round++) {
    const done = finish(ctx, { notes: kept.map((n) => ({ ...n })), sustained, protect }, used);
    const have = new Set(done.map((n) => n.t));
    const lost = [...protect].filter((t) => !have.has(t));
    if (lost.length === 0) {
      settledRun = done;
      break;
    }
    // ...and with diff.plusHolds a hold running over such a moment (or ending too near it for its lane) plays as a tap
    const over = new Set(!diff.plusHolds ? [] : done.filter((h) => h.len > 0 && lost.some((t) => t > h.t && t < h.t + h.len + reach)).map((h) => h.t));
    const next = kept
      .filter((n) => protect.has(n.t) || !lost.some((t) => Math.abs(n.t - t) < reach))
      .map((n) => (n.len > 0 && over.has(n.t) ? (({ len, ...tap }) => tap)(n) : n));
    for (const n of kept) if (lost.some((t) => Math.abs(n.t - t) < 2 * reach)) sized.add(n.t);
    kept = next;
    used = { ...diff, sizedAsBuilt: new Set(sized) };
  }
  return { notes: kept, diff: used, done: settledRun };
}

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
