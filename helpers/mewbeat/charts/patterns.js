// Pattern events: the notes of one phrase, taken from its leading musical layer
// (drums / bass / lead) and, where other layers play about as much, from those too (see mixedEvents), placed on
// lanes by what they play. Difficulty is a
// later filter (difficultyFilter.js); here every event just gets a level:
//   0 strong (on a beat, or a main accent), 1 on the 1/2 or 1/4 grid (tonal notes on the 1/8 grid too), 2 fine (hats, 1/8 drum hits).
const { BEAT_TOLERANCE_MS } = require("./difficulty");
const { TONAL_MIN_CONF } = require("./phrases");
const { capMoments } = require("./difficultyFilter");
const { isSupport } = require("./holds");
const { gridSlot, nearestQuarter, snapToQuarterGrid } = require("./grid");
const { median, nearestIndex } = require("./util");

const LANES = 4;
const LONGEST_SHARE = 0.25; // the longest quarter of a tonal phrase's notes are level 0
const NARROW_RANGE_SEMITONES = 3; // a narrower pitch range maps by contour instead
const CONTOUR_START_LANE = 1;
const STAIR_MIN_STEPS = 3; // a monotonic run of this many steps climbs one lane per step
const TRILL_MIN_GAP_MS = 250; // a repeated pitch closer than max(1/2 beat, this) trills
// A line that rests at least REGISTER_REST_BEATS and comes back at least REGISTER_JUMP_SEMITONES away (a sung line
// handing over to an instrument's melody, or a verse an octave up) starts a new part; each part spreads its own pitch
// range over the lanes, so neither is squeezed onto one hand by the other's register. A part of fewer than
// REGISTER_MIN_NOTES notes stays with the one before it.
const REGISTER_REST_BEATS = 1;
const REGISTER_JUMP_SEMITONES = 7;
const REGISTER_MIN_NOTES = 4;
const HAT_CLEARANCE_BEATS = 1 / 8; // hats stay this far from a kick/snare
const SECONDARY_MIN_ENERGY = 0.6; // phrases at least this loud add drums under a tonal leader
const SECONDARY_CLEARANCE_BEATS = 1 / 4; // ...into slots this far from any leader event
// Under a tonal leader the drums are the backbone: kick/snare are level 1 (Normal+), one on a beat level 0
// (Easy too: a sung line alone is too thin for Easy); a hit between 1/4 slots stays Hard-only.
const SECONDARY_BEAT_LEVEL = 0;
const SECONDARY_HIT_LEVEL = 1;
// A long, confident bass/lead note under another leader is charted as a hold of its own, unless a leader event
// already sits on its start.
const SUSTAIN_MIN_BEATS = 1.5;
const SUSTAIN_MIN_CONF = 0.8;
const SUSTAIN_CLEARANCE_BEATS = 1 / 4;

const KICK_LANES = [0, 3];
const SNARE_LANES = [1, 2];

// A phrase with support layers is charted from several layers at once, one hand each way: low sounds (bass, kick)
// on the left hand (lanes 0-1), high ones (snare, perc, hats, lead) on the right (lanes 2-3). Pitch rises left to
// right: inside a hand the higher pitch takes the lane further right.
const HAND_LANES = 2;
const MIXED_KICK_LANES = [0, 1];
const MIXED_SNARE_LANES = [2, 3];
const TONAL_HAND_BASE = { bass: 0, lead: 2 };
// A support event gets one level more than its own (Easy follows the leader, Normal adds the second layer, Hard
// everything), except where the leader has nothing within this distance: there it fills the leader's rest.
const SUPPORT_MIN_LEVEL = 1;
const SUPPORT_REST_BEATS = 1 / 4;
const CHORD_LEVEL = 2; // a kick on a bar start under a leader note on the other hand is a Hard-only chord

const sourceMs = (timing) => (timing?.medianMs > 0 ? timing.medianMs : 500);
const mirror = (lane) => LANES - 1 - lane;
const inPhrase = (phrase, t) => Number.isFinite(t) && t >= phrase.startMs && t < phrase.endMs;
const list = (value) => (Array.isArray(value) ? value : []);

// --- drums ---------------------------------------------------------------------

// Kick / snare / perc hits of the phrase on the quarter grid with their lanes.
// The lane pair alternates per class: the n-th earlier kick (or snare/perc) of the
// phrase picks pair n % 2, so kicks use lanes 0/3 and snares 1/2 on any meter.
function hitsOf(phrase, features, timing, kickLanes = KICK_LANES, snareLanes = SNARE_LANES) {
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
    h.lane = (h.kick ? kickLanes : snareLanes)[seen[cls]++ % 2];
  }
  return hits;
}

