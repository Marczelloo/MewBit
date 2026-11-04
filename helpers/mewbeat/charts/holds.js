// Hold notes: a sustained bass/lead event becomes a note with `len` (ms). While a
// hold runs its hand is busy: no note of that hand starts before it ends (plus a
// gap), and depending on the difficulty the other hand is blocked (Easy), spaced
// half a beat apart (Normal) or free (Hard). Taps carry no `len` key at all.
// A hold lets go on the chart's next moment, the way a mapper draws one (settleHolds). Where diff.holdRelease is "free"
// (Normal) it lets go with its sound instead, and carries the notes of the other hand under it (underHoldFlagged).
const { BEAT_TOLERANCE_MS, FALLBACK_BEAT_MS } = require("./difficulty");
const { lowerBound, nearestIndex } = require("./util");
const { sustainsOf } = require("./sustains");

const MAX_HOLD_BEATS = 4;
const MAX_HOLD_SHARE = 0.12; // holds are at most this share of a chart's notes: more reads as a held-note chart
const HOLD_SOURCES = new Set(["bass", "lead", "rhythm"]); // drum events never become holds
// addSustainHolds: a long, confident bass/lead note turns the tap charted on its start into a hold.
const SUSTAIN_MIN_BEATS = 1.5;
const SUSTAIN_MIN_CONF = 0.8;
const SUSTAIN_MATCH_MS = 40; // a tap this close to the note's start is the one that holds
const SUSTAIN_DROP_PER_BEAT = 2; // a hold may push out at most this many same-hand taps per beat it runs
// addGapHolds: a tap followed by a rest of the whole chart, while the music keeps sounding, is held through the rest.
const GAP_MAX_BEATS = 2; // a longer rest is a pause, not a held note
const GAP_MIN_ENERGY = 0.3; // the music sounds this loud at the start, middle and end of the hold
const GAP_HOLD_SHARE = 0.1; // holds are brought up to this share of the notes they are placed among
const GAP_SUSTAIN_SHARE = 0.6; // a bass/lead note lasting this much of the rest is what the hold follows
// settleHolds: only a hold this long may run over notes, and only over a sparse other hand.
const LONG_HOLD_BEATS = 1.5;
const LONG_HOLD_NOTES_PER_BEAT = 1;
const EARLY_RELEASE_BEATS = 1 / 4; // letting go before a note of the same hand
const SHORT_HOLD_NOTE_GAPS = 2; // however short the beat, a hold is at least this many of the difficulty's note gaps long

const FREE_SNAP_BEATS = 1 / 4; // a free hold whose sound ends this near a moment lets go on it
// A free hold follows a dragged note (sustains.js), which the tracker dates less exactly than a short one.
const DRAGGED_MATCH_MS = 160; // a note starting this near a tap is the one the tap holds
const BASS_HOLD_BEATS = 1; // a hold follows a bass note this far at most: a drawn-out bass note is mostly the tracker's (14 of 316 long bass-backed holds sat on a stem sound)

// draggedNear(sustains, t, least) -> the dragged note that starts near `t` and lasts at least `least` more (the lead
// before the bass, then the nearest start), or null.
function draggedNear(sustains, t, least) {
  let best = null;
  for (const e of sustains) {
    if (e.t > t + DRAGGED_MATCH_MS) break;
    if (e.t < t - DRAGGED_MATCH_MS || e.t + e.len - t < least) continue;
    if (best === null || (e.source === "lead") > (best.source === "lead") || ((e.source === "lead") === (best.source === "lead") && Math.abs(e.t - t) < Math.abs(best.t - t))) best = e;
  }
  return best;
}

// Where a free hold on `c` follows dragged note `e` to: the whole note of the lead, a beat of the bass's.
const draggedEnd = (e, beat) => (e.source === "lead" ? e.t + e.len : e.t + Math.min(e.len, BASS_HOLD_BEATS * beat));

