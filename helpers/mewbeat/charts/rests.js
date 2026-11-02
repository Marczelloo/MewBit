// A rest the player feels as a hole: a stretch of at least diff.fillRestBeats with no note while the music plays on
// (a calm passage charted on the beat, a band-path phrase whose onsets fell between the grid steps). Such a rest gets
// a note from the music itself, a sound heard there: an onset of one of the four bands or a layer event, on the
// difficulty's own grid (baseDiv steps per beat, a beat before a half beat), nearest the middle of the rest, on a lane
// neither neighbour uses, within the floors and hold rules. Longest rest first, until none is left.
const { LEAD_IN_MS, MAX_SNAP_DISTANCE_MS } = require("./difficulty");
const { gridSlot } = require("./grid");
const { beatMsOf, holdSafe } = require("./holds");
const { nearestIndex } = require("./util");

const FILL_MIN_ENERGY = 0.2; // a rest is filled only where the music is at least this loud (a quiet passage may rest)
const LEADER_BONUS = 0.5; // a sound of the phrase's leading layer (the sung line of a vocal phrase) ranks first
const BAND_LANES = { low: 0, lowmid: 1, highmid: 2, high: 3 };
const KICK_LANES = [0, 3];
const SNARE_LANES = [1, 2];

const byTime = (a, b) => a.t - b.t || a.lane - b.lane;
const endOf = (n) => n.t + (n.len > 0 ? n.len : 0);

// The music's sounds as { t, s, lanes, layer }: layer events (kicks outside, snares inside, bass low, lead high) or,
// for features without layers, band onsets (lane = band), time-ordered.
function soundsOf(features) {
  const out = [];
  const push = (t, s, lanes, layer) => {
    if (Number.isFinite(t)) out.push({ t: Math.round(t), s: Number.isFinite(s) ? s : 0.5, lanes, layer });
  };
  const layered = ["drums", "bass", "lead"].some((k) => Array.isArray(features[k]) && features[k].length > 0);
  for (const band of !layered && Array.isArray(features.bands) ? features.bands : []) {
    const lane = BAND_LANES[band?.name];
    if (lane === undefined || !Array.isArray(band.onsets)) continue;
    for (const o of band.onsets) push(o?.t, o?.s, [lane], "bands");
  }
  for (const d of Array.isArray(features.drums) ? features.drums : []) {
    const lanes = d?.kind === "kick" ? KICK_LANES : d?.kind === "snare" ? SNARE_LANES : [2, 1, 3, 0];
    push(d?.t, d?.s, lanes, "drums");
  }
  for (const b of Array.isArray(features.bass) ? features.bass : []) push(b?.t, b?.s, [0, 1], "bass");
  for (const l of Array.isArray(features.lead) ? features.lead : []) push(l?.t, (l?.s ?? 0.5) * (l?.conf ?? 1), [2, 3, 1], "lead");
  return out.sort((a, b) => a.t - b.t);
}

// t on the difficulty's grid ({ t, level }: level 0 a beat, 1 a finer step), or null when no grid step of baseDiv
// per beat is within MAX_SNAP_DISTANCE_MS. Without a beat grid the time stays raw.
function onGrid(timing, t, div) {
  if (!timing?.snapped) return { t, level: 0 };
  const points = timing.gridPoints(div);
  if (points.length === 0) return null;
  const snapped = points[nearestIndex(points, t)];
  if (Math.abs(snapped - t) > MAX_SNAP_DISTANCE_MS) return null;
  return { t: snapped, level: gridSlot(timing, snapped)?.beat ? 0 : 1 };
}

