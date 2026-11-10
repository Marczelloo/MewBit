// mewbeat chart debugger: front-end. One canvas with rows on a shared time axis, a side panel that explains notes.
import { Player, computePeaks, decodeAudio, peakRange } from "./audio.js";
import { LEVELS, KIND_SHORT, clamp, esc, fmt, lowerBound, parseTime, sortedByT, stageName } from "./labels.js";
import * as UI from "./panel.js";

const $ = (s) => document.querySelector(s);
const LABEL_W = 136;
const ROW_GAP = 2;
const DEFAULT_WINDOW_MS = 12000;

// ---------- storage helpers ----------
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

// ---------- elements ----------
const el = {
  cv: $("#cv"), wrap: $("#canvasWrap"), ov: $("#ov"), ovWrap: $("#ovWrap"), panel: $("#panel"),
  songBtn: $("#songBtn"), songPop: $("#songPop"), songFilter: $("#songFilter"), songList: $("#songList"),
  playBtn: $("#playBtn"), timeNow: $("#timeNow"), timeTotal: $("#timeTotal"), audioStatus: $("#audioStatus"),
  jump: $("#jumpTo"), vol: $("#vol"), clickGen: $("#clickGen"), clickHum: $("#clickHum"),
  offset: $("#offset"), offsetVal: $("#offsetVal"), follow: $("#follow"),
  snapSel: $("#snapSel"), genInfo: $("#genInfo"), msg: $("#msg"), warn: $("#warn"),
  showRej: $("#showRej"), filterChip: $("#filterChip"), loopInfo: $("#loopInfo"), loopClear: $("#loopClear"), cursorT: $("#cursorT"),
  legendChips: $("#legendChips"),
};
const g = el.cv.getContext("2d");
const og = el.ov.getContext("2d");

// ---------- colours (from CSS variables) ----------
const COL = {};
for (const n of ["bg", "panel", "row", "row2", "line", "text", "dim", "accent", "ok", "warn", "bad", "playhead", "loop",
  "k-event", "k-copy", "k-bandPath", "k-fillGaps", "k-fillRests", "k-other", "l-drums", "l-bass", "l-lead", "l-bands",
  "b-low", "b-lowmid", "b-highmid", "b-high", "d-kick", "d-snare", "d-hat", "d-other", "human", "snap", "wave", "energy"]) {
  COL[n] = getComputedStyle(document.documentElement).getPropertyValue("--" + n).trim() || "#888";
}
const kindColor = (k) => COL["k-" + k] ?? COL["k-other"];
const drumColor = (k) => COL["d-" + k] ?? COL["d-other"];
const leaderColor = (l) => COL["l-" + l] ?? COL.dim;

// ---------- state ----------
const S = { songs: [], sort: "name", shown: [], hi: 0 };
let D = null; // song data
let C = null; // chart data (or {unusable:true})
let level = "normal";
let snapVer = "";
let snapData = null; // {notes} | {missing:true} | {loading:true}
let roundIx = -1; // the picked round of a played song
let sel = null; // {kind:"note",id} | {kind:"phrase",index} | {kind:"human",row,n}
let filter = null; // {stage, rule?}
let loop = null;
let loopDrag = null;
let peaks = null;
let offsetMs = 0;
let rows = [];
let totalH = 400;
let cssW = 1000;
let dpr = 1;
let PW = 800;
let tA = 0;
let tB = 12000;
const V = { t0: -500, ppm: 0.07 };
let songToken = 0;
let chartToken = 0;
let snapToken = 0;
let audioAbort = null;
let raf = 0;
let hashTimer = 0;
let msgTimer = 0;
let lastTimeStr = "";
let lastWin = "";
let hatch = null;

const player = new Player(() => {
  el.playBtn.textContent = player.playing ? "⏸" : "▶";
  scheduleHash();
  requestDraw();
});

// ---------- small helpers ----------
const X = (t) => LABEL_W + (t - V.t0) * V.ppm;
const tAtX = (x) => V.t0 + (x - LABEL_W) / V.ppm;
const humanNotes = () => D?.human[level] ?? null;
const dur = () => D?.dur ?? 0;

function flash(text, ms = 3500) {
  el.msg.textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { el.msg.textContent = ""; }, ms);
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error ?? ""; } catch { /* ignore */ }
    const e = new Error(`HTTP ${res.status} ${detail}`.trim());
    e.status = res.status;
    throw e;
  }
  return res.json();
}

function requestDraw() {
  if (!raf) raf = requestAnimationFrame(frame);
}

// ---------- URL hash ----------
function parseHash() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw) return {};
  const [id, lv, t] = raw.split("/");
  const out = {};
  try { if (id) out.id = decodeURIComponent(id); } catch { /* ignore */ }
  if (LEVELS.includes(lv)) out.level = lv;
  if (t !== undefined && isFinite(Number(t))) out.pos = Number(t);
  return out;
}
function scheduleHash() {
  if (hashTimer || !D) return;
  hashTimer = setTimeout(() => {
    hashTimer = 0;
    if (!D) return;
    const h = `#${encodeURIComponent(D.id)}/${level}/${Math.round(player.pos())}`;
    if (location.hash !== h) history.replaceState(null, "", h);
  }, 300);
}

