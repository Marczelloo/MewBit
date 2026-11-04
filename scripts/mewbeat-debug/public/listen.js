// Blind listening test: one song, several click tracks, switch between them while the music keeps playing.
// The page never says what a track is; it only knows labels and moments.
import { Player } from "./audio.js";

const CLICK_FREQ = 1400; // one pitch for every track, so the sound itself gives nothing away
const SEEK_MS = 5000;
const STORE = "mewbeat-listen";

const $ = (id) => document.getElementById(id);
const el = {
  songSel: $("songSel"),
  statusText: $("statusText"),
  prog: $("prog"),
  error: $("error"),
  errorText: $("errorText"),
  retry: $("retry"),
  timeNow: $("timeNow"),
  timeTotal: $("timeTotal"),
  back: $("back"),
  playBtn: $("playBtn"),
  fwd: $("fwd"),
  tracks: $("tracks"),
  timeline: $("timeline"),
  tl: $("tl"),
  playhead: $("playhead"),
  volMusic: $("volMusic"),
  volClick: $("volClick"),
};

// Music goes through this.gain (the base class); clicks go through their own node, so neither slider scales the other.
class ListenPlayer extends Player {
  constructor(onState) {
    super(onState);
    this.clickVolume = 0.8;
    this.clickGain = null;
  }

  clickBus() {
    if (!this.clickGain) {
      this.clickGain = this.ctx.createGain();
      this.clickGain.gain.value = this.clickVolume;
      this.clickGain.connect(this.ctx.destination);
    }
    return this.clickGain;
  }

  setClickVolume(v) {
    this.clickVolume = v;
    if (this.clickGain) this.clickGain.gain.value = v;
  }