// The rests of `notes` of at least diff.fillRestBeats, longest first: { fromMs, toMs, avoid } where `avoid` holds the
// lanes of the moments on either side (a note there would make a jack). With `untilMs` the rest after the last note
// up to then counts too.
function restsOf(notes, diff, timing, untilMs) {
  const rests = [];
  let lastEnd = LEAD_IN_MS;
  let lastLanes = [];
  const consider = (fromMs, toMs, nextLanes) => {
    if (toMs - fromMs >= diff.fillRestBeats * beatMsOf(timing, fromMs)) rests.push({ fromMs, toMs, avoid: new Set([...lastLanes, ...nextLanes]) });
  };
  for (let i = 0; i < notes.length; ) {
    let j = i;
    while (j < notes.length && notes[j].t === notes[i].t) j++;
    const moment = notes.slice(i, j);
    consider(lastEnd, moment[0].t, moment.map((n) => n.lane));
    lastEnd = Math.max(lastEnd, ...moment.map(endOf));
    lastLanes = moment.map((n) => n.lane);
    i = j;
  }
  if (untilMs !== null) consider(lastEnd, untilMs, []);
  return rests.sort((a, b) => b.toMs - b.fromMs - (a.toMs - a.fromMs) || a.fromMs - b.fromMs);
}

// fillRests(notes, ctx, diff, { fromMs, toMs, untilMs }) -> notes, time-ordered. `ctx` is generate.js's analysis
// (features, timing, energy, phrases, leaders). Fill notes go between fromMs and toMs only (one phrase, so a repeat
// copies its source's fills); `untilMs` (the end of the song, for the last phrase) ends the rest after the last note.
function fillRests(notes, ctx, diff, { fromMs: windowFrom = LEAD_IN_MS, toMs: windowTo = Infinity, untilMs = null } = {}) {
  if (!(diff.fillRestBeats > 0)) return notes;
  const { features, timing, energy, phrases = [], leaders = [] } = ctx;
  const sounds = soundsOf(features);
  const leaderAt = (t) => {
    const i = phrases.findIndex((p) => t >= p.startMs && t < p.endMs);
    return i < 0 ? null : leaders[i];
  };
  const laneGap = diff.minLaneGapMs ?? 0;
  const out = [...notes].sort(byTime);
  const tried = new Set();
  for (;;) {
    const rest = restsOf(out, diff, timing, untilMs).find((r) => !tried.has(r.fromMs) && r.toMs > windowFrom && r.fromMs < windowTo);
    if (!rest) return out;
    const { fromMs, toMs, avoid } = rest;
    const beat = beatMsOf(timing, fromMs);
    const clear = Math.max(diff.minNoteGapMs ?? 0, beat / 2);
    const mid = (fromMs + toMs) / 2;
    const leader = leaderAt(mid);
    const candidates = [];
    const lo = Math.max(fromMs + clear, windowFrom);
    const hi = Math.min(toMs - clear, windowTo - 1);
    for (const sound of sounds) {
      if (sound.t < lo - MAX_SNAP_DISTANCE_MS) continue;
      if (sound.t > hi + MAX_SNAP_DISTANCE_MS) break;
      const slot = onGrid(timing, sound.t, diff.baseDiv ?? 2);
      if (!slot || slot.t < lo || slot.t > hi || energy.at(slot.t) < FILL_MIN_ENERGY) continue;
      candidates.push({ t: slot.t, level: slot.level, rank: sound.s + (sound.layer === leader ? LEADER_BONUS : 0), lanes: sound.lanes });
    }
    candidates.sort((a, b) => a.level - b.level || Math.abs(a.t - mid) - Math.abs(b.t - mid) || b.rank - a.rank);
    let placed = null;
    for (const c of candidates) {
      const lane = c.lanes.find((l) =>
        !avoid.has(l) &&
        out.every((m) => m.lane !== l || (Math.abs(m.t - c.t) >= laneGap && Math.abs(endOf(m) - c.t) >= laneGap)) &&
        holdSafe({ t: c.t, lane: l }, out, diff, timing));
      if (lane !== undefined) {
        placed = { t: c.t, lane };
        break;
      }
    }
    if (!placed) {
      tried.add(fromMs);
      continue;
    }
    out.push(placed);
    out.sort(byTime);
  }
}

module.exports = { FILL_MIN_ENERGY, fillRests };
