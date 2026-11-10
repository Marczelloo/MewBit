// Stage scenery behind the game: one painted scene cut into pixel-aligned layers on a 2560x1440
// canvas, plus spotlights. Each song gets its own scene, and always the same one. Pure decoration,
// so everything is aria-hidden and ignores the pointer. The look follows the `vibe` prop (--mb-vibe, set here
// on .mb-backdrop only) and the data-pulse flip on .mb-stage, which only runs opacity animations; see mewbeat.css.
import { memo, useEffect, useRef, useState } from "react";
import { pickScene } from "./scenes.js";

// URLs only, so a scene's images are fetched when it first shows. New art only needs a new folder.
const FILES = import.meta.glob("./backdrop/*/*.webp", { eager: true, query: "?url", import: "default" });
const SCENES = [...new Set(Object.keys(FILES).map((path) => path.split("/")[2]))].sort();
const FADE_MS = 700; // Matches mb-scene-out in mewbeat.css.

// A dev-server-only switch to look at one scene: ?mock=1&scene=04-arcade.
const FORCED_SCENE = import.meta.env.DEV && typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("scene") : null;

const url = (scene, layer) => FILES[`./backdrop/${scene}/${layer}.webp`];

function sceneFor(track) {
  if (FORCED_SCENE && SCENES.includes(FORCED_SCENE)) return FORCED_SCENE;
  return pickScene(SCENES, track);
}

function Layer({ scene, layer, name = "" }) {
  return <img className={`mb-layer ${name}`.trim()} src={url(scene, layer)} alt="" draggable={false} />;
}

const Scene = memo(function Scene({ scene, leaving = false }) {
  return (
    <div className={`mb-scene-set${leaving ? " mb-scene-leaving" : ""}`}>
      <Layer scene={scene} layer="base" />
      <Layer scene={scene} layer="fever" name="mb-layer-fever" />
      <Layer scene={scene} layer="lit" name="mb-layer-lit" />
      <Layer scene={scene} layer="glow" name="mb-layer-glow" />
      <Layer scene={scene} layer="neon" name="mb-layer-neon" />
    </div>
  );
});

// `vibe` (0..1.4) comes with every judgement; the scenes and the track stay put, so only the backdrop's variable changes.
// `hold` is true while notes of a run are falling: a new scene is then not started (five 2560x1440 images to decode)
// until the run pauses, ends or moves to the next song, so the swap happens before a run or between songs. A decode
// that has started is never cancelled by a run starting under it (Live starts the next song's run while it loads).
function Stage({ track = null, vibe = 0, hold = false }) {
  const wanted = sceneFor(track);
  const [shown, setShown] = useState(() => wanted ?? SCENES[0]);
  const [leaving, setLeaving] = useState(null);
  const loading = useRef(null); // the scene being decoded, if any: { scene }

  // The next scene waits until its images can paint, then the old one fades away on top of it. Only the old scene
  // stays mounted for the fade (FADE_MS), after which a single scene is left.
  useEffect(() => {
    if (!wanted || wanted === shown) {
      loading.current = null;
      return;
    }
    if (loading.current?.scene === wanted || hold) return;
    const job = { scene: wanted };
    loading.current = job;
    const ready = ["base", "fever", "lit", "glow", "neon"].map((layer) => {
      const image = new Image();
      image.src = url(wanted, layer);
      return image.decode().catch(() => {});
    });
    Promise.all(ready).then(() => {
      if (loading.current !== job) return;
      loading.current = null;
      setLeaving(shown);
      setShown(wanted);
    });
  }, [wanted, shown, hold]);

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(() => setLeaving(null), FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return (
    <div className="mb-backdrop" aria-hidden="true" style={{ "--mb-vibe": vibe }}>
      <Scene key={shown} scene={shown} />
      {leaving ? <Scene key={leaving} scene={leaving} leaving /> : null}
      <div className="mb-spot mb-spot-l" />
      <div className="mb-spot mb-spot-r" />
      <div className="mb-backdrop-dim" />
    </div>
  );
}

export default memo(Stage);
