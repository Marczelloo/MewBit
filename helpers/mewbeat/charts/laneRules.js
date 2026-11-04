// What Normal's lanes answer to: the direction of the melody a moment plays (melodyDirection), and the rules of the
// Ranking Criteria a Normal chart keeps (normalViolations). The pattern reference is mapping-analysis/shared/mania-patterns.md.
const { beatMsOf } = require("./holds");
const { groupByTime } = require("./difficultyFilter");
const { lowerBound, nearestIndex } = require("./util");

// --- the melody ----------------------------------------------------------------------------------------------

const LINE_CONF = 0.6; // a lead or bass note this sure counts as the melody
const MATCH_MS = 70; // a moment plays the line's note this close (moments sit on the grid, up to 35 ms off the sound)
const PREVIOUS_MS = 2000; // the note before it must be this near: after a longer rest there is no direction to speak of
const SAME_SEMITONES = 0.5; // a step this small is the same pitch, ...
const MOVED_SEMITONES = 1; // ...this large a different one; in between the line is not sure
const CLUSTER_MS = 40; // onsets this close are one sound
const SOUND_STRENGTH = 0.5; // the onsets of a sound add up to at least this much, or it is not heard
const SAME_BAND = 0.25; // the centre of two sounds this close (in bands, 0 low to 3 high) is the same
const MOVED_BANDS = 0.75; // ...this far apart, one is higher

const lines = new WeakMap();
function linesOf(features) {
  if (!lines.has(features)) {
    const tonal = (line) =>
      (Array.isArray(line) ? line : []).filter((n) => Number.isFinite(n?.t) && Number.isFinite(n.pitch) && Number(n.conf) >= LINE_CONF).sort((a, b) => a.t - b.t);
    const sounds = (Array.isArray(features.bands) ? features.bands : [])
      .flatMap((band, b) => (Array.isArray(band?.onsets) ? band.onsets : []).filter((o) => Number.isFinite(o?.t)).map((o) => ({ t: o.t, s: Number.isFinite(o.s) ? o.s : 0.5, band: b })))
      .sort((a, b) => a.t - b.t);
    const lead = tonal(features.lead);
    const bass = tonal(features.bass);
    lines.set(features, { tonal: [lead, bass].map((line) => ({ line, times: line.map((n) => n.t) })), sounds, soundTimes: sounds.map((o) => o.t) });
  }
  return lines.get(features);
}

// 1 / -1 / 0 when the line moves up / down / stays; null when it cannot tell. undefined: the line plays nothing here.
function lineDirection({ line, times }, t) {
  const at = nearestIndex(times, t);
  if (at < 0 || Math.abs(times[at] - t) > MATCH_MS) return undefined;
  const before = line[at - 1];
  if (!before || line[at].t - before.t > PREVIOUS_MS) return null;
  const step = line[at].pitch - before.pitch;
  if (Math.abs(step) <= SAME_SEMITONES) return 0;
  return Math.abs(step) >= MOVED_SEMITONES ? Math.sign(step) : null;
}

// Where the bands sound around t, strongest-weighted: 0 (low) to 3 (high), or null when nothing is heard.
function centreAt({ sounds, soundTimes }, t) {
  let weight = 0;
  let sum = 0;
  for (let i = lowerBound(soundTimes, t - CLUSTER_MS); i < sounds.length && soundTimes[i] <= t + CLUSTER_MS; i++) {
    weight += sounds[i].s;
    sum += sounds[i].s * sounds[i].band;
  }
  return weight >= SOUND_STRENGTH ? sum / weight : null;
}

// melodyDirection(ctx, t) -> 1 | -1 | 0 | null
// Where the sound a moment plays at t goes from the sound before it: 1 higher, -1 lower, 0 the same (a repeated sound).
// The lead line says so when it is sure of its notes, then the bass line; failing both, where the bands sound
// (the centre of their onsets, low to high). null when none of them is sure. A line that plays a note here but is not sure
// of its step (between 0.5 and 1 semitone, or after a rest of over 2 s) answers null itself: bass and bands are not tried.
function melodyDirection(ctx, t) {
  const features = ctx?.features;
  if (!features) return null;
  const heard = linesOf(features);
  for (const line of heard.tonal) {
    const direction = lineDirection(line, t);
    if (direction !== undefined) return direction;
  }
  const now = centreAt(heard, t);
  const at = lowerBound(heard.soundTimes, t - CLUSTER_MS) - 1;
  if (now === null || at < 0 || t - heard.soundTimes[at] > PREVIOUS_MS) return null;
  const before = centreAt(heard, heard.soundTimes[at]);
  if (before === null) return null;
  const move = now - before;
  if (Math.abs(move) <= SAME_BAND) return 0;
  return Math.abs(move) >= MOVED_BANDS ? Math.sign(move) : null;
}

