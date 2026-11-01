// Pattern events: the notes of one phrase, taken from its leading musical layer
// (drums / bass / lead) and placed on lanes by what they play. Difficulty is a
// later filter (difficultyFilter.js); here every event just gets a level:
//   0 strong (on a beat, or a main accent), 1 on the 1/2 or 1/4 grid (tonal notes on the 1/8 grid too), 2 fine (hats, 1/8 drum hits).
const { BEAT_TOLERANCE_MS } = require("./difficulty");
const { TONAL_MIN_CONF } = require("./phrases");
const { capMoments } = require("./difficultyFilter");
const { gridSlot, nearestQuarter, snapToQuarterGrid } = require("./grid");
const { median, nearestIndex } = require("./util");

const LANES = 4;
const LONGEST_SHARE = 0.25; // the longest quarter of a tonal phrase's notes are level 0
const NARROW_RANGE_SEMITONES = 3; // a narrower pitch range maps by contour instead
const CONTOUR_START_LANE = 1;
const STAIR_MIN_STEPS = 3; // a monotonic run of this many steps climbs one lane per step
const TRILL_MIN_GAP_MS = 250; // a repeated pitch closer than max(1/2 beat, this) trills
const HAT_CLEARANCE_BEATS = 1 / 8; // hats stay this far from a kick/snare
const SECONDARY_MIN_ENERGY = 0.6; // phrases at least this loud add drums under a tonal leader
const SECONDARY_CLEARANCE_BEATS = 1 / 4; // ...into slots this far from any leader event
// Under a tonal leader the drums are the backbone: kick/snare are level 1 (Normal+), one on a beat level 0
// (Easy too: a sung line alone is too thin for Easy); a hit between 1/4 slots stays Hard-only.
const SECONDARY_BEAT_LEVEL = 0;
const SECONDARY_HIT_LEVEL = 1;

const KICK_LANES = [0, 3];
const SNARE_LANES = [1, 2];

const sourceMs = (timing) => (timing?.medianMs > 0 ? timing.medianMs : 500);
const mirror = (lane) => LANES - 1 - lane;
const inPhrase = (phrase, t) => Number.isFinite(t) && t >= phrase.startMs && t < phrase.endMs;
const list = (value) => (Array.isArray(value) ? value : []);

// --- drums ---------------------------------------------------------------------

// Kick / snare / perc hits of the phrase on the quarter grid with their lanes.
// The lane pair alternates per class: the n-th earlier kick (or snare/perc) of the
// phrase picks pair n % 2, so kicks use lanes 0/3 and snares 1/2 on any meter.
function hitsOf(phrase, features, timing) {
  const hits = [];
  for (const d of list(features.drums)) {
    if (!inPhrase(phrase, d?.t)) continue;
    if (d.kind !== "kick" && d.kind !== "snare" && d.kind !== "perc") continue;
    const snapped = snapToQuarterGrid(timing, d.t);
    if (!inPhrase(phrase, snapped.t)) continue;
    hits.push({ t: snapped.t, eighth: snapped.eighth, s: Number(d.s) || 0, kick: d.kind === "kick" });
  }
  hits.sort((a, b) => a.t - b.t || Number(b.kick) - Number(a.kick));
  const seen = { kick: 0, snare: 0 };
  for (const h of hits) {
    const cls = h.kick ? "kick" : "snare";
    h.lane = (h.kick ? KICK_LANES : SNARE_LANES)[seen[cls]++ % 2];
  }
  return hits;
}

function hatsOf(phrase, features, timing, hits, beatMs) {
  const clear = HAT_CLEARANCE_BEATS * beatMs;
  const hatTimes = [];
  for (const d of list(features.drums)) {
    if (d?.kind !== "hat" || !inPhrase(phrase, d.t)) continue;
    const snapped = snapToQuarterGrid(timing, d.t);
    if (snapped.eighth || !inPhrase(phrase, snapped.t)) continue; // hats only fill 1/4-grid slots
    if (hits.some((h) => Math.abs(h.t - snapped.t) <= clear)) continue;
    hatTimes.push({ t: snapped.t, s: Number(d.s) || 0 });
  }
  hatTimes.sort((a, b) => a.t - b.t);
  const hats = [];
  const before = [...hits];
  for (const h of hatTimes) {
    if (hats.some((x) => x.t === h.t)) continue;
    const previous = before.filter((e) => e.t < h.t).pop();
    const lane = previous ? mirror(previous.lane) : 2; // the opposite hand of the previous event
    const hat = { t: h.t, lane, s: h.s };
    hats.push(hat);
    before.push(hat);
    before.sort((a, b) => a.t - b.t);
  }
  return hats;
}

