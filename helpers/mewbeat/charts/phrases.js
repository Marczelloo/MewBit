const { ENERGY_EXPONENT, FALLBACK_BEAT_MS, SILENCE_ENERGY } = require("./difficulty");
const { clamp01, lowerBound, nearestIndex } = require("./util");
const { energyLookup } = require("./timing");

const BEATS_PER_PHRASE = 16;
const FALLBACK_PHRASE_MS = 8000; // a window without a trustworthy beat grid
const MIN_TAIL_FRACTION = 0.25; // a trailing window shorter than this share of a phrase joins the previous one

const REPEAT_SIMILARITY = 0.85; // a repeat at least this similar takes the leader of its source
const TONAL_MIN_CONF = 0.45; // below this a bass/lead line is not trusted enough to lead
const DRUMS_MIN_ACTIVITY = 0.15;
const DRUMS_MIN_CONF = 0.3;
const LEAD_PREFERRED_SCORE = 0.5; // in a vocal song a present lead scoring at least this leads outright
// A song is "vocal" when this share of its phrases carry a clearly sung line: lead confidence and onset rate
// at least the two values below. Instrumental songs keep their drum/bass leaders.
const VOCAL_PHRASE_SHARE = 0.3;
const VOCAL_MIN_CONF = 0.8;
const VOCAL_MIN_RATE = 1; // lead onsets per second
const HYSTERESIS = 0.8; // the previous leader stays while its score >= this share of the best
// A present layer other than the leader backs it up (supportLayers) when its score is at least this share of the
// leader's: then the phrase is charted from everything that plays, not from one layer.
const SUPPORT_MIN_SHARE = 0.3;

const FULL_DRUM_EVENTS_PER_BEAT = 2; // drum density at which the drum layer counts as fully busy
// A layer leading a phrase of energy E should offer about this many notes per second times E^ENERGY_EXPONENT (the
// shape of the difficulty's density target); one with fewer has its score scaled down in proportion.
const BUSY_NOTES_PER_SEC = 1.8;

// Steady pulse: most of the audible beats carry a drum or low-band onset. Such a phrase is charted at least at the
// difficulty's pulseNotesPerBeat however quiet it is, and its drums are judged against the phrase's own loudness
// (soft kicks under a quiet intro are all the rhythm there is) instead of the song's peak.
const PULSE_TOLERANCE_BEATS = 0.2; // an onset this close to a beat (in beats) carries it
const PULSE_MIN_SHARE = 0.7; // share of the audible beats that must carry one
const PULSE_MIN_BEATS = 4; // fewer audible beats than this say nothing about a pulse
const SOFT_DRUMS_MIN_ENERGY = 0.1; // drum strength is read relative to max(phrase energy, this)
const SOFT_DRUMS_MAX_LIFT = 3; // ...and lifted by at most this factor

const LAYERS = ["drums", "bass", "lead"];

const round3 = (x) => Math.round(x * 1000) / 1000;
const finite = (x, fallback = 0) => (Number.isFinite(x) ? x : fallback);

// --- layer activity / confidence (port of the plugin's LayerActivity) --------

// {ms of the phrase the notes cover, length-weighted mean confidence of that part}
function cover(notes, startMs, endMs) {
  let covered = 0;
  let weighted = 0;
  for (const n of notes) {
    const from = Math.max(finite(n.t), startMs);
    const to = Math.min(finite(n.t) + finite(n.len), endMs);
    if (to > from) {
      covered += to - from;
      weighted += (to - from) * finite(n.conf);
    }
  }
  return { covered, confidence: covered === 0 ? 0 : weighted / covered };
}

