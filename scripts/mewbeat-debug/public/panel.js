// The side panel and the key-numbers strip: pure functions from data to HTML. Clicks are handled in app.js through
// data-act attributes. What a normal player needs sits on top; the rest is in sections that open on a click
// (<details data-sec>, their open state is remembered by app.js and passed in as c.open).
import { chartedName, esc, fmt, kindName, leaderName, KIND_SHORT, lowerBound, ruleName, ruleText, sourceName, stageName } from "./labels.js";

const WIN = 45; // ms, how close a music event must be to count as "what the note was mapped to"

const num = (x, d = 2) => (x == null || !isFinite(x) ? "–" : Number(x).toFixed(d));
const pct = (x) => (x == null || !isFinite(x) ? "–" : `${(x * 100).toFixed(1)}%`);
const show = (v) => (v !== null && typeof v === "object" ? esc(JSON.stringify(v)) : esc(v));
const signed = (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(Math.round(x))} ms`;

// Plain-language explanations of the technical words, shown on hover (dotted underline).
const GLOSS = {
  stars: "Szacowana trudność chartu w gwiazdkach.",
  nps: "Nuty na sekundę: średnio w całym utworze i najwięcej w jednej sekundzie (szczyt).",
  npsServer: "Nuty na sekundę policzone przez generator (tak jak widzi je gra).",
  npsHere: "Nuty na sekundę policzone w debuggerze z nut na wykresie.",
  distance: "Jak bardzo chart generatora różni się od mapy zrobionej przez człowieka. Niżej = bliżej człowieka.",
  hands: "Jaka część nut wypada na lewą, a jaka na prawą rękę.",
  layer: "Jaka część nut leży na dźwięku, który generator wykrył w nagraniu (perkusja, bas, melodia, pasma).",
  repeatId: "Na ile powtórzona fraza ma te same nuty co jej pierwowzór (1 = identycznie).",
  window: "Ile nut jest w części utworu widocznej teraz na osi czasu.",
  ghost: "Nuta, którą generator rozważał, ale nie wpuścił do chartu. Na wykresie to pusty obrys.",
  stage: "Krok generatora, który odrzucił nutę. Klik pokazuje na wykresie tylko odrzucone na tym kroku.",
  kind: "Skąd nuta się wzięła: z dźwięku w muzyce, z kopii wcześniejszej frazy, z wypełnienia pauzy itd.",
  source: "Część muzyki, z której wzięto nutę: perkusja, bas, melodia albo pasmo częstotliwości.",
  s: "Siła dźwięku, na którym leży nuta (więcej = mocniej słychać).",
  support: "Znacznik generatora: nuta wspierająca, dołożona obok głównych dźwięków (np. dla rytmu).",
  hand: "Ręka, której generator przypisał nutę.",
  accent: "Czy nuta jest akcentem (mocniejszym miejscem w muzyce).",
  sustain: "Jak długo brzmi dźwięk pod nutą (podstawa do holdów).",
  gridLevel: "Miejsce nuty w siatce rytmu: niższa liczba = mocniejsze miejsce (na uderzeniu), wyższa = między uderzeniami.",
  phrase: "Fragment utworu (zwykle kilka taktów), który generator traktuje jako całość.",
  leader: "Instrument, który prowadzi frazę: z jego dźwięków powstają główne nuty.",
  supports: "Instrumenty, które dokładają nuty obok prowadzącego.",
  charted: "Sposób, w jaki fraza została zapisana: z dźwięków muzyki, ze wzorca rytmu, jako kopia albo ścieżką po pasmach.",
  confidence: "Jak pewny jest generator, że dany instrument gra w tej frazie (więcej = pewniej).",
  energy: "Jak głośno i gęsto gra utwór w tej frazie.",
  similarity: "Na ile ta fraza brzmi jak fraza, którą powtarza (1 = tak samo).",
  lag: "O ile później wraca powtarzany fragment.",
  activity: "Jak dużo gra każdy instrument w tej frazie (więcej = częściej).",
  hold: "Nuta, którą trzeba przytrzymać.",
  mapped: "Dźwięki z analizy nagrania, które leżą przy nucie (±45 ms).",
  history: "Co kolejne kroki generatora zrobiły z nutą: przesunięcia czasu, zmiany pasa, holdu.",
  version: "Wersja generatora, z której pochodzi chart zagrany w tej rundzie.",
};
const term = (label, key) => `<span class="term" title="${esc(GLOSS[key] ?? key)}">${label}</span>`;

const kv = (k, v) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
const btn = (act, label, attrs = {}, cls = "") =>
  `<button class="mini ${cls}" data-act="${act}"${Object.entries(attrs)
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join("")}>${label}</button>`;
const section = (title, body, extra = "") => `<section class="blk ${extra}"><h3>${title}</h3>${body}</section>`;
// A section that opens on a click. `force` keeps it open whatever was remembered; otherwise the remembered state wins,
// then `open` (the default).
const fold = (c, key, title, body, { open = false, force = false, cls = "", hint = "" } = {}) => {
  const isOpen = force || (c.open?.[key] ?? open);
  return `<details class="blk ${cls}" data-sec="${esc(key)}"${isOpen ? " open" : ""}><summary>${title}${hint ? `<span class="hint">${hint}</span>` : ""}</summary><div class="body">${body}</div></details>`;
};
// A Polish name with the generator's own id after it, so nothing of the raw data is lost.
const named = (fn, v) => (fn(v) !== v ? `${esc(fn(v))} <span class="dim">(${esc(v)})</span>` : esc(v));
const stepsWord = (n) => `${n} ${n === 1 ? "krok" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "kroki" : "kroków"}`;
const tstr = (t) => `<b class="tnum">${fmt(t)}</b> <span class="dim tnum">(${Math.round(t)} ms)</span>`;

// Position of a record in the chart: its final note, else where it was rejected, else where it started.
export function recPos(C, rec) {
  const n = C.noteById.get(rec.id);
  if (n) return { t: n.t, lane: n.lane, final: true };
  if (rec.rejected) return { t: rec.rejected.t, lane: rec.rejected.lane, final: false };
  return { t: rec.from.t, lane: rec.from.lane, final: false };
}

// Everything in the analysis within +-45 ms of t.
export function featuresNear(D, t, win = WIN) {
  const out = [];
  const take = (arr, label, extra) => {
    for (let i = lowerBound(arr, t - win); i < arr.length && arr[i].t <= t + win; i++) {
      out.push({ label, off: arr[i].t - t, s: arr[i].s, extra: extra ? extra(arr[i]) : "" });
    }
  };
  for (const b of D.bands) take(b.onsets, `pasmo ${b.name}`);
  for (const [kind, arr] of D.drumsByKind) take(arr, `perkusja: ${kind}`);
  take(D.bass, "bas", (x) => `wysokość ${num(x.pitch, 1)}, pewność ${num(x.conf, 2)}`);
  take(D.lead, "melodia", (x) => `wysokość ${num(x.pitch, 1)}, pewność ${num(x.conf, 2)}`);
  out.sort((a, b) => Math.abs(a.off) - Math.abs(b.off));
  return out;
}

function nearBlock(D, t, caption) {
  const items = featuresNear(D, t);
  const head = `<div class="sub">${caption} <span class="tnum">${Math.round(t)} ms</span></div>`;
  if (!items.length) return `${head}<div class="empty">Nic w ±${WIN} ms: w analizie audio nie ma żadnego zdarzenia przy tej nucie.</div>`;
  const rows = items
    .map((x) => `<tr><td>${esc(x.label)}</td><td class="tnum r">${signed(x.off)}</td><td class="tnum r">${x.s != null ? "s " + num(x.s, 3) : ""}</td><td class="dim">${esc(x.extra)}</td></tr>`)
    .join("");
  return `${head}<table class="mini-table">${rows}</table>`;
}

function historyLines(rec) {
  const st = { t: rec.from.t, lane: rec.from.lane, level: rec.from.level, len: rec.from.len ?? 0 };
  const start = [`czas ${st.t} ms`, `pas ${st.lane}`];
  if (st.level != null) start.push(`poziom ${st.level}`);
  if (st.len) start.push(`hold ${st.len} ms`);
  const lines = [`<li><span class="stg">start</span> ${start.join(", ")}</li>`];
  const keys = [["t", "czas", " ms"], ["lane", "pas", ""], ["level", "poziom", ""], ["len", "hold", " ms"]];
  for (const h of rec.history ?? []) {
    const parts = [];
    for (const [key, label, unit] of keys) {
      if (h[key] === undefined) continue;
      const before = st[key];
      const after = h[key];
      parts.push(before !== after ? `${label} ${before ?? "–"} → ${after}${unit}` : `${label} ${after}${unit} (bez zmiany)`);
      st[key] = after;
    }
    for (const [k, v] of Object.entries(h)) if (!["stage", "t", "lane", "level", "len"].includes(k)) parts.push(`${esc(k)}: ${show(v)}`);
    lines.push(`<li><span class="stg" title="${esc(h.stage)}">${esc(stageName(h.stage))}</span> ${parts.join(", ") || "bez zmiany wartości"}</li>`);
  }
  return lines.join("");
}

export function noteHtml(c, rec) {
  const { D, C } = c;
  const note = C.noteById.get(rec.id);
  const pos = recPos(C, rec);
  const phrase = C.phraseByIndex.get(rec.phrase);
  let h = "";

  const status = note
    ? `<span class="tag ok">w chartcie</span>`
    : `<span class="tag bad">odrzucona: ${esc(stageName(rec.rejected?.stage))}</span>`;
  h += `<div class="title">Nuta ${status}</div>`;

  // The card: what the note is and why it is (or is not) there, in one look.
  const lead = note
    ? `Jest w chartcie. Skąd: ${esc(kindName(rec.kind))}.`
    : `${term("Odrzucona", "ghost")} na kroku „${esc(stageName(rec.rejected?.stage))}”${rec.rejected?.why ? `: ${esc(ruleText(rec.rejected.why))}` : ""}.`;
  h +=
    `<div class="card"><div class="lead">${lead}</div>` +
    kv("czas", tstr(pos.t)) +
    kv("pas", `<b>${pos.lane}</b>${rec.from.lane !== pos.lane ? ` <span class="dim">(startowo ${rec.from.lane})</span>` : ""}`) +
    kv(term("hold", "hold"), note?.len ? `${note.len} ms` : "brak") +
    kv("status", note ? "końcowa (jest w chartcie)" : "odrzucona (duch)") +
    `<div class="actions">${btn("copyTime", "kopiuj czas", { t: pos.t })}${btn("play", "▶ odtwórz stąd", { t: pos.t })}</div></div>`;

  if (rec.rejected) {
    const r = rec.rejected;
    let b = kv(term("etap", "stage"), `<b>${esc(stageName(r.stage))}</b> <span class="dim">(${esc(r.stage)})</span>`);
    b += kv("miejsce", `czas ${Math.round(r.t)} ms, pas ${r.lane}`);
    if (r.why) {
      b += kv("reguła", esc(ruleText(r.why)));
      if (r.why.t != null) {
        b += `<div class="actions">${btn("blocker", "skocz do nuty, która zablokowała", { t: r.why.t, lane: r.why.lane ?? "" })}<span class="dim tnum">${fmt(r.why.t)}${r.why.lane != null ? `, pas ${r.why.lane}` : ""}</span></div>`;
      }
    } else b += `<div class="empty">Ten etap nie zapisał, która reguła zadecydowała.</div>`;
    h += fold(c, "note.rej", "Dlaczego odrzucona", b, { force: true, cls: "rej" });
  }

  let origin = kv(term("rodzaj", "kind"), `<b>${esc(kindName(rec.kind))}</b> <span class="dim">(${esc(rec.kind)})</span>`);
  if (rec.source !== undefined) origin += kv(term("warstwa źródłowa", "source"), esc(sourceName(rec.source)));
  if (rec.s !== undefined) origin += kv(term("siła s", "s"), `<span class="tnum">${num(rec.s, 3)}</span>`);
  if (rec.support !== undefined) origin += kv(term("wsparcie", "support"), `<span class="tnum">${show(rec.support)}</span>`);
  if (rec.hand !== undefined) origin += kv(term("ręka", "hand"), `<span class="tnum">${show(rec.hand)}</span>`);
  if (rec.accent !== undefined) origin += kv(term("akcent", "accent"), rec.accent ? "tak" : "nie");
  if (rec.sustainMs !== undefined) origin += kv(term("sustain", "sustain"), `<span class="tnum">${show(rec.sustainMs)} ms</span>`);
  origin += kv(term("poziom siatki (start)", "gridLevel"), rec.from.level != null ? esc(rec.from.level) : "–");
  if (rec.kind === "copy") {
    origin += kv("źródło kopii", `${rec.copyOfT != null ? fmt(rec.copyOfT) : "?"} ${btn("rec", "skocz do źródła", { id: rec.copyOf })}`);
  }
  h += fold(c, "note.origin", "Pochodzenie", origin, { hint: esc(KIND_SHORT[rec.kind] ?? rec.kind) });

  if (phrase) {
    let p = kv(term("fraza", "phrase"), `<b>#${phrase.index}</b> ${btn("phrase", "pokaż frazę", { index: phrase.index })}`);
    p += kv(term("lider", "leader"), `<b>${named(leaderName, phrase.leader)}</b>`);
    p += kv(term("wspierają", "supports"), (phrase.supports ?? []).map((x) => named(leaderName, x)).join(", ") || "–");
    p += kv(term("zapisana jako", "charted"), `<b>${named(chartedName, phrase.charted)}</b>`);
    const cf = phrase.confidence ?? {};
    p += kv(term("pewność", "confidence"), `<span class="tnum">perkusja ${num(cf.drums)} · bas ${num(cf.bass)} · melodia ${num(cf.lead)}</span>`);
    if (phrase.repeat) p += kv("powtórka", `fraza #${phrase.repeatOf}, podobieństwo ${num(phrase.similarity, 3)}`);
    h += fold(c, "note.phrase", "Fraza", p, { hint: `#${phrase.index}` });
  } else if (rec.phrase != null) {
    h += fold(c, "note.phrase", "Fraza", kv(term("fraza", "phrase"), `#${esc(rec.phrase)}`), { hint: `#${esc(rec.phrase)}` });
  }

  h += fold(c, "note.history", `<span class="term" title="${esc(GLOSS.history)}">Historia</span>`, `<ol class="hist">${historyLines(rec)}</ol>`, { hint: stepsWord((rec.history ?? []).length) });

  let m = nearBlock(D, rec.from.t, "Przy czasie oryginalnym");
  const finalT = note ? note.t : rec.rejected?.t;
  if (finalT != null && finalT !== rec.from.t) m += nearBlock(D, finalT, "Przy czasie w chartcie (po przesunięciu)");
  m += `<div class="dim small">przesunięcie = zdarzenie − nuta (+ znaczy: zdarzenie później niż nuta)</div>`;
  h += fold(c, "note.near", `<span class="term" title="${esc(GLOSS.mapped)}">Na co zmapowana</span>`, m);

  if (c.human) {
    const refT = note ? note.t : (rec.rejected?.t ?? rec.from.t);
    const refLane = note ? note.lane : (rec.rejected?.lane ?? rec.from.lane);
    const near = [];
    for (let i = lowerBound(c.human, refT - WIN); i < c.human.length && c.human[i].t <= refT + WIN; i++) near.push(c.human[i]);
    near.sort((a, b) => Math.abs(a.t - refT) - Math.abs(b.t - refT));
    let u;
    if (!near.length) u = `<div class="empty">Brak nuty człowieka w ±${WIN} ms.</div>`;
    else
      u = near
        .map((n) => `<div class="kv"><span class="k">${fmt(n.t)}</span><span class="v">pas ${n.lane} <span class="${n.lane === refLane ? "ok" : "warn"}">(${n.lane === refLane ? "ten sam pas" : "inny pas"})</span>, ${signed(n.t - refT)}${n.len ? `, hold ${n.len} ms` : ""}</span></div>`)
        .join("");
    h += fold(c, "note.human", "U człowieka", u, { open: true, hint: near.length ? `${near.length} w ±${WIN} ms` : "brak" });
  }
  return h;
}

