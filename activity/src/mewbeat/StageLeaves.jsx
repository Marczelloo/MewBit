// The parts of the game screen that follow the HUD. Each one reads its own slice of the HUD store, so a judgement
// renders these leaves and not the session around them. A spectator's stage follows the watched player: the
// session passes that player's vibe and FEVER (`watchVibe` null when there is nothing to follow) instead of the HUD's.
import { useCallback, useEffect, useRef } from "react";
import GameHud, { FeverBar, HighwayReadout } from "./GameHud.jsx";
import Stage from "./Stage.jsx";
import { multiplierFor } from "./scoring.js";
import { useHud } from "./useHud.js";
import { EMPTY_HUD } from "./useMewbeatGame.js";

const FEVER_VIBE = 1.4; // FEVER pushes the vibe look past full
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
        return fever ? FEVER_VIBE : Math.min(1, Math.max(0, watchVibe !== null ? watchVibe : staged.vibe));
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

export function StageBackdrop({ store, shown, watchVibe, watchFever, track }) {
  return <Stage track={track} vibe={useStageVibe(store, shown, watchVibe, watchFever)} />;
}

// A fixed gradient at its FEVER strength, faded with the vibe: the fade is the compositor's, no gradient is repainted.
export function Aura({ store, shown, watchVibe, watchFever }) {
  const vibe = useStageVibe(store, shown, watchVibe, watchFever);
  return <div className="mb-aura" aria-hidden="true" style={{ opacity: vibe / FEVER_VIBE }} />;
}

export function FeverBanner({ store, shown, watchVibe, watchFever }) {
  return useStageFever(store, shown, watchVibe, watchFever) ? <div className="mb-feverbanner" aria-hidden="true">FEVER!</div> : null;
}

// The thin bar over the highway that runs down with the FEVER.
export function FeverTime({ store, shown, watchVibe, watchFever }) {
  const fever = useStageFever(store, shown, watchVibe, watchFever);
  const leftMs = useHud(store, useCallback((hud) => stagedOf(hud, shown).feverLeftMs, [shown]));
  const style = fever
    ? { opacity: 1, transform: "scaleX(0)", transition: `transform ${Math.max(0, leftMs)}ms linear` }
    : { opacity: 0, transform: "scaleX(1)", transition: "none" };
  return <div className="mb-fevertime" style={style} aria-hidden="true" />;
}

// A miss marks the edges of the stage; a spectator's stage plays itself and shows no judgements.
export function MissFlash({ store, watching, effects, crushed }) {
  const judgement = useHud(store, useCallback((hud) => (watching ? null : hud.judgement), [watching]));
  if (judgement?.kind !== "miss" || effects === "off") return null;
  return <div key={judgement.id} className={`mb-missflash${crushed ? " mb-missflash-crushed" : ""}`} aria-hidden="true" />;
}

// The combo over the highway. A spectator sees the watched player's combo, not the autoplay's.
export function Readout({ store, shown, watching, combo, watchVibe, watchFever }) {
  const fever = useStageFever(store, shown, watchVibe, watchFever);
  const hud = useHud(
    store,
    useCallback((raw) => (watching ? { ...raw, combo, multiplier: multiplierFor(combo), feverActive: fever, judgement: null } : raw), [watching, combo, fever])
  );
  return <HighwayReadout hud={hud} />;
}

export function StagedFeverBar({ store, shown }) {
  return <FeverBar hud={useStaged(store, shown)} />;
}

export function StagedGameHud({ store, shown }) {
  return <GameHud hud={useStaged(store, shown)} />;
}

export function UnrankedChip({ store, show }) {
  const unranked = useHud(store, useCallback((hud) => hud.unranked, []));
  return show && unranked ? <span className="mb-chip">unranked</span> : null;
}
