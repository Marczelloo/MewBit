// Hold notes: a sustained bass/lead event becomes a note with `len` (ms). While a
// hold runs its hand is busy: no note of that hand starts before it ends (plus a
// gap), and depending on the difficulty the other hand is blocked (Easy), spaced
// half a beat apart (Normal) or free (Hard). Taps carry no `len` key at all.
const { FALLBACK_BEAT_MS } = require("./difficulty");

const MAX_HOLD_BEATS = 4;
const MAX_HOLD_SHARE = 0.08; // holds are at most this share of a chart's notes: more reads as a held-note chart
const HOLD_SOURCES = new Set(["bass", "lead"]); // drum events never become holds

// A support event backs the leader up: a backbone drum hit under a tonal leader ("secondary"), or an event of a
// support layer in a mixed phrase (patterns.js mixedEvents).
const isSupport = (e) => e.source === "secondary" || e.support === true;

// Does note `o` give way to hold candidate `c`: a support event of another layer, or a less important note of one?
const yields = (o, c) => o.source !== c.source && (isSupport(o) || o.level > c.level);

const hand = (lane) => lane >> 1;
const beatMsOf = (timing, t) => (typeof timing?.beatMsAt === "function" ? timing.beatMsAt(t) : FALLBACK_BEAT_MS);

// Gap a note of `noteLane` must keep after the end of a hold on `holdLane`, or
// null when the hold does not constrain that lane after its start.
function gapAfterHold(holdLane, noteLane, diff) {
  const noteGap = diff.minNoteGapMs ?? 0;
  const laneGap = diff.minLaneGapMs ?? 0;
  if (holdLane === noteLane) return Math.max(noteGap, laneGap);
  if (hand(holdLane) === hand(noteLane) || diff.holdOtherHand === "blocked") return noteGap;
  return null;
}

// Does hold `h` ({t, lane, len}) forbid note `n` (a note starting at or after h.t)?
// Same time: only a chord partner in the other hand, and only where the difficulty
// lets the other hand play over a hold. Later: until the end of the hold plus the gap.
function holdBlocks(h, n, diff) {
  if (!(h.len > 0) || n === h || n.t < h.t) return false;
  if (n.t === h.t) return n.lane === h.lane || hand(n.lane) === hand(h.lane) || diff.holdOtherHand !== "free";
  const gap = gapAfterHold(h.lane, n.lane, diff);
  return gap !== null && n.t < h.t + h.len + gap;
}

// Normal: while a hold runs, a note of the other hand within half a beat of an earlier
// note of that hand (inside the hold), or at the same time as one (a chord would be a
// third key), is forbidden. `others` are the notes kept so far.
function spacedBlocked(h, n, others, diff, halfBeatMs) {
  if (diff.holdOtherHand !== "spaced" || !(h.len > 0)) return false;
  if (hand(n.lane) === hand(h.lane) || n.t <= h.t || n.t >= h.t + h.len) return false;
  return others.some((o) => o !== n && o !== h && hand(o.lane) !== hand(h.lane) && o.t > h.t && o.t <= n.t && n.t - o.t < halfBeatMs);
}

// The notes that `spaced` mode forbids inside hold h, simulated in time order (at one
// time the more important note, lower level, is kept first and so wins).
function spacingBlockers(h, notes, diff, halfBeatMs) {
  const kept = [];
  const out = [];
  for (const n of [...notes].sort((a, b) => a.t - b.t || (a.level ?? 0) - (b.level ?? 0))) {
    if (spacedBlocked(h, n, kept, diff, halfBeatMs)) out.push(n);
    else kept.push(n);
  }
  return out;
}

// Would placing `moved` ({t, lane, len?}) clash with a hold in `pool`, or its own
// hold with a note in `pool`? Normal's half-beat spacing counts too.
function holdSafe(moved, pool, diff, timing = null) {
  const halfBeat = (t) => beatMsOf(timing, t) / 2;
  if (!pool.every((o) => !holdBlocks(o, moved, diff) && !holdBlocks(moved, o, diff))) return false;
  if (pool.some((o) => spacedBlocked(o, moved, pool, diff, halfBeat(o.t)))) return false;
  return !(moved.len > 0) || spacingBlockers(moved, pool, diff, halfBeat(moved.t)).length === 0;
}

// clipHolds(notes, limitMs, diff, timing) -> notes: no hold runs past `limitMs - minLaneGapMs`.
// A hold that gets shorter than its minimum becomes a tap (no `len` key). Taps are untouched.
function clipHolds(notes, limitMs, diff, timing) {
  const laneGap = diff.minLaneGapMs ?? 0;
  return notes.map((n) => {
    if (!(n.len > 0) || n.t + n.len + laneGap <= limitMs) return n;
    const len = Math.round(limitMs - laneGap - n.t);
    if (len > 0 && len >= diff.holdMinBeats * beatMsOf(timing, n.t)) return { ...n, len };
    const tap = { ...n };
    delete tap.len;
    return tap;
  });
}