function drumEvents(phrase, features, timing, beatMs) {
  const hits = hitsOf(phrase, features, timing);
  const strongFrom = hits.length === 0 ? 0 : median(hits.map((h) => h.s));
  const events = hits.map((h) => {
    const slot = gridSlot(timing, h.t);
    const onBeat = timing?.snapped ? slot?.beat === true : true;
    const level = h.eighth ? 2 : onBeat && h.s >= strongFrom ? 0 : 1;
    return { t: h.t, lane: h.lane, level, s: h.s, source: "drums" };
  });
  for (const h of hatsOf(phrase, features, timing, hits, beatMs)) {
    events.push({ t: h.t, lane: h.lane, level: 2, s: h.s, source: "drums" });
  }
  return events;
}

// --- tonal layers (bass / lead) ---------------------------------------------------

function pitchLane(pitch, min, max) {
  return Math.min(LANES - 1, Math.max(0, Math.floor((LANES * (pitch - min)) / (max - min + 1e-9))));
}

const reflect = (lane) => (lane > LANES - 1 ? LANES - 2 : lane < 0 ? 1 : lane);

// One lane step in `dir` (+1/-1); at an edge the walk turns around.
function bounce(lane, dir) {
  const next = lane + dir;
  if (next > LANES - 1) return { lane: LANES - 2, dir: -1 };
  if (next < 0) return { lane: 1, dir: 1 };
  return { lane: next, dir };
}

// Lane for every note of a (time-sorted) phrase line, from its pitches:
// pitch range -> lanes, or the contour when the range is narrow; a repeated
// pitch holds its lane, or trills with the neighbour toward the centre when fast;
// a run of >= 3 steps in one direction climbs one lane per step.
function tonalLanes(notes, minRepeatGapMs) {
  const pitches = notes.map((n) => n.pitch);
  const min = Math.min(...pitches);
  const max = Math.max(...pitches);
  const contour = max - min < NARROW_RANGE_SEMITONES;
  const dir = notes.map((n, i) => (i === 0 ? 0 : Math.sign(n.pitch - notes[i - 1].pitch)));

  // Steps that belong to a monotonic run of at least STAIR_MIN_STEPS.
  const stair = new Array(notes.length).fill(0);
  const runStart = new Array(notes.length).fill(false);
  for (let i = 1; i < notes.length; ) {
    if (dir[i] === 0) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < notes.length && dir[j + 1] === dir[i]) j++;
    if (j - i + 1 >= STAIR_MIN_STEPS) {
      runStart[i] = true;
      for (let k = i; k <= j; k++) stair[k] = dir[i];
    }
    i = j + 1;
  }

  const lanes = [];
  const base = [];
  let walkDir = 1;
  for (let i = 0; i < notes.length; i++) {
    if (i === 0) {
      base.push(contour ? CONTOUR_START_LANE : pitchLane(pitches[0], min, max));
      lanes.push(base[0]);
    } else if (stair[i] !== 0) {
      let from = lanes[i - 1];
      if (runStart[i]) {
        walkDir = stair[i];
        // Re-anchor on the pitch lane of the run's first note, so lanes keep tracking pitch.
        if (!contour) from = pitchLane(pitches[i - 1], min, max);
      }
      const step = bounce(from, walkDir);
      walkDir = step.dir;
      base.push(step.lane);
      lanes.push(step.lane);
    } else if (dir[i] === 0) {
      const home = base[i - 1];
      base.push(home);
      const fast = notes[i].t - notes[i - 1].t < minRepeatGapMs;
      if (!fast) lanes.push(home);
      else if (lanes[i - 1] !== home) lanes.push(home);
      else lanes.push(home + (home < LANES / 2 ? 1 : -1));
    } else {
      const lane = contour ? reflect(base[i - 1] + dir[i]) : pitchLane(pitches[i], min, max);
      base.push(lane);
      lanes.push(lane);
    }
  }
  return lanes;
}