function layersOf(features, startMs, endMs, beatMs) {
  const beats = Math.max(1e-9, (endMs - startMs) / beatMs);
  let drumCount = 0;
  let drumStrength = 0;
  let hitCount = 0;
  let hitStrength = 0;
  for (const d of Array.isArray(features.drums) ? features.drums : []) {
    if (!(d.t >= startMs && d.t < endMs)) continue;
    drumCount++;
    drumStrength += finite(d.s);
    if (d.kind === "kick" || d.kind === "snare") {
      hitCount++;
      hitStrength += finite(d.s);
    }
  }
  const drumActivity =
    drumCount === 0 ? 0 : Math.min(1, drumCount / beats / FULL_DRUM_EVENTS_PER_BEAT) * (drumStrength / drumCount);
  const drumConfidence = hitCount === 0 ? 0 : hitStrength / hitCount;

  const span = Math.max(1, endMs - startMs);
  const bass = cover(Array.isArray(features.bass) ? features.bass : [], startMs, endMs);
  const lead = cover(Array.isArray(features.lead) ? features.lead : [], startMs, endMs);
  return {
    activity: {
      drums: round3(clamp01(drumActivity)),
      bass: round3(clamp01(bass.covered / span)),
      lead: round3(clamp01(lead.covered / span)),
    },
    confidence: {
      drums: round3(clamp01(drumConfidence)),
      bass: round3(clamp01(bass.confidence)),
      lead: round3(clamp01(lead.confidence)),
    },
  };
}

// Onsets per second in the phrase: kicks and snares for drums, trusted note starts for bass and lead.
function ratesOf(features, startMs, endMs) {
  const seconds = Math.max(1e-9, (endMs - startMs) / 1000);
  const inside = (t) => t >= startMs && t < endMs;
  const list = (x) => (Array.isArray(x) ? x : []);
  const hits = list(features.drums).filter((d) => inside(d.t) && (d.kind === "kick" || d.kind === "snare")).length;
  const notes = (line) => list(line).filter((n) => inside(n.t) && finite(n.conf) >= TONAL_MIN_CONF).length;
  return {
    drums: round3(hits / seconds),
    bass: round3(notes(features.bass) / seconds),
    lead: round3(notes(features.lead) / seconds),
  };
}

// Sorted times of every drum event and low-band onset: what can carry a beat.
function pulseTimesOf(features) {
  const times = [];
  for (const d of Array.isArray(features.drums) ? features.drums : []) if (Number.isFinite(d?.t)) times.push(d.t);
  for (const o of Array.isArray(features.bands?.[0]?.onsets) ? features.bands[0].onsets : []) if (Number.isFinite(o?.t)) times.push(o.t);
  return times.sort((a, b) => a - b);
}

// Share of the phrase's audible beats that carry one of `times`; 0 without a beat grid.
function pulseOf(times, timing, lookup, startMs, endMs) {
  if (!timing?.snapped) return 0;
  const tolerance = PULSE_TOLERANCE_BEATS * timing.medianMs;
  let audible = 0;
  let carried = 0;
  for (let i = lowerBound(timing.beats, startMs); i < timing.beats.length && timing.beats[i] < endMs; i++) {
    const beat = timing.beats[i];
    if (lookup.at(beat) < SILENCE_ENERGY) continue;
    audible++;
    const j = nearestIndex(times, beat);
    if (j >= 0 && Math.abs(times[j] - beat) <= tolerance) carried++;
  }
  return audible < PULSE_MIN_BEATS ? 0 : carried / audible;
}

const hasSteadyPulse = (phrase) => finite(phrase?.pulse) >= PULSE_MIN_SHARE;

function layerValues(source) {
  return { drums: clamp01(finite(source?.drums)), bass: clamp01(finite(source?.bass)), lead: clamp01(finite(source?.lead)) };
}

// --- phrase windows -----------------------------------------------------------

function sectionStartsOf(features, durationMs) {
  const starts = (Array.isArray(features.sections) ? features.sections : [])
    .map((s) => s?.startMs)
    .filter((t) => Number.isFinite(t) && t > 0 && t < durationMs);
  return [...new Set(starts)].sort((a, b) => a - b);
}

// Windows of 16 beats from the (extended) beat grid, or 8000 ms without one.
// The grid is anchored at the first beat at or after 0; the first window still
// starts at 0 and the last ends at the track end.
function fallbackWindows(timing, durationMs) {
  const bounds = [0];
  const beats = timing.snapped ? timing.beats : [];
  if (beats.length > 0) {
    for (let i = lowerBound(beats, 0) + BEATS_PER_PHRASE; i < beats.length && beats[i] < durationMs; i += BEATS_PER_PHRASE) {
      if (beats[i] > bounds[bounds.length - 1]) bounds.push(beats[i]);
    }
  } else {
    for (let t = FALLBACK_PHRASE_MS; t < durationMs; t += FALLBACK_PHRASE_MS) bounds.push(t);
  }
  // A sliver at the end is not a phrase of its own.
  const nominal = beats.length > 0 ? BEATS_PER_PHRASE * timing.medianMs : FALLBACK_PHRASE_MS;
  if (bounds.length > 1 && durationMs - bounds[bounds.length - 1] < MIN_TAIL_FRACTION * nominal) bounds.pop();
  bounds.push(durationMs);
  return bounds.slice(1).map((end, i) => [bounds[i], end]);
}