export function phraseHtml(c, index) {
  const { C } = c;
  const ph = C.phraseByIndex.get(index) ?? c.featurePhrases?.[index];
  if (!ph) return `<div class="empty">Brak frazy #${index}.</div>`;
  let h = `<div class="title">${term("Fraza", "phrase")} #${ph.index ?? index}</div>`;

  let card = kv("początek", tstr(ph.startMs)) + kv("koniec", tstr(ph.endMs)) + kv("długość", `<span class="tnum">${Math.round(ph.endMs - ph.startMs)} ms</span>`);
  if (ph.leader !== undefined) card += kv(term("lider", "leader"), `<b>${named(leaderName, ph.leader)}</b>`);
  if (ph.charted !== undefined) card += kv(term("zapisana jako", "charted"), `<b>${named(chartedName, ph.charted)}</b>`);
  card += kv("powtórka", ph.repeat ? `tak, fraza #${ph.repeatOf} ${btn("phrase", "pokaż źródło", { index: ph.repeatOf })}` : "nie");
  card += `<div class="actions">${btn("goto", "pokaż w widoku", { t: ph.startMs })}${btn("play", "▶ odtwórz od początku", { t: ph.startMs })}${btn("copyTime", "kopiuj czas", { t: ph.startMs })}</div>`;
  h += `<div class="card">${card}</div>`;

  let f = "";
  if (ph.supports) f += kv(term("wspierają", "supports"), ph.supports.map((x) => named(leaderName, x)).join(", ") || "–");
  if (ph.confidence) f += kv(term("pewność", "confidence"), `<span class="tnum">perkusja ${num(ph.confidence.drums)} · bas ${num(ph.confidence.bass)} · melodia ${num(ph.confidence.lead)}</span>`);
  if (ph.energy != null) f += kv(term("energia", "energy"), `<span class="tnum">${num(ph.energy, 3)}</span>`);
  if (ph.similarity != null) f += kv(term("podobieństwo", "similarity"), `<span class="tnum">${num(ph.similarity, 3)}</span>`);
  if (ph.lagMs != null) f += kv(term("opóźnienie powtórki", "lag"), `<span class="tnum">${Math.round(ph.lagMs)} ms</span>`);
  if (ph.lastPhrase) f += kv("ostatnia fraza", "tak");
  if (ph.activity) f += kv(term("aktywność", "activity"), `<span class="tnum">perkusja ${num(ph.activity.drums)} · bas ${num(ph.activity.bass)} · melodia ${num(ph.activity.lead)}</span>`);
  if (f) h += fold(c, "phrase.more", "Więcej o frazie", f);

  const st = C.phraseStats.get(ph.index ?? index);
  let n = "";
  if (!st) n = `<div class="empty">Brak danych o nutach (chart niedostępny).</div>`;
  else {
    n += kv("nuty w chartcie", `<b class="tnum">${st.fin}</b>`);
    n += kv(term("odrzucone kandydatury", "ghost"), `<b class="tnum">${st.rej}</b>`);
    if (st.stages.size) {
      n += `<div class="sub">odrzucone wg etapu</div>`;
      for (const [stage, cnt] of [...st.stages].sort((a, b) => b[1] - a[1])) n += kv(esc(stageName(stage)), `<span class="tnum">${cnt}</span>`);
    }
    if (ph.charted === "bands") {
      n += `<div class="note">Ta fraza jest zapisana ścieżką po pasmach. Etap ścieżki po pasmach zapisuje tylko nuty, które zostawił, więc ta fraza nie ma odrzuconych kandydatów do pokazania${st.rej ? ` (te ${st.rej} pochodzą z innych etapów)` : ""}.</div>`;
    }
    if (ph.charted === "copy") n += `<div class="note">Ta fraza jest kopią frazy #${ph.repeatOf}: nuty powstały przez skopiowanie, nie z dźwięków tej frazy.</div>`;
  }
  h += fold(c, "phrase.notes", "Nuty", n, { open: true, hint: st ? `${st.fin} w chartcie · ${st.rej} odrzuconych` : "" });
  return h;
}