// ---------- building data ----------
function buildData(p) {
  const f = p.features;
  const order = ["low", "lowmid", "highmid", "high"];
  const rawBands = f.bands ?? [];
  const bands = [...order.map((n) => rawBands.find((b) => b.name === n)).filter(Boolean), ...rawBands.filter((b) => !order.includes(b.name))]
    .map((b) => ({ name: b.name, onsets: sortedByT(b.onsets) }));
  const drums = sortedByT(f.drums);
  const drumsByKind = new Map();
  for (const d of drums) {
    if (!drumsByKind.has(d.kind)) drumsByKind.set(d.kind, []);
    drumsByKind.get(d.kind).push(d);
  }
  const pref = ["kick", "snare", "hat"];
  const kinds = [...drumsByKind.keys()].sort((a, b) => {
    const ia = pref.indexOf(a); const ib = pref.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  for (const arr of drumsByKind.values()) arr.maxLen = 0;
  const pitchRange = (arr) => {
    let lo = Infinity; let hi = -Infinity;
    for (const n of arr) { if (n.pitch < lo) lo = n.pitch; if (n.pitch > hi) hi = n.pitch; }
    return isFinite(lo) ? [lo, hi] : [0, 1];
  };
  const bass = sortedByT(f.bass);
  const lead = sortedByT(f.lead);
  const human = {};
  for (const lv of LEVELS) {
    if (!p.human?.[lv]) continue;
    human[lv] = sortedByT(p.human[lv].map(([t, lane, end]) => ({ t, lane, end, len: end ? end - t : 0 })));
  }
  const phr = f.phrases?.list ?? [];
  D = {
    id: p.song.id, song: p.song, features: f, dur: f.durationMs ?? 0, payload: p,
    bands, drums, drumsByKind, drumKinds: kinds, bass, lead,
    pitch: { bass: pitchRange(bass), lead: pitchRange(lead) },
    energy: f.energy?.values?.length ? f.energy : null,
    sections: f.sections ?? [], highlightMs: f.highlightMs ?? null,
    human, hasAnyHuman: Object.keys(human).length > 0,
    snapshots: p.snapshots ?? [],
    beats: f.tempo?.beats ?? [], downbeats: f.tempo?.downbeats ?? [],
    featurePhrases: phr.map((x, i) => ({ index: i, ...x })),
    audioUrl: p.audioUrl,
  };
}

function buildChart(raw) {
  if (!raw.usable) return { unusable: true, raw };
  const recById = new Map();
  for (const r of raw.records ?? []) recById.set(r.id, r);
  const notes = sortedByT((raw.notes ?? []).map((n) => ({ ...n, kind: recById.get(n.id)?.kind })));
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const ghosts = [];
  const stageCounts = new Map();
  const ruleCounts = new Map();
  const phraseStats = new Map();
  const stat = (i) => {
    if (!phraseStats.has(i)) phraseStats.set(i, { fin: 0, rej: 0, stages: new Map() });
    return phraseStats.get(i);
  };
  for (const r of raw.records ?? []) {
    if (r.rejected) {
      ghosts.push({ t: r.rejected.t, lane: r.rejected.lane, rec: r, kind: r.kind });
      const st = r.rejected.stage;
      stageCounts.set(st, (stageCounts.get(st) ?? 0) + 1);
      if (r.rejected.why?.rule) {
        if (!ruleCounts.has(st)) ruleCounts.set(st, new Map());
        const m = ruleCounts.get(st);
        m.set(r.rejected.why.rule, (m.get(r.rejected.why.rule) ?? 0) + 1);
      }
      const ps = stat(r.phrase);
      ps.rej++;
      ps.stages.set(st, (ps.stages.get(st) ?? 0) + 1);
    }
  }
  ghosts.sort((a, b) => a.t - b.t);
  ghosts.maxLen = 0;
  const kindFinal = new Map();
  const sourceFinal = new Map();
  for (const n of notes) {
    const r = recById.get(n.id);
    if (!r) continue;
    kindFinal.set(r.kind, (kindFinal.get(r.kind) ?? 0) + 1);
    const s = r.source ?? "—";
    sourceFinal.set(s, (sourceFinal.get(s) ?? 0) + 1);
    stat(r.phrase).fin++;
  }
  const phrases = (raw.phrases ?? []).slice().sort((a, b) => a.startMs - b.startMs);
  const dens = new Uint16Array(Math.ceil((D?.dur ?? 0) / 1000) + 2);
  for (const n of notes) { const i = Math.floor(n.t / 1000); if (i >= 0 && i < dens.length) dens[i]++; }
  return { raw, notes, noteById, recById, ghosts, stageCounts, ruleCounts, phraseStats, kindFinal, sourceFinal, phrases, phraseByIndex: new Map(phrases.map((p) => [p.index, p])), dens };
}

// ---------- layout ----------
function buildRows() {
  const r = [];
  let y = 0;
  const add = (id, h, label, extra = {}) => { r.push({ id, y, h, label, ...extra }); y += h + ROW_GAP; };
  add("ruler", 22, "");
  add("wave", 58, "Fala");
  add("energy", 44, "Energia");
  D.bands.forEach((b, i) => add("band:" + i, 11, `pasmo ${b.name}`, { band: b, small: true }));
  D.drumKinds.forEach((k) => add("drum:" + k, 11, `perk. ${k}`, { kind: k, small: true }));
  add("bass", 44, "Bas");
  add("lead", 44, "Melodia");
  add("phrases", 22, "Frazy");
  add("gen", 4 * 21, C?.unusable ? "Generator (brak)" : C ? "Generator" : "Generator (liczę…)", { lanes: true });
  const hn = humanNotes();
  if (hn) add("human", 4 * 15, "Człowiek", { lanes: true });
  else add("human", 18, D.hasAnyHuman ? `Człowiek: brak mapy dla ${level}` : "Człowiek: brak (utwór bez mapy)", { empty: true });
  if (snapVer) {
    if (snapData?.notes) add("snap", 4 * 15, `Snapshot ${snapVer}`, { lanes: true });
    else add("snap", 18, snapData?.missing ? `Snapshot ${snapVer}: brak` : `Snapshot ${snapVer}: ładuję…`, { empty: true });
  }
  // The charts are what this page is for: free height below the rows goes to their lanes.
  const lanes = r.filter((row) => row.lanes);
  const extra = lanes.length ? Math.floor(Math.min(4 * 24, (el.wrap.clientHeight - y) / lanes.length)) : 0;
  if (extra > 0) {
    let shift = 0;
    for (const row of r) {
      row.y += shift;
      if (row.lanes) { row.h += extra; shift += extra; }
    }
    y += shift;
  }
  rows = r;
  totalH = y;
}
const rowById = (id) => rows.find((r) => r.id === id);

function relayout() {
  if (!D) return;
  buildRows();
  resizeCanvas();
}

function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  cssW = Math.max(300, el.wrap.clientWidth);
  const h = Math.max(totalH, 10);
  el.cv.style.width = cssW + "px";
  el.cv.style.height = h + "px";
  el.cv.width = Math.round(cssW * dpr);
  el.cv.height = Math.round(h * dpr);
  PW = cssW - LABEL_W;
  hatch = null;
  clampView();
  requestDraw();
}
function resizeOverview() {
  const w = Math.max(300, el.ovWrap.clientWidth);
  const h = el.ovWrap.clientHeight || 64;
  el.ov.style.width = w + "px";
  el.ov.width = Math.round(w * dpr);
  el.ov.height = Math.round(h * dpr);
  requestDraw();
}

// ---------- view ----------
const range = () => PW / V.ppm;
function minPpm() { return PW / (Math.max(dur(), 1000) * 1.08); }
function clampView() {
  if (!D) return;
  V.ppm = clamp(V.ppm, minPpm(), 2);
  const R = range();
  const lo = -R * 0.1;
  V.t0 = clamp(V.t0, lo, Math.max(lo, dur() - R * 0.9));
}
function centerOn(t, frac = 0.35) {
  V.t0 = t - range() * frac;
  clampView();
  requestDraw();
}
function ensureVisible(t) {
  const R = range();
  if (t < V.t0 + R * 0.02 || t > V.t0 + R * 0.95) centerOn(t, 0.2);
}
function zoomAt(x, factor) {
  const t = tAtX(x);
  V.ppm = clamp(V.ppm * factor, minPpm(), 2);
  V.t0 = t - (x - LABEL_W) / V.ppm;
  clampView();
  requestDraw();
}
function defaultView(at) {
  V.ppm = PW / DEFAULT_WINDOW_MS;
  V.t0 = at - DEFAULT_WINDOW_MS * 0.2;
  clampView();
}

// ---------- loading ----------
async function loadSong(id, { lv = level, pos = 0 } = {}) {
  const token = ++songToken;
  chartToken++;
  snapToken++;
  audioAbort?.abort();
  player.destroy();
  peaks = null;
  D = null; C = null; sel = null; snapData = null; roundIx = -1;
  setLoop(null);
  level = lv;
  syncLevelButtons();
  el.warn.hidden = true;
  el.genInfo.textContent = "";
  el.playBtn.disabled = true;
  el.audioStatus.textContent = "";
  el.songBtn.textContent = "Ładuję utwór…";
  renderPanel();
  let payload;
  try {
    payload = await getJson(`/api/song/${encodeURIComponent(id)}`);
  } catch (e) {
    if (token !== songToken) return;
    el.songBtn.textContent = "Błąd ładowania utworu";
    flash(`Nie wczytano utworu ${id}: ${e.message}`, 8000);
    return;
  }
  if (token !== songToken) return;
  buildData(payload);
  if (!D.snapshots.includes(snapVer)) snapVer = "";
  offsetMs = Number(lsGet("mewbeat-debug.offset." + id)) || 0;
  el.offset.value = String(offsetMs);
  updateOffsetUi();
  player.offset = offsetMs;
  player.fallbackDur = D.dur;
  player.pausedPos = clamp(pos, 0, D.dur);
  el.timeTotal.textContent = " " + fmt(D.dur);
  el.songBtn.textContent = `${payload.song.artist} — ${payload.song.title}`;
  document.title = `${payload.song.artist} — ${payload.song.title} · mewbeat debugger`;
  fillSnapSelect();
  buildLegend();
  buildRows();
  resizeCanvas();
  defaultView(player.pausedPos);
  centerOn(player.pausedPos, 0.3);
  updateTime(true);
  renderPanel();
  scheduleHash();
  renderSongList();
  loadAudio(token, payload.audioUrl);
  loadChart();
  loadSnapshot();
}

async function loadAudio(token, url) {
  audioAbort = new AbortController();
  const ctrl = audioAbort;
  el.audioStatus.textContent = "Dekoduję audio…";
  try {
    const buf = await decodeAudio(url, ctrl.signal);
    if (token !== songToken) return;
    player.buffer = buf;
    peaks = computePeaks(buf);
    const d = Math.round(buf.duration * 1000);
    if (Math.abs(d - D.dur) > 50 || !D.dur) { D.dur = Math.max(D.dur, d); el.timeTotal.textContent = " " + fmt(D.dur); }
    el.playBtn.disabled = false;
    el.audioStatus.textContent = "audio gotowe";
    setTimeout(() => { if (el.audioStatus.textContent === "audio gotowe") el.audioStatus.textContent = ""; }, 2500);
  } catch (e) {
    if (token !== songToken || e.name === "AbortError") return;
    el.audioStatus.textContent = "";
    flash(`Błąd audio: ${e.message || e}`, 12000);
    el.audioStatus.innerHTML = `<span class="warn">Błąd audio: ${esc(e.message || e)}</span>`;
  }
  requestDraw();
}

async function loadChart(keep = false) {
  if (!D) return;
  const my = ++chartToken;
  const prev = C && !C.unusable ? C.notes.length : null;
  if (!keep) { C = null; if (sel?.kind === "note") sel = null; setTracks(); relayout(); renderPanel(); }
  el.genInfo.innerHTML = `<span class="warn">liczę chart…</span>`;
  const t0 = performance.now();
  let raw;
  try {
    raw = await getJson(`/api/chart/${encodeURIComponent(D.id)}/${level}`);
  } catch (e) {
    if (my !== chartToken) return;
    el.genInfo.innerHTML = `<span class="warn">błąd chartu</span>`;
    showWarn(`Błąd pobierania chartu: ${e.message}`);
    return;
  }
  if (my !== chartToken) return;
  C = buildChart(raw);
  if (sel?.kind === "note") sel = null;
  if (sel?.kind === "phrase" && C.unusable) sel = null;
  const roundtrip = Math.round(performance.now() - t0);
  if (C.unusable) {
    el.genInfo.innerHTML = `gen v${esc(raw.generatorVersion)} · <span class="warn">brak chartu</span>`;
    showWarn(`Generator nie zrobił chartu dla poziomu ${level} (usable = false).`);
  } else {
    const delta = keep && prev != null ? ` <span class="dim">(było ${prev}, ${C.notes.length - prev >= 0 ? "+" : ""}${C.notes.length - prev})</span>` : "";
    el.genInfo.innerHTML = `gen <b>v${esc(raw.generatorVersion)}</b> · ★ <b>${raw.stars ?? "–"}</b> · ${raw.ms} ms <span class="dim">(${roundtrip} ms z siecią)</span> · <b>${C.notes.length}</b> nut${delta}`;
    if (raw.matches === false) showWarn("UWAGA: historia nie zgadza się z prawdziwym chartem (matches = false). To, co panel mówi o nutach, nie opisuje chartu, który dostałaby gra. Nie ufaj panelowi, dopóki to nie zniknie.");
    else el.warn.hidden = true;
  }
  setTracks();
  relayout();
  renderPanel(true);
  requestDraw();
}

function showWarn(text) {
  el.warn.textContent = text;
  el.warn.hidden = false;
}

async function loadSnapshot() {
  const my = ++snapToken;
  if (!snapVer || !D) { snapData = null; relayout(); return; }
  snapData = { loading: true };
  relayout();
  try {
    const arr = await getJson(`/api/snapshot/${encodeURIComponent(D.id)}/${level}/${snapVer}`);
    if (my !== snapToken) return;
    snapData = { notes: sortedByT(arr) };
  } catch (e) {
    if (my !== snapToken) return;
    snapData = e.status === 404 ? { missing: true } : { missing: true, error: e.message };
  }
  relayout();
  if (sel?.kind === "human" && sel.row === "snap") { sel = null; renderPanel(); }
}

function setTracks() {
  player.tracks = [
    { notes: C && !C.unusable ? C.notes : [], on: el.clickGen.checked, freq: 1760 },
    { notes: humanNotes() ?? [], on: el.clickHum.checked, freq: 880 },
  ];
  player.resetSchedule();
}

async function setLevel(lv) {
  if (!D || lv === level) return;
  level = lv;
  syncLevelButtons();
  renderSongList();
  scheduleHash();
  if (sel?.kind === "human") sel = null;
  await Promise.all([loadChart(), loadSnapshot()]);
}

// A round of a played song: its level, and the chart it was played on when that version is stored.
async function pickRound(i) {
  const round = D?.song.rounds?.[i];
  if (!round || !LEVELS.includes(round.difficulty)) return;
  roundIx = i;
  const label = round.chartVersion == null ? "" : `v${round.chartVersion}`;
  snapVer = D.snapshots.includes(label) ? label : "";
  el.snapSel.value = snapVer;
  if (label && !snapVer) flash(`Wersja ${label} nie jest zachowana, pokazuję tylko chart z bieżącego generatora.`, 6000);
  if (sel?.kind === "human" && sel.row === "snap") sel = null;
  if (round.difficulty === level) await loadSnapshot();
  else await setLevel(round.difficulty);
  renderPanel(true);
}

// ---------- selection ----------
function select(s) {
  sel = s;
  renderPanel();
  requestDraw();
}

function renderPanel(keepScroll = false) {
  const st = el.panel.scrollTop;
  if (!D) { el.panel.innerHTML = `<div class="empty" style="padding:12px 0">Ładuję…</div>`; return; }
  const c = { D, C, song: D.song, level, human: humanNotes(), filter, snapVer, featurePhrases: D.featurePhrases };
  let html = "";
  const usable = C && !C.unusable;
  if (sel?.kind === "note" && usable && C.recById.get(sel.id)) html = UI.noteHtml(c, C.recById.get(sel.id));
  else if (sel?.kind === "phrase") html = UI.phraseHtml(usable ? c : { ...c, C: { phraseByIndex: new Map(), phraseStats: new Map() } }, sel.index);
  else if (sel?.kind === "human") html = UI.plainNoteHtml({ ...c, C: usable ? C : null }, sel);
  else { sel = sel?.kind === "note" ? null : sel; html = UI.summaryHtml(c); }
  if (sel) html = `<div class="actions" style="padding-top:8px"><button class="mini" data-act="clearSel">← podsumowanie (Esc)</button></div>` + html;
  else if (D.song.rounds?.length) html = UI.roundsHtml(D.song.rounds, D.snapshots, roundIx) + html;
  el.panel.innerHTML = html;
  el.panel.scrollTop = keepScroll ? st : 0;
  lastWin = "";
  updateWinCounts();
  updateFilterChip();
}

function updateFilterChip() {
  if (!filter) { el.filterChip.hidden = true; return; }
  el.filterChip.hidden = false;
  el.filterChip.textContent = `filtr duchów: ${stageName(filter.stage)}${filter.rule ? " / " + filter.rule : ""} ✕`;
}

function updateWinCounts() {
  const box = $("#winCounts");
  if (!box) return;
  tA = V.t0;
  tB = V.t0 + PW / V.ppm;
  const cnt = (arr) => { if (!arr) return null; return lowerBound(arr, tB) - lowerBound(arr, tA); };
  const gen = C && !C.unusable ? cnt(C.notes) : null;
  const hum = cnt(humanNotes());
  const text = `${fmt(tA)} – ${fmt(tB)}: generator <b>${gen ?? "–"}</b> · człowiek <b>${hum ?? "–"}</b>`;
  if (text !== lastWin) { box.innerHTML = text; lastWin = text; }
}

// ---------- hit testing ----------
function rowAt(y) {
  for (const r of rows) if (y >= r.y && y < r.y + r.h) return r;
  return null;
}

function ghostVisible(gh) {
  if (!filter) return true;
  const rj = gh.rec.rejected;
  return rj.stage === filter.stage && (!filter.rule || rj.why?.rule === filter.rule);
}
const showGhosts = () => el.showRej.checked && C && !C.unusable;

function hitTest(x, y) {
  const r = rowAt(y);
  if (!r || x < LABEL_W) return null;
  const t = tAtX(x);
  if (r.id === "phrases") {
    const list = C && !C.unusable ? C.phrases : D.featurePhrases;
    const i = lowerBound(list, t, (p) => p.startMs) - 1;
    for (const k of [i, i + 1]) {
      const p = list[k];
      if (p && t >= p.startMs && t < p.endMs) return { kind: "phrase", index: p.index ?? k };
    }
    return null;
  }
  if (r.id !== "gen" && r.id !== "human" && r.id !== "snap") return null;
  if (!r.lanes) return null;
  const lh = r.h / 4;
  const lane = clamp(Math.floor((y - r.y) / lh), 0, 3);
  const pxMs = 9 / V.ppm;
  let best = null;
  let bestD = 9;
  const scan = (arr, off, ghost, make) => {
    if (!arr) return;
    for (let i = lowerBound(arr, t - off - pxMs - (arr.maxLen ?? 0)); i < arr.length; i++) {
      const n = arr[i];
      const nt = n.t + off;
      if (nt > t + pxMs) break;
      if (n.lane !== lane) continue;
      const len = n.len ?? 0;
      let d = Math.abs(X(nt) - x);
      if (len && t >= nt && t <= nt + len) d = 0;
      else if (len && t > nt + len) d = Math.abs(X(nt + len) - x);
      d += ghost ? 2 : 0;
      if (d < bestD) { bestD = d; best = make(n); }
    }
  };
  if (r.id === "gen" && C && !C.unusable) {
    scan(C.notes, offsetMs, false, (n) => ({ kind: "note", id: n.id }));
    if (showGhosts()) scan(C.ghosts.filter ? C.ghosts : [], offsetMs, true, (n) => (ghostVisible(n) ? { kind: "note", id: n.rec.id } : null));
  } else if (r.id === "human") scan(humanNotes(), offsetMs, false, (n) => ({ kind: "human", row: "human", n }));
  else if (r.id === "snap" && snapData?.notes) scan(snapData.notes, offsetMs, false, (n) => ({ kind: "human", row: "snap", n }));
  return best;
}

// ---------- drawing ----------
function clampText(text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && g.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

function getHatch() {
  if (hatch) return hatch;
  const size = Math.max(8, Math.round(8 * dpr));
  const tile = document.createElement("canvas");
  tile.width = tile.height = size;
  const t = tile.getContext("2d");
  t.strokeStyle = "rgba(255,255,255,0.45)";
  t.lineWidth = Math.max(1, dpr);
  t.beginPath();
  t.moveTo(0, size); t.lineTo(size, 0);
  t.moveTo(-size / 2, size / 2); t.lineTo(size / 2, -size / 2);
  t.moveTo(size / 2, size * 1.5); t.lineTo(size * 1.5, size / 2);
  t.stroke();
  hatch = g.createPattern(tile, "repeat");
  hatch.setTransform(new DOMMatrix().scale(1 / dpr));
  return hatch;
}

const RULER_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000];

function drawRuler(r) {
  const step = RULER_STEPS.find((s) => s * V.ppm >= 80) ?? 120000;
  g.font = "10px system-ui, sans-serif";
  g.textBaseline = "top";
  g.fillStyle = COL.dim;
  g.strokeStyle = COL.dim;
  g.lineWidth = 1;
  g.beginPath();
  const minor = step / 5;
  if (minor * V.ppm >= 5) {
    for (let k = Math.ceil(tA / minor); k <= Math.floor(tB / minor); k++) {
      const x = Math.round(X(k * minor)) + 0.5;
      g.moveTo(x, r.y + r.h - 4); g.lineTo(x, r.y + r.h);
    }
  }
  for (let k = Math.ceil(tA / step); k <= Math.floor(tB / step); k++) {
    const x = Math.round(X(k * step)) + 0.5;
    g.moveTo(x, r.y + r.h - 9); g.lineTo(x, r.y + r.h);
  }
  g.stroke();
  for (let k = Math.ceil(tA / step); k <= Math.floor(tB / step); k++) {
    g.fillText(fmt(k * step, step < 1000), X(k * step) + 3, r.y + 3);
  }
}

function drawWave(r) {
  if (!peaks) {
    g.fillStyle = COL.dim;
    g.font = "12px system-ui, sans-serif";
    g.textBaseline = "middle";
    g.fillText(el.audioStatus.textContent || "brak audio", LABEL_W + 10, r.y + r.h / 2);
    return;
  }
  const mid = r.y + r.h / 2;
  const amp = r.h / 2 - 2;
  const scale = amp / peaks.top;
  g.fillStyle = COL.wave;
  const pxMs = 1 / V.ppm;
  for (let px = 0; px < PW; px++) {
    const t0 = tA + px * pxMs;
    const pr = peakRange(peaks, t0, t0 + pxMs);
    if (!pr) continue;
    const hi = pr[1] * scale;
    const lo = -pr[0] * scale;
    g.fillRect(LABEL_W + px, mid - hi, 1, Math.max(1, hi + lo));
  }
}

function drawEnergy(r) {
  g.font = "9px system-ui, sans-serif";
  g.textBaseline = "top";
  if (D.energy) {
    const hop = D.energy.hopMs;
    const vals = D.energy.values;
    const i0 = Math.max(0, Math.floor(tA / hop) - 1);
    const i1 = Math.min(vals.length - 1, Math.ceil(tB / hop) + 1);
    if (i1 >= i0) {
      const bottom = r.y + r.h - 1;
      const hgt = r.h - 4;
      g.beginPath();
      g.moveTo(X(i0 * hop), bottom);
      for (let i = i0; i <= i1; i++) g.lineTo(X(i * hop), bottom - clamp(vals[i], 0, 1) * hgt);
      g.lineTo(X(i1 * hop), bottom);
      g.closePath();
      g.globalAlpha = 0.3; g.fillStyle = COL.energy; g.fill();
      g.globalAlpha = 0.9; g.strokeStyle = COL.energy; g.lineWidth = 1; g.stroke();
      g.globalAlpha = 1;
    }
  } else {
    g.fillStyle = COL.dim;
    g.fillText("brak danych o energii", LABEL_W + 10, r.y + 4);
  }
  g.setLineDash([3, 3]);
  g.strokeStyle = COL.dim;
  g.fillStyle = COL.dim;
  D.sections.forEach((s, i) => {
    if (s.startMs < tA - 1 || s.startMs > tB) return;
    const x = Math.round(X(s.startMs)) + 0.5;
    g.beginPath(); g.moveTo(x, r.y); g.lineTo(x, r.y + r.h); g.stroke();
    g.fillText(`S${i} · ${s.energy?.toFixed?.(2) ?? ""}`, x + 3, r.y + 1);
  });
  g.setLineDash([]);
  if (D.highlightMs != null && D.highlightMs >= tA && D.highlightMs <= tB) {
    const x = X(D.highlightMs);
    g.fillStyle = COL.warn;
    g.beginPath(); g.moveTo(x - 4, r.y + r.h - 1); g.lineTo(x + 4, r.y + r.h - 1); g.lineTo(x, r.y + r.h - 7); g.fill();
    g.fillText("highlight", x + 6, r.y + r.h - 11);
  }
}

function drawTicks(r, arr, color) {
  g.fillStyle = color;
  const w = V.ppm > 0.05 ? 2 : 1;
  for (let i = lowerBound(arr, tA - 5); i < arr.length; i++) {
    const o = arr[i];
    if (o.t > tB) break;
    g.globalAlpha = 0.18 + 0.82 * clamp(o.s ?? 1, 0, 1);
    g.fillRect(Math.round(X(o.t)), r.y + 1, w, r.h - 2);
  }
  g.globalAlpha = 1;
}

function drawRoll(r, arr, range, color) {
  const [lo, hi] = range;
  const span = hi - lo || 1;
  g.fillStyle = color;
  const bh = 4;
  for (let i = lowerBound(arr, tA - 5 - arr.maxLen); i < arr.length; i++) {
    const n = arr[i];
    if (n.t > tB) break;
    const x = X(n.t);
    const w = Math.max(2, (n.len ?? 0) * V.ppm);
    if (x + w < LABEL_W) continue;
    g.globalAlpha = 0.2 + 0.8 * clamp(n.conf ?? 1, 0, 1);
    const y = r.y + 3 + (1 - (n.pitch - lo) / span) * (r.h - 3 - bh - 3);
    g.fillRect(x, y, w, bh);
  }
  g.globalAlpha = 1;
}

function drawPhrases(r) {
  const usable = C && !C.unusable;
  const list = usable ? C.phrases : D.featurePhrases;
  g.font = "10px system-ui, sans-serif";
  g.textBaseline = "middle";
  const i0 = Math.max(0, lowerBound(list, tA, (p) => p.endMs));
  for (let i = i0; i < list.length; i++) {
    const p = list[i];
    if (p.startMs > tB) break;
    const x1 = Math.max(LABEL_W, X(p.startMs));
    const x2 = Math.min(LABEL_W + PW, X(p.endMs));
    const w = x2 - x1;
    if (w <= 0) continue;
    const color = usable ? leaderColor(p.leader) : COL.dim;
    g.globalAlpha = 0.4;
    g.fillStyle = color;
    g.fillRect(x1, r.y + 1, Math.max(1, w - 1), r.h - 2);
    g.globalAlpha = 1;
    if (usable && p.charted === "copy") {
      g.fillStyle = getHatch();
      g.fillRect(x1, r.y + 1, Math.max(1, w - 1), r.h - 2);
    }
    g.fillStyle = color;
    g.fillRect(Math.max(LABEL_W, X(p.startMs)), r.y + 1, 2, r.h - 2);
    const isSel = sel?.kind === "phrase" && sel.index === p.index;
    if (isSel) { g.strokeStyle = COL.text; g.lineWidth = 1.5; g.strokeRect(x1 + 0.5, r.y + 1.5, Math.max(1, w - 2), r.h - 3); }
    let label = usable ? `#${p.index} ${p.leader}${p.repeatOf != null ? ` →#${p.repeatOf}` : ""}` : `#${p.index}`;
    g.fillStyle = COL.text;
    if (w > 22) {
      if (g.measureText(label).width > w - 8) label = `#${p.index}`;
      if (g.measureText(label).width <= w - 6) g.fillText(label, x1 + 5, r.y + r.h / 2);
    }
  }
}

function ring(x, cy, hh, color, dashed) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 2;
  if (dashed) g.setLineDash([3, 2]);
  g.strokeRect(x - 6, cy - hh - 2, 12, hh * 2 + 4);
  g.restore();
}

