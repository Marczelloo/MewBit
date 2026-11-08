// How many notes each moment plays. The moments are settled by now; a chord is a choice about one of them, not a new
// one, so it never takes a place in the rhythm. People put chords on the strong beats of the loud bars and keep them
// when they make an easier level: Hard plays a chord at a rate set by the place in the bar, the bar's loudness and how
// strong the sound is, Normal keeps most of Hard's and adds few of its own, Easy keeps few of Normal's. A section opens
// on one when it is loud enough, and a repeat of a phrase plays the chords of its source. A level with diff.maxChordShare
// keeps the chords it plans to that share of the moments so far (what is saved towards a chord waits for room). A level
// with diff.maxChordsPer8Beats also keeps them to that many in any 8 beats: the share counts from the start of the song,
// so a quiet opening saves up room that a loud part spends at once.
const { beatPosition } = require("./grid");
const { groupByTime, slotRank } = require("./difficultyFilter");
const { beatMsOf } = require("./holds");
const { isRepeatOf } = require("./phrases");
const { sourceTime } = require("./repeats");
const { soloLeadRates } = require("./selection");
const { strengthAt } = require("./rhythm");
const { opensOnChord } = require("./sections");
const { nearestIndex } = require("./util");

const GRID_SLACK = 0.9; // as in the difficulty's other gaps in beats
const BEATS_PER_BAR = 4;
const FALLBACK_BAR_MS = 2000;
const QUIET_BAR_SCALE = 0.4; // the rate of the quietest bar of a song, the loudest gets 2 - this
const MIN_STRENGTH_SCALE = 0.5;
const MAX_STRENGTH_SCALE = 1.5;
const NO_SOUND_SCALE = 0.5; // a moment no sound is near
const FAST_BEATS = 0.45; // a moment with a neighbour closer than this is in a fast run...
const FAST_SCALE = 0.3; // ...where people play far fewer chords than elsewhere
const SAME_MOMENT_MS = 3;
const LIMIT_WINDOW_BEATS = 8; // diff.maxChordsPer8Beats counts the chords in this many beats

const byTime = (a, b) => a.t - b.t || a.lane - b.lane;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Each moment's bar's loudness as a scale of the chord rate, averaging 1 over the bars: the quietest low, the loudest high.
function barScales(moments, ctx) {
  const { timing, energy } = ctx;
  const barOf = (t) => (timing?.snapped ? Math.floor(beatPosition(timing, t) / BEATS_PER_BAR) : Math.floor(t / FALLBACK_BAR_MS));
  const bars = new Map();
  for (const moment of moments) {
    const bar = barOf(moment[0].t);
    const e = energy.at(moment[0].t);
    const seen = bars.get(bar);
    if (seen) {
      seen.sum += e;
      seen.n++;
    } else {
      bars.set(bar, { sum: e, n: 1 });
    }
  }
  const ranked = [...bars.entries()].sort((a, b) => a[1].sum / a[1].n - b[1].sum / b[1].n);
  const scale = new Map(ranked.map(([bar], i) => [bar, QUIET_BAR_SCALE + 2 * (1 - QUIET_BAR_SCALE) * (ranked.length > 1 ? i / (ranked.length - 1) : 0.5)]));
  return (t) => scale.get(barOf(t));
}

// diff.chordLoudness: the chord rate's scale at an energy, linear between the [energy, scale] points (sorted by energy)
// and flat past both ends; 1 without it. barScales ranks a song's bars against each other only, so a quiet opening
// plays as many chords as the song's middle; people's chords follow how loud the music is.
function loudnessScale(points, e) {
  if (!points?.length) return 1;
  if (e <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [e1, s1] = points[i];
    const [e0, s0] = points[i - 1];
    if (e <= e1) return s0 + ((s1 - s0) * (e - e0)) / (e1 - e0);
  }
  return points[points.length - 1][1];
}

// How strong the sound at each moment is against the song's mean, within limits.
function strengthScales(moments, ctx) {
  const heard = moments.map((m) => strengthAt(ctx, m[0].t));
  const known = heard.filter((s) => s !== null);
  const mean = known.length > 0 ? known.reduce((sum, s) => sum + s, 0) / known.length : 1;
  return heard.map((s) => (s === null || !(mean > 0) ? NO_SOUND_SCALE : clamp(s / mean, MIN_STRENGTH_SCALE, MAX_STRENGTH_SCALE)));
}

