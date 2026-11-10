// The first-run tour's trap. At the end of the tour Mewbit tells the player to try it themselves; a ridiculous chart
// plays for a few seconds, she cuts it off with a joke, and the game opens with a calm song as a real run. The heavy
// chart plays locally through Web Audio (nothing goes to the voice channel).
//
// This file holds the constants, the loudness guard, the sequence (a pure reducer), the small player and the
// preparation. The bot finds, charts and renders both songs by itself (helpers/mewbeat/tourSongs.js, which also holds
// their search texts and levels); the client asks for them while the tour runs and downloads the heavy one. A song that
// is not ready at the last step, or any failure on the way, means no trap: the tour just ends.

// ---- The trap: change the songs, levels and times here ----------------------------------------------------------
// (The songs themselves, by search text, are in helpers/mewbeat/tourSongs.js.)
export const HEAVY = { level: "hell", fromMs: 18_260 }; // the stretch of the heavy song that plays
export const CALM = { level: "normal" }; // the level the calm song is played on
export const TRAP_PAUSE_MS = 1000; // the highway runs this long, empty, before the music starts
export const HEAVY_MS = 5000; // how long the heavy chart plays (with its sound) before the cut
export const CUT_FADE_MS = 100; // fade out of the cut
export const STOP_FADE_MS = 150; // fade out when the tour ends, is skipped or closed
// -----------------------------------------------------------------------------------------------------------------

const HEAVY_SLACK_MS = 600; // samples kept past the cut, so its fade has sound to fade
const SONGS_TIMEOUT_MS = 10_000;
const SONGS_POLL_MS = 5000; // the bot has not finished with its two songs yet: ask again while the tour runs
const CHART_TIMEOUT_MS = 30_000;
const POLL_MS = 2500;
const POLL_LIMIT_MS = 120_000;
export const START_LEAD_S = 0.05; // the sound starts this long after it is asked, so the notes are set to start then too

// ---- Loudness guard --------------------------------------------------------------------------------------------
// The songs are other people's masters at any level, and the player may sit with headphones on. The stretch that
// will play is measured, brought to a fixed quiet level, and never allowed to peak above the ceiling.
const TARGET_RMS = 10 ** (-26 / 20); // -26 dBFS
const PEAK_CEILING = 0.45;
const MAX_GAIN = 6; // a near-silent stretch is not blown up into noise
const REFERENCE_VOLUME = 80; // the music volume at which the target level is heard as is

// Gain for channels[*][fromSample, toSample): the stretch is measured as it will play. The music volume can only
// lower it, by (volume / 80)^2 below 80; above 80 it stays at the target. 0 is silent. A stretch that is empty or
// silent gives 0.
export function safeGain(channels, fromSample, toSample, { musicVolume } = {}) {
  let sum = 0;
  let peak = 0;
  let count = 0;
  for (const data of channels) {
    const from = Math.max(0, Math.floor(fromSample));
    const to = Math.min(data.length, Math.ceil(toSample));
    for (let i = from; i < to; i += 1) {
      const value = data[i];
      sum += value * value;
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
    }
    if (to > from) count += to - from;
  }
  if (!count || !(peak > 0)) return 0;
  const rms = Math.sqrt(sum / count);
  if (!(rms > 0) || !Number.isFinite(rms)) return 0;
  const volume = Number.isFinite(musicVolume) ? Math.min(100, Math.max(0, musicVolume)) : REFERENCE_VOLUME;
  if (volume === 0) return 0;
  const wanted = Math.min(TARGET_RMS / rms, MAX_GAIN) * Math.min(1, (volume / REFERENCE_VOLUME) ** 2);
  return Math.min(wanted, PEAK_CEILING / peak);
}

// ---- Sequence --------------------------------------------------------------------------------------------------
// idle -> heavy (the Hell chart plays) -> joke (cut off, Mewbit talks) -> idle. The joke ends in the tour closing: with
// "rude" the game opens on the calm song, with Skip it does not (MewbeatGame.jsx).
export const TRAP_IDLE = { phase: "idle", line: "" };

