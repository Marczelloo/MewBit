// Measures a generator level on the 80 TRAIN songs against the human Normal maps: the numbers Task 3 reports.
//   node measure_normal.js [--level normal] [--json out.json] [--songs id,id] [--set '{"foreground":0.5}'] [--budget '{"q":0.7}'] [--k '{"1":1.2}']
// --set merges into the level's parameters, --budget into BUDGET (momentWeights.js) and --k into the level's K coefficients (by index), for tuning without edits.
// Beat share uses 70 ms (rel_proxy_select.py BEAT_TOL); "good grid" = human beat share >= .85 (the spec's .92 / .76 are on those songs).
// Moments/s are counted in the phrases phrase_density.py used (>= 2 s, inside the first..last human moment), so the unit is the
// one the budget was fitted on. Beat share = grid beats (inside that span) with a note within 35 ms. Notes with no sound = notes
// with no onset of any layer within 35 ms. F1 is on moments, 35 ms. Test songs are never read: ids come from corpus.csv (train).
// Local density: p50 / p95 / p99 / max over all phrases of all songs (moments/s) and over every 4-beat window (notes/s, a window
// every quarter beat across the human span), chart against human. Chord share (moments) = moments with more than one note.
// Repeats: for every repeat phrase, its loudness against its source's (the budget's measure, audibleOf), what repeatPlan makes of it
// (copy / extra / fresh) and the moments it plays against the moments in the window it copies (sourceWindow), chart and human; the
// ratios are of pairs whose source plays at least 4 moments. --repeat merges into REPEAT (momentWeights.js).
const fs = require("fs"), path = require("path");
const repo = path.resolve(__dirname, "../../..");
const { analyse, generateChart } = require(path.join(repo, "helpers/mewbeat/charts/generate"));
const { strengthAt } = require(path.join(repo, "helpers/mewbeat/charts/rhythm"));
const { isRepeatOf } = require(path.join(repo, "helpers/mewbeat/charts/phrases"));
const { sourceWindow } = require(path.join(repo, "helpers/mewbeat/charts/repeats"));
const { audibleOf, phraseBudget, repeatPlan } = require(path.join(repo, "helpers/mewbeat/charts/selection"));

const arg = (name, dflt) => { const i = process.argv.indexOf("--" + name); return i < 0 ? dflt : process.argv[i + 1]; };
const level = arg("level", "normal");
const { levelOf } = require(path.join(repo, "helpers/mewbeat/charts/difficulty"));
const weights = require(path.join(repo, "helpers/mewbeat/charts/momentWeights"));
if (arg("set", null)) Object.assign(levelOf(level), JSON.parse(arg("set", "{}")));
if (arg("budget", null)) Object.assign(weights.BUDGET, JSON.parse(arg("budget", "{}")));
if (arg("repeat", null)) Object.assign(weights.REPEAT, JSON.parse(arg("repeat", "{}")));
if (arg("k", null)) for (const [i, v] of Object.entries(JSON.parse(arg("k", "{}")))) weights.K[levelOf(level).scoreLevel ?? level].coef[+i] = v;
const only = arg("songs", null)?.split(",");
const rows = fs.readFileSync(path.join(repo, "mapping-analysis/shared/corpus.csv"), "utf8").split("\n").slice(1).map((l) => l.split(","));
const trainIds = rows.filter((r) => r[1] === "train").map((r) => r[0]);
const TOL = 35, BEAT_TOL = 70, MIN_PHRASE_MS = 2000;

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const near = (sorted, t, tol) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < t) lo = m + 1; else hi = m; } return (lo < sorted.length && sorted[lo] - t <= tol) || (lo > 0 && t - sorted[lo - 1] <= tol); };

function phraseDensities(times, phrases, lo, hi) {
  const out = [];
  for (const p of phrases) {
    if (p.endMs - p.startMs < MIN_PHRASE_MS || p.startMs < lo || p.endMs > hi) continue;
    out.push({ a: p.startMs, b: p.endMs, y: times.filter((t) => t >= p.startMs && t < p.endMs).length / ((p.endMs - p.startMs) / 1000) });
  }
  return out;
}