export function plainNoteHtml(c, sel) {
  const n = sel.n;
  const which = sel.row === "human" ? "człowieka" : `snapshotu ${esc(c.snapVer)}`;
  let h = `<div class="title">Nuta ${which}</div>`;
  h +=
    `<div class="card">` +
    kv("czas", tstr(n.t)) +
    kv("pas", `<b>${n.lane}</b>`) +
    kv("długość", n.len ? `${Math.round(n.len)} ms` : "brak (zwykła nuta)") +
    `<div class="actions">${btn("copyTime", "kopiuj czas", { t: n.t })}${btn("play", "▶ odtwórz stąd", { t: n.t })}</div>` +
    `<div class="note">brak śladu: ta nuta nie pochodzi z obecnego generatora</div></div>`;
  const near = [];
  const notes = c.C?.notes ?? [];
  for (let i = lowerBound(notes, n.t - 120); i < notes.length && notes[i].t <= n.t + 120; i++) near.push(notes[i]);
  near.sort((a, b) => Math.abs(a.t - n.t) - Math.abs(b.t - n.t));
  const g = near.length
    ? near.slice(0, 5).map((x) => `<div class="kv"><span class="k">${fmt(x.t)}</span><span class="v">pas ${x.lane}, ${signed(x.t - n.t)} ${btn("rec", "pokaż", { id: x.id })}</span></div>`).join("")
    : `<div class="empty">Generator nie ma nuty w ±120 ms.</div>`;
  h += fold(c, "plain.gen", "Najbliższe nuty generatora", g, { open: true });
  h += fold(c, "plain.near", `<span class="term" title="${esc(GLOSS.mapped)}">Na co zmapowana</span>`, nearBlock(c.D, n.t, "Przy czasie"));
  return h;
}

