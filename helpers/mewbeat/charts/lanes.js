// The lanes of a chart, laid out last, when every moment and its size are known. A lane belongs to no instrument: a
// mapper picks it for how it feels under the hands after the last few presses. So a moment's lanes are drawn from what
// people play in the same place (laneGrammar.json, learned from the human charts of the train songs by
// mapping-analysis/synthesis/learn_lane_grammar.py), steered so the hands and the lanes stay even and a trill ends, and
// limited by what is playable. A mapper also has favourite figures, so what this song has already played after the same
// few moments counts too (diff.motifPull). People repeat a rhythm far more than its lanes: a repeated phrase mostly gets
// lanes of its own, sometimes its source's, as they were or mirrored.
const grammar = require("./laneGrammar.json");
const { beatMsOf, holdBlocks, spacedBlocked } = require("./holds");
const { groupByTime } = require("./difficultyFilter");
const { isRepeatOf } = require("./phrases");
const { sourceTime } = require("./repeats");
const { nearestIndex } = require("./util");

const LANES = 4;
const GAP_LIMITS_MS = [120, 200, 350]; // the classes must match GAP_LIMITS_MS in learn_lane_grammar.py
const MASKS = { 1: [1, 2, 4, 8], 2: [3, 5, 6, 9, 10, 12], 3: [7, 11, 13, 14], 4: [15] };
const MAX_ORDER = 3;
const BLEND = 20; // how many sightings a longer history needs to count as much as the shorter one
const BALANCE_BEATS = 16;
const HAND_PULL = 10; // how hard the hands are pulled level
const LANE_PULL = 8; // how hard a lane over its share is held back
const AGREE = 3; // how much the lanes of the level above are preferred
const TRILL_FREE = 4; // a trill this long is left alone, then every note halves its chance
const TRILL_MAX = 9;
const TRILL_HALVING = 0.5;
const TRILL_OVER = 1e-6;
const ECHO_SAME = 0.135; // the share of repeated phrases taking their source's lanes
const ECHO_MIRROR = 0.135; // ...and the same mirrored (diff.echoMirror where a level does it more)
const MOTIF_ORDERS = [2, 3];
const SAME_MOMENT_MS = 3;
const RECENT_NOTES = 16; // what a hold's half-beat spacing can still see

const byTime = (a, b) => a.t - b.t || a.lane - b.lane;
const handOf = (lane) => lane >> 1;
const lanesOf = (mask) => [0, 1, 2, 3].filter((l) => (mask >> l) & 1);
const leftOf = (mask) => (mask & 1) + ((mask >> 1) & 1);
const isSingle = (mask) => (mask & (mask - 1)) === 0;
const mirrorMask = (mask) => lanesOf(mask).reduce((m, l) => m | (1 << (LANES - 1 - l)), 0);

function gapClass(gapMs) {
  const at = GAP_LIMITS_MS.findIndex((limit) => gapMs < limit);
  return at < 0 ? GAP_LIMITS_MS.length : at;
}

// mulberry32: the same song gets the same chart.
function randomFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const totals = new WeakMap();
function totalOf(seen) {
  if (!totals.has(seen)) totals.set(seen, Object.values(seen).reduce((sum, c) => sum + c, 0));
  return totals.get(seen);
}

// How likely each mask is here: the counts of each history, from none to MAX_ORDER, each blended over the shorter one by
// how often it was seen. A history people never played stops the walk.
function grammarOdds(table, gap, size, history) {
  const masks = MASKS[size];
  let odds = masks.map(() => 1 / masks.length);
  for (let order = 0; order <= Math.min(MAX_ORDER, history.length); order++) {
    const seen = table[`${gap}|${size}|${history.slice(history.length - order).join(".")}`];
    if (!seen) break;
    const n = totalOf(seen);
    const weight = n / (n + BLEND);
    odds = masks.map((m, i) => (weight * (seen[m] ?? 0)) / n + (1 - weight) * odds[i]);
  }
  return odds;
}

function pick(items, weights, random) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let at = random() * total;
  for (let i = 0; i < items.length; i++) {
    at -= weights[i];
    if (at < 0) return items[i];
  }
  return items[items.length - 1];
}

