// Deterministic features-JSON-v1 builder for chart tests. No randomness: every
// "variation" below is a pure function of the onset index.
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
    tempo: { bpm, confidence, beats, downbeats },
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

module.exports = { makeFeatures, threeSectionEnergy };