function npsOf(notes) {
  if (!notes || notes.length < 2) return { mean: null, peak: null };
  const span = (notes[notes.length - 1].t - notes[0].t) / 1000;
  let peak = 0;
  for (let i = 0, j = 0; i < notes.length; i++) {
    while (notes[i].t - notes[j].t >= 1000) j++;
    peak = Math.max(peak, i - j + 1);
  }
  return { mean: span > 0 ? notes.length / span : null, peak };
}

function countList(map, nameFn) {
  return [...map]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => kv(esc(nameFn(k)), `<span class="tnum">${v}</span>`))
    .join("");
}

const dateStr = (at) => (at == null ? "–" : new Date(at).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));
const LEVEL_NAME = { easy: "Easy", normal: "Normal", hard: "Hard", hell: "Hell" };
const levelName = (l) => LEVEL_NAME[l] ?? l;

// The rounds somebody played of a song, newest first; a click picks the level and, if it is stored, the chart that was played.
export function roundsHtml(c, rounds, snapshots, picked) {
  const rows = rounds
    .map((r, i) => {
      const label = r.chartVersion == null ? null : `v${r.chartVersion}`;
      const version = label == null ? `<span class="dim">nieznana</span>` : `${esc(label)}${snapshots.includes(label) ? "" : ` <span class="dim">(nie zachowana)</span>`}`;
      const acc = r.accuracy == null ? "–" : `${Number(r.accuracy).toFixed(1)}%`;
      return `<button class="rowbtn round ${i === picked ? "on" : ""}" data-act="round" data-i="${i}" title="Pokaż chart z tej rundy"><span class="tnum">${dateStr(r.at)}</span><span>${esc(levelName(r.difficulty))}</span><span class="tnum">${acc}</span><span>${esc(r.grade ?? "–")}</span><span class="ver">wersja ${version}</span></button>`;
    })
    .join("");
  const head = `<div class="rowbtn round head dim"><span>data</span><span>poziom</span><span>celność</span><span>ocena</span><span class="ver">${term("wersja", "version")} chartu pod spodem</span></div>`;
  return fold(c, "rounds", `Zagrane rundy (${rounds.length})`, `<div class="dim small" style="margin-bottom:4px">Klik pokazuje poziom i chart z tej rundy.</div>` + head + rows, { open: true });
}