  // Same click as Player.blip, only routed to the click bus instead of this.gain.
  blip(freq, when) {
    const ctx = this.ctx;
    if (when < ctx.currentTime - 0.005) return;
    when = Math.max(when, ctx.currentTime);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(0.4, when + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    osc.connect(env);
    env.connect(this.clickBus());
    osc.start(when);
    osc.stop(when + 0.05);
    this.blips.add(osc);
    osc.onended = () => this.blips.delete(osc);
  }
}

let list = [];
let song = null; // loaded song JSON
let tracks = []; // [{label, ref, notes}]
let active = 0;
let player = null;
let loadAbort = null;
let loadToken = 0;
let retryAction = null;
let lastSecond = -1;
let lastTotal = -1;
let tlWidth = 0;

const load = (key, fallback) => {
  try {
    const v = localStorage.getItem(`${STORE}:${key}`);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
};
const save = (key, value) => {
  try { localStorage.setItem(`${STORE}:${key}`, String(value)); } catch { /* storage may be blocked */ }
};

const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const fmtMb = (bytes) => `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`;
const messageOf = (e) => (e && e.message) || String(e);

// ---------- status / errors ----------

function setStatus(text, percent = null) {
  el.statusText.textContent = text;
  el.prog.hidden = false;
  if (percent == null) el.prog.removeAttribute("value");
  else el.prog.value = percent;
}

function clearStatus(text = "") {
  el.statusText.textContent = text;
  el.prog.hidden = true;
}

function showError(text, retry) {
  clearStatus();
  el.errorText.textContent = text;
  el.error.hidden = false;
  retryAction = retry;
}

function hideError() {
  el.error.hidden = true;
  retryAction = null;
}

el.retry.addEventListener("click", () => {
  const action = retryAction;
  hideError();
  if (action) action();
});

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------- audio download (streamed, with progress) ----------

async function fetchAudio(url, signal, onProgress) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  if (!res.body || !res.body.getReader) {
    onProgress(0, 0);
    return res.arrayBuffer();
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(got, total);
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}

async function loadAudio(token, url, signal) {
  try {
    setStatus("Pobieram audio…");
    const data = await fetchAudio(url, signal, (got, total) => {
      if (token !== loadToken) return;
      if (total && got <= total) setStatus(`Pobieram audio… ${fmtMb(got)} / ${fmtMb(total)} (${Math.floor((got / total) * 100)}%)`, (got / total) * 100);
      else setStatus(`Pobieram audio… ${fmtMb(got)}`);
    });
    if (token !== loadToken) return;
    setStatus("Dekoduję audio…");
    // An offline context decodes without needing a user gesture; the real AudioContext is made on first play.
    const buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(data);
    if (token !== loadToken) return;
    player.buffer = buffer;
    clearStatus("Audio gotowe.");
    el.playBtn.disabled = false;
    updateTotal();
    drawTimeline();
  } catch (e) {
    if (token !== loadToken || e?.name === "AbortError") return;
    const hint = e?.name === "EncodingError" ? "Nie udało się zdekodować audio" : "Nie udało się pobrać audio";
    showError(`${hint} (${messageOf(e)}). Sprawdź połączenie i spróbuj ponownie.`, () => loadSong(currentEntry()));
  }
}

// ---------- song loading ----------

function currentEntry() {
  return list.find((e) => e.song === el.songSel.value) ?? null;
}

function destroyPlayer() {
  if (!player) return;
  const old = player;
  player = null;
  old.onState = () => {};
  old.destroy();
  try { old.ctx?.close(); } catch { /* ignore */ }
}

async function loadSong(entry) {
  const token = ++loadToken;
  loadAbort?.abort();
  loadAbort = new AbortController();
  const { signal } = loadAbort;
  destroyPlayer();
  hideError();
  song = null;
  tracks = [];
  lastSecond = -1;
  el.playBtn.disabled = true;
  renderPlayState();
  buildTracks();
  drawTimeline();
  updateTime(0);
  if (!entry) return;
  setStatus("Ładuję utwór…");
  let data;
  try {
    data = await getJson(`/api/listening/${encodeURIComponent(entry.song)}`, signal);
  } catch (e) {
    if (token !== loadToken || e?.name === "AbortError") return;
    showError(`Nie udało się wczytać utworu (${messageOf(e)}).`, () => loadSong(entry));
    return;
  }
  if (token !== loadToken) return;
  song = data;
  const byTime = (a, b) => a.t - b.t;
  tracks = [
    ...(data.variants ?? []).map((v) => ({ label: String(v.label), ref: false, notes: (v.moments ?? []).map((m) => ({ t: Number(m.t) })).sort(byTime) })),
    ...(data.references ?? []).map((r) => ({ label: String(r.label), ref: true, notes: (r.moments ?? []).map((m) => ({ t: Number(m.t) })).sort(byTime) })),
  ];
  active = Math.min(active, Math.max(0, tracks.length - 1));
  player = new ListenPlayer(renderPlayState);
  player.fallbackDur = Number(data.durationMs) || 0;
  player.setVolume(Number(el.volMusic.value));
  player.setClickVolume(Number(el.volClick.value));
  document.title = "mewbeat · test odsłuchowy";
  buildTracks();
  applyTrack();
  updateTotal();
  renderPlayState();
  drawTimeline();
  const url = `/audio/${encodeURIComponent(data.audioId)}`;
  loadAudio(token, url, signal);
}

// ---------- tracks ----------

function buildTracks() {
  el.tracks.textContent = "";
  tracks.forEach((t, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = t.ref ? "ref" : "var";
    b.setAttribute("aria-pressed", String(i === active));
    const name = document.createElement("span");
    name.textContent = t.label;
    b.append(name);
    if (i < 9) {
      const k = document.createElement("kbd");
      k.textContent = String(i + 1);
      b.append(k);
    }
    b.addEventListener("click", () => selectTrack(i));
    el.tracks.append(b);
  });
}

// Hands the active track to the player. Called on switch, never restarts the music.
function applyTrack() {
  if (!player || !tracks[active]) return;
  player.tracks = [{ notes: tracks[active].notes, on: true, freq: CLICK_FREQ }];
  player.resetSchedule();
}

function selectTrack(i) {
  if (i < 0 || i >= tracks.length) return;
  active = i;
  [...el.tracks.children].forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
  applyTrack();
  drawTimeline();
}

// ---------- transport ----------

function renderPlayState() {
  const playing = !!player?.playing;
  el.playBtn.textContent = playing ? "❚❚ Pauza" : "▶ Odtwarzaj";
}

async function togglePlay() {
  if (!player || !player.buffer) return;
  if (player.playing) player.pause();
  else {
    try {
      await player.play(); // AudioContext is created here, inside the user's tap or key press
    } catch (e) {
      showError(`Nie udało się uruchomić dźwięku (${messageOf(e)}).`, () => {});
    }
  }
}

function seekBy(ms) {
  if (player) player.seek(player.pos() + ms);
}

el.playBtn.addEventListener("click", togglePlay);
el.back.addEventListener("click", () => seekBy(-SEEK_MS));
el.fwd.addEventListener("click", () => seekBy(SEEK_MS));

function setVolumes() {
  const m = Number(el.volMusic.value);
  const c = Number(el.volClick.value);
  player?.setVolume(m);
  player?.setClickVolume(c);
  save("music", m);
  save("click", c);
}
el.volMusic.addEventListener("input", setVolumes);
el.volClick.addEventListener("input", setVolumes);
// After a touch or mouse drag the slider keeps focus; let go of it so Space and the arrows go back to the player.
for (const s of [el.volMusic, el.volClick]) s.addEventListener("pointerup", () => s.blur());

el.songSel.addEventListener("change", () => {
  el.songSel.blur();
  const entry = currentEntry();
  if (entry) history.replaceState(null, "", `#${encodeURIComponent(entry.song)}`);
  loadSong(entry);
});

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target?.tagName;
  if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.key === " ") {
    e.preventDefault();
    if (!e.repeat) togglePlay();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    seekBy(-SEEK_MS);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    seekBy(SEEK_MS);
  } else if (/^[1-9]$/.test(e.key)) {
    const i = Number(e.key) - 1;
    if (i < tracks.length) selectTrack(i);
  }
});
// A focused button would also click on Space key-up; the key is already handled above.
document.addEventListener("keyup", (e) => {
  if (e.key === " " && e.target?.tagName !== "SELECT" && e.target?.tagName !== "INPUT") e.preventDefault();
});