// A support event backs the leader up: a backbone drum hit under a tonal leader ("secondary"), or an event of a
// support layer in a mixed phrase (patterns.js mixedEvents).
const SPACING_SLACK = 0.9; // a whole-beat spacing is met within this much: a bending grid stretches it
const isSupport = (e) => e.source === "secondary" || e.support === true;

// Does note `o` give way to hold candidate `c`: a support event of another layer, or a less important note of one?
const yields = (o, c) => o.source !== c.source && (isSupport(o) || o.level > c.level);

// What may sit under a hold: the Ranking Criteria for Normal, shared with laneRules.js (normalViolations).
const SHORT_HOLD_CLASS = 0.6; // a hold up to this long (in beats) is a half-beat hold: nothing under it
const BEAT_HOLD_CLASS = 1.1; // ...up to this long a beat hold: nothing faster than a half beat under it

// underHoldFlagged(start, len, under, beatOf) -> the indices of `under` that break the rule. `start` is the hold's time,
// `len` its length, `under` the offsets (ms, ascending) from `start` of the notes strictly inside it, beatOf(t) the beat
// length at t. A half-beat hold carries nothing; a hold of about a beat nothing closer than a half beat to either end or
// to another such note; a longer one anything. A gap is measured against the larger beat of its two ends, as the other
// rules of laneRules.js do: beatOf moves by up to about 8% between neighbouring moments.
function underHoldFlagged(start, len, under, beatOf) {
  const beat = beatOf(start);
  if (len <= SHORT_HOLD_CLASS * beat) return under.map((_, i) => i);
  if (len > BEAT_HOLD_CLASS * beat) return [];
  const marks = [0, ...under, len];
  const flagged = new Set();
  marks.forEach((t, k) => {
    if (k === 0 || t - marks[k - 1] >= Math.max(beatOf(start + marks[k - 1]), beatOf(start + t)) / 2) return;
    for (const at of [k - 1, k]) if (at > 0 && at < marks.length - 1) flagged.add(at - 1);
  });
  return [...flagged].sort((a, b) => a - b);
}

const hand = (lane) => lane >> 1;
const beatMsOf = (timing, t) => (typeof timing?.beatMsAt === "function" ? timing.beatMsAt(t) : FALLBACK_BEAT_MS);

// Gap a note of `noteLane` must keep after the end of a hold on `holdLane`, or
// null when the hold does not constrain that lane after its start.
function gapAfterHold(holdLane, noteLane, diff) {
  const noteGap = diff.minNoteGapMs ?? 0;
  const laneGap = diff.minLaneGapMs ?? 0;
  if (holdLane === noteLane) return Math.max(noteGap, laneGap);
  if (hand(holdLane) === hand(noteLane)) return noteGap;
  return diff.holdOtherHand === "blocked" ? 0 : null; // the other hand presses as the hold lets go
}

// Does hold `h` ({t, lane, len}) forbid note `n` (a note starting at or after h.t)?
// Same time: only a chord partner in the other hand, and only where the difficulty
// lets the other hand play over a hold. Later: until the end of the hold plus the gap.
function holdBlocks(h, n, diff) {
  if (!(h.len > 0) || n === h || n.t < h.t) return false;
  if (n.t === h.t) return n.lane === h.lane || hand(n.lane) === hand(h.lane) || diff.holdOtherHand === "blocked";
  const gap = gapAfterHold(h.lane, n.lane, diff);
  return gap !== null && n.t < h.t + h.len + gap;
}

