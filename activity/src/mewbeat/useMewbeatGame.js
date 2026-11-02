import { useCallback, useEffect, useRef, useState } from "react";
import { effectiveEffects } from "./effects.js";
import { approachMsFor, createHighwayRenderer, tempoScrollFactor } from "./highway.js";
import { createHitSounds } from "./hitSounds.js";
import { createKeyRouter } from "./input.js";
import { usePrefersReducedMotion } from "./mewbit/Mewbit.jsx";
import { createTapTiming, nearestNote, runTimingOf } from "./calibration.js";
import { createRun } from "./run.js";
import { createLiveSender } from "./liveSender.js";

// Same literal as DEFAULT_SETTINGS in helpers/mewbeat/userSettings.js (the activity cannot import that CJS file).
export const DEFAULT_SETTINGS = { keys: ["KeyD", "KeyF", "KeyJ", "KeyK"], offsetMs: 0, soloOffsetMs: 0, scrollSpeed: 5, liveDifficulty: "normal", effects: "full", hitSounds: false, hitVolume: 40, musicVolume: 80, showMewbit: true, tempoScroll: true };

const MISS_POSE_MS = 600;
const CRUSHED_POSE_MS = 1200;
const CRUSH_COMBO = 25;
const MILESTONE_POSE_MS = 900;
const DIFFICULTY_IDS = ["easy", "normal", "hard", "hell"]; // same list as DIFFICULTIES in SongSelect.jsx
const MISS_LOOKBACK_MS = 500; // misses keep falling past the line this long before the renderer drops them
const FLASH_KEEP_MS = 400;
const SWAP_TIMEOUT_MS = 20000; // a difficulty change whose chart never arrives gives up and keeps the old chart
const SWAP_FAILED_SHOW_MS = 3500;