// ---------- time and timeline ----------

const durationMs = () => player?.duration || Number(song?.durationMs) || 0;

function updateTime(pos) {
  const s = Math.floor(pos / 1000);
  if (s !== lastSecond) {
    lastSecond = s;
    el.timeNow.textContent = fmtTime(pos);
  }
}

function updateTotal() {
  const d = Math.round(durationMs() / 1000);
  if (d === lastTotal) return;
  lastTotal = d;
  el.timeTotal.textContent = `/ ${fmtTime(d * 1000)}`;
}

function frame() {
  const dur = durationMs();
  const pos = player ? player.pos() : 0;
  updateTime(pos);
  if (dur > 0) el.playhead.style.transform = `translateX(${((pos / dur) * tlWidth).toFixed(1)}px)`;
  requestAnimationFrame(frame);
}

function drawTimeline() {
  const cv = el.tl;
  const dpr = window.devicePixelRatio || 1;
  const w = el.timeline.clientWidth;
  const h = el.timeline.clientHeight;
  if (!w || !h) return;
  tlWidth = w;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const dur = durationMs();
  if (!dur || !song) return;
  const x = (ms) => (ms / dur) * w;
  const css = getComputedStyle(document.documentElement);

  // Active track: thin ticks in the lower part of the bar.
  g.strokeStyle = css.getPropertyValue("--accent").trim();
  g.lineWidth = 1;
  g.globalAlpha = 0.9;
  g.beginPath();
  for (const n of tracks[active]?.notes ?? []) {
    const px = Math.round(x(n.t)) + 0.5;
    g.moveTo(px, h * 0.42);
    g.lineTo(px, h - 4);
  }
  g.stroke();
  g.globalAlpha = 1;

  // Part boundaries and their labels (a label is dropped when it would run into the previous one).
  const dim = css.getPropertyValue("--dim").trim();
  g.font = "11px system-ui, sans-serif";
  g.textBaseline = "top";
  let labelEnd = -Infinity;
  for (const p of song.parts ?? []) {
    const px = Math.round(x(p.startMs)) + 0.5;
    if (p.startMs > 0) {
      g.strokeStyle = dim;
      g.globalAlpha = 0.7;
      g.beginPath();
      g.moveTo(px, 0);
      g.lineTo(px, h);
      g.stroke();
      g.globalAlpha = 1;
    }
    if (!p.label) continue;
    const tx = px + 4;
    const tw = g.measureText(p.label).width;
    if (tx < labelEnd + 4 || tx + tw > w - 2) continue;
    g.fillStyle = dim;
    g.fillText(p.label, tx, 4);
    labelEnd = tx + tw;
  }
}

el.timeline.addEventListener("click", (e) => {
  const dur = durationMs();
  if (!player || !dur) return;
  const r = el.timeline.getBoundingClientRect();
  player.seek(((e.clientX - r.left) / r.width) * dur);
});

new ResizeObserver(drawTimeline).observe(el.timeline);

// ---------- start ----------

async function init() {
  hideError();
  el.songSel.disabled = true;
  setStatus("Ładuję listę utworów…");
  try {
    list = await getJson("/api/listening");
  } catch (e) {
    showError(`Nie udało się wczytać listy utworów (${messageOf(e)}).`, init);
    return;
  }
  if (!list.length) {
    clearStatus("Brak utworów do odsłuchu.");
    el.songSel.innerHTML = "<option>Brak utworów</option>";
    return;
  }
  el.songSel.textContent = "";
  for (const e of list) {
    const o = document.createElement("option");
    o.value = e.song;
    o.textContent = e.title;
    el.songSel.append(o);
  }
  el.songSel.disabled = false;
  let wanted = "";
  try { wanted = decodeURIComponent(location.hash.slice(1)); } catch { /* malformed hash */ }
  if (list.some((e) => e.song === wanted)) el.songSel.value = wanted;
  loadSong(currentEntry());
}

el.volMusic.value = load("music", el.volMusic.value);
el.volClick.value = load("click", el.volClick.value);
requestAnimationFrame(frame);
init();