function drawLanes(r, notes, o) {
  const lh = r.h / 4;
  g.lineWidth = 1;
  g.strokeStyle = COL.line;
  g.globalAlpha = 0.5;
  g.beginPath();
  for (let i = 0; i < 4; i++) { const y = Math.round(r.y + i * lh + lh / 2) + 0.5; g.moveTo(LABEL_W, y); g.lineTo(LABEL_W + PW, y); }
  g.stroke();
  g.globalAlpha = 1;
  if (!notes) return;
  const off = o.offset;
  const hh = (lh - 6) / 2;
  const hw = 3;
  // ghosts first, below the real notes
  if (o.ghosts) {
    const gl = o.ghosts;
    g.lineWidth = 1;
    g.globalAlpha = 0.55;
    for (let i = lowerBound(gl, tA - off - 10 / V.ppm); i < gl.length; i++) {
      const gh = gl[i];
      const x = X(gh.t + off);
      if (x > LABEL_W + PW + 6) break;
      if (!ghostVisible(gh)) continue;
      g.strokeStyle = kindColor(gh.kind);
      g.strokeRect(Math.round(x) - hw + 0.5, r.y + gh.lane * lh + lh / 2 - hh + 0.5, hw * 2, hh * 2 - 1);
    }
    g.globalAlpha = 1;
  }
  const start = lowerBound(notes, tA - off - 10 / V.ppm - (notes.maxLen ?? 0));
  for (let i = start; i < notes.length; i++) {
    const n = notes[i];
    const x = X(n.t + off);
    if (x > LABEL_W + PW + 6) break;
    const cy = r.y + n.lane * lh + lh / 2;
    const color = o.color(n);
    g.fillStyle = color;
    if (n.len) {
      g.globalAlpha = 0.45;
      g.fillRect(x, cy - hh * 0.55, Math.max(1, n.len * V.ppm), hh * 1.1);
      g.globalAlpha = 1;
    }
    g.fillRect(Math.round(x) - hw, cy - hh, hw * 2, hh * 2);
  }
}