export function trapReducer(state, action) {
  switch (action.type) {
    case "begin": return state.phase === "idle" ? { phase: "heavy", line: action.line ?? "" } : state;
    case "cut": return state.phase === "heavy" ? { ...state, phase: "joke" } : state;
    case "end": return state.phase === "idle" ? state : TRAP_IDLE;
    default: return state;
  }
}

// Which song's scene is on the highway: the heavy one stays (frozen) under the joke.
export const trapSceneOf = (phase) => (phase === "heavy" || phase === "joke" ? "heavy" : null);
// What the tour layer shows: nothing but Skip during the heavy chart, the joke popup, or its normal step.
export const trapScreenOf = (phase) => (phase === "heavy" || phase === "joke" ? phase : null);

// ---- Player ----------------------------------------------------------------------------------------------------
// Its own source and gain beside the game's song (soloAudio.js), straight to the output. Always fades in from
// silence; the cut and every stop fade out.
export function createTrapPlayer(getContext) {
  let voice = null; // { ctx, source, gain }

  // Plays buffer from fromMs. fadeMs is the fade in. With lengthMs it plays that long and fades out over its last
  // endFadeMs by itself, so a late timer in a hidden tab cannot leave it running. delayMs holds the sound back that
  // long (the fade in starts when the sound does). false: nothing plays (the context cannot run, the stretch is
  // silent or the music volume is 0).
  function play(buffer, fromMs, fadeMs, { musicVolume, lengthMs = null, endFadeMs = CUT_FADE_MS, delayMs = 0 } = {}) {
    stop(0);
    let ctx;
    try { ctx = getContext(); } catch { return false; }
    if (!ctx || !buffer || ctx.state === "closed") return false;
    const rate = buffer.sampleRate;
    const fromSample = Math.floor((fromMs / 1000) * rate);
    const toSample = lengthMs === null ? buffer.length : Math.min(buffer.length, fromSample + Math.ceil((lengthMs / 1000) * rate));
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c));
    const level = safeGain(channels, fromSample, toSample, { musicVolume });
    if (!(level > 0)) return false;
    try {
      const start = ctx.currentTime + START_LEAD_S + Math.max(0, delayMs) / 1000;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setValueAtTime(0, start);
      const fade = Math.max(0.01, fadeMs / 1000);
      gain.gain.linearRampToValueAtTime(level, start + fade);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(ctx.destination);
      if (lengthMs !== null) {
        const end = start + lengthMs / 1000;
        gain.gain.setValueAtTime(level, Math.max(start + fade, end - Math.min(endFadeMs / 1000, lengthMs / 1000)));
        gain.gain.linearRampToValueAtTime(0, end);
        source.start(start, fromMs / 1000, lengthMs / 1000 + 0.05);
      } else {
        source.start(start, fromMs / 1000);
      }
      const mine = { ctx, source, gain };
      source.onended = () => {
        try { source.disconnect(); gain.disconnect(); } catch { /* already gone */ }
        if (voice === mine) voice = null;
      };
      voice = mine;
      return true;
    } catch {
      return false;
    }
  }

  // Fades out and stops. Does nothing when nothing plays.
  function stop(fadeMs = STOP_FADE_MS) {
    const mine = voice;
    if (!mine) return;
    voice = null;
    const { ctx, source, gain } = mine;
    try {
      const at = ctx.currentTime;
      const fade = Math.max(0, fadeMs) / 1000;
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime(fade > 0 ? gain.gain.value : 0, at);
      if (fade > 0) gain.gain.linearRampToValueAtTime(0, at + fade);
      source.stop(at + fade + 0.02);
    } catch { /* never started, or already stopped */ }
  }

  return { play, stop, playing: () => voice !== null };
}

// ---- Preparation -----------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The chart without the notes before fromMs (holds that begin earlier go too): the trap's highway starts empty and the
// first real notes fall in, instead of a screenful of blocks that were already on their way.
export function trimChart(chart, fromMs) {
  return { ...chart, notes: chart.notes.filter((note) => note.t >= fromMs) };
}

