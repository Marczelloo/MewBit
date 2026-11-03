// The side panel: pure functions from data to HTML. Clicks are handled in app.js through data-act attributes.
import { esc, fmt, kindName, KIND_SHORT, lowerBound, ruleName, ruleText, sourceName, stageName } from "./labels.js";

const WIN = 45; // ms, how close a music event must be to count as "what the note was mapped to"

const num = (x, d = 2) => (x == null || !isFinite(x) ? "–" : Number(x).toFixed(d));
const pct = (x) => (x == null || !isFinite(x) ? "–" : `${(x * 100).toFixed(1)}%`);
const show = (v) => (v !== null && typeof v === "object" ? esc(JSON.stringify(v)) : esc(v));
const signed = (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(Math.round(x))} ms`;

const kv = (k, v) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
const btn = (act, label, attrs = {}, cls = "") =>
  `<button class="mini ${cls}" data-act="${act}"${Object.entries(attrs)
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join("")}>${label}</button>`;
const section = (title, body, extra = "") => `<section class="blk ${extra}"><h3>${title}</h3>${body}</section>`;
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
    lines.push(`<li><span class="stg">${esc(stageName(h.stage))}</span> ${parts.join(", ") || "bez zmiany wartości"}</li>`);
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
  h += section(
    "Nuta",
    kv("czas", tstr(pos.t)) +
      kv("pas", `<b>${pos.lane}</b>${rec.from.lane !== pos.lane ? ` <span class="dim">(startowo ${rec.from.lane})</span>` : ""}`) +
      kv("hold", note?.len ? `${note.len} ms` : "brak") +
      kv("status", note ? "końcowa (jest w chartcie)" : "odrzucona (duch)") +
      `<div class="actions">${btn("copyTime", "kopiuj czas", { t: pos.t })}${btn("play", "▶ odtwórz stąd", { t: pos.t })}</div>`
  );

  let origin = kv("rodzaj", `<b>${esc(kindName(rec.kind))}</b> <span class="dim">(${esc(rec.kind)})</span>`);
  if (rec.source !== undefined) origin += kv("warstwa źródłowa", esc(sourceName(rec.source)));
  if (rec.s !== undefined) origin += kv("siła s", `<span class="tnum">${num(rec.s, 3)}</span>`);
  if (rec.support !== undefined) origin += kv("wsparcie", `<span class="tnum">${show(rec.support)}</span>`);
  if (rec.hand !== undefined) origin += kv("ręka", `<span class="tnum">${show(rec.hand)}</span>`);
  if (rec.accent !== undefined) origin += kv("akcent", rec.accent ? "tak" : "nie");
  if (rec.sustainMs !== undefined) origin += kv("sustain", `<span class="tnum">${show(rec.sustainMs)} ms</span>`);
  origin += kv("poziom siatki (start)", rec.from.level != null ? esc(rec.from.level) : "–");
  if (rec.kind === "copy") {
    origin += kv("źródło kopii", `${rec.copyOfT != null ? fmt(rec.copyOfT) : "?"} ${btn("rec", "skocz do źródła", { id: rec.copyOf })}`);
  }
  h += section("Pochodzenie", origin);

  if (phrase) {
    let p = kv("fraza", `<b>#${phrase.index}</b> ${btn("phrase", "pokaż frazę", { index: phrase.index })}`);
    p += kv("lider", `<b>${esc(phrase.leader)}</b>`);
    p += kv("wspierają", esc((phrase.supports ?? []).join(", ") || "–"));
    p += kv("zapisana jako", `<b>${esc(phrase.charted)}</b>`);
    const cf = phrase.confidence ?? {};
    p += kv("pewność", `<span class="tnum">perkusja ${num(cf.drums)} · bas ${num(cf.bass)} · melodia ${num(cf.lead)}</span>`);
    if (phrase.repeat) p += kv("powtórka", `fraza #${phrase.repeatOf}, podobieństwo ${num(phrase.similarity, 3)}`);
    h += section("Fraza", p);
  } else if (rec.phrase != null) {
    h += section("Fraza", kv("fraza", `#${esc(rec.phrase)}`));
  }

  h += section("Historia", `<ol class="hist">${historyLines(rec)}</ol>` + (note ? "" : ""));

  if (rec.rejected) {
    const r = rec.rejected;
    let b = kv("etap", `<b>${esc(stageName(r.stage))}</b> <span class="dim">(${esc(r.stage)})</span>`);
    b += kv("miejsce", `czas ${Math.round(r.t)} ms, pas ${r.lane}`);
    if (r.why) {
      b += kv("reguła", esc(ruleText(r.why)));
      if (r.why.t != null) {
        b += `<div class="actions">${btn("blocker", "skocz do nuty, która zablokowała", { t: r.why.t, lane: r.why.lane ?? "" })}<span class="dim tnum">${fmt(r.why.t)}${r.why.lane != null ? `, pas ${r.why.lane}` : ""}</span></div>`;
      }
    } else b += `<div class="empty">Ten etap nie zapisał, która reguła zadecydowała.</div>`;
    h += section("Odrzucenie", b, "rej");
  }

  let m = nearBlock(D, rec.from.t, "Przy czasie oryginalnym");
  const finalT = note ? note.t : rec.rejected?.t;
  if (finalT != null && finalT !== rec.from.t) m += nearBlock(D, finalT, "Przy czasie w chartcie (po przesunięciu)");
  m += `<div class="dim small">przesunięcie = zdarzenie − nuta (+ znaczy: zdarzenie później niż nuta)</div>`;
  h += section("Na co zmapowana", m);

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
    h += section("U człowieka", u);
  }
  return h;
}