// The strip of key numbers under the header: what a player looks at first.
export function statsHtml(c) {
  const { C, song, level, human } = c;
  const card = (label, value, cls = "") => `<div class="stat ${cls}"><span class="lbl">${label}</span><span class="val">${value}</span></div>`;
  let h = card("Poziom", esc(levelName(level)));
  if (!C) return h + card("Chart", "liczę chart…", "busy");
  if (C.unusable) return h + card("Chart", "generator nie dał chartu dla tego poziomu", "busy") + (human ? card("Człowiek", `${human.length} <small>nut</small>`) : "");
  // The same per-second numbers as the comparison with the human in the panel (counted here, on both charts alike).
  const mine = npsOf(C.notes);
  h += card("Nuty", `${C.notes.length}`);
  h += card(term("Trudność", "stars"), `★ ${num(C.raw.stars, 1)}`);
  h += card(term("Nut na sekundę", "nps"), `${num(mine.mean, 1)} <small>szczyt ${mine.peak ?? "–"}</small>`);
  if (human) {
    const diff = C.notes.length - human.length;
    h += card("Mapa człowieka", `${human.length} <small>nut (${diff >= 0 ? "+" : ""}${diff} u nas)</small>`);
  }
  const d = song.distance?.[level];
  if (d != null) h += card(term("Dystans do człowieka", "distance"), `${num(d, 3)} <small>niżej = bliżej</small>`);
  return h;
}

