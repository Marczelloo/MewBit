// The parts of the game screen that follow the HUD. Each one reads its own slice of the HUD store, so a judgement
// renders these leaves and not the session around them. A spectator's stage follows the watched player: the
// session passes that player's vibe and FEVER (`watchVibe` null when there is nothing to follow) instead of the HUD's.
import { memo, useCallback, useEffect, useRef } from "react";
import GameHud, { FeverBar, HighwayReadout } from "./GameHud.jsx";
import Stage from "./Stage.jsx";
import { healthColor, healthTone, lifePips } from "./health.js";
import { multiplierFor } from "./scoring.js";
import { useHud } from "./useHud.js";
import { EMPTY_HUD } from "./useMewbeatGame.js";

const FEVER_VIBE = 1.4; // FEVER pushes the vibe look past full
// The vibe moves with every hit, but the scenery only needs it in steps: a store selector that gives the same number
// again does not re-render, so the stage re-renders at most 20 times over the whole range instead of once per hit.
export const quantizeVibe = (vibe) => Math.round(Math.min(1, Math.max(0, vibe)) * 20) / 20;
const isCrushed = (pose) => pose === "crushed";
const stagedOf = (hud, shown) => (shown ? hud : EMPTY_HUD);

// Outside a run (or its end card) the stage shows an empty run: the next song spends a while loading before its own exists.
function useStaged(store, shown) {
  return useHud(store, useCallback((hud) => stagedOf(hud, shown), [shown]));
}

function useStageFever(store, shown, watchVibe, watchFever) {
  return useHud(store, useCallback((hud) => (watchVibe !== null ? watchFever : stagedOf(hud, shown).feverActive), [shown, watchVibe, watchFever]));
}

function useStageVibe(store, shown, watchVibe, watchFever) {
  return useHud(
    store,
    useCallback(
      (hud) => {
        const staged = stagedOf(hud, shown);
        const fever = watchVibe !== null ? watchFever : staged.feverActive;
        return fever ? FEVER_VIBE : quantizeVibe(watchVibe !== null ? watchVibe : staged.vibe);
      },
      [shown, watchVibe, watchFever]
    )
  );
}

// The stage element. Every hit swaps its data-pulse between "a" and "b": two identical CSS animations, so the
// pulse restarts without React in the loop (the attribute is not React's, so a render leaves it alone). Only full
// effects pulse; a miss does not.
export function StageHost({ store, shown, watchVibe, watchFever, effects, under, children }) {
  const fever = useStageFever(store, shown, watchVibe, watchFever);
  const ref = useRef(null);
  const pulses = effects === "full";
  useEffect(() => {
    const node = ref.current;
    if (!pulses || !node) return undefined;
    let seen = store.get().judgement?.id ?? 0;
    let flip = false;
    const stop = store.subscribe(() => {
      const judgement = store.get().judgement;
      if (!judgement || judgement.id === seen) return;
      seen = judgement.id;
      if (judgement.kind === "miss") return;
      flip = !flip;
      node.setAttribute("data-pulse", flip ? "a" : "b");
    });
    return () => {
      stop();
      node.removeAttribute("data-pulse");
    };
  }, [store, pulses]);
  return (
    <div ref={ref} className={`mb-stage${under ? " mb-stage-under" : ""}${fever ? " mb-fever" : ""}`}>
      {children}
    </div>
  );
}

// `playing`: notes are falling. The next scene is held back only while the song it started with is still the one on:
// a different track (Live moving on to the next song, whose run may already have begun) is a song boundary, and the
// scene follows it at once.
export const StageBackdrop = memo(function StageBackdrop({ store, shown, watchVibe, watchFever, track, hold: playing = false }) {
  const trackKey = `${track?.title ?? ""}|${track?.artist ?? ""}|${track?.audioKey ?? ""}`;
  const startedWith = useRef(null);
  if (!playing) startedWith.current = null;
  else if (startedWith.current === null) startedWith.current = trackKey;
  const hold = playing && startedWith.current === trackKey;
  return <Stage track={track} vibe={useStageVibe(store, shown, watchVibe, watchFever)} hold={hold} />;
});

// A fixed gradient at its FEVER strength, faded with the vibe: the fade is the compositor's, no gradient is repainted.
export const Aura = memo(function Aura({ store, shown, watchVibe, watchFever }) {
  const vibe = useStageVibe(store, shown, watchVibe, watchFever);
  return <div className="mb-aura" aria-hidden="true" style={{ opacity: vibe / FEVER_VIBE }} />;
});

export const FeverBanner = memo(function FeverBanner({ store, shown, watchVibe, watchFever }) {
  return useStageFever(store, shown, watchVibe, watchFever) ? <div className="mb-feverbanner" aria-hidden="true">FEVER!</div> : null;
});