// --- the figures the melody asks for ---------------------------------------------------------------------------

const STEP_PULL = 12; // the lane next to the last one, on the side the melody goes
const SIDE_PULL = 3; // any lane on that side
const WRONG_SIDE = 0.25; // a lane on the other side, or the same one
const JACK_PULL = 6; // a repeated sound slow enough for a jack keeps its lane
const JACK_BEATS = 1 / 2; // ...at least this far from the last one (and TRILL_MIN_MS)
const TRILL_MIN_MS = 250;
const WIDE_STEP_BEATS = 0.9; // a leap across the keys needs about a beat
const TOWARD_CENTRE = [1, 2, 1, 2];

// How much more likely a single note on `lane` is for a melody going `direction` after a note on `prev` (and `before`
// it): a rising run climbs a lane per note, a falling one comes down, a repeated sound is a jack when slow and a
// trill when fast. 1 where there is no direction or the last moment was a chord (prev null).
function melodyPull(direction, lane, prev, before, gapMs, beatMs) {
  if (direction === null || prev === null) return 1;
  if (direction === 0) {
    if (gapMs >= Math.max(JACK_BEATS * beatMs, TRILL_MIN_MS) * 0.98) return lane === prev ? JACK_PULL : 1;
    const partner = before !== null && before !== prev ? before : TOWARD_CENTRE[prev];
    return lane === partner ? STEP_PULL : lane === prev ? WRONG_SIDE : 1;
  }
  const step = prev + direction;
  if (step >= 0 && step < 4) {
    if (lane === step) return STEP_PULL;
    return direction * (lane - prev) > 0 ? SIDE_PULL : WRONG_SIDE;
  }
  // At the edge a run starts over: from the far end when there is a beat for the leap, else from the near one.
  const wide = gapMs >= WIDE_STEP_BEATS * beatMs;
  const restart = direction > 0 ? (wide ? 0 : 1) : wide ? 3 : 2;
  return lane === restart ? STEP_PULL : lane === prev ? WRONG_SIDE : 1;
}

// --- the rules -----------------------------------------------------------------------------------------------

// A gap is measured against the larger beat of its two ends: beatMsAt moves by up to about 8% between neighbouring moments,
// so a gap of a true half or quarter beat can read longer than that against the beat of the moment it ends at.
const QUARTER_BEATS = 0.3; // a gap this short is a quarter beat (1/6 and faster included); a triplet third (.33) is not
const MAX_QUARTER_GAPS = 5;
const MAX_CHORD = 2;
const STREAM_BEATS = 0.56; // notes this close are a stream, which an anchor lives in: a half beat plus 12% (an 8% tempo step and the rounding), well under a triplet third (.67)
const MAX_ANCHOR = 2;
const SHORT_HOLD_BEATS = 0.5; // the shortest hold
const SHORT_HOLD_CLASS = 0.6; // a hold up to this long is a half-beat hold: nothing under it
const BEAT_HOLD_CLASS = 1.1; // ...up to this long a beat hold: nothing faster than a half beat under it
const SLACK = 0.98; // a length is met within this much: the grid rounds, and a bending grid stretches
const TAIL = 8; // the moments the lane rules look back on

const sameLanes = (a, b) => a.length === b.length && a.every((l, i) => l === b[i]);
const hopBeat = (beatOf, a, b) => Math.max(beatOf(a.t), beatOf(b.t));

// The rules a moment breaks that lanes decide, from `tail`: the moments before it and itself last ({ t, lanes }, lanes
// ascending, TAIL of them are enough). [{ rule, lane }]
function momentRules(tail, beatOf) {
  const out = [];
  const moment = tail[tail.length - 1];
  if (moment.lanes.length > MAX_CHORD) out.push({ rule: "chord", lane: moment.lanes[MAX_CHORD] });

  let quarters = 0;
  for (let k = tail.length - 1; k > 0 && tail[k].t - tail[k - 1].t <= QUARTER_BEATS * hopBeat(beatOf, tail[k - 1], tail[k]); k--) quarters++;
  if (quarters > MAX_QUARTER_GAPS) out.push({ rule: "quarterRun", lane: moment.lanes[0] });

  for (const lane of moment.lanes) {
    const back = tail.slice(0, -1).reverse().find((m) => m.lanes.includes(lane));
    if (back && moment.t - back.t <= QUARTER_BEATS * hopBeat(beatOf, back, moment)) out.push({ rule: "minijack", lane });
    if (anchored(tail, lane, beatOf) > MAX_ANCHOR) out.push({ rule: "anchor", lane });
  }
  return out;
}

