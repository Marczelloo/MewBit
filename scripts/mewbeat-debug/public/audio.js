// Playback: AudioBufferSourceNode + GainNode, a click scheduler, A-B loop. Plus waveform peaks.
import { lowerBound } from "./labels.js";

export async function decodeAudio(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.arrayBuffer();
  // An offline context decodes without needing a user gesture; the real AudioContext is made on first play.
  const offline = new OfflineAudioContext(2, 1, 44100);
  return offline.decodeAudioData(data);
}

export class Player {
  constructor(onState) {
    this.onState = onState;
    this.ctx = null;
    this.gain = null;
    this.buffer = null;
    this.src = null;
    this.playing = false;
    this.starting = false;
    this.rate = 1;
    this.volume = 0.8;
    this.startedAt = 0;
    this.startPos = 0;
    this.pausedPos = 0;
    this.tracks = []; // [{notes:[{t}], on, freq}]
    this.offset = 0; // ms, notes/clicks relative to audio
    this.loop = null; // {a, b} in ms
    this.fallbackDur = 0;
    this.timer = 0;
    this.scheduledTo = 0;
    this.blips = new Set();
  }

  get duration() {
    return this.buffer ? this.buffer.duration * 1000 : this.fallbackDur;
  }

  pos() {
    if (!this.playing) return this.pausedPos;
    const p = this.startPos + (this.ctx.currentTime - this.startedAt) * 1000 * this.rate;
    return Math.min(p, this.duration);
  }

  async ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }

  stopSource() {
    if (this.src) {
      this.src.onended = null;
      try { this.src.stop(); } catch { /* already stopped */ }
      try { this.src.disconnect(); } catch { /* ignore */ }
      this.src = null;
    }
    for (const o of this.blips) {
      try { o.stop(); } catch { /* ignore */ }
    }
    this.blips.clear();
  }

  startAt(ms) {
    this.stopSource();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    src.connect(this.gain);
    src.start(0, Math.max(0, ms) / 1000);
    this.src = src;
    this.startedAt = this.ctx.currentTime;
    this.startPos = ms;
    this.scheduledTo = ms;
    this.playing = true;
  }

  async play() {
    if (!this.buffer || this.playing || this.starting) return false;
    this.starting = true;
    try {
      await this.ensureCtx();
      let p = this.pausedPos;
      if (p >= this.duration - 30) p = this.loop ? this.loop.a : 0;
      this.startAt(p);
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), 25);
    } finally {
      this.starting = false;
    }
    this.onState();
    return true;
  }

  pause() {
    if (this.playing) this.pausedPos = this.pos();
    this.stopSource();
    this.playing = false;
    clearInterval(this.timer);
    this.timer = 0;
    this.onState();
  }

  seek(ms) {
    const p = Math.max(0, Math.min(ms, this.duration || ms));
    if (this.playing) this.startAt(p);
    else this.pausedPos = p;
  }

  setRate(r) {
    if (this.playing) {
      const p = this.pos();
      this.rate = r;
      this.startAt(p);
    } else this.rate = r;
  }

  // Call when offset, tracks or toggles change during playback so nothing is scheduled twice or skipped.
  resetSchedule() {
    if (!this.playing) return;
    for (const o of this.blips) {
      try { o.stop(); } catch { /* ignore */ }
    }
    this.blips.clear();
    this.scheduledTo = this.pos();
  }

  destroy() {
    this.pause();
    this.buffer = null;
    this.pausedPos = 0;
    this.loop = null;
  }

  tick() {
    if (!this.playing) return;
    const p = this.pos();
    if (this.loop && p >= this.loop.b) {
      this.seek(this.loop.a);
      return;
    }
    if (p >= this.duration - 5) {
      this.pause();
      this.pausedPos = this.duration;
      this.onState();
      return;
    }
    this.scheduleClicks(p);
  }

  scheduleClicks(p) {
    let horizon = p + 120 * this.rate;
    if (this.loop) horizon = Math.min(horizon, this.loop.b);
    const from = this.scheduledTo;
    if (horizon <= from) return;
    for (const tr of this.tracks) {
      if (!tr.on) continue;
      const arr = tr.notes;
      for (let i = lowerBound(arr, from - this.offset); i < arr.length; i++) {
        const at = arr[i].t + this.offset;
        if (at >= horizon) break;
        this.blip(tr.freq, this.startedAt + (at - this.startPos) / 1000 / this.rate);
      }
    }
    this.scheduledTo = horizon;
  }

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
    env.connect(this.gain);
    osc.start(when);
    osc.stop(when + 0.05);
    this.blips.add(osc);
    osc.onended = () => this.blips.delete(osc);
  }
}

// Min/max per millisecond (level 0) and per 32 ms (level 1), computed once from the decoded buffer.
export function computePeaks(buffer) {
  const sr = buffer.sampleRate;
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const len = buffer.length;
  const n = Math.ceil((len / sr) * 1000);
  const per = sr / 1000;
  const mn = new Float32Array(n);
  const mx = new Float32Array(n);
  let top = 0;
  for (let b = 0; b < n; b++) {
    const s0 = Math.floor(b * per);
    const s1 = Math.min(len, Math.floor((b + 1) * per));
    let lo = 0;
    let hi = 0;
    for (const d of channels) {
      for (let i = s0; i < s1; i++) {
        const v = d[i];
        if (v < lo) lo = v;
        else if (v > hi) hi = v;
      }
    }
    mn[b] = lo;
    mx[b] = hi;
    if (-lo > top) top = -lo;
    if (hi > top) top = hi;
  }
  const G = 32;
  const n1 = Math.ceil(n / G);
  const mn1 = new Float32Array(n1);
  const mx1 = new Float32Array(n1);
  for (let g = 0; g < n1; g++) {
    let lo = 0;
    let hi = 0;
    for (let b = g * G; b < Math.min(n, (g + 1) * G); b++) {
      if (mn[b] < lo) lo = mn[b];
      if (mx[b] > hi) hi = mx[b];
    }
    mn1[g] = lo;
    mx1[g] = hi;
  }
  return { n, n1, G, mn, mx, mn1, mx1, top: Math.max(top, 0.02) };
}

// [lo, hi] over [t0, t1) ms, or null outside the data.
export function peakRange(p, t0, t1) {
  if (t1 < 0 || t0 > p.n) return null;
  let lo = 0;
  let hi = 0;
  if (t1 - t0 >= p.G * 2) {
    const a = Math.max(0, Math.floor(t0 / p.G));
    const b = Math.min(p.n1 - 1, Math.floor(t1 / p.G));
    for (let i = a; i <= b; i++) {
      if (p.mn1[i] < lo) lo = p.mn1[i];
      if (p.mx1[i] > hi) hi = p.mx1[i];
    }
  } else {
    const a = Math.max(0, Math.floor(t0));
    const b = Math.min(p.n - 1, Math.max(a, Math.floor(t1)));
    for (let i = a; i <= b; i++) {
      if (p.mn[i] < lo) lo = p.mn[i];
      if (p.mx[i] > hi) hi = p.mx[i];
    }
  }
  return [lo, hi];
}