function recPosition(rec) {
  return UI.recPos(C, rec);
}

function drawSelection() {
  if (!sel || !D) return;
  const gen = rowById("gen");
  const lh = gen.h / 4;
  const hh = (lh - 6) / 2;
  const vline = (t, color, dashed) => {
    const x = Math.round(X(t)) + 0.5;
    g.save();
    g.strokeStyle = color; g.globalAlpha = 0.55; g.lineWidth = 1;
    if (dashed) g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(x, rowById("wave").y); g.lineTo(x, totalH); g.stroke();
    g.restore();
  };
  if (sel.kind === "note" && C && !C.unusable) {
    const rec = C.recById.get(sel.id);
    if (!rec) return;
    const p = recPosition(rec);
    vline(p.t + offsetMs, COL.text, false);
    ring(X(p.t + offsetMs), gen.y + p.lane * lh + lh / 2, hh, COL.text, false);
    if (rec.kind === "copy" && rec.copyOf != null) {
      const src = C.recById.get(rec.copyOf);
      if (src) {
        const sp = recPosition(src);
        vline(sp.t + offsetMs, COL["k-copy"], true);
        ring(X(sp.t + offsetMs), gen.y + sp.lane * lh + lh / 2, hh, COL["k-copy"], true);
      }
    }
  } else if (sel.kind === "human") {
    const r = rowById(sel.row);
    if (!r?.lanes) return;
    const l2 = r.h / 4;
    vline(sel.n.t + offsetMs, COL.text, false);
    ring(X(sel.n.t + offsetMs), r.y + sel.n.lane * l2 + l2 / 2, (l2 - 6) / 2, COL.text, false);
  } else if (sel.kind === "phrase") {
    const p = (C && !C.unusable ? C.phraseByIndex.get(sel.index) : null) ?? D.featurePhrases[sel.index];
    if (p) { vline(p.startMs, COL.text, true); vline(p.endMs, COL.text, true); }
  }
}

