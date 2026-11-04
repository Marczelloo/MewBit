// Measures Normal's lanes (Task 5) on the 80 TRAIN songs and Hopes and Dreams: the rule violations of the finished chart, with the
// melody lanes off (what v27 laid out) and on (v28), and the hand balance and step distribution beside the human Normal maps.
//   node measure_lanes.js [--json out.json] [--songs id,id] [--no-hd]
// Violations are normalViolations (laneRules.js) over every note of the chart, no exemptions. Notes removed = notes of the chart with
// melody lanes off minus on (assignLanes only ever drops notes; the moments reaching it are the same). Hand balance = the share of
// notes on the left hand (lanes 0-1); step distribution = how far a single note is from the single note before it (0 / 1 / 2 / 3 lanes,
// moments of one note only); hand change = those steps that cross from one hand to the other. These are reference points against
// the human maps, not targets. Direction = the share of single-note moments the melody gives a direction for (melodyDirection),
// and "follows" = among those with a direction up or down after a single note, the share whose step goes the way the melody does (up = right);
// for a repeated sound (direction 0) the share that is a jack (the same lane) against a trill.
// Anchors are also counted by brute force, apart from the checker: a lane played at three moments two apart (A x A y A), the
// lane absent from the two in between, those two not the same lanes, every hop at most 0.6 of the larger beat of its ends.
// Echo = of the moments of a repeated phrase that have a moment at the copied time in its source, the share on the source's lanes.
// Test songs are never read: ids come from corpus.csv (train).
const fs = require("fs"), path = require("path");
const repo = path.resolve(__dirname, "../../..");
const { analyse, generateChart } = require(path.join(repo, "helpers/mewbeat/charts/generate"));
const { levelOf } = require(path.join(repo, "helpers/mewbeat/charts/difficulty"));
const { isRepeatOf } = require(path.join(repo, "helpers/mewbeat/charts/phrases"));
const { sourceTime } = require(path.join(repo, "helpers/mewbeat/charts/repeats"));
const { melodyDirection, normalViolations } = require(path.join(repo, "helpers/mewbeat/charts/laneRules"));

const arg = (name, dflt) => { const i = process.argv.indexOf("--" + name); return i < 0 ? dflt : process.argv[i + 1]; };
const only = arg("songs", null)?.split(",");
const rows = fs.readFileSync(path.join(repo, "mapping-analysis/shared/corpus.csv"), "utf8").split("\n").slice(1).map((l) => l.split(","));
const trainIds = rows.filter((r) => r[1] === "train").map((r) => r[0]);
const HD = path.join(repo, ".mewbeat-preview/toby-fox-hopes-and-dreams-undertale.json");

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const r = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

const momentsOf = (notes) => {
  const by = new Map();
  for (const n of [...notes].sort((a, b) => a.t - b.t || a.lane - b.lane)) (by.get(n.t) ?? by.set(n.t, []).get(n.t)).push(n.lane);
  return [...by].map(([t, lanes]) => ({ t, lanes }));
};

function bruteAnchors(notes, timing) {
  const ms = momentsOf(notes);
  const beat = (a, b) => Math.max(timing.beatMsAt(a.t), timing.beatMsAt(b.t));
  let found = 0;
  for (let i = 0; i + 4 < ms.length; i++) {
    const seq = ms.slice(i, i + 5);
    for (const lane of seq[0].lanes) {
      if (!seq[2].lanes.includes(lane) || !seq[4].lanes.includes(lane) || seq[1].lanes.includes(lane) || seq[3].lanes.includes(lane)) continue;
      if (seq[1].lanes.join() === seq[3].lanes.join()) continue;
      if (seq.slice(1).every((m, k) => m.t - seq[k].t <= 0.6 * beat(seq[k], m))) found++;
    }
  }
  return found;
}

// Of the moments of the repeated phrases that have a moment at the copied time in the source: how many, and how many on its lanes.
function echoOf(notes, ctx) {
  const ms = momentsOf(notes), times = ms.map((m) => m.t);
  let have = 0, same = 0;
  ctx.phrases.forEach((p, i) => {
    if (!isRepeatOf(p, i)) return;
    const from = sourceTime(p, ctx.timing);
    for (const m of ms) {
      if (m.t < p.startMs || m.t >= p.endMs) continue;
      const f = from(m.t);
      const at = times.reduce((best, t, k) => (Math.abs(t - f) < Math.abs(times[best] - f) ? k : best), 0);
      if (Math.abs(times[at] - f) > 3) continue;
      have++;
      if (ms[at].lanes.join() === m.lanes.join()) same++;
    }
  });
  return { have, same };
}

// Hand balance, steps and (with a ctx) the melody's direction, of one chart's notes.
function shape(notes, ctx) {
  const moments = momentsOf(notes);
  const steps = [0, 0, 0, 0];
  let hands = 0, followed = 0, follows = 0, singles = 0, directed = 0, repeats = 0, jacks = 0;
  moments.forEach((m, i) => {
    const single = m.lanes.length === 1;
    if (single) singles++;
    const direction = ctx && single ? melodyDirection(ctx, m.t) : null;
    if (direction !== null) directed++;
    const before = moments[i - 1];
    if (!single || !before || before.lanes.length !== 1) return;
    const step = m.lanes[0] - before.lanes[0];
    steps[Math.abs(step)]++;
    if (m.lanes[0] >> 1 !== before.lanes[0] >> 1) hands++;
    if (direction === 0) { repeats++; if (step === 0) jacks++; } else if (direction !== null) { followed++; if (Math.sign(step) === direction) follows++; }
  });
  const total = steps.reduce((a, b) => a + b, 0);
  return {
    left: notes.filter((n) => n.lane < 2).length / notes.length,
    steps: steps.map((s) => s / total), handChange: hands / total, total,
    directed: directed / singles, followed, follows, repeats, jacks,
  };
}