function clipToSections(windows, cuts) {
  const out = [];
  for (const [start, end] of windows) {
    let from = start;
    for (const cut of cuts) {
      if (cut > from && cut < end) {
        out.push([from, cut]);
        from = cut;
      }
    }
    out.push([from, end]);
  }
  return out;
}

function validPluginList(features) {
  const list = features.phrases?.list;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.every((p) => Number.isFinite(p?.startMs) && Number.isFinite(p?.endMs) && p.endMs > p.startMs) ? list : null;
}

function meanEnergy(lookup, startMs, endMs) {
  let sum = 0;
  let n = 0;
  for (let t = startMs; t < endMs || n === 0; t += lookup.hopMs) {
    sum += lookup.at(t);
    n++;
  }
  return sum / n;
}

// buildPhrases(features, timing, durationMs) -> Phrase[]
// Phrase = { index, startMs, endMs, repeatOf, similarity, lagMs, activity, confidence, rate, energy, pulse, sectionStart }
function buildPhrases(features, timing, durationMs) {
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : finite(features.durationMs);
  if (!(duration > 0)) return [];
  const beatMs = timing?.medianMs > 0 ? timing.medianMs : FALLBACK_BEAT_MS;
  const lookup = energyLookup(features);
  const pulseTimes = pulseTimesOf(features);
  const cuts = sectionStartsOf(features, duration);
  const isSectionStart = (startMs) => cuts.some((c) => Math.abs(c - startMs) <= beatMs);

  const plugin = validPluginList(features);
  let raw;
  if (plugin) {
    raw = plugin.map((p) => ({
      startMs: p.startMs,
      endMs: p.endMs,
      repeatOf: Number.isInteger(p.repeatOf) && p.repeatOf >= 0 ? p.repeatOf : null,
      similarity: finite(p.similarity),
      lagMs: finite(p.lagMs),
      ...(p.activity || p.confidence ? { activity: layerValues(p.activity), confidence: layerValues(p.confidence) } : {}),
    }));
  } else {
    const windows = clipToSections(fallbackWindows(timing ?? { snapped: false }, duration), cuts);
    raw = windows.map(([startMs, endMs]) => ({ startMs, endMs, repeatOf: null, similarity: 0, lagMs: 0 }));
  }

  return raw.map((p, index) => {
    const layers = p.activity ? { activity: p.activity, confidence: p.confidence } : layersOf(features, p.startMs, p.endMs, beatMs);
    return {
      index,
      startMs: p.startMs,
      endMs: p.endMs,
      repeatOf: p.repeatOf,
      similarity: p.similarity,
      lagMs: p.lagMs,
      activity: layers.activity,
      confidence: layers.confidence,
      rate: ratesOf(features, p.startMs, p.endMs),
      energy: meanEnergy(lookup, p.startMs, p.endMs),
      pulse: pulseOf(pulseTimes, timing, lookup, p.startMs, p.endMs),
      sectionStart: isSectionStart(p.startMs),
    };
  });
}

// --- leading layer ---------------------------------------------------------------

function isPresent(layer, activity, confidence) {
  if (layer === "drums") return activity >= DRUMS_MIN_ACTIVITY && confidence >= DRUMS_MIN_CONF;
  return confidence >= TONAL_MIN_CONF;
}

// How a layer's score counts: drum activity already carries the hits' strength, so confidence only gates
// drums; a bass line covers the phrase (activity) and is trusted (confidence). A sung lead is trusted alone:
// it covers only 6-45 % of a phrase by nature, so coverage would bury it. Either way a layer with too
// few onsets for the phrase's energy scores less: a held bass note covers a loud phrase but gives a thin chart.
function scoreOf(p, layer, a, c) {
  const base = layer === "drums" ? a : layer === "lead" ? c : a * c;
  const rate = p.rate?.[layer];
  if (!Number.isFinite(rate)) return base;
  const need = BUSY_NOTES_PER_SEC * Math.pow(clamp01(finite(p.energy)), ENERGY_EXPONENT);
  return need > 0 ? base * Math.min(1, rate / need) : base;
}