function drawBeats(top) {
  const usable = C && !C.unusable;
  const beats = usable && C.raw.grid?.beats?.length ? C.raw.grid.beats : D.beats;
  const downs = usable && C.raw.grid?.downbeats?.length ? C.raw.grid.downbeats : D.downbeats;
  const line = (arr, alpha, color, minSpacing) => {
    if (arr.length < 2) return;
    const gap = ((arr[arr.length - 1] - arr[0]) / (arr.length - 1)) * V.ppm;
    const a = clamp((gap - minSpacing) / 25, 0, 1) * alpha;
    if (a <= 0.01) return;
    g.globalAlpha = a;
    g.strokeStyle = color;
    g.beginPath();
    for (let i = lowerBound(arr, tA - 1, (x) => x); i < arr.length && arr[i] <= tB; i++) {
      const x = Math.round(X(arr[i])) + 0.5;
      g.moveTo(x, top); g.lineTo(x, totalH);
    }
    g.stroke();
    g.globalAlpha = 1;
  };
  g.lineWidth = 1;
  line(beats, 0.28, COL.dim, 4);
  line(downs, 0.6, COL.text, 6);
}

function drawLoopOverlay() {
  const l = loopDrag ?? loop;
  if (!l) return;
  const x1 = X(l.a); const x2 = X(l.b);
  g.fillStyle = COL.loop;
  g.globalAlpha = 0.12;
  g.fillRect(x1, 0, x2 - x1, totalH);
  g.globalAlpha = 0.9;
  g.fillRect(x1, 0, 1.5, totalH);
  g.fillRect(x2 - 1.5, 0, 1.5, totalH);
  g.globalAlpha = 1;
  g.font = "bold 10px system-ui, sans-serif";
  g.textBaseline = "top";
  g.fillText("A", x1 + 3, 11);
  g.fillText("B", x2 - 10, 11);
}

function drawLabels() {
  g.fillStyle = COL.panel;
  g.fillRect(0, 0, LABEL_W, totalH);
  g.fillStyle = COL.line;
  g.fillRect(LABEL_W - 1, 0, 1, totalH);
  g.textBaseline = "middle";
  for (const r of rows) {
    g.font = (r.small ? "10px" : "11px") + " system-ui, sans-serif";
    g.fillStyle = r.empty ? COL.warn : COL.dim;
    let label = r.label;
    if ((r.id === "gen" || r.id === "human" || r.id === "snap") && r.lanes && offsetMs) label += ` (${offsetMs > 0 ? "+" : ""}${offsetMs} ms)`;
    const y = r.lanes ? r.y + 9 : r.y + r.h / 2;
    if (r.id === "ruler") continue;
    g.fillText(clampText(label, LABEL_W - (r.lanes ? 24 : 12)), 8, y);
    if (r.lanes) {
      g.fillStyle = COL.dim;
      g.textAlign = "right";
      const lh = r.h / 4;
      for (let i = 0; i < 4; i++) g.fillText(String(i), LABEL_W - 8, r.y + i * lh + lh / 2);
      g.textAlign = "left";
    }
    if (r.band) {
      g.fillStyle = COL["b-" + r.band.name] ?? COL.dim;
      g.fillRect(LABEL_W - 6, r.y + 2, 3, r.h - 4);
    }
    if (r.kind) {
      g.fillStyle = drumColor(r.kind);
      g.fillRect(LABEL_W - 6, r.y + 2, 3, r.h - 4);
    }
  }
}