// The panel with nothing selected: two tabs. "Przegląd" for everyone, "Technika" for digging into the generator.
export function summaryHtml(c) {
  const tab = c.tab === "tech" ? "tech" : "overview";
  const tabs = `<div class="tabs seg" role="tablist"><button role="tab" data-act="tab" data-tab="overview" class="${tab === "overview" ? "on" : ""}" aria-selected="${tab === "overview"}">Przegląd</button><button role="tab" data-act="tab" data-tab="tech" class="${tab === "tech" ? "on" : ""}" aria-selected="${tab === "tech"}" title="Liczby generatora, pochodzenie nut, odrzucone nuty">Technika</button></div>`;
  return tabs + (tab === "tech" ? techHtml(c) : overviewHtml(c));
}

function overviewHtml(c) {
  const { C, D, level, human } = c;
  let h = "";
  if (D.song.rounds?.length) h += roundsHtml(c, D.song.rounds, D.snapshots, c.roundIx);
  h += `<div class="title">Podsumowanie · ${esc(levelName(level))}</div>`;
  if (!C || C.unusable) {
    h += `<div class="empty">${C?.unusable ? "Generator nie dał chartu dla tego poziomu (usable = false)." : "Chart się liczy…"}</div>`;
    if (human) h += section("Człowiek", kv("liczba nut", `<b class="tnum">${human.length}</b>`));
    return h;
  }
  const m = C.raw.metrics ?? {};
  const mine = npsOf(C.notes);
  const hn = human ? npsOf(human) : null;
  const row = (label, a, b) => `<tr><td>${label}</td><td class="r tnum">${a}</td>${human ? `<td class="r tnum">${b}</td>` : ""}</tr>`;
  let s = `<table class="mini-table cmp"><tr><th></th><th class="r">Generator</th>${human ? `<th class="r">Człowiek</th>` : ""}</tr>`;
  s += row("liczba nut", C.notes.length, human?.length);
  s += row(`${term("nut/s", "npsHere")} średnio`, num(mine.mean), num(hn?.mean));
  s += row(`${term("nut/s", "npsHere")} szczyt`, mine.peak ?? "–", hn?.peak ?? "–");
  s += `</table>`;
  if (human) s += kv("różnica nut", `<span class="tnum">${C.notes.length - human.length >= 0 ? "+" : ""}${C.notes.length - human.length}</span>`);
  else s += `<div class="empty">${D.hasAnyHuman ? `Brak ludzkiej mapy na poziomie ${esc(level)}.` : "Utwór bez ludzkiej mapy."}</div>`;
  const d = c.song.distance?.[level];
  s += kv(term("dystans do człowieka", "distance"), d != null ? `<b class="tnum">${num(d, 3)}</b> <span class="dim">(wyższy = gorzej)</span>` : "–");
  if (m.handBalance) s += kv(term("balans rąk", "hands"), `<span class="tnum">lewa ${pct(m.handBalance.left)} · prawa ${pct(m.handBalance.right)}</span>`);
  h += section("Chart a człowiek", s);
  h += section(term("Widoczne okno", "window"), `<div id="winCounts" class="tnum"></div>`);
  h += `<div class="dim small" style="padding-top:8px">Kliknij nutę albo frazę na wykresie, żeby zobaczyć, skąd się wzięła.</div>`;
  return h;
}

