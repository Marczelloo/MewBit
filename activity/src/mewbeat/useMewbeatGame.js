import { useCallback, useEffect, useRef, useState } from "react";
import { effectiveEffects } from "./effects.js";
import { approachMsFor, createHighwayRenderer } from "./highway.js";
import { createHitSounds } from "./hitSounds.js";
import { createKeyRouter } from "./input.js";
import { usePrefersReducedMotion } from "./mewbit/Mewbit.jsx";
import { createTapTiming, nearestNote, runTimingOf } from "./calibration.js";
import { createRun } from "./run.js";

// Same literal as DEFAULT_SETTINGS in helpers/mewbeat/userSettings.js (the activity cannot import that CJS file).
export const DEFAULT_SETTINGS = { keys: ["KeyD", "KeyF", "KeyJ", "KeyK"], offsetMs: 0, scrollSpeed: 5, liveDifficulty: "normal", effects: "full", hitSounds: false, hitVolume: 40, showMewbit: true };

const MISS_POSE_MS = 600;
const CRUSHED_POSE_MS = 1200;
const CRUSH_COMBO = 25;
const MILESTONE_POSE_MS = 900;
const MISS_LOOKBACK_MS = 500; // misses keep falling past the line this long before the renderer drops them
const FLASH_KEEP_MS = 400;

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
export function useMewbeatGame({ link, settings, effects = "full", trackInfo = null, inputPaused = false, onExit }) {
  const cfg = settingsOf(settings);
  const prefersReduced = usePrefersReducedMotion();
  const effectsLevel = effectiveEffects(effects, prefersReduced);

  const [phase, setPhaseState] = useState("connecting");
  const [hud, setHud] = useState(EMPTY_HUD);
  const [endSummary, setEndSummary] = useState(null);
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
  const rendererRef = useRef(null);
  const phaseRef = useRef("connecting");
  const resumePhaseRef = useRef("connecting"); // what "offline" interrupted
  const runRef = useRef(null);
  const chartRef = useRef(null);
  const runAutoplayRef = useRef(false);
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
  const redrawRef = useRef(false); // a resize wipes the canvas, which a paused game must repaint once

  // Latest props for the long-lived callbacks below.
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const trackRef = useRef(trackInfo);
  trackRef.current = trackInfo;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  // While the settings panel is open the game ignores keys so its capture buttons receive them.
  const inputPausedRef = useRef(inputPaused);
  inputPausedRef.current = inputPaused;
  const soundsRef = useRef(null);
  const releaseHeldRef = useRef(() => {}); // set by the link effect: releases every held lane into the run

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
      return { ...rest, unranked: runAutoplayRef.current || skipped > 0, judgement: judgementRef.current };
    }

    function startRun() {
      const chart = chartRef.current;
      const songMs = songClock.songTimeAt(performance.now());
      if (!chart || songMs === null) return;
      const run = createRun({
        chart,
        startSongMs: songMs,
        offsetMs: cfgRef.current.offsetMs,
        autoplay: autoplayRef.current,
      });
      runRef.current = run;
      runAutoplayRef.current = autoplayRef.current;
      runTrackRef.current = trackRef.current;
      runCalibrationRef.current = Boolean(chartRef.current?.calibration);
      setCalibrating(runCalibrationRef.current);
      lastSongMsRef.current = songMs;
      resetRunState();
      setEndSummary(null);
      const snap = run.snapshot(songMs);
      multiplierRef.current = snap.multiplier;
      setHud(toHud(snap));
      setPhase(songClock.paused() ? "paused" : "playing");
    }

    // Drops the current run. A run that judged at least one note leaves its end card.
    function endRun() {
      const run = runRef.current;
      if (!run) return;
      runRef.current = null;
      setCalibrating(false);
      const snap = run.snapshot(lastSongMsRef.current);
      feverActiveRef.current = false;
      if (snap.judged >= 1) {
        const { hits, ranked, skipped, ...rest } = snap;
        setEndSummary({ ...rest, calibration: runCalibrationRef.current, timingMs: runTimingOf(hits), title: runTrackRef.current?.title ?? null, artist: runTrackRef.current?.artist ?? null, feverActive: false, feverLeftMs: 0 });
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

    // Applies run events: counters for the pose and flashes, and marks the HUD stale.
    // Returns true when the run ended.
    function handleEvents(events, heardMs) {
      let ended = false;
      for (const event of events) {
        if (event.kind === "hit") {
          comboRef.current += 1;
          // The player's presses sound on the key (see onLane); autoplay has no keys, so its heads
          // sound here. A tail counts for combo and the popup, but it has no sound of its own.
          if (cfgRef.current.hitSounds && runAutoplayRef.current && event.part !== "tail") soundsRef.current?.play(cfgRef.current.hitVolume);
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
      // Autoplay plays the whole game, FEVER included.
      if (runAutoplayRef.current && snap.vibe >= 1 && !snap.feverActive) {
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
        lanesDownRef.current[lane] = true;
        const run = runRef.current;
        if (!run || phaseRef.current !== "playing") return;
        // Every press sounds, hit or not, as in osu!mania: the sound answers the key.
        if (cfgRef.current.hitSounds && !runAutoplayRef.current) soundsRef.current?.play(cfgRef.current.hitVolume);
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
        if (!run || phaseRef.current !== "playing") return;
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
        if (run && songMs !== null) handleEvents(run.release(lane, songMs), run.heardTime(songMs));
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

      const run = runRef.current;
      const current = phaseRef.current;
      const renderer = rendererRef.current;
      const approachMs = approachMsFor(cfgRef.current.scrollSpeed);

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
  const setAutoplay = useCallback((next) => {
    const value = Boolean(next);
    autoplayRef.current = value;
    setAutoplayState(value);
    const run = runRef.current;
    const songMs = link.songClock.songTimeAt(performance.now());
    if (run && songMs !== null && run.snapshot(songMs).judged === 0 && chartRef.current) {
      const chart = chartRef.current;
      const restarted = createRun({ chart, startSongMs: songMs, offsetMs: cfgRef.current.offsetMs, autoplay: value });
      runRef.current = restarted;
      runAutoplayRef.current = value;
      const snap = restarted.snapshot(songMs);
      const { hits, ranked, skipped, ...rest } = snap;
      setHud({ ...rest, unranked: value || skipped > 0, judgement: null });
      judgementRef.current = null;
      flashesRef.current = [];
    }
  }, [link]);

  const resetTiming = useCallback(() => {
    tapTiming.reset();
    setTiming(tapTiming.estimate());
  }, [tapTiming]);

  return { phase, hud, endSummary, mewbitPose, track: trackInfo, canvasRef, progressRef, autoplay, setAutoplay, effectsLevel, unlockAudio, previewHit, timing, resetTiming, calibrating };
}
