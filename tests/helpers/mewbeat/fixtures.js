// Deterministic features-JSON-v1 builder for chart tests. No randomness: every
// "variation" below is a pure function of the onset index.
const { FLAGS } = require("../../../helpers/mewbeat/charts/flags");

const BANDS = ["low", "lowmid", "highmid", "high"];

function near(value, target) {
  return Math.abs(value - target) < 1e-6;
}

// Downbeats get strength 1.0, other beats ~0.8, 8ths ~0.6, 16ths ~0.5, each
// with a small index-based wobble so strengths are rarely exactly equal.
function strengthAt(beatPos, index) {
  const wobble = ((index * 37) % 13) / 100 - 0.06;
  if (near(beatPos % 4, 0)) return Math.min(1, 1 + wobble);
  if (near(beatPos % 1, 0)) return 0.78 + wobble;
  if (near((beatPos * 2) % 1, 0)) return 0.6 + wobble;
  return 0.5 + wobble;
}

function makeFeatures({
  bpm = 120,
  confidence = 0.9,
  durationMs = 180000,
  energy = () => 0.5,
  onsetEveryBeats = 0.25,
  beatsPerBar = 4,
  highlightMs = 90000,
  offsetMs = 0,
} = {}) {
  const beatMs = 60000 / bpm;

  const beats = [];
  const downbeats = [];
  for (let i = 0; offsetMs + i * beatMs < durationMs; i++) {
    const t = Math.round(offsetMs + i * beatMs);
    beats.push(t);
    if (i % beatsPerBar === 0) downbeats.push(t);
  }

  const bands = BANDS.map((name) => ({ name, onsets: [] }));
  for (let i = 0; ; i++) {
    const beatPos = i * onsetEveryBeats;
    const t = Math.round(offsetMs + beatPos * beatMs);
    if (t >= durationMs - 100) break;
    const s = strengthAt(beatPos, i);
    const strongest = (i * 5 + (i >> 2)) % 4;
    for (let b = 0; b < 4; b++) {
      if (b === strongest) {
        bands[b].onsets.push({ t, s });
      } else {
        // Weaker, slightly later onsets in the other bands: exercises the merge.
        const jitter = ((b * 7 + i) % 5) * 4;
        const bandS = s * (0.5 + 0.1 * ((i + b) % 4));
        bands[b].onsets.push({ t: t + jitter, s: Number(bandS.toFixed(4)) });
      }
    }
  }

  const hopMs = 500;
  const values = [];
  for (let i = 0; i * hopMs < durationMs; i++) {
    values.push(Math.min(1, Math.max(0, energy(i * hopMs + hopMs / 2))));
  }

  return {
    featuresVersion: 1,
    durationMs,
    hopMs: 10,
    bands,
    tempo: { bpm, confidence, beats, downbeats, fitted: true }, // the fixture's grid is the truth: the fit leaves it
    energy: { hopMs, values },
    sections: [],
    highlightMs,
    audio: { sourceName: "youtube", identifier: "fixture", length: durationMs },
  };
}

// 0-60 s quiet, 60-120 s loud, 120-180 s quiet (the brief's fixture).
function threeSectionEnergy(ms) {
  return ms >= 60000 && ms < 120000 ? 1.0 : 0.3;
}

// --- features v2 (drums / bass / lead / phrases) --------------------------------

const BEATS_PER_PHRASE = 16;
const SUSTAIN_FIXTURE_BEATS = 2;

// Per-letter event patterns, in beats from the phrase start. Repeated letters
// give identical patterns, which is what makes a phrase a "repeat".
function drumPattern(letter) {
  const events = [];
  for (let b = 0; b < BEATS_PER_PHRASE; b++) {
    if (letter === "A") {
      events.push({ beat: b, kind: b % 2 === 0 ? "kick" : "snare" });
      events.push({ beat: b + 0.5, kind: "hat" });
    } else {
      events.push({ beat: b, kind: b % 4 === 1 || b % 4 === 3 ? "snare" : "kick" });
      if (b % 4 === 2) events.push({ beat: b + 0.5, kind: "kick" });
      if (b % 4 === 3) events.push({ beat: b + 0.5, kind: "perc" });
    }
  }
  return events;
}

function bassPattern(letter) {
  const step = letter === "A" ? 2 : 1.5;
  const roots = letter === "A" ? [40, 43, 38, 45] : [41, 36, 43, 40, 38];
  const events = [];
  for (let k = 0, b = 0; b < BEATS_PER_PHRASE; k++, b += step) {
    events.push({ beat: b, lenBeats: step * 0.75, pitch: roots[k % roots.length] });
  }
  return events;
}