export function phraseHtml(c, index) {
  const { C, D } = c;
  const ph = C.phraseByIndex.get(index) ?? c.featurePhrases?.[index];
  if (!ph) return `<div class="empty">Brak frazy #${index}.</div>`;
  let h = `<div class="title">Fraza #${ph.index ?? index}</div>`;
  let f = kv("początek", tstr(ph.startMs)) + kv("koniec", tstr(ph.endMs)) + kv("długość", `<span class="tnum">${Math.round(ph.endMs - ph.startMs)} ms</span>`);
  if (ph.leader !== undefined) f += kv("lider", `<b>${esc(ph.leader)}</b>`);
  if (ph.supports) f += kv("wspierają", esc(ph.supports.join(", ") || "–"));
  if (ph.charted !== undefined) f += kv("zapisana jako", `<b>${esc(ph.charted)}</b>`);
  if (ph.confidence) f += kv("pewność", `<span class="tnum">perkusja ${num(ph.confidence.drums)} · bas ${num(ph.confidence.bass)} · melodia ${num(ph.confidence.lead)}</span>`);
  if (ph.energy != null) f += kv("energia", `<span class="tnum">${num(ph.energy, 3)}</span>`);
  f += kv("powtórka", ph.repeat ? `tak, fraza #${ph.repeatOf} ${btn("phrase", "pokaż źródło", { index: ph.repeatOf })}` : "nie");
  if (ph.similarity != null) f += kv("podobieństwo", `<span class="tnum">${num(ph.similarity, 3)}</span>`);
  if (ph.lagMs != null) f += kv("opóźnienie powtórki", `<span class="tnum">${Math.round(ph.lagMs)} ms</span>`);
  if (ph.lastPhrase) f += kv("ostatnia fraza", "tak");
  if (ph.activity) f += kv("aktywność", `<span class="tnum">perkusja ${num(ph.activity.drums)} · bas ${num(ph.activity.bass)} · melodia ${num(ph.activity.lead)}</span>`);
  f += `<div class="actions">${btn("goto", "pokaż w widoku", { t: ph.startMs })}${btn("play", "▶ odtwórz od początku", { t: ph.startMs })}${btn("copyTime", "kopiuj czas", { t: ph.startMs })}</div>`;
  h += section("Pola", f);

  const st = C.phraseStats.get(ph.index ?? index);
  let n = "";
  if (!st) n = `<div class="empty">Brak danych o nutach (chart niedostępny).</div>`;
  else {
    n += kv("nuty w chartcie", `<b class="tnum">${st.fin}</b>`);
    n += kv("odrzucone kandydatury", `<b class="tnum">${st.rej}</b>`);
    if (st.stages.size) {
      n += `<div class="sub">odrzucone wg etapu</div>`;
      for (const [stage, cnt] of [...st.stages].sort((a, b) => b[1] - a[1])) n += kv(esc(stageName(stage)), `<span class="tnum">${cnt}</span>`);
    }
    if (ph.charted === "bands") {
      n += `<div class="note">Ta fraza jest zapisana ścieżką po pasmach. Etap ścieżki po pasmach zapisuje tylko nuty, które zostawił, więc ta fraza nie ma odrzuconych kandydatów do pokazania${st.rej ? ` (te ${st.rej} pochodzą z innych etapów)` : ""}.</div>`;
    }
    if (ph.charted === "copy") n += `<div class="note">Ta fraza jest kopią frazy #${ph.repeatOf}: nuty powstały przez skopiowanie, nie z dźwięków tej frazy.</div>`;
  }
  h += section("Nuty", n);
  return h;
}