const songs = [];
const named = trainIds.filter((id) => !only || only.includes(id)).map((id) => ({
  id, features: (() => { const raw = JSON.parse(fs.readFileSync(path.join(repo, ".mewbeat-debug/data/features", id + ".json"), "utf8")); return raw.features ?? raw; })(),
  human: (() => { const p = path.join(repo, ".mewbeat-debug/data/human/normal", id + ".json"); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")).map(([t, lane, end]) => ({ t, lane, ...(end ? { len: end - t } : {}) })) : null; })(),
}));
if (!arg("no-hd", false) && !only && fs.existsSync(HD)) { const raw = JSON.parse(fs.readFileSync(HD, "utf8")); named.push({ id: "hopes-and-dreams", features: raw.features ?? raw, human: null }); }

const normal = levelOf("normal");
for (const { id, features, human } of named) {
  const ctx = analyse(features);
  normal.melodyLanes = false;
  const before = generateChart(features, "normal", "measure");
  normal.melodyLanes = true;
  const after = generateChart(features, "normal", "measure");
  if (!before || !after) { songs.push({ id, noChart: true }); continue; }
  const span = (notes) => { const ts = notes.map((n) => n.t); return (Math.max(...ts) - Math.min(...ts)) / 1000; };
  const viol = (notes) => normalViolations(notes, ctx.timing, { durationMs: ctx.durationMs });
  const count = (vs) => vs.reduce((o, v) => ((o[v.rule] = (o[v.rule] ?? 0) + 1), o), {});
  songs.push({
    id,
    notesBefore: before.notes.length, notesAfter: after.notes.length, removed: before.notes.length - after.notes.length,
    starsBefore: before.stars, starsAfter: after.stars,
    npsBefore: before.notes.length / span(before.notes), npsAfter: after.notes.length / span(after.notes),
    violationsBefore: count(viol(before.notes)), violationsAfter: count(viol(after.notes)),
    bruteBefore: bruteAnchors(before.notes, ctx.timing), bruteAfter: bruteAnchors(after.notes, ctx.timing),
    echoBefore: echoOf(before.notes, ctx), echoAfter: echoOf(after.notes, ctx),
    before: shape(before.notes, ctx), after: shape(after.notes, ctx), human: human ? shape(human, null) : null,
  });
}

const ok = songs.filter((s) => !s.noChart);
const sum = (key) => ok.reduce((t, s) => { for (const [rule, n] of Object.entries(s[key])) t[rule] = (t[rule] ?? 0) + n; return t; }, {});
const pooled = (key, f) => mean(ok.filter((s) => s[key]).map(f));
const shapeSummary = (key) => {
  const have = ok.filter((s) => s[key]);
  return {
    songs: have.length,
    left: r(median(have.map((s) => s[key].left))),
    steps: [0, 1, 2, 3].map((k) => r(median(have.map((s) => s[key].steps[k])))),
    handChange: r(median(have.map((s) => s[key].handChange))),
  };
};
const summary = {
  songs: ok.length, noChart: songs.length - ok.length,
  violationsBefore: sum("violationsBefore"), violationsAfter: sum("violationsAfter"),
  bruteAnchors: { before: ok.reduce((t, s) => t + s.bruteBefore, 0), after: ok.reduce((t, s) => t + s.bruteAfter, 0) },
  echo: Object.fromEntries(["echoBefore", "echoAfter"].map((k) => [k, { moments: ok.reduce((t, s) => t + s[k].have, 0), onSourceLanes: r(ok.reduce((t, s) => t + s[k].same, 0) / ok.reduce((t, s) => t + s[k].have, 0)) }])),
  songsWithViolationsAfter: ok.filter((s) => Object.keys(s.violationsAfter).length > 0).map((s) => s.id),
  notes: { before: ok.reduce((t, s) => t + s.notesBefore, 0), after: ok.reduce((t, s) => t + s.notesAfter, 0), removed: ok.reduce((t, s) => t + s.removed, 0) },
  songsWithRemoved: ok.filter((s) => s.removed > 0).length,
  stars: { before: r(median(ok.map((s) => s.starsBefore)), 2), after: r(median(ok.map((s) => s.starsAfter)), 2), maxChange: r(Math.max(...ok.map((s) => Math.abs(s.starsAfter - s.starsBefore))), 2) },
  notesPerSec: { before: r(median(ok.map((s) => s.npsBefore)), 2), after: r(median(ok.map((s) => s.npsAfter)), 2) },
  directionAvailable: r(pooled("after", (s) => s.after.directed)),
  followsDirection: { before: r(ok.reduce((t, s) => t + s.before.follows, 0) / ok.reduce((t, s) => t + s.before.followed, 0)), after: r(ok.reduce((t, s) => t + s.after.follows, 0) / ok.reduce((t, s) => t + s.after.followed, 0)), n: ok.reduce((t, s) => t + s.after.followed, 0) },
  repeatedSound: { jackBefore: r(ok.reduce((t, s) => t + s.before.jacks, 0) / ok.reduce((t, s) => t + s.before.repeats, 0)), jackAfter: r(ok.reduce((t, s) => t + s.after.jacks, 0) / ok.reduce((t, s) => t + s.after.repeats, 0)), n: ok.reduce((t, s) => t + s.after.repeats, 0) },
  shapeBefore: shapeSummary("before"), shapeAfter: shapeSummary("after"), shapeHuman: shapeSummary("human"),
};
console.log(JSON.stringify(summary, null, 1));
const out = arg("json", null);
if (out) fs.writeFileSync(out, JSON.stringify({ summary, songs }));