// The first lanes a moment does not use yet: the notes added here only hold a place until lanes.js lays the moment out.
function freeLanes(moment, count) {
  const taken = new Set(moment.map((n) => n.lane));
  return [0, 1, 2, 3].filter((l) => !taken.has(l)).slice(0, count);
}

// How the figure around moment m weighs a chord there (diff.chordFlow, generator flag "transitions"): people play fewer
// between two fast gaps and on the way from a hold into a fast run, more where the moment has room and beside another chord.
function flowScale(flow, moments, sizes, m, beatMs) {
  if (!flow) return 1;
  const { t } = moments[m][0];
  const before = m > 0 ? (t - moments[m - 1][0].t) / beatMs : Infinity;
  const after = m + 1 < moments.length ? (moments[m + 1][0].t - t) / beatMs : Infinity;
  const fastBefore = before <= flow.fastBeats;
  const fastAfter = after <= flow.fastBeats;
  let scale = 1;
  if (fastBefore && fastAfter) scale *= flow.betweenFast;
  if (!fastBefore && !fastAfter) scale *= flow.withRoom;
  if (fastAfter && m > 0 && moments[m - 1].some((n) => n.len > 0)) scale *= flow.holdIntoRun;
  if (m > 0 && sizes[m - 1] > 1 && before <= flow.nearBeats) scale *= flow.besideChord;
  return scale;
}

// The times of the moments that come after rule.gapBeats of nothing (holds count until they let go) while the music is
// quieter than rule.below (diff.quietLone, Normal's QUIET_LONE). On the train songs people play such a moment as one
// tap 68% of the time and a chord 27%; Normal made a chord of 38%, as the room around it (flowScale) asks for one.
function quietLoneMoments(moments, ctx, rule) {
  const out = new Set();
  if (!rule) return out;
  let reach = null;
  for (const moment of moments) {
    const { t } = moment[0];
    if (reach !== null && t - reach >= rule.gapBeats * beatMsOf(ctx.timing, t) && ctx.energy.at(t) < rule.below) out.add(t);
    const end = Math.max(...moment.map((n) => n.t + (n.len > 0 ? n.len : 0)));
    reach = reach === null ? end : Math.max(reach, end);
  }
  return out;
}

// holdQuietLone(notes, ctx, rule) -> notes: with rule.hold, a lone quiet moment (quietLoneMoments) that is one tap holds
// until rule.hold.releaseBeats before the next moment, when that leaves at least rule.hold.minBeats. Something drawn out
// starting in a quiet stretch reads as one long note; the pitch tracker often misses it there, so the room decides.
function holdQuietLone(notes, ctx, rule) {
  if (!rule?.hold) return notes;
  const moments = groupByTime(notes);
  const lone = quietLoneMoments(moments, ctx, rule);
  const held = new Map();
  moments.forEach((moment, m) => {
    const next = moments[m + 1];
    if (!lone.has(moment[0].t) || moment.length > 1 || moment[0].len > 0 || !next) return;
    const beat = beatMsOf(ctx.timing, moment[0].t);
    const len = next[0].t - rule.hold.releaseBeats * beat - moment[0].t;
    if (len >= rule.hold.minBeats * beat) held.set(moment[0], Math.round(len));
  });
  return notes.map((n) => (held.has(n) ? { ...n, len: held.get(n) } : n));
}

// A chord of `plan` (the moments so far, { m, t, kept, added, score, firm }) given back for `m`, the moment just planned: while
// the chords in the 8 beats that end at m are more than `limit`, the weakest of them plays one note instead (its first,
// a hold before a tap); a chord with `firm` (a section's opening, two holds at one moment) never does. The window is
// measured against the larger beat of its two ends, like the gaps of laneRules.js. Returns the plan entries that gave way.
function giveBack(plan, m, limit, timing) {
  const gone = [];
  const chord = (e) => e.kept.length + e.added.length > 1;
  const inWindow = (e) => plan[m].t - e.t < LIMIT_WINDOW_BEATS * Math.max(beatMsOf(timing, e.t), beatMsOf(timing, plan[m].t));
  for (;;) {
    const window = [];
    for (let k = m; k >= 0 && inWindow(plan[k]); k--) if (chord(plan[k])) window.push(plan[k]);
    const weakest = window.filter((e) => !e.firm).sort((a, b) => a.score - b.score || b.t - a.t)[0];
    if (window.length <= limit || !weakest) return gone;
    weakest.kept = weakest.kept.slice(0, 1);
    weakest.added = [];
    gone.push(weakest);
  }
}

