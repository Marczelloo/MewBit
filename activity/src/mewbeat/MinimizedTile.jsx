import { useCallback, useEffect, useState } from "react";
import { formatScore } from "./GameHud.jsx";
import { Cover } from "./SongSelect.jsx";
import { TILE_HEIGHT, TILE_WIDTH, ordinal, placeOf, tileScale } from "./minimized.js";
import Mewbit from "./mewbit/Mewbit.jsx";
import { useHud } from "./useHud.js";
import "./minimized.css";

const PROGRESS_MS = 500;

// Scales the 320x180 tile to the window it is in (a minimized window ranges from about 240x135 up).
export function useTileScale() {
  const read = () => tileScale(window.innerWidth, window.innerHeight);
  const [scale, setScale] = useState(read);
  useEffect(() => {
    const onResize = () => setScale(read());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return scale;
}

function Face({ effects }) {
  return <Mewbit pose="neutral" effects={effects === "off" ? "off" : "reduced"} />;
}

// The minimized window: one of four tiles, no controls. This part only draws what it is given, so the dev preview
// feeds it sample data and the game feeds it the run.
// kind: "select" (title, artist, artworkUrl), "paused" (title, artworkUrl, score, combo), "live" (title, artworkUrl,
// score, combo, place { place, total } or null, progress 0..1), "lobby" (room, ready { ready, total }, next { title, artworkUrl } or null).
export function MinimizedTile({ kind, title, artist, artworkUrl, score = 0, combo = 0, place = null, progress = 0, room, ready, next = null, effects = "full", scale = 1 }) {
  const cover = { title, artworkUrl };
  return (
    <div className="mb-min" data-tile={kind}>
      <div className={`mb-tile mb-tile-${kind}`} style={{ width: TILE_WIDTH, height: TILE_HEIGHT, transform: `scale(${scale})` }}>
        {kind === "paused" ? (
          <>
            <Cover row={cover} className="mb-tile-art mb-tile-cover" />
            <div className="mb-tile-glyph" aria-hidden="true"><i /><i /></div>
            <div className="mb-tile-info">
              <span className="mb-tile-tag">PAUSED</span>
              <span className="mb-tile-score">{formatScore(score)}</span>
              <span className="mb-tile-combo">{combo}x combo</span>
            </div>
            <div className="mb-tile-resume">Open to resume</div>
          </>
        ) : kind === "live" ? (
          <>
            <Cover row={cover} className="mb-tile-art mb-tile-cover" />
            <div className="mb-tile-info">
              <span className="mb-tile-score">{formatScore(score)}</span>
              <span className="mb-tile-combo">{combo}x combo</span>
            </div>
            <i className="mb-tile-dot" aria-hidden="true" />
            {place ? <div className="mb-tile-place">{ordinal(place.place)}<span>of {place.total}</span></div> : null}
            <div className="mb-tile-prog" aria-hidden="true"><i style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }} /></div>
          </>
        ) : kind === "lobby" ? (
          <>
            <div className="mb-tile-face"><Face effects={effects} /></div>
            <div className="mb-tile-room">{room}</div>
            <div className="mb-tile-ready">{ready.ready}<span>of {ready.total} ready</span></div>
            {next ? (
              <div className="mb-tile-next">
                <Cover row={next} className="mb-tile-art mb-tile-cover" />
                <b><em>Next</em> {next.title}</b>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="mb-tile-mew"><Face effects={effects} /></div>
            <div className="mb-tile-col">
              <Cover row={cover} className="mb-tile-art mb-tile-cover" />
              <div>
                <b>{title}</b>
                {artist ? <span>{artist}</span> : null}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const scoreOf = (hud) => hud.score;
const comboOf = (hud) => hud.combo;

// The tile of the run on stage: its score and combo from the HUD store, the player's place from the live board, and the
// song's progress from the song clock. Each updates this one component and not the game under it.
export function RunTile({ kind, hudStore, board, meId, songFraction, ...rest }) {
  const score = useHud(hudStore, scoreOf);
  const combo = useHud(hudStore, comboOf);
  const [entries, setEntries] = useState(() => board.entries());
  useEffect(() => {
    setEntries(board.entries());
    return board.subscribe(setEntries);
  }, [board]);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (kind !== "live") return undefined;
    const read = () => setProgress(songFraction());
    read();
    const id = window.setInterval(read, PROGRESS_MS);
    return () => window.clearInterval(id);
  }, [kind, songFraction]);
  const scale = useTileScale();
  return <MinimizedTile kind={kind} score={score} combo={combo} place={kind === "live" ? placeOf(entries, meId) : null} progress={progress} scale={scale} {...rest} />;
}

// The tiles that carry no run (song select, the room lobby) need only the window's scale.
export function PlainTile(props) {
  return <MinimizedTile {...props} scale={useTileScale()} />;
}

export const useSongFraction = (link, durationMs) =>
  useCallback(() => {
    const songMs = link.songClock.songTimeAt(performance.now());
    return songMs !== null && durationMs > 0 ? Math.max(0, Math.min(1, songMs / durationMs)) : 0;
  }, [link, durationMs]);