// Notes per second in every 4-beat window, one starting every quarter beat across [lo, hi].
function windows(times, beatMs, lo, hi) {
  const sorted = [...times].sort((a, b) => a - b), width = 4 * beatMs, out = [];
  let a = 0, b = 0;
  for (let w = lo; w + width <= hi; w += beatMs / 4) {
    while (a < sorted.length && sorted[a] < w) a++;
    if (b < a) b = a;
    while (b < sorted.length && sorted[b] < w + width) b++;
    out.push((b - a) / (width / 1000));
  }
  return out;
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const pool = { hp: [], cp: [], hw: [], cw: [] };
const inside = (times, a, b) => times.filter((t) => t >= a && t < b).length;
const MIN_SOURCE = 4;
// The repeats of one song: loudness against the source, the plan and the moments, chart and human.
function repeatsOf(ctx, diff, cMom, hMom) {
  const out = [];
  ctx.phrases.forEach((p, i) => {
    if (!isRepeatOf(p, i)) return;
    const source = ctx.phrases[p.repeatOf];
    const { from, to } = sourceWindow(p, source);
    const was = audibleOf(ctx, source, 1).loudness;
    const nSource = inside(cMom, from, to);
    out.push({
      i, loud: was > 0 ? audibleOf(ctx, p, 1).loudness / was : 1,
      plan: repeatPlan(p, source, ctx, diff, nSource), budget: phraseBudget(p, ctx, diff),
      chartSource: nSource, chart: inside(cMom, p.startMs, p.endMs),
      humanSource: inside(hMom, from, to), human: inside(hMom, p.startMs, p.endMs),
    });
  });
  return out;
}

const r = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const songs = [];
for (const id of trainIds) {
  if (only && !only.includes(id)) continue;
  const humanPath = path.join(repo, ".mewbeat-debug/data/human/normal", id + ".json");
  if (!fs.existsSync(humanPath)) continue;
  const human = JSON.parse(fs.readFileSync(humanPath, "utf8"));
  const raw = JSON.parse(fs.readFileSync(path.join(repo, ".mewbeat-debug/data/features", id + ".json"), "utf8"));
  const features = raw.features ?? raw;
  const chart = generateChart(features, level, "measure");
  if (!chart) { songs.push({ id, noChart: true }); continue; }
  const ctx = analyse(features);
  const hMom = [...new Set(human.map((n) => n[0]))].sort((a, b) => a - b);
  const lo = hMom[0], hi = hMom[hMom.length - 1];
  const cMom = [...new Set(chart.notes.map((n) => n.t))].sort((a, b) => a - b);
  const beats = ctx.timing.snapped ? ctx.timing.beats.filter((t) => t >= lo && t <= hi) : [];
  const share = (moms) => (beats.length ? beats.filter((b) => near(moms, b, BEAT_TOL)).length / beats.length : NaN);
  const hp = phraseDensities(hMom, ctx.phrases, lo, hi), cp = phraseDensities(cMom, ctx.phrases, lo, hi);
  pool.hp.push(...hp.map((p) => p.y)); pool.cp.push(...cp.map((p) => p.y));
  const beatMs = ctx.timing.medianMs > 0 ? ctx.timing.medianMs : 500;
  pool.hw.push(...windows(human.map((n) => n[0]), beatMs, lo, hi)); pool.cw.push(...windows(chart.notes.map((n) => n.t), beatMs, lo, hi));
  const wsum = (ps) => ps.reduce((s, p) => s + p.y * (p.b - p.a), 0) / ps.reduce((s, p) => s + (p.b - p.a), 0);
  const inSpan = (ts) => ts.filter((t) => t >= lo && t <= hi).length / ((hi - lo) / 1000);
  let tp = 0; for (const t of cMom) if (near(hMom, t, TOL)) tp++;
  let hit = 0; for (const t of hMom) if (near(cMom, t, TOL)) hit++;
  const prec = tp / cMom.length, rec = hit / hMom.length;
  const repeats = repeatsOf(ctx, levelOf(level), cMom, hMom);
  songs.push({
    id, repeats, stars: chart.stars, noteCount: chart.notes.length, momentCount: cMom.length,
    humanDensity: hp.length ? wsum(hp) : NaN, chartDensity: cp.length ? wsum(cp) : NaN,
    humanPhraseCv: hp.length > 1 ? std(hp.map((p) => p.y)) / mean(hp.map((p) => p.y)) : NaN,
    chartPhraseCv: cp.length > 1 ? std(cp.map((p) => p.y)) / mean(cp.map((p) => p.y)) : NaN,
    phraseCorr: hp.length > 2 ? corr(hp.map((p) => p.y), cp.map((p) => p.y)) : NaN,
    humanBeatShare: share(hMom), chartBeatShare: share(cMom),
    humanNps: inSpan(human.map((n) => n[0])), chartNps: inSpan(chart.notes.map((n) => n.t)),
    noSound: chart.notes.filter((n) => strengthAt(ctx, n.t) === null).length / chart.notes.length,
    precision: prec, recall: rec, f1: prec + rec ? (2 * prec * rec) / (prec + rec) : 0,
    chordShare: 1 - cMom.length / chart.notes.length, chordMomentShare: chordMoments(chart.notes), holds: chart.notes.filter((n) => n.len > 0).length / chart.notes.length,
    loud: ctx.energy && undefined,
  });
}
function chordMoments(notes) { const by = new Map(); for (const n of notes) by.set(n.t, (by.get(n.t) ?? 0) + 1); return [...by.values()].filter((c) => c > 1).length / by.size; }
function corr(x, y) { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); }