// m:ss for the progress readout
function clockText(totalSeconds) {
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

const EMPTY_COUNTS = { perfect: 0, great: 0, good: 0, miss: 0 };
export const EMPTY_HUD = {
  score: 0,
  combo: 0,
  maxCombo: 0,
  multiplier: 1,
  vibe: 0,
  feverActive: false,
  feverLeftMs: 0,
  accuracy: null,
  grade: null,
  counts: EMPTY_COUNTS,
  fevers: 0,
  judged: 0,
  total: 0,
  unranked: false,
  judgement: null,
};

function settingsOf(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  if (!Array.isArray(merged.keys) || merged.keys.length !== 4) merged.keys = DEFAULT_SETTINGS.keys;
  return merged;
}

// Which Mewbit pose to show. FEVER beats a recent miss, which beats a multiplier milestone,
// which beats the combo-driven vibe levels.
export function poseFor({ phase, feverActive, now, missUntil, crushed, milestoneUntil, combo }) {
  if (phase === "charting") return "charting";
  if (phase !== "playing") return "neutral";
  if (feverActive) return "fever";
  if (now < missUntil) return crushed ? "crushed" : "miss";
  if (now < milestoneUntil) return "milestone";
  if (combo >= 50) return "vibe3";
  if (combo >= 25) return "vibe2";
  if (combo >= 10) return "vibe1";
  return "neutral";
}

// Drives one mewbeat session: listens to the link, charts each new track, runs the game on the
// song clock and renders it. The link must already be started when this mounts its effects (the
// mock link emits its first anchor from start()); it reads the current state on mount instead of
// waiting for events it may have missed.
// liveSession(audioKey) names the live leaderboard session a run reports to ("live:<audioKey>" in Live, "room"
// in a room); null, or a function answering null, means the run reports nothing (solo, room spectators).
export function useMewbeatGame({ link, mode = "live", requests = null, settings, effects = "full", trackInfo = null, inputPaused = false, liveSession = null, submitExtra = null, onExit }) {
  const cfg = settingsOf(settings);
  const prefersReduced = usePrefersReducedMotion();
  const effectsLevel = effectiveEffects(effects, prefersReduced);

  const [phase, setPhaseState] = useState("connecting");
  const [hud, setHud] = useState(EMPTY_HUD);
  const [endSummary, setEndSummary] = useState(null);
  const [runDifficulty, setRunDifficulty] = useState(null); // the difficulty of the chart the run on stage is on
  const [swap, setSwap] = useState(null); // a difficulty change in progress: { difficulty, status: "loading" | "failed" }
  const [mewbitPose, setMewbitPose] = useState("neutral");
  const [autoplay, setAutoplayState] = useState(false);
  // Tap timing outlives runs: calibration gathers over every song played this session.
  const [tapTiming] = useState(createTapTiming);
  const [timing, setTiming] = useState(() => tapTiming.estimate());
  const timingDirtyRef = useRef(false);
  const runCalibrationRef = useRef(false);
  const [calibrating, setCalibrating] = useState(false); // the run in progress plays the calibration clicks

  const canvasRef = useRef(null);
  const progressRef = useRef(null);
  const progressTimeRef = useRef(null);
  const rendererRef = useRef(null);
  const phaseRef = useRef("connecting");
  const resumePhaseRef = useRef("connecting"); // what "offline" interrupted
  const runRef = useRef(null);
  const chartRef = useRef(null);
  const runAutoplayRef = useRef(false);
  const runSpectatingRef = useRef(false); // the run on stage is someone else's round: autoplay, silent, no keys, no score
  const autoplayRef = useRef(false);
  const dirtyRef = useRef(false);
  const lastSongMsRef = useRef(0);
  const lanesDownRef = useRef([false, false, false, false]);
  const flashesRef = useRef([]);
  const judgementRef = useRef(null);
  const judgementIdRef = useRef(0);
  const comboRef = useRef(0);
  const multiplierRef = useRef(1);
  const feverActiveRef = useRef(false);
  const missUntilRef = useRef(0);
  const crushedRef = useRef(false);
  const milestoneUntilRef = useRef(0);
  const poseRef = useRef("neutral");
  const runTrackRef = useRef(null);
  const runMetaRef = useRef(null); // what the server needs to know about the chart the run is on
  const summaryIdRef = useRef(0);
  const swapRef = useRef(null); // { audioKey, difficulty } the run is waiting a chart for
  const requestSwapRef = useRef(() => false); // set by the link effect: asks for another difficulty's chart
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  const liveSessionFnRef = useRef(liveSession);
  liveSessionFnRef.current = liveSession;
  // Fields merged into the mewbeat_submit body (a room run adds the round it belongs to).
  const submitExtraRef = useRef(submitExtra);
  submitExtraRef.current = submitExtra;
  const liveRef = useRef(null); // the live leaderboard sender of the run in progress
  const [runSession, setRunSession] = useState(null); // its session, while the run is on stage
  const redrawRef = useRef(false); // a resize wipes the canvas, which a paused game must repaint once

  // Latest props for the long-lived callbacks below.
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const spectating = Boolean(cfg.spectating);
  // A room link's own state is current the moment a round is abandoned or taken over; the prop is a render behind.
  const spectatingNow = () => Boolean(link.state?.().spectating ?? cfgRef.current.spectating);
  const trackRef = useRef(trackInfo);
  trackRef.current = trackInfo;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  // While the settings panel is open the game ignores keys so its capture buttons receive them.
  const inputPausedRef = useRef(inputPaused);
  inputPausedRef.current = inputPaused;
  const soundsRef = useRef(null);
  const releaseHeldRef = useRef(() => {}); // set by the link effect: releases every held lane into the run
  const beginChartingRef = useRef(() => {}); // set by the link effect: (re)requests the chart for the current song

  const setPhase = useCallback((next) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  useEffect(() => {
    link.setTrackInfo?.(trackInfo);
  }, [link, trackInfo]);

  // Hit sounds: the AudioContext only comes into being on the first gesture (see unlockAudio).
  useEffect(() => {
    const sounds = createHitSounds();
    soundsRef.current = sounds;
    return () => {
      sounds.close();
      if (soundsRef.current === sounds) soundsRef.current = null;
    };
  }, []);
  const unlockAudio = useCallback(() => soundsRef.current?.unlock(), []);
  // One hit at the given volume, so the settings slider can be heard while it moves.
  const previewHit = useCallback((volume) => soundsRef.current?.play(volume), []);

  // A key held when the panel opens never sends its keyup to the game: release it ourselves,
  // so a hold being played is judged now instead of staying held forever.
  useEffect(() => {
    if (inputPaused) releaseHeldRef.current();
  }, [inputPaused]);

  // A changed difficulty asks for that difficulty's chart now, whatever the link's anchors do (solo has none
  // to piggyback on). A running game keeps its run; a game waiting for a chart, or stuck without one, retries.
  const liveDifficulty = cfg.liveDifficulty;
  useEffect(() => {
    const current = phaseRef.current;
    if (!runRef.current && (current === "charting" || current === "uncharted" || current === "failed")) beginChartingRef.current();
  }, [liveDifficulty]);

  // A new audio offset applies to the run in progress: score stays, heard time moves.
  const offsetMs = cfg.offsetMs;
  useEffect(() => {
    const run = runRef.current;
    if (!run) return;
    const songMs = link.songClock.songTimeAt(performance.now());
    run.setOffset(offsetMs, songMs ?? undefined);
    dirtyRef.current = true;
  }, [link, offsetMs]);

  // ---- link events, run lifecycle, render loop ----
  useEffect(() => {
    const songClock = link.songClock;

    function resetRunState() {
      lanesDownRef.current = [false, false, false, false];
      flashesRef.current = [];
      judgementRef.current = null;
      comboRef.current = 0;
      multiplierRef.current = 1;
      feverActiveRef.current = false;
      missUntilRef.current = 0;
      crushedRef.current = false;
      milestoneUntilRef.current = 0;
      dirtyRef.current = false;
    }

    function toHud(snap) {
      const { hits, ranked, skipped, ...rest } = snap;
      return { ...rest, unranked: runAutoplayRef.current || skipped > 0 || snap.difficultyChanged, judgement: judgementRef.current };
    }

    const liveSample = (snap) => ({ score: Math.round(snap.score), combo: snap.combo, accuracy: snap.accuracy ?? null });

    function endLive(snap) {
      liveRef.current?.end(snap ? liveSample(snap) : undefined);
      liveRef.current = null;
      setRunSession(null);
    }

    // Autoplay and calibration runs report nothing: they are not a score to compare.
    function startLive(snap) {
      endLive();
      const audioKey = songClock.audioKey();
      const send = requestsRef.current?.send;
      const session = audioKey && send && !runAutoplayRef.current && !runCalibrationRef.current ? liveSessionFnRef.current?.(audioKey) ?? null : null;
      if (!session) return;
      liveRef.current = createLiveSender({ send, session, audioKey, difficulty: cfgRef.current.liveDifficulty });
      liveRef.current.update(liveSample(snap));
      setRunSession(session);
    }

    function startRun() {
      const chart = chartRef.current;
      const songMs = songClock.songTimeAt(performance.now());
      if (!chart || songMs === null) return;
      // The link knows first (cfg follows a render later); a spectated round always autoplays, whatever the toggle says.
      const spectating = spectatingNow();
      const autoplay = autoplayRef.current || spectating;
      const run = createRun({
        chart,
        startSongMs: songMs,
        offsetMs: cfgRef.current.offsetMs,
        autoplay,
      });
      runRef.current = run;
      runAutoplayRef.current = autoplay;
      runSpectatingRef.current = spectating;
      runTrackRef.current = trackRef.current;
      runCalibrationRef.current = Boolean(chartRef.current?.calibration);
      runMetaRef.current = { audioKey: songClock.audioKey(), difficulty: cfgRef.current.liveDifficulty, chartVersion: chart.version ?? null, highlightMs: chart.highlightMs ?? null };
      clearSwap();
      setRunDifficulty(cfgRef.current.liveDifficulty);
      setCalibrating(runCalibrationRef.current);
      lastSongMsRef.current = songMs;
      resetRunState();
      setEndSummary(null);
      const snap = run.snapshot(songMs);
      multiplierRef.current = snap.multiplier;
      setHud(toHud(snap));
      startLive(snap);
      setPhase(songClock.paused() ? "paused" : "playing");
      // A solo link starts its count-in only now that the game took the chart (the live link has no such hook).
      link.chartAccepted?.(chart);
    }

    // Sends the finished run for scoring and keeps the reply on the summary it belongs to. A calibration run
    // has nothing to rank, so it is not sent. Local numbers show at once; the reply only adds to them.
    function submitRun(id, body) {
      const send = requestsRef.current?.request;
      // A run that changed difficulty mid-way mixes two charts: its note indexes mean nothing against either
      // chart on the server, so it is never sent (Results says why).
      if (body.flags.calibration || body.flags.difficultyChanged || !send || !body.audioKey) return "skipped";
      const settle = (submit) => setEndSummary((current) => (current && current.id === id ? { ...current, submit } : current));
      send("mewbeat_submit", body).then(
        (reply) => settle(reply?.status === "ok" && reply.result ? { status: "ok", result: reply.result } : { status: "error", reason: reply?.reason ?? null }),
        () => settle({ status: "error", reason: null })
      );
      return "submitting";
    }

    // Drops the current run. A run that judged at least one note leaves its results.
    function endRun() {
      const run = runRef.current;
      if (!run) return;
      runRef.current = null;
      setCalibrating(false);
      const snap = run.snapshot(lastSongMsRef.current);
      feverActiveRef.current = false;
      endLive(snap);
      clearSwap();
      setRunDifficulty(null);
      // Nobody is graded for watching: a spectated run leaves no summary and sends nothing.
      if (snap.judged >= 1 && !runSpectatingRef.current) {
        const { hits, ranked, skipped, ...rest } = snap;
        const meta = runMetaRef.current ?? {};
        const { events, fevers } = run.log();
        const id = ++summaryIdRef.current;
        const flags = { autoplay: runAutoplayRef.current, calibration: runCalibrationRef.current, difficultyChanged: run.flags.difficultyChanged };
        const status = submitRun(id, { ...(submitExtraRef.current ?? {}), mode: modeRef.current, audioKey: meta.audioKey ?? null, difficulty: meta.difficulty, chartVersion: meta.chartVersion, events, fevers, flags });
        setEndSummary({
          ...rest,
          id,
          skipped,
          calibration: flags.calibration,
          autoplay: flags.autoplay,
          difficultyChanged: flags.difficultyChanged,
          audioKey: meta.audioKey ?? null,
          difficulty: meta.difficulty ?? null,
          // Head-hit errors in heard time (positive: late) against the offset the run ended on.
          hitErrors: hits.map((hit) => hit.errorMs),
          offsetMs: cfgRef.current.offsetMs,
          timingMs: runTimingOf(hits),
          title: runTrackRef.current?.title ?? null,
          artist: runTrackRef.current?.artist ?? null,
          artworkUrl: runTrackRef.current?.artworkUrl ?? null,
          highlightMs: meta.highlightMs ?? null,
          submit: { status },
          feverActive: false,
          feverLeftMs: 0,
        });
        setHud({ ...toHud(snap), feverActive: false, feverLeftMs: 0 });
      } else {
        setHud(EMPTY_HUD);
      }
    }

    function beginCharting() {
      const key = songClock.audioKey();
      if (!key) return;
      const status = link.status();
      if (status !== "live") {
        setPhase(status === "offline" ? "offline" : "connecting");
        return;
      }
      setPhase("charting");
      link.requestChart(key, cfgRef.current.liveDifficulty);
    }
    beginChartingRef.current = beginCharting;

    // ---- live difficulty change ----
    let swapTimer = 0;
    let swapFailedTimer = 0;
    function clearSwap() {
      window.clearTimeout(swapTimer);
      window.clearTimeout(swapFailedTimer);
      swapRef.current = null;
      setSwap(null);
    }

    // The old chart keeps playing; the card says the change did not go through for a moment.
    function failSwap() {
      const wanted = swapRef.current;
      window.clearTimeout(swapTimer);
      swapRef.current = null;
      if (!wanted) return;
      setSwap({ difficulty: wanted.difficulty, status: "failed" });
      window.clearTimeout(swapFailedTimer);
      swapFailedTimer = window.setTimeout(() => setSwap(null), SWAP_FAILED_SHOW_MS);
    }

    // Asks for another difficulty's chart for the run on stage; the chart event does the swap (see offChart).
    // Calibration runs have one fixed chart. Returns false when there is nothing to change.
    function requestSwap(next) {
      const run = runRef.current;
      const audioKey = songClock.audioKey();
      if (!run || !audioKey || runCalibrationRef.current || !DIFFICULTY_IDS.includes(next)) return false;
      window.clearTimeout(swapTimer);
      window.clearTimeout(swapFailedTimer);
      if (next === runMetaRef.current?.difficulty) {
        // Back to the chart already playing: drop the pending change.
        swapRef.current = null;
        setSwap(null);
        return true;
      }
      swapRef.current = { audioKey, difficulty: next };
      setSwap({ difficulty: next, status: "loading" });
      swapTimer = window.setTimeout(failSwap, SWAP_TIMEOUT_MS);
      link.requestChart(audioKey, next);
      return true;
    }
    requestSwapRef.current = requestSwap;

    function applySwap(chart) {
      const wanted = swapRef.current;
      const run = runRef.current;
      const songMs = songClock.songTimeAt(performance.now());
      if (!wanted || !run || songMs === null) {
        failSwap();
        return;
      }
      const tempo = cfgRef.current.tempoScroll === false ? 1 : tempoScrollFactor(chartRef.current?.bpm);
      const approachMs = Math.floor(approachMsFor(cfgRef.current.scrollSpeed) / tempo);
      if (!run.swapChart(chart, songMs, approachMs)) {
        failSwap();
        return;
      }
      window.clearTimeout(swapTimer);
      swapRef.current = null;
      setSwap(null);
      // Later code reads the chart as it plays now: old notes up to the cut, the new chart's after it.
      chartRef.current = { ...chart, notes: run.noteList() };
      runMetaRef.current = { ...runMetaRef.current, difficulty: wanted.difficulty };
      liveRef.current?.setDifficulty(wanted.difficulty);
      setRunDifficulty(wanted.difficulty);
      dirtyRef.current = true;
    }

    // Applies run events: counters for the pose and flashes, and marks the HUD stale.
    // Returns true when the run ended.
    function handleEvents(events, heardMs) {
      let ended = false;
      for (const event of events) {
        if (event.kind === "hit") {
          comboRef.current += 1;
          // The player's presses sound on the key (see onLane); autoplay has no keys, so its heads
          // sound here. A tail counts for combo and the popup, but it has no sound of its own.
          if (cfgRef.current.hitSounds && runAutoplayRef.current && !runSpectatingRef.current && !runCalibrationRef.current && event.part !== "tail") soundsRef.current?.play(cfgRef.current.hitVolume);
          flashesRef.current.push({ lane: event.lane, judgement: event.judgement, at: heardMs });
          judgementRef.current = { text: event.judgement.toUpperCase(), kind: event.judgement, id: ++judgementIdRef.current };
        } else if (event.kind === "miss") {
          crushedRef.current = comboRef.current >= CRUSH_COMBO;
          missUntilRef.current = performance.now() + (crushedRef.current ? CRUSHED_POSE_MS : MISS_POSE_MS);
          comboRef.current = 0;
          judgementRef.current = { text: "MISS", kind: "miss", id: ++judgementIdRef.current };
        } else if (event.kind === "end") {
          ended = true;
        }
        dirtyRef.current = true;
      }
      return ended;
    }

    function flushHud(run, songMs) {
      dirtyRef.current = false;
      if (timingDirtyRef.current) {
        timingDirtyRef.current = false;
        setTiming(tapTiming.estimate());
      }
      const snap = run.snapshot(songMs);
      if (snap.multiplier > multiplierRef.current) milestoneUntilRef.current = performance.now() + MILESTONE_POSE_MS;
      multiplierRef.current = snap.multiplier;
      feverActiveRef.current = snap.feverActive;
      setHud(toHud(snap));
      liveRef.current?.update(liveSample(snap));
      // Autoplay plays the whole game, FEVER included.
      if (runAutoplayRef.current && !runSpectatingRef.current && snap.vibe >= 1 && !snap.feverActive) {
        const fever = run.fever(songMs);
        if (fever) handleEvents([fever], run.heardTime(songMs));
      }
    }

    // ---- link subscriptions ----
    function reconcile() {
      if (runRef.current) return;
      if (songClock.audioKey()) beginCharting();
    }

    const offAnchor = link.onAnchor((result) => {
      switch (result) {
        case "init":
        case "keyChange":
          endRun();
          chartRef.current = null;
          beginCharting();
          break;
        case "clear":
          endRun();
          chartRef.current = null;
          setPhase("idle");
          break;
        case "pause":
        case "resume":
          if (runRef.current) setPhase(result === "pause" ? "paused" : "playing");
          break;
        case "snap": {
          const songMs = songClock.songTimeAt(performance.now());
          if (runRef.current && songMs !== null) {
            runRef.current.jump(songMs);
            dirtyRef.current = true;
          }
          break;
        }
        default:
          break;
      }
      // A refused first send or a changed difficulty would leave "charting" stuck; the link dedupes in-flight requests.
      if (phaseRef.current === "charting" && link.status() === "live") {
        const key = songClock.audioKey();
        if (key) link.requestChart(key, cfgRef.current.liveDifficulty);
      }
    });

    const offChart = link.onChart((event) => {
      const wanted = swapRef.current;
      if (wanted && event.audioKey === wanted.audioKey && event.difficulty === wanted.difficulty) {
        if (event.status === "ready" && event.chart?.notes) applySwap(event.chart);
        else if (event.status !== "pending") failSwap(); // "pending" keeps waiting
        return;
      }
      if (phaseRef.current !== "charting") return;
      if (event.audioKey !== songClock.audioKey() || event.difficulty !== cfgRef.current.liveDifficulty) return;
      if (event.status === "ready" && event.chart?.notes) {
        chartRef.current = event.chart;
        // The clicks measure the offset on their own: taps from earlier songs would blur it.
        if (event.chart.calibration) {
          tapTiming.reset();
          timingDirtyRef.current = true;
        }
        startRun();
      } else if (event.status === "uncharted") {
        setPhase("uncharted");
      } else if (event.status === "failed") {
        setPhase("failed");
      }
      // "pending" keeps charting; "stale" belongs to a track that is already gone.
    });

    const offStatus = link.onStatus((status) => {
      if (status === "offline") {
        if (runRef.current || phaseRef.current === "offline") return;
        resumePhaseRef.current = phaseRef.current;
        setPhase("offline");
      } else if (status === "live" && phaseRef.current === "charting" && !runRef.current) {
        // Back online while charting: a request refused or lost meanwhile goes out again (in-flight ones dedupe).
        const key = songClock.audioKey();
        if (key) link.requestChart(key, cfgRef.current.liveDifficulty);
      } else if (status === "live" && (phaseRef.current === "offline" || phaseRef.current === "connecting")) {
        if (!songClock.audioKey()) {
          setPhase(phaseRef.current === "offline" ? "idle" : "connecting");
        } else if (["uncharted", "failed", "ended", "idle"].includes(resumePhaseRef.current)) {
          setPhase(resumePhaseRef.current);
        } else {
          // A request sent before the drop is never answered; restart the link so it can go out again.
          if (phaseRef.current === "offline" && resumePhaseRef.current === "charting") {
            link.stop();
            link.start();
          }
          beginCharting();
        }
        resumePhaseRef.current = "connecting";
      }
    });

    reconcile();

    // Releases every lane the player is holding, at the current song time, then forgets them all.
    function releaseHeld() {
      const run = runRef.current;
      const songMs = songClock.songTimeAt(performance.now());
      if (run && songMs !== null) {
        lanesDownRef.current.forEach((down, lane) => {
          if (down) handleEvents(run.release(lane, songMs), run.heardTime(songMs));
        });
      }
      lanesDownRef.current = [false, false, false, false];
    }
    releaseHeldRef.current = releaseHeld;

    // ---- input ----
    // Keys come from cfgRef, so a keys change swaps only the router (the run, chart request and
    // link subscriptions stay as they are).
    const buildRouter = (keys) => createKeyRouter({
      keys,
      onLane: (lane, timeStamp) => {
        if (runSpectatingRef.current) return; // the keys do nothing while watching
        lanesDownRef.current[lane] = true;
        const run = runRef.current;
        if (!run || phaseRef.current !== "playing") return;
        // Every press sounds, hit or not, as in osu!mania: the sound answers the key. Calibration runs stay
        // silent: players line the hit sound up instead of the beat, which skews the measured offset.
        if (cfgRef.current.hitSounds && !runAutoplayRef.current && !runCalibrationRef.current) soundsRef.current?.play(cfgRef.current.hitVolume);
        const songMs = songClock.songTimeAt(timeStamp);
        if (songMs === null) return;
        // Calibration hides the notes, so a tap is aimed by ear alone (a player watching the notes
        // reacts a little late and would talk the offset up): any key counts for the nearest click.
        const calibrating = runCalibrationRef.current;
        // Autoplay judges its own notes; only the player's presses say where they hear the beat.
        if (!runAutoplayRef.current && chartRef.current && tapTiming.add(chartRef.current.notes, calibrating ? null : lane, songMs, cfgRef.current.offsetMs) !== null) {
          timingDirtyRef.current = true;
          dirtyRef.current = true;
        }
        const click = calibrating && chartRef.current ? nearestNote(chartRef.current.notes, null, run.heardTime(songMs)) : null;
        const hit = run.press(click ? click.lane : lane, songMs);
        if (hit) handleEvents([hit], run.heardTime(songMs));
      },
      onFever: () => {
        const run = runRef.current;
        if (!run || phaseRef.current !== "playing" || runSpectatingRef.current) return;
        const songMs = songClock.songTimeAt(performance.now());
        if (songMs === null) return;
        const fever = run.fever(songMs);
        if (fever) handleEvents([fever], run.heardTime(songMs));
      },
      onExit: () => onExitRef.current?.(),
    });
    let routedKeys = cfgRef.current.keys;
    let route = buildRouter(routedKeys);
    const onKeyDown = (event) => {
      soundsRef.current?.unlock();
      if (inputPausedRef.current) return;
      if (cfgRef.current.keys !== routedKeys) {
        routedKeys = cfgRef.current.keys;
        route = buildRouter(routedKeys);
      }
      if (route(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onKeyUp = (event) => {
      if (inputPausedRef.current) return;
      const lane = cfgRef.current.keys.indexOf(event.code);
      if (lane >= 0) {
        lanesDownRef.current[lane] = false;
        const run = runRef.current;
        const songMs = songClock.songTimeAt(event.timeStamp);
        if (run && songMs !== null && !runSpectatingRef.current) handleEvents(run.release(lane, songMs), run.heardTime(songMs));
      }
      // Space is FEVER and keydown already took it; keep its keyup from clicking a focused button.
      if (lane >= 0 || event.code === "Space") {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    const onBlur = () => releaseHeld();
    window.addEventListener("blur", onBlur);

    // ---- render loop ----
    let raf = 0;
    let lastPercent = -1;
    let lastTimeKey = "";
    const emptyFrame = { heardMs: 0, notes: [], lanesDown: [], flashes: [], feverActive: false };
    function frame() {
      raf = window.requestAnimationFrame(frame);
      const now = performance.now();
      const songMs = songClock.songTimeAt(now);
      const duration = trackRef.current?.durationMs;
      if (progressRef.current) {
        const fraction = songMs !== null && duration > 0 ? Math.min(1, songMs / duration) : 0;
        progressRef.current.style.transform = `scaleX(${fraction})`;
        const percent = Math.round(fraction * 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          progressRef.current.parentElement?.setAttribute("aria-valuenow", String(percent));
        }
      }
      if (progressTimeRef.current) {
        const elapsed = songMs !== null && songMs > 0 ? Math.floor((duration > 0 ? Math.min(songMs, duration) : songMs) / 1000) : 0;
        const key = duration > 0 ? `${elapsed}/${Math.round(duration / 1000)}` : String(elapsed);
        if (key !== lastTimeKey) {
          lastTimeKey = key;
          progressTimeRef.current.textContent = duration > 0 ? `${clockText(elapsed)} / ${clockText(Math.round(duration / 1000))}` : clockText(elapsed);
        }
      }

      const run = runRef.current;
      const current = phaseRef.current;
      const renderer = rendererRef.current;
      const tempo = cfgRef.current.tempoScroll === false ? 1 : tempoScrollFactor(chartRef.current?.bpm);
      const approachMs = Math.floor(approachMsFor(cfgRef.current.scrollSpeed) / tempo);

      function drawRun(heardMs) {
        const flashes = flashesRef.current;
        while (flashes.length && heardMs - flashes[0].at > FLASH_KEEP_MS) flashes.shift();
        renderer?.render({
          heardMs,
          approachMs,
          notes: runCalibrationRef.current ? [] : run.visibleNotes(heardMs - MISS_LOOKBACK_MS, heardMs + approachMs),
          lanesDown: lanesDownRef.current,
          flashes,
          feverActive: feverActiveRef.current,
        });
      }

      if (run && current === "playing" && songMs !== null) {
        lastSongMsRef.current = songMs;
        const heardMs = run.heardTime(songMs);
        const events = run.tick(songMs);
        const ended = events.length ? handleEvents(events, heardMs) : false;
        if (ended) {
          endRun();
          setPhase("ended");
          return;
        }
        if (dirtyRef.current) flushHud(run, songMs);
        drawRun(heardMs);
      } else if (run && current === "paused") {
        if (redrawRef.current && songMs !== null) drawRun(run.heardTime(songMs));
      } else {
        renderer?.render({ ...emptyFrame, approachMs, lanesDown: lanesDownRef.current });
      }
      redrawRef.current = false;

      const pose = poseFor({
        phase: current,
        feverActive: feverActiveRef.current,
        now,
        missUntil: missUntilRef.current,
        crushed: crushedRef.current,
        milestoneUntil: milestoneUntilRef.current,
        combo: comboRef.current,
      });
      if (pose !== poseRef.current) {
        poseRef.current = pose;
        setMewbitPose(pose);
      }
    }
    raf = window.requestAnimationFrame(frame);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      releaseHeldRef.current = () => {};
      beginChartingRef.current = () => {};
      requestSwapRef.current = () => false;
      window.clearTimeout(swapTimer);
      window.clearTimeout(swapFailedTimer);
      endLive(runRef.current ? runRef.current.snapshot(lastSongMsRef.current) : undefined);
      offAnchor();
      offChart();
      offStatus();
    };
    // link is stable for the screen's life.
  }, [link, setPhase, tapTiming]);

  // ---- canvas ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const renderer = createHighwayRenderer(canvas, { effects: effectsLevel });
    rendererRef.current = renderer;
    renderer.resize();
    const observer = new ResizeObserver(() => {
      renderer.resize();
      redrawRef.current = true;
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [effectsLevel]);

  // Autoplay applies to the next run. A run that has not judged a note yet restarts so it takes effect now.
  // A spectated round stays autoplay whatever the toggle says (the toggle itself is left as the user set it).
  const restartRun = useCallback((value) => {
    const forced = spectatingNow();
    const effective = value || forced;
    const run = runRef.current;
    const songMs = link.songClock.songTimeAt(performance.now());
    if (run && songMs !== null && run.snapshot(songMs).judged === 0 && !run.flags.difficultyChanged && chartRef.current) {
      const chart = chartRef.current;
      const restarted = createRun({ chart, startSongMs: songMs, offsetMs: cfgRef.current.offsetMs, autoplay: effective });
      runRef.current = restarted;
      runAutoplayRef.current = effective;
      runSpectatingRef.current = forced;
      if (effective && liveRef.current) {
        // An autoplayed run is not a score to put on the board.
        liveRef.current.end();
        liveRef.current = null;
        setRunSession(null);
      }
      const snap = restarted.snapshot(songMs);
      const { hits, ranked, skipped, ...rest } = snap;
      setHud({ ...rest, unranked: effective || skipped > 0, judgement: null });
      judgementRef.current = null;
      flashesRef.current = [];
    }
  }, [link]);

  const setAutoplay = useCallback((next) => {
    const value = Boolean(next);
    autoplayRef.current = value;
    setAutoplayState(value);
    restartRun(value);
  }, [restartRun]);

  // A player whose chart came too late turns into a spectator with the run already built: take it over now.
  useEffect(() => {
    if (spectating) restartRun(autoplayRef.current);
  }, [spectating, restartRun]);

  const resetTiming = useCallback(() => {
    tapTiming.reset();
    setTiming(tapTiming.estimate());
  }, [tapTiming]);

  const changeDifficulty = useCallback((next) => requestSwapRef.current(next), []);

  return { phase, hud, runDifficulty, swap, changeDifficulty, runSession, endSummary, mewbitPose, track: trackInfo, canvasRef, progressRef, progressTimeRef, autoplay, setAutoplay, effectsLevel, unlockAudio, previewHit, timing, resetTiming, calibrating };
}