// How many notes of `lane` the end of `tail` has played as an anchor: every second moment in a stream, other lanes
// between them, and not just the one other lane (that is a trill). 0 when it is none.
function anchored(tail, lane, beatOf) {
  let presses = 1;
  let between = null;
  let differs = false;
  for (let k = tail.length - 1; k >= 2; k -= 2) {
    const [a, x, b] = [tail[k - 2], tail[k - 1], tail[k]];
    if (!a.lanes.includes(lane) || x.lanes.includes(lane)) break;
    if (x.t - a.t > STREAM_BEATS * hopBeat(beatOf, a, x) || b.t - x.t > STREAM_BEATS * hopBeat(beatOf, x, b)) break;
    if (between && !sameLanes(between, x.lanes)) differs = true;
    between = x.lanes;
    presses++;
  }
  return differs ? presses : 0;
}

// Would laying `lanes` at t after `tail` (the moments so far, { t, lanes }) break a rule of the figures: a minijack at
// a quarter beat, an anchor of 3, a sixth quarter-beat gap in a row? (A chord of 3 is chords.js's to keep.)
function breaksLaneRules(tail, t, lanes, timing) {
  const next = [...tail.slice(-(TAIL - 1)), { t, lanes }];
  if (next.length < 2) return false;
  return momentRules(next, (at) => beatMsOf(timing, at)).some((v) => v.rule !== "chord");
}

// normalViolations(notes, timing, { durationMs }) -> [{ rule, t, lane }]
// The rules of the Ranking Criteria for a Normal chart, kept by every note ({ t, lane, len? }, any order):
//   anchor       a lane played every second moment of a stream three times (more than MAX_ANCHOR), not as a trill
//   minijack     a lane played again within a quarter beat
//   quarterRun   more than five quarter-beat gaps in a row
//   chord        more than two notes at one time
//   holdShort    a hold under half a beat
//   underShortHold  a note under a half-beat hold
//   underHold    a note under a hold of about a beat, closer than a half beat to the hold's ends or another such note
//   holdLane     a note on the lane of a hold that is running
//   holdBounds   a hold that lets go after the song ends (`durationMs`, left out: no limit)
// `timing` is the chart's timing (buildTiming): its beatMsAt(t) is the beat length at t; without it a beat is 500 ms.
function normalViolations(notes, timing = null, { durationMs = Infinity } = {}) {
  const out = [];
  const flag = (rule, n, lane = n.lane) => out.push({ rule, t: n.t, lane });
  const sorted = [...notes].sort((a, b) => a.t - b.t || a.lane - b.lane);
  const beatOf = (t) => beatMsOf(timing, t);

  const tail = [];
  for (const moment of groupByTime(sorted)) {
    tail.push({ t: moment[0].t, lanes: moment.map((n) => n.lane).sort((a, b) => a - b) });
    if (tail.length > TAIL) tail.shift();
    for (const v of momentRules(tail, beatOf)) flag(v.rule, moment[0], v.lane);
  }

  const times = sorted.map((n) => n.t);
  for (const h of sorted) {
    if (!(h.len > 0)) continue;
    const beat = beatOf(h.t);
    const end = h.t + h.len;
    if (h.len < SHORT_HOLD_BEATS * beat * SLACK) flag("holdShort", h);
    if (end > durationMs) flag("holdBounds", h);
    const under = [];
    for (let i = lowerBound(times, h.t); i < sorted.length && times[i] < end; i++) {
      const n = sorted[i];
      if (n === h) continue;
      if (n.lane === h.lane) flag("holdLane", n);
      else if (n.t > h.t && n.t < end) under.push(n);
    }
    if (h.len <= SHORT_HOLD_CLASS * beat) {
      for (const n of under) flag("underShortHold", n);
    } else if (h.len <= BEAT_HOLD_CLASS * beat) {
      const marks = [h.t, ...under.map((n) => n.t), end];
      const flagged = new Set();
      marks.forEach((t, k) => {
        if (k === 0 || t - marks[k - 1] >= (beat / 2) * SLACK) return;
        for (const at of [k - 1, k]) if (at > 0 && at < marks.length - 1) flagged.add(at - 1);
      });
      for (const at of [...flagged].sort((a, b) => a - b)) flag("underHold", under[at]);
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

module.exports = { TAIL, breaksLaneRules, melodyDirection, melodyPull, normalViolations };