const ok = songs.filter((s) => !s.noChart);
const allRepeats = ok.flatMap((s) => s.repeats);
const threshold = weights.REPEAT.louder;
const ratios = (rs, own, source) => rs.filter((x) => x[source] >= MIN_SOURCE).map((x) => x[own] / x[source]);
const ratioSummary = (rs) => ({ n: rs.filter((x) => x.chartSource >= MIN_SOURCE).length, chartMedian: r(median(ratios(rs, "chart", "chartSource"))), chartMean: r(mean(ratios(rs, "chart", "chartSource"))), humanN: rs.filter((x) => x.humanSource >= MIN_SOURCE).length, humanMedian: r(median(ratios(rs, "human", "humanSource"))), humanMean: r(mean(ratios(rs, "human", "humanSource"))) });
const col = (k) => ok.map((s) => s[k]).filter(Number.isFinite);
const cd = col("chartDensity"), hd = col("humanDensity");
const summary = {
  level, songs: songs.length, noChart: songs.length - ok.length,
  chartMomentsPerSec: { median: r(median(cd)), cv: r(std(cd) / mean(cd)) },
  humanMomentsPerSec: { median: r(median(hd)), cv: r(std(hd) / mean(hd)) },
  corrSongDensityWithHuman: r(corr(ok.filter((s) => Number.isFinite(s.chartDensity) && Number.isFinite(s.humanDensity)).map((s) => s.chartDensity), ok.filter((s) => Number.isFinite(s.chartDensity) && Number.isFinite(s.humanDensity)).map((s) => s.humanDensity))),
  phraseCv: { chart: r(mean(col("chartPhraseCv"))), human: r(mean(col("humanPhraseCv"))) },
  phraseCorrWithHuman: { mean: r(mean(col("phraseCorr"))), median: r(median(col("phraseCorr"))) },
  beatShare: { chart: r(median(col("chartBeatShare")), 2), human: r(median(col("humanBeatShare")), 2), chartMean: r(mean(col("chartBeatShare")), 2), humanMean: r(mean(col("humanBeatShare")), 2) },
  notesPerSec: { chart: r(median(col("chartNps")), 2), human: r(median(col("humanNps")), 2) },
  stars: { median: r(median(col("stars")), 2), mean: r(mean(col("stars")), 2) },
  noSoundShare: { median: r(median(col("noSound")), 3), mean: r(mean(col("noSound")), 3) },
  chordShare: { median: r(median(col("chordShare")), 3) },
  chordMomentShare: { median: r(median(col("chordMomentShare")), 3), max: r(Math.max(...col("chordMomentShare")), 3) },
  phraseMomentsPerSec: Object.fromEntries(["cp", "hp"].map((k) => [k === "cp" ? "chart" : "human", { p50: r(pct(pool[k], 0.5), 2), p95: r(pct(pool[k], 0.95), 2), p99: r(pct(pool[k], 0.99), 2), max: r(Math.max(...pool[k]), 2), n: pool[k].length }])),
  window4BeatNotesPerSec: Object.fromEntries(["cw", "hw"].map((k) => [k === "cw" ? "chart" : "human", { p50: r(pct(pool[k], 0.5), 2), p95: r(pct(pool[k], 0.95), 2), p99: r(pct(pool[k], 0.99), 2), max: r(Math.max(...pool[k]), 2), n: pool[k].length }])), holdShare: { median: r(median(col("holds")), 3) },
  f1: { median: r(median(col("f1"))), precision: r(median(col("precision"))), recall: r(median(col("recall"))) },
  repeats: {
    n: allRepeats.length, louder: allRepeats.filter((x) => x.loud >= threshold).length,
    copied: allRepeats.filter((x) => x.plan.copy && x.plan.extra === 0).length, withExtra: allRepeats.filter((x) => x.plan.extra > 0).length, fresh: allRepeats.filter((x) => !x.plan.copy).length,
    notesAgainstSource: {
      louder: ratioSummary(allRepeats.filter((x) => x.loud >= threshold)),
      louderCopiedWithExtra: ratioSummary(allRepeats.filter((x) => x.loud >= threshold && x.plan.copy)),
      louderFresh: ratioSummary(allRepeats.filter((x) => x.loud >= threshold && !x.plan.copy)),
      sameLoudness: ratioSummary(allRepeats.filter((x) => x.loud < threshold)),
    },
  },
};
console.log(JSON.stringify(summary, null, 1));
const out = arg("json", null);
if (out) fs.writeFileSync(out, JSON.stringify({ summary, songs }));
const good = ok.filter((s) => s.humanBeatShare >= 0.85);
console.log(JSON.stringify({ goodGridSongs: good.length, beatShareGoodGrid: { chart: r(median(good.map((s) => s.chartBeatShare)), 2), human: r(median(good.map((s) => s.humanBeatShare)), 2) } }));
