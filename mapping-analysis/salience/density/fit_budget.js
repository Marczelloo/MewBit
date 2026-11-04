// Fits the phrase budget of selection.js on the 80 TRAIN songs: model B of phrase_density.py (salient sounds per second +
// loudness of the phrase, Ridge alpha 1 on standardized columns) with K = raw_strength on the generator grid
// (k_weights_raw.json), human Normal moments per second as the target. Writes budget_fit.json; momentWeights.js carries the numbers.
//   node fit_budget.js
// Target phrases are the generator's phrases (analyse) inside the first..last human Normal moment with at least 2 s the music plays
// (selection.js audibleOf: not the lead-in, not the silence); every rate is per such second, as the budget is spent.
// Salient = a candidate whose K score lies in the song's top (1 - q): q is picked on train by the r2 of the salient rate
// against the target. Test songs are never read: ids come from corpus.csv (split = train).
const fs = require("fs"), path = require("path");
const repo = path.resolve(__dirname, "../../..");
const { analyse } = require(path.join(repo, "helpers/mewbeat/charts/generate"));
const { audibleOf, scoreMoments } = require(path.join(repo, "helpers/mewbeat/charts/selection"));
const { LEAD_IN_MS, SILENCE_ENERGY } = require(path.join(repo, "helpers/mewbeat/charts/difficulty"));

const QS = [0.5, 0.6, 0.7, 0.8, 0.9], MIN_PHRASE_MS = 2000, ALPHA = 1, NFOLD = 5;
const rows = fs.readFileSync(path.join(repo, "mapping-analysis/shared/corpus.csv"), "utf8").split("\n").slice(1).map((l) => l.split(","));
const trainIds = rows.filter((r) => r[1] === "train").map((r) => r[0]);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const corr = (x, y) => { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; x.forEach((v, i) => { a += (v - mx) * (y[i] - my); b += (v - mx) ** 2; c += (y[i] - my) ** 2; }); return a / Math.sqrt(b * c); };

// The phrase table: one row per target phrase, with its salient rate at every q and its loudness against the song.
const table = [];
trainIds.forEach((id, song) => {
  const humanPath = path.join(repo, ".mewbeat-debug/data/human/normal", id + ".json");
  if (!fs.existsSync(humanPath)) return;
  const human = [...new Set(JSON.parse(fs.readFileSync(humanPath, "utf8")).map((n) => n[0]))].sort((a, b) => a - b); // moments: a chord is one
  const ctx = analyse(JSON.parse(fs.readFileSync(path.join(repo, ".mewbeat-debug/data/features", id + ".json"), "utf8")));
  const scored = scoreMoments(ctx, "normal");
  const sorted = scored.map((m) => m.score).sort((a, b) => a - b);
  const cut = QS.map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
  const values = ctx.features.energy?.values ?? [], hop = ctx.energy.hopMs;
  const songMean = values.length ? mean(values) : 1;
  const lo = human[0], hi = human[human.length - 1];
  for (const p of ctx.phrases) {
    if (p.startMs < lo || p.endMs > hi) continue;
    const played = audibleOf(ctx, p, songMean), secs = played.seconds;
    if (secs * 1000 < MIN_PHRASE_MS) continue;
    const heard = scored.filter((m) => m.t >= p.startMs && m.t < p.endMs && m.t >= LEAD_IN_MS && ctx.energy.at(m.t) >= SILENCE_ENERGY);
    table.push({
      song, id, secs, y: human.filter((t) => t >= p.startMs && t < p.endMs).length / secs,
      sal: cut.map((c) => heard.filter((m) => m.score >= c).length / secs),
      loud: played.loudness,
    });
  }
});
const y = table.map((r) => r.y);
console.log(new Set(table.map((r) => r.song)).size, "songs,", table.length, "phrases, mean", mean(y).toFixed(3), "moments/s");

// Ridge on [salient rate, loud]: closed form of the 2x2 normal equations on standardized columns.
function ridge(X, t) {
  const mu = [0, 1].map((j) => mean(X.map((r) => r[j]))), sd = [0, 1].map((j) => std(X.map((r) => r[j])) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j]));
  const tb = mean(t);
  let a = ALPHA, b = 0, d = ALPHA, e = 0, f = 0;
  Z.forEach((z, i) => { a += z[0] * z[0]; b += z[0] * z[1]; d += z[1] * z[1]; e += z[0] * (t[i] - tb); f += z[1] * (t[i] - tb); });
  const det = a * d - b * b, w = [(d * e - b * f) / det, (a * f - b * e) / det];
  const coef = w.map((v, j) => v / sd[j]);
  return { coef, intercept: tb - coef[0] * mu[0] - coef[1] * mu[1] };
}
const predict = (m, r, k) => m.intercept + m.coef[0] * r.sal[k] + m.coef[1] * r.loud;

