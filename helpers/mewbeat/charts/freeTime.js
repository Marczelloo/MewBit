// Music with no tempo to hold (generator flag freeTime, difficulty.js FREE_TIME). The fitted grid (beatFit.js) cannot tell
// that it failed on a stretch that speeds up, slows down or is played freely: it lays the neighbouring tempo over it, and
// the sounds there sit no nearer to its lines than chance. A phrase is free when three things say so together:
//   the tracker found no tempo: its beats wander (where the music has a tempo their spread within a phrase is about 0.02)
//   the sounds do not sit on the grid's lines
//   the notes of the decoded melody share no quarter grid at the fitted tempo, wherever its lines lie
// Any one of them alone is common in music the grid fits (a breakdown loses the tracker, vocals sit off the lines, a few
// slow notes lock to nothing), and there charting by the grid is closer to what people play. A free phrase's moments keep the
// times they were heard at and are told apart by their strength alone (selection.js); a song with no decoded melody has none.
const { cleanTimes, lowerBound, median } = require("./util");

const TAU = 2 * Math.PI;
const QUARTERS = 4; // the lines of the grid the charts are laid on, per beat

// How uneven the beats the tracker gave a phrase are: the mean distance of their intervals from the median interval, as a
// share of it. null with fewer than `minBeats` beats in the phrase: too few to say.
function beatSpread(beats, phrase, minBeats) {
  const inside = beats.slice(lowerBound(beats, phrase.startMs), lowerBound(beats, phrase.endMs));
  if (inside.length < minBeats) return null;
  const intervals = inside.slice(1).map((t, i) => t - inside[i]);
  const mid = median(intervals);
  if (!(mid > 0)) return null;
  return intervals.reduce((sum, x) => sum + Math.abs(x - mid), 0) / intervals.length / mid;
}

// Where the sounds of a phrase (`times`, in order, and the weight of each) sit against the quarter lines of the grid, as the
// mean of their phases: { n, onGrid, lock }. onGrid is 1 with every sound on a line, 0 with the sounds anywhere and -1 with all of them
// halfway between two lines; lock is 1 when they share one quarter grid at the grid's tempo, whether or not it is this one.
function gridPhase(times, weights, grid, phrase) {
  let re = 0, im = 0, weight = 0, n = 0;
  let k = Math.max(0, lowerBound(grid, phrase.startMs + 1e-9) - 1);
  for (let i = lowerBound(times, phrase.startMs); i < times.length && times[i] < phrase.endMs; i++) {
    const t = times[i];
    const w = weights[i];
    while (k + 1 < grid.length && grid[k + 1] <= t) k++;
    if (k + 1 >= grid.length || grid[k] > t) continue;
    const phase = (TAU * QUARTERS * (t - grid[k])) / (grid[k + 1] - grid[k]);
    re += w * Math.cos(phase);
    im += w * Math.sin(phase);
    weight += w;
    n++;
  }
  return weight > 0 ? { n, onGrid: re / weight, lock: Math.hypot(re, im) / weight } : { n: 0, onGrid: null, lock: null };
}

// Every band's onsets in time: { times, weights }, an onset weighing its strength.
function bandSounds(raw) {
  const out = [];
  for (const band of Array.isArray(raw?.bands) ? raw.bands : []) {
    for (const o of Array.isArray(band?.onsets) ? band.onsets : []) if (Number.isFinite(o?.t) && Number.isFinite(o?.s)) out.push({ t: o.t, w: o.s });
  }
  out.sort((a, b) => a.t - b.t);
  return { times: out.map((o) => o.t), weights: out.map((o) => o.w) };
}

// freePhrases(raw, features, timing, phrases, rule) -> the phrases that are free, in order. `raw` holds the tracker's beats
// and the onsets as measured, `features` the decoded melody (the tuned line where there is one), `timing` the fitted grid.
// rule = { spread, minBeats, onGrid, minLead, leadLock }: the tracked beats spread wider than `spread`, the sounds under
// `onGrid` of the lines, and `minLead` or more notes of the melody locked under `leadLock`. [] without a rule, a grid or a melody.
function freePhrases(raw, features, timing, phrases, rule) {
  const line = Array.isArray(features?.decodedMelodyTuned) ? features.decodedMelodyTuned : features?.decodedMelody;
  if (!rule || !timing?.snapped || !Array.isArray(line) || line.length === 0) return [];
  const beats = cleanTimes(raw?.tempo?.beats);
  const sounds = bandSounds(raw);
  const lead = line.map((n) => n?.t).filter(Number.isFinite).sort((a, b) => a - b);
  const each = lead.map(() => 1);
  return phrases.filter((phrase) => {
    const spread = beatSpread(beats, phrase, rule.minBeats);
    if (spread === null || spread <= rule.spread) return false;
    const heard = gridPhase(sounds.times, sounds.weights, timing.beats, phrase);
    if (heard.n === 0 || heard.onGrid >= rule.onGrid) return false;
    const melody = gridPhase(lead, each, timing.beats, phrase);
    return melody.n >= rule.minLead && melody.lock < rule.leadLock;
  });
}

// Whether t lies in one of the free phrases.
const inFree = (free, t) => free.some((phrase) => t >= phrase.startMs && t < phrase.endMs);

module.exports = { beatSpread, freePhrases, gridPhase, inFree };