// slowChords(diff, timing) -> diff: with diff.chordSlow = { refBpm, power, max } a song slower than refBpm plays more chords. People's
// beats are chords more often the slower the song (train: 77% of the beats at 100-120 BPM, 67% at 140-160, 38% at 180-200), the
// rates here do not follow. The rates, the share and the 8-beat window all grow by (refBpm / bpm) ^ power, at most max.
function slowChords(diff, timing) {
  const rule = diff.chordSlow;
  if (!rule || !diff.chordRates || !timing?.snapped || !(timing.medianMs > 0)) return diff;
  const factor = clamp(Math.pow(rule.refBpm / (60000 / timing.medianMs), rule.power), 1, rule.max);
  if (factor <= 1) return diff;
  return {
    ...diff,
    chordRates: diff.chordRates.map((r) => r * factor),
    maxChordShare: diff.maxChordShare ? Math.min(rule.maxShare ?? 0.5, diff.maxChordShare * factor) : diff.maxChordShare,
    maxChordsPer8Beats: diff.maxChordsPer8Beats > 0 ? Math.round(diff.maxChordsPer8Beats * factor) : diff.maxChordsPer8Beats,
  };
}

// planChords(notes, ctx, diff, upper) -> notes with every moment at the size it plays.
// `upper` (rhythm.js) is the level above, for a level cut from it. With diff.keepSizes the notes come with their sizes
// (Normal's, under hardPlus): a moment that came as a chord stays one, as far as the hands are free.
function planChords(notes, ctx, diff, upper = null) {
  const { timing, phrases, sections, energy } = ctx;
  const moments = groupByTime(notes);
  const barScale = barScales(moments, ctx);
  const strength = strengthScales(moments, ctx);
  const opening = new Set(sections.filter((s) => opensOnChord(s, diff, energy)).map((s) => s.t));
  const quietLone = quietLoneMoments(moments, ctx, diff.quietLone);
  const solo = diff.soloLead && phrases.length > 0 ? soloLeadRates(ctx, diff.soloLead) : null;
  const carry = [0, 0, 0, 0]; // what each place in the bar has saved towards its next chord
  const carryNew = [0, 0, 0, 0];
  const carryTriple = [0, 0, 0, 0];
  const times = [];
  const sizes = []; // what each moment plays, after the window
  const planned = []; // ...and what it would play without it: a repeat is planned from this, and counts as a chord for the share when its source was
  const plan = []; // per moment: what it plays and how strong its chord is against the others (giveBack)
  let phraseAt = 0;
  let running = [];
  let chords = 0; // chords planned so far; one the window gives back still counts, so the share spends as it would without the window

  moments.forEach((moment, m) => {
    const { t } = moment[0];
    while (phraseAt + 1 < phrases.length && t >= phrases[phraseAt + 1].startMs) phraseAt++;
    running = running.filter((h) => h.t + h.len > t);
    const holds = moment.filter((n) => n.len > 0);

    // A chord needs room around it, and what the holds leave of the hands.
    const beatMs = beatMsOf(timing, t);
    const nearest = Math.min(...[moments[m - 1], moments[m + 1]].map((o) => (o ? Math.abs(o[0].t - t) : Infinity)));
    const tight = nearest < Math.max((diff.chordGapBeats ?? 0) * beatMs * GRID_SLACK, diff.chordMinGapMs ?? 0);
    const handsFree = !(diff.holdOtherHand === "blocked" && holds.length > 0) && running.length < 2 && (running.length === 0 || diff.holdOtherHand === "free");
    const canChord = !tight && handsFree;

    const rank = slotRank(timing, t);
    let want = 1;
    let opens = false;
    let cap = Infinity; // a repeat plays no more than its source was left with
    const repeat = phrases.length > 0 && isRepeatOf(phrases[phraseAt], phraseAt);
    const inSource = repeat ? nearestIndex(times, sourceTime(phrases[phraseAt], timing)(t)) : -1;
    if (opening.has(t) && canChord) {
      want = 2;
      opens = true;
    } else if (inSource >= 0 && Math.abs(times[inSource] - sourceTime(phrases[phraseAt], timing)(t)) <= SAME_MOMENT_MS) {
      want = canChord ? planned[inSource] : 1;
      cap = sizes[inSource];
    } else if (canChord) {
      const scale = strength[m] * (nearest < FAST_BEATS * beatMs ? FAST_SCALE : 1) * flowScale(diff.chordFlow, moments, sizes, m, beatMs);
      if (diff.chordRates) {
        carry[rank] += diff.chordRates[rank] * barScale(t) * scale * loudnessScale(diff.chordLoudness, energy.at(t));
      } else if ((upper?.at.get(t)?.length ?? 0) >= 2) {
        carry[rank] += (diff.chordKeep?.[rank] ?? 0) * scale;
      } else {
        carryNew[rank] += (diff.chordNew?.[rank] ?? 0) * scale;
      }
      // A level that caps its chords (diff.maxChordShare) plays a planned one only while the share so far has room for it.
      const room = !(diff.chordRates && diff.maxChordShare) || chords + 1 <= diff.maxChordShare * (m + 1);
      if (carry[rank] >= 1 && !room) carry[rank] = 1;
      if (carry[rank] >= 1 && room) {
        carry[rank] -= 1;
        want = 2;
      } else if (carryNew[rank] >= 1) {
        carryNew[rank] -= 1;
        want = 2;
      }
      if (want === 2 && diff.chordTriples) {
        carryTriple[rank] += diff.chordTriples[rank];
        if (carryTriple[rank] >= 1) {
          carryTriple[rank] -= 1;
          want = 3;
        }
      }
    }

    // Holds are kept first and at most two share a moment; a chord over a running hold or with a held note stays small.
    if (holds.length > 0 || running.length > 0) want = Math.min(want, 2);
    want = Math.max(want, Math.min(holds.length, 2));
    if (running.length > 0 && diff.holdOtherHand !== "free") want = 1;
    const asked = want;
    want = Math.min(want, Math.max(cap, Math.min(holds.length, 2)));
    // A lone moment in quiet music plays one note, but counts as planned: the chords around it stay where they were.
    // So does a moment of a phrase a quiet soloist leads (selection.js soloLeadRates): one note at a time follows the line.
    if ((quietLone.has(t) || solo?.[phraseAt] > 0) && !opens) want = Math.min(want, Math.max(1, Math.min(holds.length, 2)));
    // hardPlus (diff.keepSizes): a moment comes in at the size Normal played it, and the rates above only add to it.
    if (diff.keepSizes && handsFree) want = Math.max(want, moment.length);
    // ...but where the lanes found no room for a moment it was built on (generate.js withoutCrowding), only its own size.
    if (diff.keepSizes && diff.sizedAsBuilt?.has(t)) want = moment.length;

    const kept = [...holds, ...moment.filter((n) => !(n.len > 0))].slice(0, want);
    const added = freeLanes(kept, want - kept.length).map((lane) => ({ t, lane }));
    running.push(...kept.filter((n) => n.len > 0));
    times.push(t);
    sizes.push(kept.length + added.length);
    planned.push(want < asked ? asked : kept.length + added.length);
    // How much a chord is wanted here, as the rates above weigh it: a downbeat of a loud bar on a strong sound first.
    const score = (diff.chordRates?.[rank] ?? 1) * barScale(t) * strength[m];
    plan.push({ m, t, kept, added, score, firm: opens || holds.length > 1 });
    if (planned[m] > 1) chords++;
    if (diff.maxChordsPer8Beats > 0 && kept.length + added.length > 1) {
      for (const e of giveBack(plan, m, diff.maxChordsPer8Beats, timing)) sizes[e.m] = 1;
    }
  });
  return plan.flatMap((e) => [...e.kept, ...e.added]).sort(byTime);
}

// limitChordShare(notes, timing, diff) -> notes with the chords of a capped level back at diff.maxChordShare. A plan keeps a
// section's opening chord and two holds whatever the share says, and the lane search keeps more of what is planned than
// the walk in lanes.js does. The chords on the weakest places of the bar go first, the latest of them first, down to one note.
function limitChordShare(notes, timing, diff) {
  if (!(diff.chordRates && diff.maxChordShare)) return notes;
  const moments = groupByTime(notes);
  const chords = moments.filter((m) => m.length > 1);
  const over = chords.length - Math.floor(diff.maxChordShare * moments.length);
  if (over <= 0) return notes;
  const dropped = new Set();
  const weakestFirst = chords
    .filter((m) => m.some((n) => !(n.len > 0)))
    .sort((a, b) => slotRank(timing, b[0].t) - slotRank(timing, a[0].t) || b[0].t - a[0].t);
  for (const m of weakestFirst.slice(0, over)) dropped.add(m.findLast((n) => !(n.len > 0)));
  return notes.filter((n) => !dropped.has(n));
}

module.exports = { holdQuietLone, limitChordShare, planChords, slowChords };