// `split`: hats are right-hand sounds (mixed phrases), alternating the two right-hand lanes.
function hatsOf(phrase, features, timing, hits, beatMs, split = false) {
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
  const before = split ? hits.filter((h) => !h.kick) : [...hits];
  for (const h of hatTimes) {
    if (hats.some((x) => x.t === h.t)) continue;
    const previous = before.filter((e) => e.t < h.t).pop();
    const other = previous?.lane === MIXED_SNARE_LANES[0] ? MIXED_SNARE_LANES[1] : MIXED_SNARE_LANES[0];
    const lane = split ? other : previous ? mirror(previous.lane) : 2; // the opposite hand of the previous event
    const hat = { t: h.t, lane, s: h.s };
    hats.push(hat);
    before.push(hat);
    before.sort((a, b) => a.t - b.t);
  }
  return hats;
}

// `split`: kicks on the left hand, snare / perc / hats on the right (a mixed phrase).
function drumEvents(phrase, features, timing, beatMs, split = false) {
  const hits = split ? hitsOf(phrase, features, timing, MIXED_KICK_LANES, MIXED_SNARE_LANES) : hitsOf(phrase, features, timing);
  const strongFrom = hits.length === 0 ? 0 : median(hits.map((h) => h.s));
  const events = hits.map((h) => {
    const slot = gridSlot(timing, h.t);
    const onBeat = timing?.snapped ? slot?.beat === true : true;
    const level = h.eighth ? 2 : onBeat && h.s >= strongFrom ? 0 : 1;
    return { t: h.t, lane: h.lane, level, s: h.s, source: "drums" };
  });
  for (const h of hatsOf(phrase, features, timing, hits, beatMs, split)) {
    events.push({ t: h.t, lane: h.lane, level: 2, s: h.s, source: "drums" });
  }
  return events;
}

// --- tonal layers (bass / lead) ---------------------------------------------------

const isSustained = (n, beatMs) => Number(n.len) >= SUSTAIN_MIN_BEATS * beatMs && Number(n.conf) >= SUSTAIN_MIN_CONF;

// The lane helpers work on `count` lanes: the four of the keyboard, or the two of one hand in a mixed phrase.
function pitchLane(pitch, min, max, count) {
  return Math.min(count - 1, Math.max(0, Math.floor((count * (pitch - min)) / (max - min + 1e-9))));
}

const reflect = (lane, count) => (lane > count - 1 ? count - 2 : lane < 0 ? 1 : lane);

// One lane step in `dir` (+1/-1); at an edge the walk turns around.
function bounce(lane, dir, count) {
  const next = lane + dir;
  if (next > count - 1) return { lane: count - 2, dir: -1 };
  if (next < 0) return { lane: 1, dir: 1 };
  return { lane: next, dir };
}

// Lane for every note of a (time-sorted) phrase line, from its pitches:
// pitch range -> lanes, or the contour when the range is narrow; a repeated
// pitch holds its lane, or trills with the neighbour toward the centre when fast;
// a run of >= 3 steps in one direction climbs one lane per step.
function tonalLanes(notes, minRepeatGapMs, count = LANES) {
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
      base.push(contour ? CONTOUR_START_LANE : pitchLane(pitches[0], min, max, count));
      lanes.push(base[0]);
    } else if (stair[i] !== 0) {
      let from = lanes[i - 1];
      if (runStart[i]) {
        walkDir = stair[i];
        // Re-anchor on the pitch lane of the run's first note, so lanes keep tracking pitch.
        if (!contour) from = pitchLane(pitches[i - 1], min, max, count);
      }
      const step = bounce(from, walkDir, count);
      walkDir = step.dir;
      base.push(step.lane);
      lanes.push(step.lane);
    } else if (dir[i] === 0) {
      const home = base[i - 1];
      base.push(home);
      const fast = notes[i].t - notes[i - 1].t < minRepeatGapMs;
      if (!fast) lanes.push(home);
      else if (lanes[i - 1] !== home) lanes.push(home);
      else lanes.push(home + (home < count / 2 ? 1 : -1));
    } else {
      const lane = contour ? reflect(base[i - 1] + dir[i], count) : pitchLane(pitches[i], min, max, count);
      base.push(lane);
      lanes.push(lane);
    }
  }
  return lanes;
}