function draw() {
  if (!D) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = COL.bg;
    g.fillRect(0, 0, cssW, totalH);
    return;
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = COL.bg;
  g.fillRect(0, 0, cssW, totalH);
  tA = V.t0;
  tB = V.t0 + PW / V.ppm;
  for (const r of rows) { g.fillStyle = r.id === "ruler" ? COL.panel : COL.row; g.fillRect(LABEL_W, r.y, PW, r.h); }
  g.save();
  g.beginPath();
  g.rect(LABEL_W, 0, PW, totalH);
  g.clip();
  drawBeats(rows[1]?.y ?? 0);
  const usable = C && !C.unusable;
  for (const r of rows) {
    if (r.id === "ruler") drawRuler(r);
    else if (r.id === "wave") drawWave(r);
    else if (r.id === "energy") drawEnergy(r);
    else if (r.band) drawTicks(r, r.band.onsets, COL["b-" + r.band.name] ?? COL.text);
    else if (r.kind) drawTicks(r, D.drumsByKind.get(r.kind), drumColor(r.kind));
    else if (r.id === "bass") drawRoll(r, D.bass, D.pitch.bass, COL["l-bass"]);
    else if (r.id === "lead") drawRoll(r, D.lead, D.pitch.lead, COL["l-lead"]);
    else if (r.id === "phrases") drawPhrases(r);
    else if (r.id === "gen") {
      if (usable) drawLanes(r, C.notes, { offset: offsetMs, color: (n) => kindColor(n.kind), ghosts: showGhosts() ? C.ghosts : null });
      else {
        drawLanes(r, null, {});
        g.fillStyle = COL.dim; g.font = "12px system-ui, sans-serif"; g.textBaseline = "middle";
        g.fillText(C?.unusable ? "Generator nie dał chartu dla tego poziomu" : "Liczę chart…", LABEL_W + 10, r.y + r.h / 2);
      }
    } else if (r.id === "human") { if (r.lanes) drawLanes(r, humanNotes(), { offset: offsetMs, color: () => COL.human }); }
    else if (r.id === "snap") { if (r.lanes) drawLanes(r, snapData.notes, { offset: offsetMs, color: () => COL.snap }); }
  }
  drawSelection();
  drawLoopOverlay();
  const px = X(player.pos());
  if (px >= LABEL_W - 6 && px <= LABEL_W + PW + 6) {
    g.fillStyle = COL.playhead;
    g.fillRect(px - 0.75, 0, 1.5, totalH);
    g.beginPath(); g.moveTo(px - 5, 0); g.lineTo(px + 5, 0); g.lineTo(px, 7); g.fill();
  }
  g.restore();
  drawLabels();
}

function drawOverview() {
  const w = el.ov.width / dpr;
  const h = el.ov.height / dpr;
  og.setTransform(dpr, 0, 0, dpr, 0, 0);
  og.fillStyle = COL.bg;
  og.fillRect(0, 0, w, h);
  og.fillStyle = COL.panel;
  og.fillRect(0, 0, LABEL_W, h);
  og.fillStyle = COL.dim;
  og.font = "11px system-ui, sans-serif";
  og.textBaseline = "middle";
  og.fillText("Przegląd", 8, h / 2);
  if (!D || !dur()) return;
  const x0 = LABEL_W;
  const W = w - LABEL_W - 8;
  const ox = (t) => x0 + (t / dur()) * W;
  // energy
  if (D.energy) {
    const vals = D.energy.values;
    const hop = D.energy.hopMs;
    og.beginPath();
    og.moveTo(x0, h - 14);
    for (let px = 0; px <= W; px += 1) {
      const i = clamp(Math.floor(((px / W) * dur()) / hop), 0, vals.length - 1);
      og.lineTo(x0 + px, h - 14 - clamp(vals[i], 0, 1) * (h - 24));
    }
    og.lineTo(x0 + W, h - 14);
    og.closePath();
    og.globalAlpha = 0.45; og.fillStyle = COL.energy; og.fill(); og.globalAlpha = 1;
  }
  // density hints, one bar per second
  const bars = (dens, color, base, hgt, maxv) => {
    og.fillStyle = color;
    for (let i = 0; i < dens.length; i++) {
      if (!dens[i]) continue;
      const bw = Math.max(1, (1000 / dur()) * W);
      og.globalAlpha = 0.85;
      og.fillRect(ox(i * 1000), base - (dens[i] / maxv) * hgt, bw, (dens[i] / maxv) * hgt);
    }
    og.globalAlpha = 1;
  };
  const hn = humanNotes();
  let humanDens = null;
  if (hn) {
    if (!D.humanDens) D.humanDens = {};
    if (!D.humanDens[level]) {
      const d = new Uint16Array(Math.ceil(dur() / 1000) + 2);
      for (const n of hn) { const i = Math.floor(n.t / 1000); if (i >= 0 && i < d.length) d[i]++; }
      D.humanDens[level] = d;
    }
    humanDens = D.humanDens[level];
  }
  let maxv = 4;
  if (C && !C.unusable) for (const v of C.dens) if (v > maxv) maxv = v;
  if (humanDens) for (const v of humanDens) if (v > maxv) maxv = v;
  if (C && !C.unusable) bars(C.dens, COL["k-event"], h - 2, 12, maxv);
  if (humanDens) bars(humanDens, COL.human, h - 14, 0, maxv); // placeholder to keep colour state clean
  if (humanDens) {
    og.fillStyle = COL.human;
    og.globalAlpha = 0.7;
    for (let i = 0; i < humanDens.length; i++) {
      if (!humanDens[i]) continue;
      og.fillRect(ox(i * 1000), 2, Math.max(1, (1000 / dur()) * W), (humanDens[i] / maxv) * 8);
    }
    og.globalAlpha = 1;
  }
  // loop
  if (loop) {
    og.fillStyle = COL.loop; og.globalAlpha = 0.25;
    og.fillRect(ox(loop.a), 0, ox(loop.b) - ox(loop.a), h);
    og.globalAlpha = 1;
  }
  // visible window
  const wx1 = ox(clamp(tA, 0, dur()));
  const wx2 = ox(clamp(tB, 0, dur()));
  og.fillStyle = "rgba(255,255,255,0.10)";
  og.fillRect(wx1, 0, Math.max(2, wx2 - wx1), h);
  og.strokeStyle = COL.text;
  og.lineWidth = 1;
  og.strokeRect(wx1 + 0.5, 0.5, Math.max(2, wx2 - wx1) - 1, h - 1);
  // playhead
  const ph = ox(player.pos());
  og.fillStyle = COL.playhead;
  og.fillRect(ph - 0.75, 0, 1.5, h);
}

function updateTime(force = false) {
  const s = fmt(player.pos());
  if (force || s !== lastTimeStr) { el.timeNow.textContent = s; lastTimeStr = s; }
}

function frame() {
  raf = 0;
  if (D && player.playing && el.follow.checked) {
    const p = player.pos();
    const R = range();
    if (p > V.t0 + R * 0.88 || p < V.t0) { V.t0 = p - R * 0.1; clampView(); }
  }
  updateTime();
  draw();
  drawOverview();
  updateWinCounts();
  if (player.playing) { requestDraw(); scheduleHash(); }
}

// ---------- seeking, playing ----------
function seek(ms, reveal = true) {
  if (!D) return;
  ms = clamp(ms, 0, Math.max(dur(), player.duration));
  player.seek(ms);
  if (reveal && el.follow.checked) ensureVisible(ms);
  updateTime();
  scheduleHash();
  requestDraw();
}

async function togglePlay() {
  if (!D) return;
  if (player.playing) { player.pause(); return; }
  if (!player.buffer) { flash("Audio jeszcze niegotowe (dekodowanie albo błąd)."); return; }
  try { await player.play(); } catch (e) { flash("Nie można odtworzyć: " + e.message, 8000); }
  requestDraw();
}

function setLoop(l) {
  loop = l && l.b - l.a > 50 ? { a: Math.max(0, l.a), b: Math.min(l.b, Math.max(dur(), 1)) } : null;
  player.loop = loop;
  el.loopInfo.textContent = loop ? `A–B: ${fmt(loop.a)} – ${fmt(loop.b)} (${((loop.b - loop.a) / 1000).toFixed(2)} s)` : "A–B: brak (Shift+przeciągnij)";
  el.loopClear.disabled = !loop;
  requestDraw();
}

