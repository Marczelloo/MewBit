import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { formatAccuracy, formatScore } from "./GameHud.jsx";
import { DIFFICULTIES, resolveArtworkUrl } from "./SongSelect.jsx";

// Replaces the score card in the right column while someone is watched: whose round is on screen, a way to
// switch to another player, and that player's live numbers (from the room's live board, not from a local run).
export default function SpectateCard({ target, players, entry, onStep }) {
  if (!target) return null;
  const src = resolveArtworkUrl(target.avatarUrl);
  const difficulty = DIFFICULTIES.find((d) => d.id === target.difficulty)?.label ?? target.difficulty;
  const several = players.length > 1;
  return (
    <section className="mb-card mb-spectate" aria-label="Spectating">
      <span className="mb-label">Spectating</span>
      <div className="mb-spectate-who">
        {several ? (
          <button type="button" className="mb-spectate-step" aria-label="Previous player" onClick={() => onStep(-1)}>
            <CaretLeft size={14} weight="bold" aria-hidden="true" />
          </button>
        ) : null}
        {src
          ? <img className="mb-spectate-av" src={src} alt="" draggable="false" />
          : <span className="mb-spectate-av mb-spectate-av-text" aria-hidden="true">{String(target.username ?? "?").slice(0, 2).toUpperCase()}</span>}
        <span className="mb-spectate-name">
          <b>{target.username}</b>
          <small>{difficulty}</small>
        </span>
        {several ? (
          <button type="button" className="mb-spectate-step" aria-label="Next player" onClick={() => onStep(1)}>
            <CaretRight size={14} weight="bold" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="mb-hud-score">{formatScore(entry?.score ?? 0)}</div>
      <div className="mb-hud-stats">
        <div>
          Accuracy
          <b>{formatAccuracy(entry?.accuracy ?? null)}</b>
        </div>
        <div>
          Combo
          <b>{entry?.combo ?? 0}</b>
        </div>
      </div>
    </section>
  );
}