export function plainNoteHtml(c, sel) {
  const n = sel.n;
  const which = sel.row === "human" ? "człowieka" : `snapshotu ${esc(c.snapVer)}`;
  let h = `<div class="title">Nuta ${which}</div>`;
  h +=
    section(
      "Nuta",
      kv("czas", tstr(n.t)) +
        kv("pas", `<b>${n.lane}</b>`) +
        kv("długość", n.len ? `${Math.round(n.len)} ms` : "brak (zwykła nuta)") +
        `<div class="actions">${btn("copyTime", "kopiuj czas", { t: n.t })}${btn("play", "▶ odtwórz stąd", { t: n.t })}</div>`
    ) + `<div class="note">brak śladu: ta nuta nie pochodzi z obecnego generatora</div>`;
  const near = [];
  const notes = c.C?.notes ?? [];
  for (let i = lowerBound(notes, n.t - 120); i < notes.length && notes[i].t <= n.t + 120; i++) near.push(notes[i]);
  near.sort((a, b) => Math.abs(a.t - n.t) - Math.abs(b.t - n.t));
  const g = near.length
    ? near.slice(0, 5).map((x) => `<div class="kv"><span class="k">${fmt(x.t)}</span><span class="v">pas ${x.lane}, ${signed(x.t - n.t)} ${btn("rec", "pokaż", { id: x.id })}</span></div>`).join("")
    : `<div class="empty">Generator nie ma nuty w ±120 ms.</div>`;
  h += section("Najbliższe nuty generatora", g);
  h += section("Na co zmapowana", nearBlock(c.D, n.t, "Przy czasie"));
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

export function summaryHtml(c) {
  const { C, D, song, level, human } = c;
  let h = `<div class="title">Podsumowanie · ${esc(level)}</div>`;
  if (!C || C.unusable) {
    h += `<div class="empty">${C?.unusable ? "Generator nie dał chartu dla tego poziomu (usable = false)." : "Chart się liczy…"}</div>`;
    if (human) h += section("Człowiek", kv("liczba nut", `<b class="tnum">${human.length}</b>`));
    return h;
  }
  const m = C.raw.metrics ?? {};
  const mine = npsOf(C.notes);
  let s = kv("liczba nut", `<b class="tnum">${C.notes.length}</b>`);
  s += kv("gwiazdki", `<span class="tnum">${num(C.raw.stars, 1)}</span>`);
  s += kv("NPS (serwer)", `<span class="tnum">śr. ${num(m.nps?.mean)} · szczyt ${num(m.nps?.peak)}</span>`);
  s += kv("NPS (liczone tu)", `<span class="tnum">śr. ${num(mine.mean)} · szczyt ${mine.peak ?? "–"}</span>`);
  if (m.handBalance) s += kv("balans rąk", `<span class="tnum">lewa ${pct(m.handBalance.left)} · prawa ${pct(m.handBalance.right)}</span>`);
  if (m.onLayerShare != null) s += kv("udział warstwy", `<span class="tnum">${pct(m.onLayerShare)}</span>`);
  if (Array.isArray(m.repeatIdentity) && m.repeatIdentity.length) {
    const avg = m.repeatIdentity.reduce((a, x) => a + x.identity, 0) / m.repeatIdentity.length;
    s += kv("identyczność powtórek", `<span class="tnum">śr. ${num(avg, 3)} (${m.repeatIdentity.length} fraz)</span>`);
  }
  const d = song.distance?.[level];
  s += kv("dystans do człowieka", d != null ? `<b class="tnum">${num(d, 3)}</b> <span class="dim">(wyższy = gorzej)</span>` : "–");
  h += section("Chart generatora", s);

  if (human) {
    const hn = npsOf(human);
    h += section("Człowiek", kv("liczba nut", `<b class="tnum">${human.length}</b>`) + kv("NPS (liczone tu)", `<span class="tnum">śr. ${num(hn.mean)} · szczyt ${hn.peak ?? "–"}</span>`) + kv("różnica nut", `<span class="tnum">${C.notes.length - human.length >= 0 ? "+" : ""}${C.notes.length - human.length}</span>`));
  } else h += section("Człowiek", `<div class="empty">${D.hasAnyHuman ? `Brak ludzkiej mapy na poziomie ${esc(level)}.` : "Utwór bez ludzkiej mapy."}</div>`);

  h += section("Widoczne okno", `<div id="winCounts" class="tnum"></div>`);

  h += section("Nuty wg pochodzenia", countList(C.kindFinal, (k) => `${kindName(k)}`) + `<div class="sub">wg warstwy źródłowej</div>` + countList(C.sourceFinal, (k) => (k === "—" ? "bez warstwy" : sourceName(k))));

  let rej = "";
  const f = c.filter;
  const stages = [...C.stageCounts].sort((a, b) => b[1] - a[1]);
  const totalRej = stages.reduce((a, x) => a + x[1], 0);
  for (const [stage, cnt] of stages) {
    const active = f && f.stage === stage && !f.rule;
    rej += `<button class="rowbtn ${active ? "on" : ""}" data-act="stage" data-stage="${esc(stage)}"><span>${esc(stageName(stage))}</span><span class="tnum">${cnt}</span></button>`;
    const rules = C.ruleCounts.get(stage);
    if (rules) {
      for (const [rule, rc] of [...rules].sort((a, b) => b[1] - a[1])) {
        const ra = f && f.stage === stage && f.rule === rule;
        rej += `<button class="rowbtn sub2 ${ra ? "on" : ""}" data-act="rule" data-stage="${esc(stage)}" data-rule="${esc(rule)}"><span>${esc(ruleName(rule))}</span><span class="tnum">${rc}</span></button>`;
      }
    }
  }
  if (!stages.length) rej = `<div class="empty">Brak odrzuconych kandydatów.</div>`;
  h += section(`Odrzucone wg etapu · ${totalRej}`, `<div class="dim small">klik filtruje duchy na wykresie, ponowny klik czyści</div>${rej}`);
  return h;
}

export { KIND_SHORT };