// The phrase's line of one tonal layer: grid-snapped notes with the lane the tonal patterns give each.
function tonalLine(phrase, features, timing, layer, beatMs, laneCount = LANES) {
  const notes = list(features[layer])
    .filter((n) => inPhrase(phrase, n?.t) && Number.isFinite(n.pitch) && Number(n.conf) >= TONAL_MIN_CONF)
    .map((n) => ({ ...n, ...snapToQuarterGrid(timing, n.t), t0: n.t }))
    .map((n) => (n.eighth ? { ...n, coarseT: nearestQuarter(timing, n.t0) } : n))
    .filter((n) => inPhrase(phrase, n.t))
    .sort((a, b) => a.t - b.t || a.pitch - b.pitch);
  const minRepeatGapMs = Math.max(beatMs / 2, TRILL_MIN_GAP_MS);
  const lanes = registerParts(notes, beatMs).flatMap((part) => tonalLanes(part, minRepeatGapMs, laneCount));
  return { notes, lanes };
}

// A (time-sorted) line cut into its parts by register (see REGISTER_REST_BEATS).
function registerParts(notes, beatMs) {
  const parts = [];
  let part = [];
  notes.forEach((n, i) => {
    const prev = notes[i - 1];
    const rest = prev ? n.t0 - (prev.t0 + (Number(prev.len) || 0)) : 0;
    if (prev && rest >= REGISTER_REST_BEATS * beatMs && Math.abs(n.pitch - prev.pitch) >= REGISTER_JUMP_SEMITONES) {
      parts.push(part);
      part = [];
    }
    part.push(n);
  });
  if (part.length > 0) parts.push(part);
  // Short parts join the part before (the first one the part after).
  const merged = [];
  for (const p of parts) {
    if (merged.length > 0 && (p.length < REGISTER_MIN_NOTES || merged[merged.length - 1].length < REGISTER_MIN_NOTES)) merged[merged.length - 1].push(...p);
    else merged.push(p);
  }
  return merged;
}

// `laneCount` 2 places the line inside one hand (lanes 0-1 here, the caller moves them); `sustainedOnly` gives only
// a long, confident note its sustain: a support layer's other notes are taps, not holds.
function tonalEvents(phrase, features, timing, layer, beatMs, laneCount = LANES, sustainedOnly = false) {
  const { notes, lanes } = tonalLine(phrase, features, timing, layer, beatMs, laneCount);
  if (notes.length === 0) return [];

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
    if (Number.isFinite(n.len) && n.len > 0 && (!sustainedOnly || isSustained(n, beatMs))) event.sustainMs = n.len;
    return event;
  });
}

// Long confident notes of the tonal layers that do not lead the phrase: the leader never charts them, but a held
// bass or organ note under the pattern is what a hold is for. Level 0, so every difficulty may take it.
// `skip`: the layers charted in full already; `handed`: place a line in its hand (a mixed phrase).
function sustainEvents(phrase, skip, features, timing, leaderEvents, beatMs, handed = false) {
  const clear = SUSTAIN_CLEARANCE_BEATS * beatMs;
  const times = leaderEvents.map((e) => e.t).sort((a, b) => a - b);
  const events = [];
  for (const layer of ["bass", "lead"]) {
    if (skip.has(layer)) continue;
    const { notes, lanes } = tonalLine(phrase, features, timing, layer, beatMs, handed ? HAND_LANES : LANES);
    notes.forEach((n, i) => {
      if (!isSustained(n, beatMs)) return;
      const near = nearestIndex(times, n.t);
      if (near >= 0 && Math.abs(times[near] - n.t) < clear) return;
      const lane = handed ? lanes[i] + TONAL_HAND_BASE[layer] : lanes[i];
      const event = { t: n.t, lane, level: 0, s: Number(n.s) || 0, source: layer, sustainMs: n.len };
      if (n.eighth) event.coarseT = n.coarseT;
      events.push(event);
    });
  }
  return events;
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
  const backed = new Set(events.filter(isSupport).map((e) => e.t)); // already a two-note moment
  for (const e of events) {
    if (isSupport(e)) continue;
    byTime.set(e.t, [...(byTime.get(e.t) ?? []), e]);
  }
  for (const [t, here] of byTime) {
    if (here.length !== 1 || here[0].level !== 0 || backed.has(t) || !isBarStart(timing, phrase, t)) continue;
    const lane = mirror(here[0].lane);
    if (events.some((e) => e.t === t && e.lane === lane)) continue;
    out.push({ t, lane, level: 1, s: here[0].s, source: here[0].source });
  }
  return out;
}

