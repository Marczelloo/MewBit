// The lanes of a chart found by a search instead of drawn one moment at a time (diff.laneSearch, generator flag
// "transitions"). What is playable stays as in lanes.js. A beam of hypotheses walks the song and pays for a figure people
// rarely play here (laneGrammar.json) and for uneven hands and lanes, so a moment can give way to the moments after it and
// the figures join up. A repeated phrase decides on entering it whether it copies its source and pays for each moment it
// leaves the copy, so the way into a repeat is searched too. Unlike the walk in lanes.js this one has no shared stream of
// random numbers: the noise on a choice hangs on the time of the moment, so a small change to the notes stays where it is.
const grammar = require("./laneGrammar.json");
const { beatMsOf, holdBlocks, spacedBlocked, underHoldFlagged } = require("./holds");
const { groupByTime } = require("./difficultyFilter");
const {
  TAIL, alternateSteps, breaksLaneRules, melodyDirection, melodyPull, pitchCost, pitchRoom, pitchTrack, recallLane, runCost, runStartCost, stairSteps,
} = require("./laneRules");
const { isRepeatOf } = require("./phrases");
const { sourceTime } = require("./repeats");
const { nearestIndex } = require("./util");
const {
  AGREE, BALANCE_BEATS, GAP_LIMITS_MS, LANES, MASKS, RECENT_NOTES, SAME_MOMENT_MS, TRILL_FREE, TRILL_MAX,
  freeTheHands, gapClass, grammarOdds, handOf, isSingle, laneOfSingle, lanesOf, leftOf, lonelyLanes, mirrorMask,
} = require("./lanes");

const LAG = 6; // how many moments stay open while a repeat looks back at its source
const LOST_NOTE = 6; // what a note lost from a moment costs
const LOST_HOLD = 2; // what a hold played as a tap costs
const TRILL_OVER = 14; // what a trill past TRILL_MAX costs
const NEVER_SEEN = 1e-4; // the odds below which a figure costs no more
const FAST_BEATS = 0.62; // a gap up to here is a fast one, as people's maps are measured
const ONE_HAND = [0b0011, 0b1100]; // the two chords one hand plays

// What lanes.js makes of a mask, once per mask: the search asks for it for every mask of every hypothesis. Only read from here
// (applyStep keeps its own lonelyLanes, which it takes lanes out of).
const LANES_OF = Array.from({ length: 16 }, (_, mask) => lanesOf(mask));
const LONELY_COUNT = Array.from({ length: 16 }, (_, mask) => lonelyLanes(mask).length);
const MASK_AT = Array.from({ length: 16 }, (_, mask) => (MASKS[LANES_OF[mask].length] ?? []).indexOf(mask)); // its place among the masks of its size

const hashMix = (a, b) => {
  let x = Math.imul(a ^ b, 0x5bd1e995);
  x ^= x >>> 15;
  return Math.imul(x, 0x9e3779b1) >>> 0;
};
const gumbel = (h) => -Math.log(-Math.log((h + 0.5) / 4294967296));

// A note on the hand of a hold that has just ended: the hold lets go a note gap before it. Where the shorter hold would
// break the rule on notes under it, or be under half a beat, it plays as a tap.
function clipRelease(notes, timing, diff) {
  const gap = diff.minNoteGapMs ?? 0;
  const beatAt = (at) => beatMsOf(timing, at);
  for (const h of notes) {
    if (!(h.len > 0)) continue;
    const end = h.t + h.len;
    const next = notes.find((n) => n.t >= end && n.t < end + gap && n.lane !== h.lane && handOf(n.lane) === handOf(h.lane));
    if (!next) continue;
    const len = next.t - gap - h.t;
    const under = notes.filter((n) => n.t > h.t && n.t < h.t + len && n.lane !== h.lane).map((n) => n.t - h.t);
    if (len >= beatAt(h.t) / 2 && (!diff.underHold || underHoldFlagged(h.t, len, under, beatAt).length === 0)) h.len = Math.round(len);
    else delete h.len;
  }
  return notes;
}

