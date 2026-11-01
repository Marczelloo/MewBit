// Easy and Normal are Hard thinned out: Hard's notes on Hard's lanes, fewer of them. Hard follows the whole music
// (every layer, its own lane logic), so the lower difficulties keep its patterns instead of charting the song again
// from a narrower view. Per phrase, Hard's notes are ranked by where they sit on the beat grid (beat, half, quarter,
// finer; a downbeat, a Hard chord and a hold rank higher) and the best are kept within the difficulty's gaps and
// density cap, so a quiet passage keeps its beats and a loud one fills in towards the halves and quarters.
const { DENSITY_WINDOW_MS } = require("./difficulty");
const { beatMsOf, gapAfterHold, holdBlocks, holdSafe, limitHoldShare, spacedBlocked } = require("./holds");
const { repeatBars } = require("./barRepeats");
const { enforceFloors, limitJacks, pulsePowerFloor, selectByFloors } = require("./difficultyFilter");
const { gridSlot } = require("./grid");

const LEVEL_BEAT = 0;
const LEVEL_HALF = 1;
const LEVEL_QUARTER = 2;
const LEVEL_FINE = 3;
const DOWNBEAT_MS = 1; // a note this close to a downbeat is on it

const byTime = (a, b) => a.t - b.t || a.lane - b.lane;
const hand = (lane) => lane >> 1;

// Grid level of time t; without a beat grid every note is a half-beat note (nothing to rank them by).
function levelOf(timing, t) {
  if (!timing?.snapped) return LEVEL_HALF;
  const slot = gridSlot(timing, t);
  if (!slot) return LEVEL_HALF; // off the grid (a raw onset where the beats are missing): playable, not preferred
  return slot.beat ? LEVEL_BEAT : slot.half ? LEVEL_HALF : slot.quarter ? LEVEL_QUARTER : LEVEL_FINE;
}

// Hard's notes of one phrase as ranked items: { t, lane, len?, level, s }. Per Hard moment at most one note, or two
// where the difficulty allows a chord there; a hold is kept first, then a lane the previous moment did not use.
function rankedItems(notes, diff, timing, energy, phraseEnergy, lastLanes) {
  const downbeats = timing?.downbeats ?? [];
  const onDownbeat = (t) => downbeats.some((d) => Math.abs(d - t) <= DOWNBEAT_MS);
  const items = [];
  let previous = new Set(lastLanes);
  for (let i = 0; i < notes.length; ) {
    let j = i;
    while (j < notes.length && notes[j].t === notes[i].t) j++;
    const moment = notes.slice(i, j);
    const t = moment[0].t;
    i = j;

    let level = levelOf(timing, t);
    if (level > diff.deriveMaxLevel) continue;
    // Normal's quarter-beat notes only in a loud phrase, as when it charted the song itself.
    if (level === LEVEL_QUARTER && diff.quarterMinEnergy > 0 && (phraseEnergy ?? energy.at(t)) < diff.quarterMinEnergy) continue;
    const downbeat = onDownbeat(t);
    const chord = diff.chord && (!diff.chord.onDownbeat || downbeat) && energy.at(t) >= diff.chord.minEnergy ? 2 : 1;
    const ordered = [...moment].sort((a, b) => (b.len > 0) - (a.len > 0) || previous.has(a.lane) - previous.has(b.lane) || a.lane - b.lane);
    const kept = [];
    for (const n of ordered) {
      if (kept.length < chord && !kept.some((k) => hand(k.lane) === hand(n.lane))) kept.push(n);
    }
    const s = (downbeat ? 1 : 0.5) + (moment.length > 1 ? 0.25 : 0);
    for (const n of kept) items.push({ ...n, level: n.len > 0 ? LEVEL_BEAT : level, s: s + (n.len > 0 ? 1 : 0) });
    previous = new Set(kept.map((n) => n.lane));
  }
  return items;
}

// A hold that would run over a later kept note ends before it when it stays at least holdMinBeats long; otherwise
// the hold stands and the final floors drop that note.
function fitHolds(notes, diff, timing) {
  const out = notes.map((n) => ({ ...n }));
  for (const h of out) {
    if (!(h.len > 0)) continue;
    const beat = beatMsOf(timing, h.t);
    const blocker = out.find((o) => o.t > h.t && (holdBlocks(h, o, diff) || spacedBlocked(h, o, out, diff, beat / 2)));
    if (!blocker) continue;
    const gap = gapAfterHold(h.lane, blocker.lane, diff) ?? (beat / 2);
    const clipped = Math.round(blocker.t - gap - h.t);
    if (clipped >= diff.holdMinBeats * beat) h.len = clipped;
  }
  return out;
}