// The thin bar over the highway that runs down with the FEVER.
export const FeverTime = memo(function FeverTime({ store, shown, watchVibe, watchFever }) {
  const fever = useStageFever(store, shown, watchVibe, watchFever);
  const leftMs = useHud(store, useCallback((hud) => stagedOf(hud, shown).feverLeftMs, [shown]));
  const style = fever
    ? { opacity: 1, transform: "scaleX(0)", transition: `transform ${Math.max(0, leftMs)}ms linear` }
    : { opacity: 0, transform: "scaleX(1)", transition: "none" };
  return <div className="mb-fevertime" style={style} aria-hidden="true" />;
});

// A miss marks the edges of the stage; a spectator's stage plays itself and shows no judgements.
// `poseStore` is Mewbit's pose: while he is crushed the flash is a different one.
// One element for the whole run, its full-screen gradient painted once: each miss flips data-flash between "a" and "b"
// (two identical animations restart it), where mounting a new element per miss made the browser paint it again each time.
export const MissFlash = memo(function MissFlash({ store, poseStore, watching, effects }) {
  const crushed = useHud(poseStore, isCrushed);
  const missId = useHud(store, useCallback((hud) => (!watching && hud.judgement?.kind === "miss" ? hud.judgement.id : null), [watching]));
  // Judgement ids count hits too, so the flip follows a count of misses, not the id's parity.
  const seen = useRef({ id: null, count: 0 });
  if (missId !== null && missId !== seen.current.id) seen.current = { id: missId, count: seen.current.count + 1 };
  if (effects === "off" || watching) return null;
  const flash = seen.current.count === 0 ? undefined : seen.current.count % 2 ? "a" : "b";
  return <div className={`mb-missflash${crushed ? " mb-missflash-crushed" : ""}`} data-flash={flash} aria-hidden="true" />;
});

// The combo over the highway. A spectator sees the watched player's combo, not the autoplay's.
export const Readout = memo(function Readout({ store, shown, watching, combo, watchVibe, watchFever }) {
  const fever = useStageFever(store, shown, watchVibe, watchFever);
  const hud = useHud(
    store,
    useCallback((raw) => (watching ? { ...raw, combo, multiplier: multiplierFor(combo), feverActive: fever, judgement: null } : raw), [watching, combo, fever])
  );
  return <HighwayReadout hud={hud} />;
});

export const StagedFeverBar = memo(function StagedFeverBar({ store, shown }) {
  return <FeverBar hud={useStaged(store, shown)} />;
});

export const StagedGameHud = memo(function StagedGameHud({ store, shown }) {
  return <GameHud hud={useStaged(store, shown)} />;
});

// The run was lost: the banner of the end moment, in red. The session says when (it knows the mode).
export const FailedBanner = memo(function FailedBanner({ show }) {
  return show ? <div className="mb-feverbanner mb-endbanner mb-failedbanner" role="status">FAILED</div> : null;
});

// The health bar in the gap left of the highway (the FEVER meter has the right one). A column that fills from the
// bottom, green down to yellow and red; below 0.2 it pulses (full effects only). Four Lives and One Life add pips
// above it, and No Fail shows what it costs once the bar has run dry: a dimmed bar and a x0.5 chip. Its numbers
// come in hundredths and every selector returns a primitive, so a hit that moves nothing renders nothing.
export const HealthBar = memo(function HealthBar({ store, shown, show, effects }) {
  const health = useHud(store, useCallback((hud) => stagedOf(hud, shown).health, [shown]));
  const lives = useHud(store, useCallback((hud) => stagedOf(hud, shown).lives, [shown]));
  const failed = useHud(store, useCallback((hud) => stagedOf(hud, shown).failed, [shown]));
  const depleted = useHud(store, useCallback((hud) => stagedOf(hud, shown).depleted, [shown]));
  const modifiers = useHud(store, useCallback((hud) => stagedOf(hud, shown).modifiers, [shown]));
  if (!show) return null;
  const pips = lifePips({ modifiers, lives, failed });
  const tone = healthTone(health);
  const classes = ["mb-health", `mb-health-${tone}`];
  if (depleted) classes.push("mb-health-spent");
  if (effects === "full") classes.push("mb-health-fx");
  return (
    <div className={classes.join(" ")} role="meter" aria-label="Health" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(health * 100)}>
      {pips ? (
        <div className="mb-health-pips" aria-hidden="true">
          {Array.from({ length: pips.count }, (_, index) => <i key={index} className={index < pips.filled ? "mb-pip mb-pip-on" : "mb-pip"} />)}
        </div>
      ) : null}
      <div className="mb-health-bar" aria-hidden="true">
        <div className="mb-health-track"><i style={{ transform: `scaleY(${health})`, background: healthColor(health) }} /></div>
      </div>
      {depleted ? <span className="mb-health-chip">NF x0.5</span> : null}
    </div>
  );
});

export const UnrankedChip = memo(function UnrankedChip({ store, show }) {
  const unranked = useHud(store, useCallback((hud) => hud.unranked, []));
  return show && unranked ? <span className="mb-chip">unranked</span> : null;
});