// q on train: the r2 of the salient rate against the target.
const r2 = QS.map((_, k) => corr(table.map((r) => r.sal[k]), y) ** 2);
const best = r2.indexOf(Math.max(...r2));
console.log("r2 of the salient rate by q", QS.map((q, k) => `${q}: ${r2[k].toFixed(3)}`).join("  "), "-> q", QS[best]);
const model = ridge(table.map((r) => [r.sal[best], r.loud]), y);

// Song-grouped cross-validation of that model, pooled r2 and r2 of the song means / of the deviations from them.
const songs = [...new Set(table.map((r) => r.song))];
const fold = (s) => songs.indexOf(s) % NFOLD;
const oof = new Array(table.length);
for (let f = 0; f < NFOLD; f++) {
  const tr = table.filter((r) => fold(r.song) !== f);
  const m = ridge(tr.map((r) => [r.sal[best], r.loud]), tr.map((r) => r.y));
  table.forEach((r, i) => { if (fold(r.song) === f) oof[i] = predict(m, r, best); });
}
const r2of = (t, p) => 1 - t.reduce((s, v, i) => s + (v - p[i]) ** 2, 0) / t.reduce((s, v) => s + (v - mean(t)) ** 2, 0);
const bySong = (v) => songs.map((s) => { const idx = table.map((r, i) => (r.song === s ? i : -1)).filter((i) => i >= 0); const w = idx.map((i) => table[i].secs); return idx.reduce((a, i, j) => a + v[i] * w[j], 0) / w.reduce((a, b) => a + b, 0); });
const ym = bySong(y), pm = bySong(oof);
const dev = (v, m) => v.map((x, i) => x - m[songs.indexOf(table[i].song)]);
const cv = { pooled: r2of(y, oof), between: r2of(ym, pm), within: r2of(dev(y, ym), dev(oof, pm)) };
console.log("song-grouped cv r2", Object.fromEntries(Object.entries(cv).map(([k, v]) => [k, +v.toFixed(3)])));

// Spread: song rate = ref * (song mean / ref model)^gamma and phrase = song * (phrase model / song model)^delta; gamma and delta
// are the exponents that bring the CV between songs and the CV of phrases within a song to the human values.
const fitted = table.map((r) => predict(model, r, best));
const sm = bySong(fitted);
const refModel = sm.slice().sort((a, b) => a - b)[Math.floor(sm.length / 2)];
const human = { median: ym.slice().sort((a, b) => a - b)[Math.floor(ym.length / 2)], cvBetween: std(ym) / mean(ym),
  cvWithin: mean(songs.map((s) => { const v = y.filter((_, i) => table[i].song === s); return std(v) / mean(v); })) };
const cvOf = (gamma, delta) => {
  const rate = fitted.map((p, i) => human.median * (sm[songs.indexOf(table[i].song)] / refModel) ** gamma * (p / sm[songs.indexOf(table[i].song)]) ** delta);
  const rm = bySong(rate);
  return { between: std(rm) / mean(rm), within: mean(songs.map((s) => { const v = rate.filter((_, i) => table[i].song === s); return std(v) / mean(v); })), rm };
};
const solve = (key, target, lo, hi, g, d) => { for (let n = 0; n < 60; n++) { const mid = (lo + hi) / 2; const v = key === "between" ? cvOf(mid, d)[key] : cvOf(g, mid)[key]; if (v < target) lo = mid; else hi = mid; } return (lo + hi) / 2; };
const gamma = solve("between", human.cvBetween, 0.5, 30, 0, 1);
const delta = solve("within", human.cvWithin, 0.2, 30, gamma, 0);
const fin = cvOf(gamma, delta);
const out = {
  note: "Fitted by fit_budget.js on the train songs; momentWeights.js carries these numbers.",
  q: QS[best], coef: model.coef, intercept: model.intercept, refModel, gamma, delta,
  humanTrain: { medianSongDensity: human.median, cvBetween: human.cvBetween, cvWithinPhrase: human.cvWithin },
  modelCv: cv, r2SalientRate: Object.fromEntries(QS.map((q, k) => [q, r2[k]])),
  afterSpread: { cvBetween: fin.between, cvWithin: fin.within, corrSongWithHuman: corr(fin.rm, ym), corrSongWithHumanRaw: corr(sm, ym) },
};
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(__dirname, "budget_fit.json"), JSON.stringify(out, null, 1) + "\n");