// ---------- pointer interaction on the main canvas ----------
let drag = null;
const canvasPoint = (e) => {
  const r = el.cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

el.cv.addEventListener("pointerdown", (e) => {
  if (!D || e.button !== 0) return;
  const { x, y } = canvasPoint(e);
  if (x < LABEL_W) return;
  el.cv.setPointerCapture(e.pointerId);
  const row = rowAt(y);
  if (e.shiftKey) {
    drag = { mode: "loop", startT: tAtX(x), moved: false };
    loopDrag = { a: drag.startT, b: drag.startT };
  } else if (row?.id === "ruler") {
    drag = { mode: "scrub", moved: false };
    seek(tAtX(x), false);
  } else drag = { mode: "pan", startX: x, startY: y, t0: V.t0, moved: false, row };
  el.cv.style.cursor = "grabbing";
});

el.cv.addEventListener("pointermove", (e) => {
  if (!D) return;
  const { x, y } = canvasPoint(e);
  el.cursorT.textContent = x >= LABEL_W ? `kursor ${fmt(tAtX(x))}` : "kursor –";
  if (!drag) {
    el.cv.style.cursor = x >= LABEL_W && hitTest(x, y) ? "pointer" : "grab";
    return;
  }
  if (drag.mode === "pan") {
    if (Math.abs(x - drag.startX) > 3) drag.moved = true;
    if (drag.moved) { V.t0 = drag.t0 - (x - drag.startX) / V.ppm; clampView(); requestDraw(); }
  } else if (drag.mode === "scrub") {
    drag.moved = true;
    seek(tAtX(clamp(x, LABEL_W, LABEL_W + PW)), false);
  } else if (drag.mode === "loop") {
    const t = clamp(tAtX(x), 0, dur());
    loopDrag = { a: Math.min(drag.startT, t), b: Math.max(drag.startT, t) };
    drag.moved = true;
    requestDraw();
  }
});

function endDrag(e) {
  if (!drag) return;
  const { x, y } = canvasPoint(e);
  const d = drag;
  drag = null;
  el.cv.style.cursor = "grab";
  if (d.mode === "loop") {
    const l = loopDrag;
    loopDrag = null;
    if (l && l.b - l.a > 50) {
      setLoop(l);
      if (loop) seek(loop.a, false);
    } else requestDraw();
  } else if (d.mode === "pan" && !d.moved) {
    const row = d.row;
    if (row?.id === "wave") { seek(tAtX(x), false); return; }
    const hit = hitTest(x, y);
    if (hit) {
      if (hit.kind === "phrase") { select(hit); }
      else select(hit);
    } else if (sel) select(null);
  }
}
el.cv.addEventListener("pointerup", endDrag);
el.cv.addEventListener("pointercancel", () => { drag = null; loopDrag = null; requestDraw(); });
el.cv.addEventListener("pointerleave", () => { el.cursorT.textContent = "kursor –"; });

el.cv.addEventListener("wheel", (e) => {
  if (!D) return;
  if (e.altKey) return; // Alt+wheel: ordinary vertical scrolling of the rows
  e.preventDefault();
  const { x } = canvasPoint(e);
  if (e.ctrlKey) zoomAt(Math.max(x, LABEL_W), Math.exp(-e.deltaY * 0.0018));
  else {
    const unit = e.deltaMode === 1 ? 16 : 1;
    const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
    V.t0 += d / V.ppm;
    clampView();
    requestDraw();
  }
}, { passive: false });

// ---------- overview interaction ----------
let ovDrag = false;
function ovMove(e) {
  if (!D || !dur()) return;
  const r = el.ov.getBoundingClientRect();
  const W = r.width - LABEL_W - 8;
  const t = ((e.clientX - r.left - LABEL_W) / W) * dur();
  V.t0 = t - range() / 2;
  clampView();
  requestDraw();
}
el.ov.addEventListener("pointerdown", (e) => { ovDrag = true; el.ov.setPointerCapture(e.pointerId); ovMove(e); });
el.ov.addEventListener("pointermove", (e) => { if (ovDrag) ovMove(e); });
el.ov.addEventListener("pointerup", () => { ovDrag = false; });

// ---------- panel actions ----------
el.panel.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const d = b.dataset;
  switch (d.act) {
    case "clearSel": select(null); break;
    case "rec": {
      const rec = C?.recById.get(Number(d.id));
      if (!rec) { flash("Nie ma takiej nuty w tym chartcie."); break; }
      select({ kind: "note", id: rec.id });
      centerOn(UI.recPos(C, rec).t + offsetMs);
      break;
    }
    case "phrase": {
      const i = Number(d.index);
      select({ kind: "phrase", index: i });
      const p = C?.phraseByIndex.get(i) ?? D.featurePhrases[i];
      if (p && (p.startMs < tA || p.startMs > tB)) centerOn(p.startMs, 0.15);
      break;
    }
    case "round": pickRound(Number(d.i)); break;
    case "goto": centerOn(Number(d.t), 0.15); break;
    case "play": {
      seek(Math.max(0, Number(d.t) - 800));
      if (!player.playing) togglePlay();
      centerOn(Number(d.t) + offsetMs, 0.3);
      break;
    }
    case "copyTime": {
      const text = fmt(Number(d.t));
      navigator.clipboard?.writeText(text).then(() => flash(`Skopiowano ${text}`), () => flash(`Czas: ${text}`));
      break;
    }
    case "blocker": {
      const t = Number(d.t);
      const lane = d.lane === "" ? null : Number(d.lane);
      let found = null;
      for (let i = lowerBound(C.notes, t - 2); i < C.notes.length && C.notes[i].t <= t + 2; i++) if (lane == null || C.notes[i].lane === lane) { found = C.notes[i].id; break; }
      if (found == null) for (let i = lowerBound(C.ghosts, t - 2); i < C.ghosts.length && C.ghosts[i].t <= t + 2; i++) if (lane == null || C.ghosts[i].lane === lane) { found = C.ghosts[i].rec.id; break; }
      if (found != null) select({ kind: "note", id: found });
      else flash(`Nie znaleziono nuty przy ${fmt(t)} (pas ${lane ?? "?"}).`);
      centerOn(t + offsetMs);
      break;
    }
    case "stage": {
      filter = filter && filter.stage === d.stage && !filter.rule ? null : { stage: d.stage };
      if (filter) el.showRej.checked = true;
      renderPanel(true); requestDraw();
      break;
    }
    case "rule": {
      filter = filter && filter.stage === d.stage && filter.rule === d.rule ? null : { stage: d.stage, rule: d.rule };
      if (filter) el.showRej.checked = true;
      renderPanel(true); requestDraw();
      break;
    }
    default:
  }
  b.blur?.();
});

el.filterChip.addEventListener("click", () => { filter = null; renderPanel(true); requestDraw(); });

// ---------- song picker ----------
const isPreview = (s) => s.id.startsWith("preview:");
const isPlayed = (s) => s.id.startsWith("played:");
// A played song the list lacks (see unlistedPlayedSong in server.mjs) is still opened from a link; the server decides if it exists.
const PLAYED_ID = /^played:[0-9a-f]{40}$/;
const roundsWord = (n) => (n === 1 ? "runda" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "rundy" : "rund");
function renderSongList() {
  const q = el.songFilter.value.trim().toLowerCase();
  const dist = (s) => s.distance?.[level];
  const list = S.songs.filter((s) => !q || `${s.artist} ${s.title} ${s.creator ?? ""}`.toLowerCase().includes(q));
  // Played songs stay on top in the server's order, last played first, whatever the sort.
  list.sort((a, b) => {
    if (isPlayed(a) || isPlayed(b)) return isPlayed(a) === isPlayed(b) ? 0 : isPlayed(a) ? -1 : 1;
    if (isPreview(a) !== isPreview(b)) return isPreview(a) ? 1 : -1;
    if (S.sort === "dist") {
      const da = dist(a); const db = dist(b);
      if ((da == null) !== (db == null)) return da == null ? 1 : -1;
      if (da != null && da !== db) return db - da;
    }
    return `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`, "pl");
  });
  S.shown = list;
  S.hi = clamp(S.hi, 0, Math.max(0, list.length - 1));
  const nPlayed = list.filter(isPlayed).length;
  el.songList.innerHTML = list
    .map((s, i) => {
      const d = dist(s);
      const head = nPlayed && (i === 0 || i === nPlayed) ? `<li class="grp">${i === 0 ? "Zagrane" : "Pozostałe"}</li>` : "";
      const tag = isPlayed(s) ? `<span class="tg rounds">${s.rounds.length} ${roundsWord(s.rounds.length)}</span>` : `<span class="tg">${isPreview(s) ? "preview" : esc(s.genre ?? "")}</span>`;
      return `${head}<li data-id="${esc(s.id)}" class="${s.id === D?.id ? "cur" : ""} ${i === S.hi ? "hi" : ""}"><span class="nm">${esc(s.artist)} — ${esc(s.title)}</span>${tag}<span class="ds">${d != null ? d.toFixed(2) : "–"}</span></li>`;
    })
    .join("");
  $("#sortSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.sort === S.sort));
}
function openPop() {
  el.songPop.hidden = false;
  el.songFilter.value = "";
  S.hi = Math.max(0, S.shown.findIndex((s) => s.id === D?.id));
  renderSongList();
  el.songFilter.focus();
  el.songList.querySelector("li.hi")?.scrollIntoView({ block: "center" });
}
function closePop() { el.songPop.hidden = true; }
function pickSong(id) {
  closePop();
  if (id && id !== D?.id) loadSong(id, { pos: 0 });
}
function stepSong(dir) {
  const list = S.shown.length ? S.shown : S.songs;
  const i = list.findIndex((s) => s.id === D?.id);
  const next = list[clamp((i < 0 ? 0 : i) + dir, 0, list.length - 1)];
  if (next) loadSong(next.id, { pos: 0 });
}
el.songBtn.addEventListener("click", () => (el.songPop.hidden ? openPop() : closePop()));
el.songFilter.addEventListener("input", () => { S.hi = 0; renderSongList(); });
el.songFilter.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    S.hi = clamp(S.hi + (e.key === "ArrowDown" ? 1 : -1), 0, S.shown.length - 1);
    renderSongList();
    el.songList.querySelector("li.hi")?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") { e.preventDefault(); pickSong(S.shown[S.hi]?.id); }
  else if (e.key === "Escape") { e.preventDefault(); closePop(); }
});
el.songList.addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li) pickSong(li.dataset.id);
});
$("#sortSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  S.sort = b.dataset.sort;
  S.hi = 0;
  renderSongList();
  el.songFilter.focus();
});
document.addEventListener("mousedown", (e) => {
  if (!el.songPop.hidden && !el.songPop.contains(e.target) && e.target !== el.songBtn) closePop();
});
$("#prevSong").addEventListener("click", (e) => { stepSong(-1); e.currentTarget.blur(); });
$("#nextSong").addEventListener("click", (e) => { stepSong(1); e.currentTarget.blur(); });