// Normal: while a hold runs, a note of the other hand within half a beat of an earlier
// note of that hand (inside the hold), or at the same time as one (a chord would be a
// third key), is forbidden. `others` are the notes kept so far.
function spacedBlocked(h, n, others, diff, halfBeatMs) {
  if (diff.holdOtherHand !== "spaced" || diff.holdRelease === "free" || !(h.len > 0)) return false; // free: the rules of underHoldFlagged instead
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

// limitHoldShare(notes, round, preferred) -> notes: the shortest holds become taps until holds are at most
// MAX_HOLD_SHARE of the notes (rounded down by default; a phrase on its own rounds to nearest, so a short one keeps
// its one hold). Holds `preferred(note)` says are real sustains go last. A tap is always legal where its hold was (it
// only frees the time the hold occupied). `share` replaces the cap for a difficulty with its own (diff.maxHoldShare).
function limitHoldShare(notes, round = Math.floor, preferred = () => false, share = MAX_HOLD_SHARE) {
  const allowed = round(share * notes.length);
  const holds = notes.filter((n) => n.len > 0);
  if (holds.length <= allowed) return notes;
  const order = (a, b) => preferred(a) - preferred(b) || a.len - b.len || b.t - a.t;
  const demote = new Set([...holds].sort(order).slice(0, holds.length - allowed));
  return notes.map((n) => {
    if (!demote.has(n)) return n;
    const tap = { ...n };
    delete tap.len;
    return tap;
  });
}

// oneHoldAtATime(notes) -> notes: a hold that starts while an earlier one still runs becomes a tap (time-sorted notes).
function oneHoldAtATime(notes) {
  let heldUntil = -Infinity;
  return notes.map((n) => {
    if (!(n.len > 0)) return n;
    if (n.t > heldUntil) {
      heldUntil = n.t + n.len;
      return n;
    }
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
      const gapBlockers = direct.filter((o) => o.t > c.t && !yields(o, c)); // what gives way does not shorten the hold
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

// addSustainHolds(notes, features, diff, timing, limitMs) -> notes
// Every long (>= diff.sustainMinBeats, by default SUSTAIN_MIN_BEATS), confident bass/lead note whose start has a tap within SUSTAIN_MATCH_MS turns
// that tap into a hold, whichever layer the phrase was charted from: drum-led phrases get their bass sustains too.
//   len = min(sustain, MAX_HOLD_BEATS, next note of the lane - minLaneGapMs, limitMs - minLaneGapMs), rounded.
// Notes the hold forbids are handled like planHolds: the hold is clipped to end before the first one if it stays at
// least holdMinBeats long; otherwise they are dropped when none sits on a downbeat and there are at most
// SUSTAIN_DROP_PER_BEAT per beat of the hold; otherwise the tap stays a tap. Existing holds are kept as they are.
function addSustainHolds(notes, features, diff, timing, limitMs = Infinity) {
  const laneGap = diff.minLaneGapMs ?? 0;
  const out = [...notes].sort((a, b) => a.t - b.t || a.lane - b.lane).map((n) => ({ ...n }));
  const dropped = new Set();
  const times = out.map((n) => n.t);
  const sustains = [];
  const free = diff.holdRelease === "free";
  for (const layer of free ? [] : HOLD_SOURCES) {
    for (const e of Array.isArray(features?.[layer]) ? features[layer] : []) {
      if (Number.isFinite(e?.t) && Number(e.conf) >= SUSTAIN_MIN_CONF && Number(e.len) >= (diff.sustainMinBeats ?? SUSTAIN_MIN_BEATS) * beatMsOf(timing, e.t)) sustains.push(e);
    }
  }
  // A free hold follows the dragged notes (sustains.js), whatever the tracker is sure of, lead first.
  if (free) sustains.push(...sustainsOf(features, timing).filter((e) => e.len >= (diff.sustainMinBeats ?? SUSTAIN_MIN_BEATS) * beatMsOf(timing, e.t)));
  sustains.sort((a, b) => a.t - b.t || (a.source === "lead" ? 0 : 1) - (b.source === "lead" ? 0 : 1) || b.len - a.len);
  const isDownbeat = (t) => (timing?.downbeats ?? []).some((d) => Math.abs(d - t) <= 1);

  for (const e of sustains) {
    const i = nearestIndex(times, e.t);
    if (i < 0 || Math.abs(times[i] - e.t) > (free ? DRAGGED_MATCH_MS : SUSTAIN_MATCH_MS)) continue;
    const at = out.filter((n) => n.t === times[i] && !dropped.has(n));
    if (at.some((n) => n.len > 0)) continue;
    // A chord's note in a hand of its own, so the other note stays playable.
    const c = at.find((n) => !at.some((o) => o !== n && hand(o.lane) === hand(n.lane)));
    if (!c) continue;
    const beat = beatMsOf(timing, c.t);
    const minLen = diff.holdMinBeats * beat;
    if (free) {
      // The lanes are placeholders yet and the hold lets go with the sound: notes under it are the other hand's (lanes.js),
      // and settleHolds fits its end to the moments and the rules of what sits under it. Nothing is dropped.
      const len = Math.round(Math.min(draggedEnd(e, beat) - c.t, MAX_HOLD_BEATS * beat, limitMs - laneGap - c.t));
      if (len >= minLen) c.len = len;
      continue;
    }
    const later = out.filter((o) => !dropped.has(o) && o.t > c.t && o.t < c.t + MAX_HOLD_BEATS * beat + laneGap + (diff.minNoteGapMs ?? 0));
    let len = Math.min(e.len, MAX_HOLD_BEATS * beat, limitMs - laneGap - c.t);
    const sameLane = later.find((o) => o.lane === c.lane);
    if (sameLane) len = Math.min(len, sameLane.t - laneGap - c.t);
    len = Math.round(len);
    if (!(len >= minLen)) continue;

    // Earlier holds still running must allow it, as must the notes it would run over.
    const earlier = out.filter((o) => !dropped.has(o) && o.len > 0 && o.t < c.t);
    if (earlier.some((h) => holdBlocks(h, { ...c, len }, diff))) continue;
    const blockersAt = (l) => {
      const hold = { t: c.t, lane: c.lane, len: l };
      const pool = later.filter((o) => o.t > c.t);
      const direct = pool.filter((o) => holdBlocks(hold, o, diff));
      return [...direct, ...spacingBlockers(hold, pool.filter((o) => !direct.includes(o)), diff, beat / 2)];
    };
    let blockers = blockersAt(len);
    if (blockers.length > 0) {
      const first = Math.min(...blockers.map((o) => o.t));
      const gap = Math.max(gapAfterHold(c.lane, blockers.find((o) => o.t === first).lane, diff) ?? 0, 0);
      const clipped = Math.round(first - gap - c.t);
      if (clipped >= minLen) {
        len = clipped;
        blockers = blockersAt(len);
      }
    }
    if (blockers.length > 0) {
      const allowed = Math.floor(SUSTAIN_DROP_PER_BEAT * (len / beat));
      if (blockers.length > allowed || blockers.some((o) => isDownbeat(o.t) || o.len > 0)) continue;
      for (const o of blockers) dropped.add(o);
    }
    c.len = len;
  }
  return out.filter((n) => !dropped.has(n));
}

// The chart's moments, in time, with their notes: what a hold lets go on.
function momentsOf(notes) {
  const at = new Map();
  for (const n of notes) {
    if (at.has(n.t)) at.get(n.t).push(n);
    else at.set(n.t, [n]);
  }
  return { at, times: [...at.keys()].sort((a, b) => a - b) };
}

// The shortest hold of a difficulty at this tempo: Hard's may be half a beat, but never only a flick of the finger.
const shortestHold = (diff, beat) => Math.max((diff.restHoldBeats ?? diff.holdMinBeats) * beat * SPACING_SLACK, SHORT_HOLD_NOTE_GAPS * (diff.minNoteGapMs ?? 0));

// May `note` go to `lane`: its gaps on that lane kept before and after, no hold in the way? `holder` is about to let go.
function laneFits(note, lane, notes, diff, timing, holder) {
  const beat = beatMsOf(timing, note.t);
  const gap = Math.max(diff.minLaneGapMs ?? 0, (diff.laneGapBeats ?? 0) * beat * SPACING_SLACK);
  const pool = notes.filter((o) => o !== note && o !== holder);
  const clear = pool.every((o) => o.lane !== lane || (o.t >= note.t ? o.t - note.t >= gap && o.t !== note.t : note.t - (o.t + (o.len > 0 ? o.len : 0)) >= gap));
  return clear && holdSafe({ t: note.t, lane }, pool.filter((o) => Math.abs(o.t - note.t) <= MAX_HOLD_BEATS * beat), diff, timing);
}

// How hold `h` lets go on moment `t`: { len, move }. Nothing of its own hand there: right on it. A single tap of its
// hand there goes to the other hand (`move`) if it fits; otherwise the hold lets go a quarter of a beat earlier,
// which leaves the hand time for the next key.
function letGo(h, t, moments, notes, diff, timing) {
  const here = moments.at.get(t);
  const same = here.filter((n) => hand(n.lane) === hand(h.lane));
  if (same.length === 0) return { len: t - h.t, move: null };
  if (same.length === 1 && !(same[0].len > 0)) {
    const note = same[0];
    const mirror = 3 - note.lane;
    const lane = [mirror, mirror ^ 1].find((l) => !here.some((n) => n.lane === l) && laneFits(note, l, notes, diff, timing, h));
    if (lane !== undefined) return { len: t - h.t, move: { note, lane } };
  }
  const gap = Math.max(EARLY_RELEASE_BEATS * beatMsOf(timing, t), diff.minNoteGapMs ?? 0, same.some((n) => n.lane === h.lane) ? diff.minLaneGapMs ?? 0 : 0);
  return { len: t - gap - h.t, move: null };
}

// The moment a long hold lets go on while running over a sparse other hand, or null when it should not run over
// anything: the one nearest its own end, at least LONG_HOLD_BEATS on, with no note of its own hand before it.
function longRelease(h, moments, diff, timing) {
  const beat = beatMsOf(timing, h.t);
  const least = LONG_HOLD_BEATS * beat * SPACING_SLACK;
  if (diff.holdOtherHand === "blocked" || h.len < least) return null;
  const from = lowerBound(moments.times, h.t + 1);
  const end = h.t + h.len;
  let best = null;
  for (let i = from; i < moments.times.length; i++) {
    const t = moments.times[i];
    if (t - h.t > MAX_HOLD_BEATS * beat) break;
    if (t - h.t >= least && (best === null || Math.abs(t - end) < Math.abs(best - end))) best = t;
    if (moments.at.get(t).some((n) => hand(n.lane) === hand(h.lane))) break;
  }
  if (best === null) return null;
  const over = lowerBound(moments.times, best) - from;
  return over <= LONG_HOLD_NOTES_PER_BEAT * ((best - h.t) / beat) ? best : null;
}

// A hold with no moment in reach ends where its sound does, on the half-beat grid.
function onGridLen(h, diff, timing, limitMs) {
  const last = limitMs - (diff.minLaneGapMs ?? 0);
  const end = Math.min(h.t + h.len, h.t + MAX_HOLD_BEATS * beatMsOf(timing, h.t), last);
  const grid = typeof timing?.gridPoints === "function" ? timing.gridPoints(2) : [];
  const i = nearestIndex(grid, end);
  return i >= 0 && grid[i] > h.t && grid[i] <= last ? grid[i] - h.t : Math.round(end - h.t);
}

// Where a free hold (diff.holdRelease "free") lets go, as a length (0: it stays a tap). The sound's end is where it
// would: on a moment within FREE_SNAP_BEATS of it, else on the grid, and never past the song or MAX_HOLD_BEATS. Then the
// rules of what sits under it (underHoldFlagged) shorten it to an earlier moment until they hold: a hold of about a
// beat cannot run over a note closer than a half beat to it. `ends` are those of the holds already running: one more
// takes the other hand, and no moment can sit under both (it would have no hand to play it).
function freeLength(h, moments, ends, diff, timing, limitMs) {
  const beat = beatMsOf(timing, h.t);
  const noteGap = diff.minNoteGapMs ?? 0;
  const last = limitMs - (diff.minLaneGapMs ?? 0);
  const shortest = shortestHold(diff, beat);
  const sound = Math.min(h.t + h.len, h.t + MAX_HOLD_BEATS * beat, last);
  const running = ends.filter((e) => e > h.t);
  if (running.length >= 2) return 0;

  const near = moments.times[nearestIndex(moments.times, sound)];
  let end = near !== undefined && near > h.t && near <= last && Math.abs(near - sound) <= FREE_SNAP_BEATS * beat ? near : h.t + onGridLen({ t: h.t, len: sound - h.t }, diff, timing, limitMs);
  for (;;) {
    if (end - h.t < shortest) return 0;
    const inside = moments.times.slice(lowerBound(moments.times, h.t + 1), lowerBound(moments.times, end));
    if (underHoldFlagged(h.t, end - h.t, inside.map((t) => t - h.t), (at) => beatMsOf(timing, at)).length === 0) {
      if (running.length > 0 && moments.times.some((t) => t > h.t && t < Math.min(end, ...running) + noteGap)) return 0;
      return end - h.t;
    }
    if (inside.length === 0) return 0;
    end = inside[inside.length - 1];
  }
}

// settleHolds for a level whose holds are free: each lets go as freeLength says, in the order they start.
function settleFree(out, moments, diff, timing, limitMs) {
  const ends = [];
  for (const h of out) {
    if (!(h.len > 0)) continue;
    const len = freeLength(h, moments, ends, diff, timing, limitMs);
    if (len > 0) {
      h.len = Math.round(len);
      ends.push(h.t + h.len);
    } else {
      delete h.len;
    }
  }
  return out;
}

// settleHolds(notes, diff, timing, limitMs) -> notes: a hold lets go on the next moment of the chart, whichever hand
// plays it, and stays empty. Only a long one of Normal or Hard (a real sustain) may run on, over a sparse other hand.
// A next moment too near makes it a tap. No moment within MAX_HOLD_BEATS: it keeps its length, put on the grid.
function settleHolds(notes, diff, timing, limitMs = Infinity) {
  const out = [...notes].sort((a, b) => a.t - b.t || a.lane - b.lane).map((n) => ({ ...n }));
  const moments = momentsOf(out);
  if (diff.holdRelease === "free") return settleFree(out, moments, diff, timing, limitMs);
  for (const h of out) {
    if (!(h.len > 0)) continue;
    const beat = beatMsOf(timing, h.t);
    const next = moments.times[lowerBound(moments.times, h.t + 1)];
    const free = next === undefined || next - h.t > MAX_HOLD_BEATS * beat;
    const { len, move } = free
      ? { len: onGridLen(h, diff, timing, limitMs), move: null }
      : letGo(h, longRelease(h, moments, diff, timing) ?? next, moments, out, diff, timing);
    if (len < shortestHold(diff, beat)) {
      delete h.len;
      continue;
    }
    h.len = Math.round(len);
    if (move) move.note.lane = move.lane;
  }
  return out;
}

// addGapHolds(notes, features, diff, timing, energy, limitMs, fromMs) -> notes: most songs have few long notes the pitch
// tracker can see (a supersaw or a pad under the drums is not one), so a tap followed by a rest of the whole chart,
// while the music keeps sounding, is held until the next moment (letGo). From `fromMs` on (the notes before it are
// context: their holds may still run) holds are brought up to diff.gapHoldShare of the notes: first where a long note
// of the bass or lead starts, then on the beat, then the longest rests. Nothing is dropped: a hold that would forbid a
// note stays a tap.
function addGapHolds(notes, features, diff, timing, energy, limitMs = Infinity, fromMs = -Infinity) {
  const out = [...notes].sort((a, b) => a.t - b.t || a.lane - b.lane).map((n) => ({ ...n }));
  const own = out.filter((n) => n.t >= fromMs);
  let budget = Math.round((diff.gapHoldShare ?? GAP_HOLD_SHARE) * own.length) - own.filter((n) => n.len > 0).length;
  if (budget <= 0) return out;
  const moments = momentsOf(out);
  const loud = (t) => (typeof energy?.at === "function" ? energy.at(t) : 1) >= GAP_MIN_ENERGY;
  const sustains = [...HOLD_SOURCES].flatMap((layer) => (Array.isArray(features?.[layer]) ? features[layer] : [])).filter((e) => Number.isFinite(e?.t) && Number(e.len) > 0).sort((x, y) => x.t - y.t);
  const sustainTimes = sustains.map((e) => e.t);
  const sustained = (t, rest) => {
    for (let i = lowerBound(sustainTimes, t - SUSTAIN_MATCH_MS); i < sustains.length && sustains[i].t <= t + SUSTAIN_MATCH_MS; i++) {
      if (sustains[i].len >= GAP_SUSTAIN_SHARE * rest) return 1;
    }
    return 0;
  };
  // A free hold (diff.holdRelease) follows the sound it starts with: its length, not the rest. (The sustain to read it from.)
  const free = diff.holdRelease === "free";
  const dragged = free ? sustainsOf(features, timing) : [];
  const beats = timing?.beats ?? [];
  const onBeat = (t) => {
    const i = nearestIndex(beats, t);
    return i >= 0 && Math.abs(beats[i] - t) <= BEAT_TOLERANCE_MS ? 1 : 0;
  };
  const candidates = [];
  for (const c of own) {
    if (c.len > 0) continue;
    if (moments.at.get(c.t).some((o) => o !== c && (o.len > 0 || (!free && (hand(o.lane) === hand(c.lane) || diff.holdOtherHand === "blocked"))))) continue;
    const beat = beatMsOf(timing, c.t);
    const next = moments.times[lowerBound(moments.times, c.t + 1)];
    if (next === undefined || next > limitMs) continue;
    const rest = next - c.t;
    if (rest < shortestHold(diff, beat) || rest > (GAP_MAX_BEATS * beat) / SPACING_SLACK) continue;
    if (![c.t, c.t + rest / 2, next].every(loud)) continue;
    const sound = free ? draggedNear(dragged, c.t, GAP_SUSTAIN_SHARE * rest) : null;
    candidates.push({ c, next, rest, rank: 2 * (free ? +(sound !== null) : sustained(c.t, rest)) + onBeat(c.t), sound });
  }
  candidates.sort((x, y) => y.rank - x.rank || y.rest - x.rest || x.c.t - y.c.t || x.c.lane - y.c.lane);
  for (const { c, next, sound } of candidates) {
    if (budget <= 0) break;
    const beat = beatMsOf(timing, c.t);
    if (free) {
      // The lanes are placeholders yet: settleHolds fits the end, lanes.js the hands. A tap is a hold where it can be one.
      // It lets go with the dragged note it starts; with none, at the next moment.
      const len = Math.round(Math.min(sound ? draggedEnd(sound, beat) - c.t : next - c.t, MAX_HOLD_BEATS * beat, limitMs - (diff.minLaneGapMs ?? 0) - c.t));
      if (len < shortestHold(diff, beat)) continue;
      c.len = len;
      if (!sound) c.gapHold = true; // a hold on a dragged note is a sustain: the share cap keeps it before the gap holds
      budget--;
      continue;
    }
    const { len, move } = letGo(c, next, moments, out, diff, timing);
    if (len < shortestHold(diff, beat)) continue;
    const reach = MAX_HOLD_BEATS * beat;
    const pool = out
      .filter((o) => o !== c && o.t + (o.len > 0 ? o.len : 0) >= c.t - reach && o.t <= c.t + len + reach)
      .map((o) => (o === move?.note ? { ...o, lane: move.lane } : o));
    if (!holdSafe({ t: c.t, lane: c.lane, len: Math.round(len) }, pool, diff, timing)) continue;
    c.len = Math.round(len);
    c.gapHold = true; // generate.js tells these from sustains, then drops the mark
    if (move) move.note.lane = move.lane;
    budget--;
  }
  return out;
}

module.exports = { SHORT_HOLD_CLASS, addGapHolds, addSustainHolds, beatMsOf, clipHolds, gapAfterHold, holdBlocks, holdSafe, isSupport, limitHoldShare, oneHoldAtATime, planHolds, settleHolds, spacedBlocked, underHoldFlagged };