// limitHoldShare(notes) -> notes: the shortest holds become taps until holds are at most MAX_HOLD_SHARE of the notes.
// A tap is always legal where its hold was (it only frees the time the hold occupied).
function limitHoldShare(notes) {
  const allowed = Math.floor(MAX_HOLD_SHARE * notes.length);
  const holds = notes.filter((n) => n.len > 0);
  if (holds.length <= allowed) return notes;
  const demote = new Set([...holds].sort((a, b) => a.len - b.len || b.t - a.t).slice(0, holds.length - allowed));
  return notes.map((n) => {
    if (!demote.has(n)) return n;
    const tap = { ...n };
    delete tap.len;
    return tap;
  });
}

// planHolds(items, diff, timing, prev, phraseEndMs) -> items still standing.
// `items` are the phrase's kept notes ({t, lane, level, source, sustainMs?}, time-sorted); an
// eligible one gets `len`. `prev` is the previous phrase's tail (its holds may still run).
//
// How a hold is placed (events are visited in time order):
//   len = min(sustainMs, 4 beats, next note of the same lane - minLaneGapMs - t, phrase end - minLaneGapMs - t)
//   (a backbone drum hit, or a less important note of another layer, does not count as that next note: it yields
//   to the hold, see 2.),
//   rounded; below holdMinBeats * the local beat the event stays a tap.
//   Notes the hold forbids ("blockers") are handled in this order:
//   1. the hold is clipped to end before the first gap-type blocker, if it stays long enough;
//   2. otherwise, if every blocker has a higher level number than the hold (less important), or is a backbone drum
//      hit under a tonal leader ("secondary"), the blockers are dropped;
//   3. otherwise the hold is demoted to a tap.
function planHolds(items, diff, timing, prev, phraseEndMs = Infinity) {
  const dropped = new Set();
  const laneGap = diff.minLaneGapMs ?? 0;
  const halfBeat = (t) => beatMsOf(timing, t) / 2;

  // Holds still running from the previous phrase win over everything here.
  const prevHolds = prev.filter((n) => n.len > 0);
  if (prevHolds.length > 0) {
    const kept = [];
    for (const n of items) {
      const others = [...prev, ...kept];
      if (prevHolds.some((h) => holdBlocks(h, n, diff) || spacedBlocked(h, n, others, diff, halfBeat(h.t)))) dropped.add(n);
      else kept.push(n);
    }
  }

  for (let i = 0; i < items.length; i++) {
    const c = items[i];
    if (dropped.has(c) || !HOLD_SOURCES.has(c.source) || !(c.sustainMs > 0)) continue;
    const beat = beatMsOf(timing, c.t);
    const minLen = diff.holdMinBeats * beat;
    if (c.sustainMs < minLen) continue;

    const later = items.filter((o, j) => j !== i && !dropped.has(o) && o.t >= c.t);
    let len = Math.min(c.sustainMs, MAX_HOLD_BEATS * beat, phraseEndMs - laneGap - c.t);
    const sameLane = later.find((o) => o.lane === c.lane && o.t > c.t && !yields(o, c));
    if (sameLane) len = Math.min(len, sameLane.t - laneGap - c.t);
    len = Math.round(len);
    if (!(len > 0 && len >= minLen)) continue;

    const blockersAt = (candidateLen) => {
      const hold = { t: c.t, lane: c.lane, len: candidateLen };
      const direct = later.filter((o) => holdBlocks(hold, o, diff));
      const spaced = spacingBlockers(hold, later.filter((o) => !direct.includes(o)), diff, halfBeat(c.t));
      return { direct, all: [...direct, ...spaced] };
    };

    let chosen = len;
    let { direct, all } = blockersAt(len);
    if (all.length > 0) {
      const gapBlockers = direct.filter((o) => o.t > c.t);
      const clipped = Math.round(Math.min(...gapBlockers.map((o) => o.t - gapAfterHold(c.lane, o.lane, diff) - c.t)));
      if (gapBlockers.length > 0 && clipped > 0 && clipped >= minLen) {
        chosen = clipped;
        ({ direct, all } = blockersAt(chosen));
      }
    }
    if (all.length > 0) {
      if (all.every((o) => o.level > c.level || yields(o, c))) {
        for (const o of all) dropped.add(o);
      } else {
        continue; // demoted: stays a tap
      }
    }
    c.len = chosen;
  }
  return items.filter((n) => !dropped.has(n));
}

module.exports = { beatMsOf, clipHolds, gapAfterHold, holdBlocks, holdSafe, isSupport, limitHoldShare, planHolds, spacedBlocked };