// A repeat is copied as its source played, so a same-lane run across the seam into it is fixed on this side: the
// last note of the phrase before it moves to a lane that neither continues the run into the copy's first notes nor
// makes one with the notes before it (within the floors and hold rules), when there is such a lane. A drum hit keeps
// its lane role (kicks outside, snares inside).
function clearSeam(notes, nextLanes, diff, timing, drumHit) {
  if (notes.length === 0 || nextLanes.length === 0) return;
  const maxJack = diff.maxJack ?? 4;
  const times = [...new Set(notes.map((n) => n.t))].sort((a, b) => a - b);
  const lanesAt = (t) => new Set(notes.filter((n) => n.t === t).map((n) => n.lane));
  const runOf = (lane, upto) => {
    let run = 0;
    for (let k = upto; k >= 0 && lanesAt(times[k]).has(lane); k--) run++;
    return run;
  };
  const lastIndex = times.length - 1;
  const last = notes.filter((n) => n.t === times[lastIndex]);
  const laneGap = diff.minLaneGapMs ?? 0;
  for (const n of last) {
    if (n.len > 0 || !nextLanes.includes(n.lane) || runOf(n.lane, lastIndex) + 1 <= maxJack) continue;
    const taken = new Set(last.map((m) => m.lane));
    const pool = notes.filter((m) => m !== n);
    const outer = (l) => l === 0 || l === 3;
    const lane = [0, 1, 2, 3].find((l) =>
      (!drumHit(n) || outer(l) === outer(n.lane)) && !taken.has(l) && !nextLanes.includes(l) && runOf(l, lastIndex - 1) + 1 <= maxJack &&
      pool.every((m) => m.lane !== l || Math.abs(m.t + (m.len > 0 ? m.len : 0) - n.t) >= laneGap) &&
      holdSafe({ t: n.t, lane: l }, pool, diff, timing));
    if (lane !== undefined) n.lane = lane;
  }
}

const strip = (n) => (n.len > 0 ? { t: n.t, lane: n.lane, len: n.len } : { t: n.t, lane: n.lane });

// deriveNotes(ctx, hardNotes, diff, { copyRepeat, steadyPulse }) -> notes ({ t, lane, len? }, time-ordered)
// `ctx` is generate.js's analysis (phrases, timing, energy). `copyRepeat(all, i)` returns the notes of phrase i copied
// from its source in `all` (the derived notes so far), or null when it is not a repeat or the copy failed.
// `steadyPulse(i)` says whether phrase i gets the difficulty's pulse density floor; `sustained(note)` whether a hold is
// one of Hard's real sustains (kept before its gap holds when a phrase has too many); `drumHit(note)` whether a note is a
// drum hit (a jack moves it within its lane role: kicks outside, snares inside).
function deriveNotes(ctx, hardNotes, diff, { copyRepeat, steadyPulse, sustained = () => false, drumHit = () => false }) {
  const { phrases, timing, energy } = ctx;
  const hard = [...hardNotes].sort(byTime);
  const all = [];
  let from = 0;
  for (let i = 0; i < phrases.length; i++) {
    const phrase = phrases[i];
    const end = i === phrases.length - 1 ? Infinity : phrase.endMs;
    let to = from;
    while (to < hard.length && hard[to].t < end) to++;
    const source = hard.slice(from, to).filter((n) => n.t >= phrase.startMs);
    from = to;

    const copied = copyRepeat(all, i);
    if (copied) {
      all.push(...copied);
      continue;
    }
    const tail = all.filter((n) => n.t >= phrase.startMs - DENSITY_WINDOW_MS || n.t + (n.len ?? 0) >= phrase.startMs - DENSITY_WINDOW_MS);
    const lastLanes = all.length > 0 ? all.filter((n) => n.t === all[all.length - 1].t).map((n) => n.lane) : [];
    const items = rankedItems(source, diff, timing, energy, phrase.energy, lastLanes);
    const powerFloor = steadyPulse(i) ? pulsePowerFloor(diff, timing) : 0;
    // Thinning leaves same-lane runs Hard did not have; the phrase is finished here, so a repeat copies it as played.
    // A bar that plays like one before it (on Hard's moments) is charted like it, so a groove keeps its pattern.
    const selected = repeatBars(selectByFloors(items, diff, energy, tail, powerFloor).map(strip), source, timing, { fromMs: phrase.startMs, toMs: end });
    // The notes a hold still blocks go before the jack check, so dropping them later cannot join two runs into a jack.
    const kept = enforceFloors([...tail, ...fitHolds(selected, diff, timing)], diff, timing).filter((n) => n.t >= phrase.startMs);
    // Hard's holds are kept first, so a thinned phrase would be mostly holds: its share is capped here, per phrase.
    const tagged = kept.map((n) => (drumHit(n) ? { ...n, source: "drums" } : n));
    const done = limitHoldShare(limitJacks(tagged, diff, tail, { strict: true, timing }).sort(byTime), Math.round, sustained).map(strip);
    all.push(...done);
    const next = i + 1 < phrases.length ? copyRepeat(all, i + 1) : null;
    if (next && next.length > 0) {
      const first = Math.min(...next.map((n) => n.t));
      clearSeam(done, next.filter((n) => n.t === first).map((n) => n.lane), diff, timing, drumHit);
    }
  }
  return all.sort(byTime);
}

module.exports = { deriveNotes, levelOf };