// ---------- toolbar ----------
function syncLevelButtons() {
  document.querySelectorAll("#levelSeg button").forEach((b) => b.classList.toggle("on", b.dataset.level === level));
}
$("#levelSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) { setLevel(b.dataset.level); b.blur(); }
});
function fillSnapSelect() {
  el.snapSel.innerHTML = `<option value="">brak</option>` + D.snapshots.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  el.snapSel.value = snapVer;
  el.snapSel.disabled = !D.snapshots.length;
}
el.snapSel.addEventListener("change", () => {
  snapVer = el.snapSel.value;
  el.snapSel.blur();
  if (sel?.kind === "human" && sel.row === "snap") sel = null;
  renderPanel(true);
  loadSnapshot();
});
$("#recalc").addEventListener("click", (e) => { loadChart(true); e.currentTarget.blur(); });

function buildLegend() {
  const chip = (c, text, hollow) => `<span class="chip"><i class="${hollow ? "hollow" : ""}" style="--c:${c}"></i>${text}</span>`;
  el.legendChips.innerHTML =
    Object.entries(KIND_SHORT).map(([k, t]) => chip(kindColor(k), t)).join("") +
    chip(COL["k-other"], "inne") +
    chip(COL["k-event"], "odrzucona (duch)", true) +
    chip(COL.human, "człowiek") +
    chip(COL.snap, "snapshot") +
    `<span class="chip dim">| frazy:</span>` +
    ["drums", "bass", "lead", "bands"].map((l) => chip(leaderColor(l), l)).join("") +
    `<span class="chip dim">kreskowana = kopia</span>`;
}

// ---------- transport ----------
el.playBtn.addEventListener("click", (e) => { togglePlay(); e.currentTarget.blur(); });
el.jump.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const ms = parseTime(el.jump.value);
    if (ms == null) { flash("Nie rozumiem czasu. Przykłady: 1:36, 1:36.5, 96.5"); return; }
    seek(ms, false);
    centerOn(ms, 0.3);
    el.jump.blur();
  } else if (e.key === "Escape") el.jump.blur();
});
$("#rateSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  player.setRate(Number(b.dataset.rate));
  $("#rateSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  b.blur();
});
el.vol.value = lsGet("mewbeat-debug.vol") ?? "0.8";
player.setVolume(Number(el.vol.value));
el.vol.addEventListener("input", () => { player.setVolume(Number(el.vol.value)); lsSet("mewbeat-debug.vol", el.vol.value); });
el.vol.addEventListener("change", () => el.vol.blur());
for (const c of [el.clickGen, el.clickHum]) c.addEventListener("change", () => { setTracks(); c.blur(); });
function updateOffsetUi() { el.offsetVal.textContent = `${offsetMs > 0 ? "+" : ""}${offsetMs} ms`; }
el.offset.addEventListener("input", () => {
  offsetMs = Number(el.offset.value);
  player.offset = offsetMs;
  player.resetSchedule();
  if (D) lsSet("mewbeat-debug.offset." + D.id, String(offsetMs));
  updateOffsetUi();
  requestDraw();
});
el.offset.addEventListener("change", () => el.offset.blur());
$("#offsetReset").addEventListener("click", (e) => { el.offset.value = "0"; el.offset.dispatchEvent(new Event("input")); e.currentTarget.blur(); });
el.follow.addEventListener("change", () => el.follow.blur());
el.showRej.addEventListener("change", () => { el.showRej.blur(); requestDraw(); });
el.loopClear.addEventListener("click", (e) => { setLoop(null); e.currentTarget.blur(); });
$("#zoomIn").addEventListener("click", (e) => { zoomAt(LABEL_W + PW / 2, 1.4); e.currentTarget.blur(); });
$("#zoomOut").addEventListener("click", (e) => { zoomAt(LABEL_W + PW / 2, 1 / 1.4); e.currentTarget.blur(); });

// ---------- keyboard ----------
const isTyping = (t) => t instanceof HTMLElement && (t.matches("textarea, select") || (t.matches("input") && !["range", "checkbox", "button"].includes(t.type)));
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTyping(e.target)) return;
  switch (e.key) {
    case " ": e.preventDefault(); if (!e.repeat) togglePlay(); break;
    case "1": case "2": case "3": case "4": setLevel(LEVELS[Number(e.key) - 1]); break;
    case "ArrowLeft": case "ArrowRight":
      if (e.target instanceof HTMLInputElement && e.target.type === "range") return;
      e.preventDefault();
      seek(player.pos() + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 5000 : 1000));
      break;
    case "+": case "=": zoomAt(LABEL_W + PW / 2, 1.4); break;
    case "-": case "_": zoomAt(LABEL_W + PW / 2, 1 / 1.4); break;
    case "[": stepSong(-1); break;
    case "]": stepSong(1); break;
    case "Escape": if (!el.songPop.hidden) closePop(); else if (sel) select(null); break;
    default:
  }
});
window.addEventListener("keyup", (e) => { if (e.key === " " && !isTyping(e.target)) e.preventDefault(); });

window.addEventListener("hashchange", () => {
  const h = parseHash();
  if (!h.id) return;
  if (h.id !== D?.id) { loadSong(h.id, { lv: h.level ?? level, pos: h.pos ?? 0 }); return; }
  if (h.level && h.level !== level) setLevel(h.level);
  if (h.pos != null && Math.abs(h.pos - player.pos()) > 50) { seek(h.pos, false); centerOn(h.pos, 0.3); }
});

new ResizeObserver(() => { if (D) relayout(); else resizeCanvas(); }).observe(el.wrap);
new ResizeObserver(() => { dpr = window.devicePixelRatio || 1; resizeOverview(); }).observe(el.ovWrap);
window.addEventListener("beforeunload", () => player.destroy());

// ---------- boot ----------
async function boot() {
  el.cv.style.cursor = "grab";
  resizeOverview();
  let songs;
  try {
    songs = await getJson("/api/songs");
  } catch (e) {
    el.songBtn.textContent = "Błąd listy utworów";
    flash("Nie wczytano /api/songs: " + e.message, 10000);
    return;
  }
  S.songs = songs;
  renderSongList();
  const h = parseHash();
  const id = h.id && (songs.some((s) => s.id === h.id) || PLAYED_ID.test(h.id)) ? h.id : songs.some((s) => s.id === "884441") ? "884441" : songs[0]?.id;
  if (!id) { el.songBtn.textContent = "Brak utworów"; return; }
  await loadSong(id, { lv: h.level ?? "normal", pos: h.pos ?? 0 });
}

// A read-only handle for poking at the page from the console while debugging the debugger.
window.__mbd = {
  get D() { return D; }, get C() { return C; }, get sel() { return sel; }, V, player,
  select: (s) => select(s), hit: hitTest, rows: () => rows, offset: () => offsetMs, get level() { return level; },
};

boot();
