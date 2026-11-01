// Hold notes: a sustained bass/lead event becomes a note with `len` (ms). While a
// hold runs its hand is busy: no note of that hand starts before it ends (plus a
// gap), and depending on the difficulty the other hand is blocked (Easy), spaced
// half a beat apart (Normal) or free (Hard). Taps carry no `len` key at all.
const { FALLBACK_BEAT_MS } = require("./difficulty");

const MAX_HOLD_BEATS = 4;
const HOLD_SOURCES = new Set(["bass", "lead"]); // drum events never become holds

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
// note of that hand (inside the hold) is forbidden. `others` are the notes kept so far.
function spacedBlocked(h, n, others, diff, halfBeatMs) {
  if (diff.holdOtherHand !== "spaced" || !(h.len > 0)) return false;
  if (hand(n.lane) === hand(h.lane) || n.t <= h.t || n.t >= h.t + h.len) return false;
  return others.some((o) => o !== n && o !== h && hand(o.lane) !== hand(h.lane) && o.t > h.t && o.t < n.t && n.t - o.t < halfBeatMs);
}

// The notes (time-sorted) that `spaced` mode forbids inside hold h, simulated in order.
function spacingBlockers(h, notes, diff, halfBeatMs) {
  if (diff.holdOtherHand !== "spaced") return [];
  const out = [];
  let lastKept = -Infinity;
  for (const n of notes) {
    if (hand(n.lane) === hand(h.lane) || n.t <= h.t || n.t >= h.t + h.len) continue;
    if (n.t !== lastKept && n.t - lastKept < halfBeatMs) out.push(n);
    else lastKept = n.t;
  }
  return out;
}

// Would placing `moved` ({t, lane, len?}) clash with a hold in `pool`, or its own
// hold with a note in `pool`?
function holdSafe(moved, pool, diff) {
  return pool.every((o) => !holdBlocks(o, moved, diff) && !holdBlocks(moved, o, diff));
}

// planHolds(items, diff, timing, prev, phraseEndMs) -> items still standing.
// `items` are the phrase's kept notes ({t, lane, level, source, sustainMs?}, time-sorted); an
// eligible one gets `len`. `prev` is the previous phrase's tail (its holds may still run).
//
// How a hold is placed (events are visited in time order):
//   len = min(sustainMs, 4 beats, next note of the same lane - minLaneGapMs - t, phrase end - minLaneGapMs - t),
//   rounded; below holdMinBeats * the local beat the event stays a tap.
//   Notes the hold forbids ("blockers") are handled in this order:
//   1. the hold is clipped to end before the first gap-type blocker, if it stays long enough;
//   2. otherwise, if every blocker has a higher level number than the hold (less important), the blockers are dropped;
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
    const sameLane = later.find((o) => o.lane === c.lane && o.t > c.t);
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
      if (all.every((o) => o.level > c.level)) {
        for (const o of all) dropped.add(o);
      } else {
        continue; // demoted: stays a tap
      }
    }
    c.len = chosen;
  }
  return items.filter((n) => !dropped.has(n));
}

module.exports = { gapAfterHold, holdBlocks, holdSafe, planHolds, spacedBlocked };