// Does a meaningful share of the song's phrases carry a confident, busy-enough lead line?
function isVocalSong(phrases) {
  if (phrases.length === 0) return false;
  const sung = phrases.filter(
    (p) => finite(p.confidence?.lead) >= VOCAL_MIN_CONF && finite(p.rate?.lead) >= VOCAL_MIN_RATE,
  ).length;
  return sung / phrases.length >= VOCAL_PHRASE_SHARE;
}

// Soft drums in a phrase with a steady pulse (instrumental songs only; a sung line keeps its lead): their strength is read against the phrase's own loudness, so a
// quiet intro whose only rhythm is faint kicks is not out-scored by a held note just because the kicks are soft.
function softDrumsLift(p) {
  if (!hasSteadyPulse(p)) return 1;
  return Math.min(SOFT_DRUMS_MAX_LIFT, 1 / Math.max(clamp01(finite(p.energy)), SOFT_DRUMS_MIN_ENERGY));
}

// The score and presence of every layer of a phrase: what chooseLeaders and supportLayers both read.
function layerScores(p, vocal) {
  const score = {};
  const present = [];
  for (const layer of LAYERS) {
    const lift = layer === "drums" && !vocal ? softDrumsLift(p) : 1;
    const a = clamp01(finite(p.activity?.[layer]) * lift);
    const c = clamp01(finite(p.confidence?.[layer]) * lift);
    score[layer] = scoreOf(p, layer, a, c);
    if (isPresent(layer, a, c)) present.push(layer);
  }
  return { score, present };
}

// chooseLeaders(phrases) -> Array<"drums"|"bass"|"lead"|"bands">, aligned to phrases.
function chooseLeaders(phrases) {
  const leaders = [];
  const vocal = isVocalSong(phrases);
  for (let i = 0; i < phrases.length; i++) {
    const p = phrases[i];
    const { score, present } = layerScores(p, vocal);

    let leader = "bands";
    if (present.length > 0) {
      let best = present[0];
      for (const layer of present) if (score[layer] > score[best]) best = layer;
      if (vocal && present.includes("lead") && score.lead >= LEAD_PREFERRED_SCORE) best = "lead";

      leader = best;
      const previous = leaders[i - 1];
      if (!p.sectionStart && previous !== undefined && present.includes(previous) && score[previous] >= HYSTERESIS * score[best]) {
        leader = previous;
      }
    }

    const source = p.repeatOf;
    if (Number.isInteger(source) && source >= 0 && source < i && finite(p.similarity) >= REPEAT_SIMILARITY) {
      leader = leaders[source];
    }
    leaders.push(leader);
  }
  return leaders;
}

// A clearly sung line: the same test isVocalSong counts phrases by.
const isSung = (p) => finite(p.confidence?.lead) >= VOCAL_MIN_CONF && finite(p.rate?.lead) >= VOCAL_MIN_RATE;

// supportLayers(phrase, leader, vocal) -> the other present layers that play comparably to the leader (score at
// least SUPPORT_MIN_SHARE of its), strongest first. Empty when the leader is dominant: nothing comes close, there
// is no layer to lead ("bands"), or `vocal` (see isVocalSong) and the phrase's lead is a sung line, which leads
// by design.
function supportLayers(phrase, leader, vocal = false) {
  if (!LAYERS.includes(leader)) return [];
  if (vocal && leader === "lead" && isSung(phrase)) return [];
  const { score, present } = layerScores(phrase, vocal);
  if (!present.includes(leader)) return [];
  const floor = SUPPORT_MIN_SHARE * score[leader];
  return present
    .filter((layer) => layer !== leader && score[layer] > 0 && score[layer] >= floor)
    .sort((a, b) => score[b] - score[a]);
}

module.exports = { REPEAT_SIMILARITY, TONAL_MIN_CONF, buildPhrases, chooseLeaders, hasSteadyPulse, isVocalSong, supportLayers };