// A copy of buffer[fromMs, toMs): the decoded song is large and only this stretch is ever played.
export function sliceBuffer(context, buffer, fromMs, toMs) {
  const rate = buffer.sampleRate;
  const from = Math.max(0, Math.floor((fromMs / 1000) * rate));
  const to = Math.min(buffer.length, Math.ceil((toMs / 1000) * rate));
  if (to - from < rate / 2) return null;
  const out = context.createBuffer(buffer.numberOfChannels, to - from, rate);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) out.getChannelData(c).set(buffer.getChannelData(c).subarray(from, to));
  return out;
}

// Starts asking the bot for its two songs and fetching the heavy one, and returns at once. result() is { heavy, calm }
// once both are ready, else null (still going, failed, or cancelled). heavy is { audioKey, track, chart, level, buffer,
// fromMs, durationMs } with buffer the stretch from fromMs on; calm is { audioKey, track, uri, source, level }: the
// game plays it like any song (its chart is ready on the bot, its audio rendered), so nothing of it is downloaded here.
// requests is the REAL request object (the tour session's own is the sample one). fetchAudio is the same one the game's
// audio engine uses.
export function prepareTrap({ requests, fetchAudio, getContext, wait = sleep, heavy = HEAVY, calm = CALM }) {
  const controller = new AbortController();
  const { signal } = controller;
  let result = null;
  const check = () => {
    if (signal.aborted) throw new Error("trap cancelled");
  };

  // What the bot says of its two songs. Not ready (or an answer that never came) is asked again every few seconds for as
  // long as the tour runs; cancel() ends it.
  async function songsOf() {
    for (;;) {
      check();
      let reply = null;
      try {
        reply = await requests.request("mewbeat_tour_songs", {}, SONGS_TIMEOUT_MS);
      } catch { /* no answer: ask again */ }
      check();
      if (reply?.status === "ok" && reply.heavy?.audioKey && reply.heavy.track && reply.calm?.audioKey && reply.calm.track && reply.calm.chartReady !== false) return reply;
      await wait(SONGS_POLL_MS);
    }
  }

  async function chartOf(audioKey, difficulty) {
    for (let waited = 0; waited <= POLL_LIMIT_MS; waited += POLL_MS) {
      const reply = await requests.request("mewbeat_chart", { audioKey, difficulty }, CHART_TIMEOUT_MS);
      check();
      if (reply.status === "ready" && Array.isArray(reply.chart?.notes) && reply.chart.notes.length > 0) return reply.chart;
      if (reply.status !== "pending") throw new Error("no chart");
      await wait(POLL_MS);
      check();
    }
    throw new Error("chart took too long");
  }

  async function heavySong({ audioKey, track }) {
    const chart = await chartOf(audioKey, heavy.level);
    // The stretch has to have notes in it, or there is nothing to cut off.
    if (!chart.notes.some((note) => note.t >= heavy.fromMs && note.t <= heavy.fromMs + HEAVY_MS)) throw new Error("empty stretch");
    const data = await fetchAudio(audioKey, signal);
    check();
    const context = getContext();
    const decoded = await context.decodeAudioData(data);
    check();
    const buffer = sliceBuffer(context, decoded, heavy.fromMs, heavy.fromMs + HEAVY_MS + HEAVY_SLACK_MS);
    if (!buffer) throw new Error("song too short");
    return { audioKey, track, chart: trimChart(chart, heavy.fromMs), level: heavy.level, buffer, fromMs: heavy.fromMs, durationMs: Math.round(decoded.duration * 1000) };
  }

  const done = (async () => {
    const songs = await songsOf();
    const loud = await heavySong(songs.heavy);
    // The game finds the calm song again by the same link the bot resolved it to.
    const { uri, source } = songs.calm.track;
    if (typeof uri !== "string" || !uri) throw new Error("calm song has no link");
    check();
    result = { heavy: loud, calm: { audioKey: songs.calm.audioKey, track: songs.calm.track, uri, source: source || "youtube", level: calm.level } };
  })().catch(() => {}); // no trap; the tour does not hear of it

  return {
    result: () => result,
    done,
    cancel() {
      controller.abort();
      result = null;
    },
  };
}