// --- mixed phrases --------------------------------------------------------------------

// A phrase charted from its leader and its support layers, one hand each way (see HAND_LANES).
function mixedEvents(phrase, leader, supports, features, timing, beatMs) {
  const layers = [leader, ...supports];
  const build = (layer) =>
    layer === "drums"
      ? drumEvents(phrase, features, timing, beatMs, true)
      : tonalEvents(phrase, features, timing, layer, beatMs, HAND_LANES, layer !== leader).map((e) => ({
          ...e,
          lane: e.lane + TONAL_HAND_BASE[layer],
        }));
  const handOf = (e) => e.lane >> 1;

  const leading = build(leader).map((e) => ({ ...e, hand: handOf(e) }));
  const leadTimes = leading.map((e) => e.t).sort((a, b) => a - b);
  const clear = SUPPORT_REST_BEATS * beatMs;
  const slots = new Set(leading.map((e) => `${handOf(e)}:${e.t}`)); // one event per hand and time; the leader wins

  const backing = [];
  for (const layer of supports) {
    const candidates = build(layer)
      .map((e) => ({ ...e, hand: handOf(e), support: true }))
      .sort((a, b) => b.s - a.s || a.t - b.t); // where two share a slot the stronger stays
    for (const e of candidates) {
      const slot = `${e.hand}:${e.t}`;
      if (slots.has(slot)) continue;
      slots.add(slot);
      const near = nearestIndex(leadTimes, e.t);
      const rest = near < 0 || Math.abs(leadTimes[near] - e.t) >= clear;
      const kickChord = !rest && e.source === "drums" && e.hand === 0 && e.level === 0 && isBarStart(timing, phrase, e.t);
      // A long note in the leader's rest keeps level 0, as a sustained note under another leader always did.
      e.level = kickChord ? CHORD_LEVEL : rest ? (e.sustainMs > 0 ? 0 : e.level) : Math.max(e.level, SUPPORT_MIN_LEVEL);
      backing.push(e);
    }
  }
  backing.sort((a, b) => a.t - b.t);
  return takeTurns([...leading, ...backing]);
}

// The density cap keeps events by level, then strength. One busy layer (a drum track's snares) would take every
// slot of its level, so in a mixed phrase the events of each source (and hand) get a `turn`: their rank by strength
// within their group. The cap then deals the slots out round-robin (every group's strongest first, then every
// group's second, ...) and the busy layer only gets what the others leave.
function takeTurns(events) {
  const groups = new Map();
  for (const e of events) {
    const key = `${e.source}:${e.hand}:${e.level}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => b.s - a.s || a.t - b.t);
    group.forEach((e, i) => {
      e.turn = e.support === true ? i + 0.5 : i;
    });
  }
  return events;
}

// patternEvents(phrase, leader, features, timing, supports) -> Event[], time-ordered.
// Event = { t, lane, level: 0|1|2, s, source: "drums"|"bass"|"lead"|"secondary", sustainMs?, support?, hand? }
// `supports` (optional, see phrases.js supportLayers): other layers that play about as much as the leader; with
// some, the phrase is mixed. Without, the leader's events alone (a tonal leader adds a drum backbone in loud phrases).
function patternEvents(phrase, leader, features, timing, supports = []) {
  const beatMs = sourceMs(timing);
  let events;
  if (leader === "bands") return [];
  if (leader !== "drums" && leader !== "bass" && leader !== "lead") return [];
  if (supports.length > 0) {
    events = mixedEvents(phrase, leader, supports, features, timing, beatMs);
    events.push(...sustainEvents(phrase, new Set([leader, ...supports]), features, timing, events, beatMs, true));
  } else if (leader === "drums") {
    events = drumEvents(phrase, features, timing, beatMs);
    events.push(...sustainEvents(phrase, new Set([leader]), features, timing, events, beatMs));
  } else {
    events = tonalEvents(phrase, features, timing, leader, beatMs);
    const held = sustainEvents(phrase, new Set([leader]), features, timing, events, beatMs);
    if (events.length > 0 && Number(phrase.energy) >= SECONDARY_MIN_ENERGY) {
      events.push(...secondaryEvents(phrase, features, timing, events, beatMs));
    }
    events.push(...held);
  }
  return capMoments(withChords(events, phrase, timing), 2);
}

module.exports = { patternEvents };