// Without holds a lead note per beat; with holds every holdsEveryBeats-th beat
// starts a note that is holdsEveryBeats beats long (the beats it covers are empty).
//
// sustainAtBeats instead: a half-beat tap on every beat, except that each listed beat starts a sustained note of
// SUSTAIN_FIXTURE_BEATS beats (the beats it covers are empty). A few holds among many taps, like a real chart.
function leadPattern(letter, holdsEveryBeats, sustainAtBeats) {
  const scale = letter === "A" ? [60, 62, 64, 67, 65, 64, 62, 60] : [67, 65, 64, 62, 64, 65, 67, 72];
  const events = [];
  if (sustainAtBeats.length > 0) {
    for (let b = 0, k = 0; b < BEATS_PER_PHRASE; k++) {
      const long = sustainAtBeats.includes(b);
      events.push({ beat: b, lenBeats: long ? SUSTAIN_FIXTURE_BEATS : 0.5, pitch: scale[k % scale.length] });
      b += long ? SUSTAIN_FIXTURE_BEATS : 1;
    }
  } else if (holdsEveryBeats > 0) {
    for (let b = 0, k = 0; b < BEATS_PER_PHRASE; b += holdsEveryBeats, k++) {
      events.push({ beat: b, lenBeats: Math.min(holdsEveryBeats, BEATS_PER_PHRASE - b), pitch: scale[k % scale.length] });
    }
  } else {
    for (let b = 0; b < BEATS_PER_PHRASE; b++) events.push({ beat: b, lenBeats: 0.5, pitch: scale[b % scale.length] });
  }
  return events;
}

function strengthOfIndex(index) {
  return Number((0.6 + (((index * 37) % 13) / 13) * 0.4).toFixed(3));
}

function makeLayeredFeatures({
  bpm = 120,
  durationMs = 64000,
  structure = "ABAB",
  leadConfidence = 0.9,
  drums = true,
  bass = true,
  lead = true,
  holdsEveryBeats = 0,
  sustainAtBeats = [],
  energy,
} = {}) {
  const base = makeFeatures({ bpm, durationMs, highlightMs: Math.round(durationMs / 2), ...(energy ? { energy } : {}) });
  const beatMs = 60000 / bpm;
  const phraseMs = BEATS_PER_PHRASE * beatMs;
  const count = Math.floor(durationMs / phraseMs);

  const drumEvents = [];
  const bassEvents = [];
  const leadEvents = [];
  const list = [];
  const firstOfLetter = new Map();
  for (let i = 0; i < count; i++) {
    const letter = structure[i % structure.length];
    const start = i * phraseMs;
    const place = (events, into, withConf, enabled) => {
      if (!enabled) return;
      // Strength depends on the index inside the phrase, so repeats are identical.
      for (const [index, e] of events.entries()) {
        const t = Math.round(start + e.beat * beatMs);
        const event = { t, s: strengthOfIndex(index) };
        if (e.kind) event.kind = e.kind;
        if (withConf !== null) {
          event.len = Math.round(e.lenBeats * beatMs);
          event.pitch = e.pitch;
          event.conf = withConf;
        }
        into.push(event);
      }
    };
    place(drumPattern(letter), drumEvents, null, drums);
    place(bassPattern(letter), bassEvents, 0.7, bass);
    place(leadPattern(letter, holdsEveryBeats, sustainAtBeats), leadEvents, leadConfidence, lead);

    // Like the plugin: a repeat points at the EARLIEST matching phrase.
    const source = firstOfLetter.get(letter);
    if (source === undefined) firstOfLetter.set(letter, i);
    list.push({
      startMs: Math.round(start),
      endMs: Math.round(start + phraseMs),
      repeatOf: source === undefined ? null : source,
      similarity: source === undefined ? 0 : 0.95,
      lagMs: source === undefined ? 0 : Math.round(start - source * phraseMs),
      activity: {
        drums: drums ? (letter === "A" ? 0.8 : 0.9) : 0,
        bass: bass ? (letter === "A" ? 0.6 : 0.4) : 0,
        lead: lead ? (letter === "A" ? 0.7 : 0.8) : 0,
      },
      confidence: { drums: drums ? 0.8 : 0, bass: bass ? 0.7 : 0, lead: lead ? leadConfidence : 0 },
    });
  }

  return {
    ...base,
    featuresVersion: 2,
    analysisTier: "full",
    drums: drumEvents,
    bass: bassEvents,
    lead: leadEvents,
    phrases: { beatsPerPhrase: BEATS_PER_PHRASE, list },
  };
}

// A generator flag that takes the named parameters away from every level: what a chart is without them, as flags to pass.
function flagWithout(name, ...params) {
  const without = Object.fromEntries(params.map((param) => [param, undefined]));
  FLAGS[name] = { label: name, levels: Object.fromEntries(["easy", "normalV26", "normal", "hard", "hell"].map((level) => [level, without])) };
  return { [name]: true };
}

module.exports = { flagWithout, makeFeatures, makeLayeredFeatures, threeSectionEnergy };