function tonalEvents(phrase, features, timing, layer, beatMs) {
  const notes = list(features[layer])
    .filter((n) => inPhrase(phrase, n?.t) && Number.isFinite(n.pitch) && Number(n.conf) >= TONAL_MIN_CONF)
    .map((n) => ({ ...n, ...snapToQuarterGrid(timing, n.t), t0: n.t }))
    .map((n) => (n.eighth ? { ...n, coarseT: nearestQuarter(timing, n.t0) } : n))
    .filter((n) => inPhrase(phrase, n.t))
    .sort((a, b) => a.t - b.t || a.pitch - b.pitch);
  if (notes.length === 0) return [];

  const lanes = tonalLanes(notes, Math.max(beatMs / 2, TRILL_MIN_GAP_MS));
  const strongFrom = median(notes.map((n) => Number(n.s) || 0));
  const lens = notes.map((n) => Number(n.len) || 0);
  const typicalLen = median(lens);
  const longestCount = Math.max(1, Math.ceil(LONGEST_SHARE * notes.length));
  const longestFrom = [...lens].sort((a, b) => b - a)[longestCount - 1];

  return notes.map((n, i) => {
    const slot = gridSlot(timing, n.t);
    const onBeatOrHalf = timing?.snapped ? slot !== null && (slot.beat || slot.half) : true;
    // A sung note on a beat is a main accent whatever its strength: Easy has little else to follow in a vocal song.
    const strong = onBeatOrHalf && (layer === "lead" || (Number(n.s) || 0) >= strongFrom);
    // "Longest quarter" only counts notes longer than the typical one, so a line
    // of equal lengths does not promote an arbitrary quarter of itself.
    const long = lens[i] >= longestFrom && lens[i] > typicalLen;
    // A sung line syncopates; a note on the 1/8 grid is still playable on Normal, but there it sits on the
    // 1/4 grid (coarseT), which is where the difficulty filter moves it.
    const level = n.eighth ? 1 : strong || long ? 0 : 1;
    const event = { t: n.t, lane: lanes[i], level, s: Number(n.s) || 0, source: layer };
    if (n.eighth) event.coarseT = n.coarseT;
    if (Number.isFinite(n.len) && n.len > 0) event.sustainMs = n.len;
    return event;
  });
}

// --- assembling ---------------------------------------------------------------------

function secondaryLevel(hit, timing) {
  if (hit.eighth) return 2;
  const onBeat = timing?.snapped ? gridSlot(timing, hit.t)?.beat === true : true;
  return onBeat ? SECONDARY_BEAT_LEVEL : SECONDARY_HIT_LEVEL;
}

// Kick/snare under a tonal leader, only where the leader is silent.
function secondaryEvents(phrase, features, timing, leaderEvents, beatMs) {
  const clear = SECONDARY_CLEARANCE_BEATS * beatMs;
  const times = leaderEvents.map((e) => e.t).sort((a, b) => a - b);
  return hitsOf(phrase, features, timing)
    .filter((h) => {
      const i = nearestIndex(times, h.t);
      return i < 0 || Math.abs(times[i] - h.t) >= clear;
    })
    .map((h) => ({ t: h.t, lane: h.lane, level: secondaryLevel(h, timing), s: h.s, source: "secondary" }));
}

function isBarStart(timing, phrase, t) {
  if (Math.abs(t - phrase.startMs) <= BEAT_TOLERANCE_MS) return true;
  const downbeats = timing?.downbeats ?? [];
  const i = nearestIndex(downbeats, t);
  return i >= 0 && Math.abs(downbeats[i] - t) <= BEAT_TOLERANCE_MS;
}

// Mirror note on strong bar starts. Only where a single level-0 leader event sits.
function withChords(events, phrase, timing) {
  const out = [...events];
  const byTime = new Map();
  for (const e of events) {
    if (e.source === "secondary") continue;
    byTime.set(e.t, [...(byTime.get(e.t) ?? []), e]);
  }
  for (const [t, here] of byTime) {
    if (here.length !== 1 || here[0].level !== 0 || !isBarStart(timing, phrase, t)) continue;
    const lane = mirror(here[0].lane);
    if (events.some((e) => e.t === t && e.lane === lane)) continue;
    out.push({ t, lane, level: 1, s: here[0].s, source: here[0].source });
  }
  return out;
}

// patternEvents(phrase, leader, features, timing) -> Event[], time-ordered.
// Event = { t, lane, level: 0|1|2, s, source: "drums"|"bass"|"lead"|"secondary", sustainMs? }
function patternEvents(phrase, leader, features, timing) {
  const beatMs = sourceMs(timing);
  let events;
  if (leader === "drums") {
    events = drumEvents(phrase, features, timing, beatMs);
  } else if (leader === "bass" || leader === "lead") {
    events = tonalEvents(phrase, features, timing, leader, beatMs);
    if (events.length > 0 && Number(phrase.energy) >= SECONDARY_MIN_ENERGY) {
      events.push(...secondaryEvents(phrase, features, timing, events, beatMs));
    }
  } else {
    return [];
  }
  return capMoments(withChords(events, phrase, timing), 2);
}

module.exports = { patternEvents };