function techHtml(c) {
  const { C, level } = c;
  let h = `<div class="title">Technika · ${esc(levelName(level))}</div>`;
  if (!C || C.unusable) return h + `<div class="empty">${C?.unusable ? "Generator nie dał chartu dla tego poziomu (usable = false)." : "Chart się liczy…"}</div>`;
  const m = C.raw.metrics ?? {};
  const mine = npsOf(C.notes);
  let s = kv("liczba nut", `<b class="tnum">${C.notes.length}</b>`);
  s += kv(term("gwiazdki", "stars"), `<span class="tnum">${num(C.raw.stars, 1)}</span>`);
  s += kv(term("NPS (serwer)", "npsServer"), `<span class="tnum">śr. ${num(m.nps?.mean)} · szczyt ${num(m.nps?.peak)}</span>`);
  s += kv(term("NPS (liczone tu)", "npsHere"), `<span class="tnum">śr. ${num(mine.mean)} · szczyt ${mine.peak ?? "–"}</span>`);
  if (m.onLayerShare != null) s += kv(term("udział warstwy", "layer"), `<span class="tnum">${pct(m.onLayerShare)}</span>`);
  if (Array.isArray(m.repeatIdentity) && m.repeatIdentity.length) {
    const avg = m.repeatIdentity.reduce((a, x) => a + x.identity, 0) / m.repeatIdentity.length;
    s += kv(term("identyczność powtórek", "repeatId"), `<span class="tnum">śr. ${num(avg, 3)} (${m.repeatIdentity.length} fraz)</span>`);
  }
  h += section("Chart generatora", s);

  h += section(term("Nuty wg pochodzenia", "kind"), countList(C.kindFinal, (k) => `${kindName(k)}`) + `<div class="sub">${term("wg warstwy źródłowej", "source")}</div>` + countList(C.sourceFinal, (k) => (k === "—" ? "bez warstwy" : sourceName(k))));

  let rej = "";
  const f = c.filter;
  const stages = [...C.stageCounts].sort((a, b) => b[1] - a[1]);
  const totalRej = stages.reduce((a, x) => a + x[1], 0);
  for (const [stage, cnt] of stages) {
    const active = f && f.stage === stage && !f.rule;
    rej += `<button class="rowbtn ${active ? "on" : ""}" data-act="stage" data-stage="${esc(stage)}" title="${esc(stage)}"><span>${esc(stageName(stage))}</span><span class="tnum">${cnt}</span></button>`;
    const rules = C.ruleCounts.get(stage);
    if (rules) {
      for (const [rule, rc] of [...rules].sort((a, b) => b[1] - a[1])) {
        const ra = f && f.stage === stage && f.rule === rule;
        rej += `<button class="rowbtn sub2 ${ra ? "on" : ""}" data-act="rule" data-stage="${esc(stage)}" data-rule="${esc(rule)}"><span>${esc(ruleName(rule))}</span><span class="tnum">${rc}</span></button>`;
      }
    }
  }
  if (!stages.length) rej = `<div class="empty">Brak odrzuconych kandydatów.</div>`;
  h += section(`${term("Odrzucone", "ghost")} wg ${term("etapu", "stage")} · ${totalRej}`, `<div class="dim small">klik filtruje duchy na wykresie (i je pokazuje), ponowny klik czyści</div>${rej}`);
  return h;
}

export { KIND_SHORT };