// A hold that would leave no hand for the moments after it plays as a tap: the newest one first.
function freeTheHands(moment, running, nextT, noteGap) {
  const kept = [...moment];
  const holdsOf = () => kept.filter((n) => n.len > 0);
  while (holdsOf().length > 0 && running.length + holdsOf().length >= 2) {
    const ends = [...running, ...holdsOf()].map((h) => h.t + h.len);
    if (!(nextT < Math.min(...ends) + noteGap)) break;
    const newest = holdsOf().at(-1);
    const { len, ...tap } = newest;
    kept[kept.indexOf(newest)] = tap;
  }
  return kept;
}

// assignLanes(notes, ctx, diff, upper) -> notes with their final lanes; a moment no lane can take is left out.
// `upper` (rhythm.js) is the level above: its lanes are the ones this level prefers.
function assignLanes(notes, ctx, diff, upper = null) {
  const { timing, phrases, durationMs } = ctx;
  const table = grammar[diff.grammar] ?? grammar.hard;
  const noteGap = diff.minNoteGapMs ?? 0;
  const laneGap = diff.minLaneGapMs ?? 0;
  const maxJack = diff.maxJack ?? LANES;
  const reach = Math.max(noteGap, laneGap);
  const random = randomFrom(Math.round(durationMs) * 31 + Math.round((diff.maxNps ?? 0) * 10));
  const echoes = phrases.map((p, i) => {
    const r = random();
    if (!isRepeatOf(p, i)) return null;
    if (r < ECHO_SAME) return "same";
    return r < ECHO_SAME + (diff.echoMirror ?? ECHO_MIRROR) ? "mirror" : null;
  });

  const moments = groupByTime(notes);
  const laneFree = new Array(LANES).fill(-Infinity);
  const jackRun = new Array(LANES).fill(0);
  const laneCount = new Array(LANES).fill(0);
  const history = [];
  const motifs = {}; // what this song has played after each two and three moments: a mapper has favourite figures
  const times = [];
  const masksSoFar = [];
  const recent = []; // the notes of the last BALANCE_BEATS beats
  const placed = [];
  const out = [];
  let active = [];
  let left = 0;
  let total = 0;
  let trill = 1;
  let lastT = null;
  let phraseAt = 0;

  moments.forEach((raw, m) => {
    const { t } = raw[0];
    const beat = beatMsOf(timing, t);
    while (phraseAt + 1 < phrases.length && t >= phrases[phraseAt + 1].startMs) phraseAt++;
    active = active.filter((h) => h.t + h.len + reach > t);
    const running = active.filter((h) => h.t + h.len > t);
    while (recent.length > 0 && recent[0].t < t - BALANCE_BEATS * beat) {
      const old = recent.shift();
      laneCount[old.lane]--;
      left -= old.lane < 2 ? 1 : 0;
      total--;
    }

    const nextT = moments[m + 1]?.[0].t ?? Infinity;
    const holdsFirst = [...raw].sort((a, b) => (b.len > 0) - (a.len > 0) || a.lane - b.lane);
    let kept = freeTheHands(holdsFirst, running, nextT, noteGap);

    const lonelyLanes = (mask) => lanesOf(mask).filter((l) => !lanesOf(mask).some((o) => o !== l && handOf(o) === handOf(l)));
    const legal = (mask, holds) => {
      const lanes = lanesOf(mask);
      if (holds > 0 && (lonelyLanes(mask).length < holds || (diff.holdOtherHand === "blocked" && lanes.length > 1))) return false;
      return lanes.every((l) => {
        if (t - laneFree[l] < laneGap || (lastT !== null && jackRun[l] >= maxJack)) return false;
        const note = { t, lane: l };
        const others = [...placed, ...lanes.filter((o) => o !== l).map((lane) => ({ t, lane }))];
        return active.every((h) => !holdBlocks(h, note, diff) && !spacedBlocked(h, note, others, diff, beat / 2));
      });
    };

    // What can be played of this moment: first its taps go, then a last hold becomes a tap.
    let options = [];
    while (kept.length > 0) {
      const holds = kept.filter((n) => n.len > 0).length;
      options = MASKS[kept.length].filter((mask) => legal(mask, holds));
      if (options.length > 0) break;
      if (kept.length > 1) {
        kept = kept.slice(0, -1);
      } else if (kept[0].len > 0) {
        const { len, ...tap } = kept[0];
        kept = [tap];
      } else {
        kept = [];
      }
    }
    if (kept.length === 0) return;

    const size = kept.length;
    const gap = lastT === null ? GAP_LIMITS_MS.length : gapClass(t - lastT);
    const odds = grammarOdds(table, gap, size, history);
    const inUpper = upper?.at.get(t)?.map((n) => n.lane) ?? [];
    const prev = history[history.length - 1];
    const figures = MOTIF_ORDERS.filter((order) => history.length >= order).map((order) => (motifs[history.slice(-order).join(".")] ??= { total: 0 }));
    const trillAfter = (mask) => {
      if (!isSingle(mask) || prev === undefined || !isSingle(prev) || mask === prev) return 1;
      return history[history.length - 2] === mask && t - lastT <= beat ? trill + 1 : 2;
    };
    const weightOf = (mask) => {
      const lanes = lanesOf(mask);
      let w = odds[MASKS[size].indexOf(mask)] + Number.EPSILON;
      w *= Math.exp(-HAND_PULL * Math.abs((left + leftOf(mask) + 2) / (total + size + 4) - 0.5));
      for (const l of lanes) w *= Math.exp(-LANE_PULL * Math.max(0, (laneCount[l] + 1) / (total + 4) - 1 / LANES));
      const run = trillAfter(mask);
      w *= run > TRILL_MAX ? TRILL_OVER : TRILL_HALVING ** Math.max(0, run - TRILL_FREE);
      if (diff.motifPull) for (const seen of figures) w *= 1 + (diff.motifPull * (seen[mask] ?? 0)) / (1 + seen.total);
      if (inUpper.length > 0) w *= 1 + (AGREE * lanes.filter((l) => inUpper.includes(l)).length) / size;
      return w;
    };

    // A repeated phrase that echoes its source plays its source's lanes wherever they can be played here.
    let mask = null;
    const echo = phrases.length > 0 ? echoes[phraseAt] : null;
    if (echo) {
      const from = sourceTime(phrases[phraseAt], timing)(t);
      const at = nearestIndex(times, from);
      if (at >= 0 && Math.abs(times[at] - from) <= SAME_MOMENT_MS) {
        const wanted = echo === "mirror" ? mirrorMask(masksSoFar[at]) : masksSoFar[at];
        if (options.includes(wanted)) mask = wanted;
      }
    }
    mask ??= pick(options, options.map(weightOf), random);

    // A hold takes a lane alone in its hand; the rest take what is left.
    const lanes = lanesOf(mask);
    const lonely = lonelyLanes(mask);
    const holding = kept.filter((n) => n.len > 0);
    const forHolds = [];
    for (let i = 0; i < holding.length; i++) {
      const choice = lonely.splice(Math.floor(random() * lonely.length), 1)[0];
      forHolds.push(choice);
    }
    const forTaps = lanes.filter((l) => !forHolds.includes(l));
    let hold = 0;
    let tap = 0;
    for (const note of kept) {
      const lane = note.len > 0 ? forHolds[hold++] : forTaps[tap++];
      const laid = { ...note, lane };
      out.push(laid);
      placed.push(laid);
      recent.push(laid);
      laneCount[lane]++;
      left += lane < 2 ? 1 : 0;
      total++;
      laneFree[lane] = t + (note.len > 0 ? note.len : 0);
      if (note.len > 0) active.push(laid);
    }
    if (placed.length > RECENT_NOTES) placed.splice(0, placed.length - RECENT_NOTES);
    for (let l = 0; l < LANES; l++) jackRun[l] = lanes.includes(l) ? jackRun[l] + 1 : 0;
    trill = trillAfter(mask);
    for (const seen of figures) {
      seen[mask] = (seen[mask] ?? 0) + 1;
      seen.total++;
    }
    history.push(mask);
    times.push(t);
    masksSoFar.push(mask);
    lastT = t;
  });
  return out.sort(byTime);
}

module.exports = { assignLanes };