// searchLanes(notes, ctx, diff, upper) -> notes with their final lanes; a moment no lane can take is left out.
// `upper` (rhythm.js) is the level above: its lanes are the ones this level prefers.
function searchLanes(notes, ctx, diff, upper = null) {
  const { timing, phrases, durationMs } = ctx;
  const o = diff.laneSearch;
  const table = grammar[diff.grammar] ?? grammar.hard;
  const noteGap = diff.minNoteGapMs ?? 0;
  const laneGap = diff.minLaneGapMs ?? 0;
  const maxJack = diff.maxJack ?? LANES;
  const reach = Math.max(noteGap, laneGap);
  const seed = (Math.round(durationMs) * 31 + Math.round((diff.maxNps ?? 0) * 10)) >>> 0;

  const moments = groupByTime(notes);
  const times = moments.map((raw) => raw[0].t);
  const stairs = diff.stairs ? stairSteps(ctx, moments.map((raw) => (raw.length === 1 ? raw[0].t : null)), (at) => beatMsOf(timing, at), diff.stairs) : null;
  const alternates = diff.twoKeyTrill ? alternateSteps(ctx, moments.map((raw) => (raw.length === 1 ? raw[0].t : null)), (at) => beatMsOf(timing, at), diff.twoKeyTrill) : null;
  // The contour of the melody per moment (diff.pitchLanes: a lane step the way the pitch moves; diff.runLanes: a staircase for a fast run).
  const track = diff.pitchLanes || diff.runLanes
    ? pitchTrack(ctx, moments.map((raw) => (raw.length === 1 ? raw[0].t : null)), (at) => beatMsOf(timing, at), diff.pitchLanes, diff.runLanes)
    : null;
  const committed = new Array(moments.length).fill(0);
  let committedTo = -1;
  const repeats = phrases.map((p, i) => isRepeatOf(p, i));
  let beam = [{
    cost: 0, node: null, m1: 0, m2: 0, m3: 0, lastT: null,
    laneFree: new Array(LANES).fill(-Infinity), jackRun: new Array(LANES).fill(0), laneCount: new Array(LANES).fill(0),
    left: 0, total: 0, decayT: null, trill: 1, active: [], placed: [], tail: [], echo: null,
  }];
  let phraseAt = 0;
  // grammarOdds is pure on (table, gap, size, history): here its cost per mask, kept on the ctx per table, so the searches of
  // all the levels of a song (they ask for the same figures) share it.
  const memos = ctx.oddsMemo ?? new Map();
  if (!memos.has(table)) memos.set(table, new Map());
  const oddsMemo = memos.get(table);
  const noise = new Float64Array(256); // the Gumbel noise of this moment's (mask, last mask), shared by the hypotheses that agree on both
  const noiseAt = new Int32Array(256).fill(-1);

  // Everything before `limit` is settled on the path of the cheapest hypothesis, so a repeat can read its source.
  const commitBefore = (limit) => {
    if (limit <= committedTo) return;
    const best = beam.reduce((a, b) => (b.cost < a.cost ? b : a));
    const ancestorAt = (h) => {
      let n = h.node;
      while (n && n.m > limit) n = n.prev;
      return n;
    };
    const anchor = ancestorAt(best);
    beam = beam.filter((h) => ancestorAt(h) === anchor);
    for (let n = anchor; n && n.m > committedTo; n = n.prev) committed[n.m] = n.mask;
    committedTo = limit;
  };

  const applyStep = (c, m, t, beat) => {
    const h = c.h;
    if (c.mask === 0) return { ...h, cost: c.cost, active: c.active, laneFree: c.laneFree, node: c.broke ? { m, mask: 0, prev: h.node, notes: [], broke: c.broke } : h.node };
    const lanes = lanesOf(c.mask);
    const lonely = lonelyLanes(c.mask);
    const holding = c.kept.filter((n) => n.len > 0);
    const forHolds = holding.map((_, i) => lonely.splice(hashMix(hashMix(seed, Math.round(t)), i) % lonely.length, 1)[0]);
    const forTaps = lanes.filter((l) => !forHolds.includes(l));
    const laneFree = c.laneFree.slice(); // the other candidates of this hypothesis still hold this one
    const active = c.active.slice();
    const decay = h.decayT === null ? 1 : Math.exp(-(t - h.decayT) / ((BALANCE_BEATS / 2) * beat));
    const laneCount = h.laneCount.map((x) => x * decay);
    let left = h.left * decay;
    let total = h.total * decay;
    let hold = 0;
    let tap = 0;
    const laid = [];
    for (const note of c.kept) {
      const lane = note.len > 0 ? forHolds[hold++] : forTaps[tap++];
      const n = { ...note, lane };
      laid.push(n);
      laneCount[lane]++;
      left += lane < 2 ? 1 : 0;
      total++;
      laneFree[lane] = t + (note.len > 0 ? note.len : 0);
      if (note.len > 0) active.push(n);
    }
    const placed = [...h.placed, ...laid];
    if (placed.length > RECENT_NOTES) placed.splice(0, placed.length - RECENT_NOTES);
    const tail = [...h.tail, { t, lanes, m }];
    if (tail.length > TAIL) tail.shift();
    return {
      cost: c.cost, node: { m, mask: c.mask, prev: h.node, notes: laid, broke: c.broke },
      m1: c.mask, m2: h.m1, m3: h.m2, lastT: t,
      laneFree, jackRun: h.jackRun.map((v, l) => (lanes.includes(l) ? v + 1 : 0)), laneCount,
      left, total, decayT: t, trill: c.run ?? 1, active, placed, tail, echo: h.echo,
    };
  };

  moments.forEach((raw, m) => {
    const { t } = raw[0];
    const beat = beatMsOf(timing, t);
    let entered = m === 0 && phrases.length > 0 && t >= phrases[0].startMs;
    while (phraseAt + 1 < phrases.length && t >= phrases[phraseAt + 1].startMs) {
      phraseAt++;
      entered = true;
    }
    const repeat = phrases.length > 0 && repeats[phraseAt];
    if (entered) {
      commitBefore(m - LAG);
      const next = [];
      for (const h of beam) {
        if (!repeat) {
          next.push(h.echo === null ? h : { ...h, echo: null });
          continue;
        }
        next.push({ ...h, echo: "none" });
        next.push({ ...h, echo: "same" });
        if (o.echoMirror !== null) next.push({ ...h, echo: "mirror", cost: h.cost + o.echoMirror });
      }
      beam = next;
    }
    let sourceMask = 0;
    if (repeat) {
      commitBefore(m - LAG);
      const from = sourceTime(phrases[phraseAt], timing)(t);
      const at = nearestIndex(times, from);
      if (at >= 0 && at <= committedTo && Math.abs(times[at] - from) <= SAME_MOMENT_MS) sourceMask = committed[at];
    }

    const nextT = moments[m + 1]?.[0].t ?? Infinity;
    const holdsFirst = [...raw].sort((a, b) => (b.len > 0) - (a.len > 0) || a.lane - b.lane);
    const melody = o.melody > 0 && raw.length === 1 ? melodyDirection(ctx, t) : null;
    const inUpper = upper?.at?.get(t)?.map((n) => n.lane) ?? [];

    // The contour of the melody at this moment (pitchLanes, runLanes). Where it speaks it stands in for the old melody term
    // (pitchLanes, runLanes) and the stairs term (runLanes): each pulls the edge of the keys its own way, and a sum of both would
    // fight there. The run staircase is the stronger form of the stairs.
    const contourAt = raw.length === 1 ? track?.[m] ?? null : null;
    const contourRun = !!diff.runLanes && contourAt !== null && contourAt.run !== 0;
    const contourPitch = !contourRun && !!diff.pitchLanes && contourAt !== null;
    const contoured = contourRun || contourPitch || (!!diff.runLanes && contourAt?.start != null);
    const contourMelody = contourRun || (contourPitch && contourAt.delta !== null);
    const contourStairs = contourRun;
    const contourCost = (h, lane, prev, gapMs) => {
      let cost = contourAt.start && diff.runLanes ? runStartCost(diff.runLanes, contourAt.start, lane) : 0;
      if (contourPitch) cost += pitchRoom(diff.pitchLanes, contourAt, lane);
      if (prev === null) return cost;
      if (contourRun) return cost + runCost(diff.runLanes, contourAt.run, lane, prev);
      if (contourPitch && contourAt.delta !== null) cost += pitchCost(diff.pitchLanes, contourAt, lane, prev, recallLane(diff.pitchLanes, track, h.tail, m, prev), gapMs, beat);
      return cost;
    };
    const candidates = [];

    for (const h of beam) {
      let active = h.active.filter((x) => x.t + x.len + reach > t);
      const laneFree = h.laneFree.slice();
      let broke = null;
      let kept = freeTheHands(holdsFirst, active.filter((x) => x.t + x.len > t), nextT, noteGap);
      const { placed } = h;

      // Under a running hold the notes keep the rules of what sits under one (holds.js underHoldFlagged), where a level asks for them.
      // `now` is how many notes this moment puts under x.
      const breaksUnder = (x, now) => {
        if (!(t > x.t && t < x.t + x.len)) return false;
        const under = placed.filter((p) => !(p.t === x.t && p.lane === x.lane) && p.lane !== x.lane && p.t > x.t && p.t < x.t + x.len).map((p) => p.t - x.t);
        for (let i = 0; i < now; i++) under.push(t - x.t);
        return underHoldFlagged(x.t, x.len, under, (at) => beatMsOf(timing, at)).length > 0;
      };
      const underBreaks = (lanes) => !!diff.underHold && active.some((x) => breaksUnder(x, lanes.filter((l) => l !== x.lane).length));
      // A hold that has ended lets go in time for a note on its own hand (clipRelease) where the shorter hold stays a hold.
      const letsGoFor = (x, lane) => {
        if (t < x.t + x.len || x.lane === lane) return false;
        const len = t - noteGap - x.t;
        if (len < beat / 2) return false;
        if (!diff.underHold) return true;
        const under = placed.filter((p) => p.lane !== x.lane && p.t > x.t && p.t < x.t + len).map((p) => p.t - x.t);
        return underHoldFlagged(x.t, len, under, (at) => beatMsOf(timing, at)).length === 0;
      };
      const legal = (mask, holds) => {
        const lanes = LANES_OF[mask];
        if (holds > 0 && (LONELY_COUNT[mask] < holds || (diff.holdOtherHand === "blocked" && lanes.length > 1))) return false;
        const playable = lanes.every((l) => {
          if (t - laneFree[l] < laneGap || (h.lastT !== null && h.jackRun[l] >= maxJack)) return false;
          if (active.length === 0) return true;
          const note = { t, lane: l };
          const others = [...placed, ...lanes.filter((x) => x !== l).map((lane) => ({ t, lane }))];
          return active.every((x) => letsGoFor(x, l) || (!holdBlocks(x, note, diff) && !spacedBlocked(x, note, others, diff, beat / 2)));
        });
        return playable && !underBreaks(lanes) && !(diff.melodyLanes && breaksLaneRules(h.tail, t, lanes, timing));
      };

      // What can be played of this moment: first its taps go, then a last hold becomes a tap.
      let options = [];
      let lostCost = 0;
      while (kept.length > 0) {
        const holds = kept.filter((n) => n.len > 0).length;
        options = MASKS[kept.length].filter((mask) => legal(mask, holds));
        if (options.length > 0) break;
        const broken = diff.underHold ? active.find((x) => breaksUnder(x, 1)) : undefined;
        if (broken) {
          (broke ??= []).push({ t: broken.t, lane: broken.lane });
          laneFree[broken.lane] = broken.t;
          active = active.filter((x) => x !== broken);
          lostCost += LOST_HOLD;
          continue;
        }
        if (kept.length > 1) {
          kept = kept.slice(0, -1);
        } else if (kept[0].len > 0) {
          const { len, ...tap } = kept[0];
          kept = [tap];
          lostCost += LOST_HOLD;
        } else {
          kept = [];
        }
      }
      lostCost += (raw.length - kept.length) * LOST_NOTE;
      if (kept.length === 0) {
        candidates.push({ h, mask: 0, kept, active, laneFree, broke, cost: h.cost + lostCost });
        continue;
      }

      const size = kept.length;
      const gap = h.lastT === null ? GAP_LIMITS_MS.length : gapClass(t - h.lastT);
      // The odds hang on the gap class, the size and the last masks only, and many hypotheses of a moment share them.
      const oddsKey = (((gap * 8 + size) * 4 + (h.m3 > 0) + (h.m2 > 0) + (h.m1 > 0)) << 12) | ((h.m3 > 0 ? h.m3 : 0) << 8) | ((h.m2 > 0 ? h.m2 : 0) << 4) | (h.m1 > 0 ? h.m1 : 0);
      let oddsCost = oddsMemo.get(oddsKey);
      if (oddsCost === undefined) {
        oddsCost = grammarOdds(table, gap, size, [h.m3, h.m2, h.m1].filter((x) => x > 0)).map((p) => Math.log(Math.max(p, NEVER_SEEN)));
        oddsMemo.set(oddsKey, oddsCost);
      }
      const decay = h.decayT === null ? 1 : Math.exp(-(t - h.decayT) / ((BALANCE_BEATS / 2) * beat));
      const dLeft = h.left * decay;
      const dTotal = h.total * decay;
      const dLanes = h.laneCount.map((c) => c * decay);
      const direction = size === raw.length ? melody : null;
      const prevLane = laneOfSingle(h.m1 || undefined);
      const beforeLane = laneOfSingle(h.m2 || undefined);
      let wanted = 0;
      if (h.echo === "same") wanted = sourceMask;
      else if (h.echo === "mirror" && sourceMask) wanted = mirrorMask(sourceMask);

      for (const mask of options) {
        let cost = h.cost + lostCost - oddsCost[MASK_AT[mask]];
        const copying = wanted !== 0 && mask === wanted;
        if (wanted !== 0 && !copying) cost += o.echoBeta;
        if (h.echo === "none" && sourceMask !== 0) cost += o.echoNone;
        if (!copying && o.tau > 0) {
          const slot = (mask << 4) | h.m1;
          if (noiseAt[slot] !== m) {
            noise[slot] = o.tau * gumbel(hashMix(hashMix(seed, Math.round(t) * 7 + mask), h.m1));
            noiseAt[slot] = m;
          }
          cost -= noise[slot];
        }
        cost += o.handPull * Math.abs((dLeft + leftOf(mask) + 2) / (dTotal + size + 4) - 0.5);
        const maskLanes = LANES_OF[mask];
        for (const l of maskLanes) cost += o.lanePull * Math.max(0, (dLanes[l] + 1) / (dTotal + 4) - 1 / LANES);
        let run = 1;
        if (isSingle(mask) && h.m1 !== 0 && isSingle(h.m1) && mask !== h.m1) run = h.m2 === mask && t - h.lastT <= beat ? h.trill + 1 : 2;
        if (run > TRILL_MAX) cost += TRILL_OVER;
        else if (run > TRILL_FREE && !alternates?.[m]) cost += (run - TRILL_FREE) * Math.LN2;
        if (contoured && size === 1) cost += contourCost(h, maskLanes[0], prevLane, t - h.lastT);
        if (direction !== null && !contourMelody) cost -= o.melody * Math.log(melodyPull(direction, maskLanes[0], prevLane, beforeLane, t - h.lastT, beat));
        if (stairs?.[m] && size === 1 && !contourStairs) cost -= diff.stairs.weight * Math.log(melodyPull(stairs[m], maskLanes[0], prevLane, beforeLane, t - h.lastT, beat));
        // An alternation goes back to the lane two notes before (melodyPull's fast repeat: no gap, so never a jack).
        if (alternates?.[m] && size === 1) cost -= diff.twoKeyTrill.weight * Math.log(melodyPull(0, maskLanes[0], prevLane, beforeLane, 0, beat));
        if (size === 1 && h.lastT !== null && t - h.lastT <= FAST_BEATS * beat && (mask & h.m1) !== 0) cost += isSingle(h.m1) ? o.restrike : o.overChord;
        if (mask === ONE_HAND[0] || mask === ONE_HAND[1]) cost -= o.oneHand;
        if (inUpper.length > 0) cost -= Math.log(1 + (AGREE * maskLanes.filter((l) => inUpper.includes(l)).length) / size);
        candidates.push({ h, mask, kept, active, laneFree, broke, cost, run });
      }
    }

    candidates.sort((a, b) => a.cost - b.cost);
    const seen = new Set();
    const nextBeam = [];
    for (const c of candidates) {
      if (nextBeam.length >= o.beam) break;
      const m1 = c.mask || c.h.m1;
      const m2 = c.mask ? c.h.m1 : c.h.m2;
      const m3 = c.mask ? c.h.m2 : c.h.m3;
      const echoBits = c.h.echo === "same" ? 1 : c.h.echo === "mirror" ? 2 : 0;
      const key = (m1 << 12) | (m2 << 8) | (m3 << 4) | echoBits | (c.active.reduce((a, x) => a | (1 << x.lane), 0) << 16);
      if (seen.has(key)) continue;
      seen.add(key);
      nextBeam.push(applyStep(c, m, t, beat));
    }
    beam = nextBeam;
  });

  const best = beam.reduce((a, b) => (b.cost < a.cost ? b : a));
  const out = [];
  const brokenKeys = new Set();
  for (let n = best.node; n; n = n.prev) {
    if (n.broke) for (const b of n.broke) brokenKeys.add(`${b.t}|${b.lane}`);
    out.push(...n.notes);
  }
  const sorted = out.map((n) => ({ ...n })).sort((a, b) => a.t - b.t || a.lane - b.lane);
  for (const n of sorted) if (brokenKeys.has(`${n.t}|${n.lane}`)) delete n.len;
  return clipRelease(sorted, timing, diff);
}

module.exports = { searchLanes };
