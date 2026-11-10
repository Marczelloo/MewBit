import { useState } from "react";
import { Avatar, Notice, useReply } from "./PlayerPanel.jsx";
import { scopesFor, usePrivatePlace } from "./placeContext.js";
import { formatCount, formatPercent } from "./playerFormat.js";
import { DIFFICULTIES, gradeClass } from "./SongSelect.jsx";

const BOARD_LIMIT = 50;
export const BOARD_SCOPES = [
  { id: "server", label: "This server" },
  { id: "global", label: "Global" },
];

// A row opens its player when onOpenPlayer is given; without it the row is a plain line, not a button.
export function BoardRow({ rank, entry, mine, pinned, size = 26, index = 0, onOpenPlayer }) {
  const className = `mb-ss-pl${mine ? " mb-ss-pl-mine" : ""}${pinned ? " mb-ss-pl-pin" : ""}${onOpenPlayer ? "" : " mb-ss-pl-static"}`;
  const cells = (
    <>
      <span className="mb-ss-rk">{rank}</span>
      <Avatar name={entry.username} avatarUrl={entry.avatarUrl} size={size} />
      <span className="mb-ss-nm">{entry.username}</span>
      <span className={`mb-ss-gr ${gradeClass(entry.grade)}`}>{entry.grade ?? "—"}</span>
      <span className="mb-ss-r">{formatPercent(entry.accuracy, 2)}</span>
      <span className="mb-ss-s">{formatCount(entry.score)}</span>
    </>
  );
  if (!onOpenPlayer) return <div className={className} style={{ "--i": index }}>{cells}</div>;
  return (
    <button type="button" className={className} style={{ "--i": index }} onClick={() => onOpenPlayer(entry.userId)}>
      {cells}
    </button>
  );
}

// The board of one level of one song. audioKey null (or enabled false) asks for nothing yet. Returns what the heading's
// toggle and the rows need; Results asks later than song select does, once its own score has been sent.
export function useLevelBoard({ request, audioKey, difficulty, userId, limit = BOARD_LIMIT, enabled = true }) {
  const isPrivate = usePrivatePlace();
  const [scope, setScope] = useState(isPrivate ? "global" : "server");
  const wanted = Boolean(audioKey) && enabled && typeof request === "function";
  const [state, retry] = useReply(request, "mewbeat_board", wanted ? { audioKey, difficulty, scope, limit } : null);
  const entries = state.reply?.entries ?? [];
  const own = state.reply?.own;
  const shown = entries.some((entry) => entry.userId === userId);
  const pinned = !shown && own?.best && Number.isFinite(own.rank) ? own : null;
  return { scope, setScope, state, retry, entries, pinned };
}

export function BoardHeading({ difficulty, scope, onScope }) {
  const scopes = scopesFor(BOARD_SCOPES, usePrivatePlace());
  return (
    <h3>
      <span>Leaderboard · <span className="mb-ss-dl">{DIFFICULTIES.find((d) => d.id === difficulty)?.label ?? difficulty}</span></span>
      <span className="mb-ss-seg" role="group" aria-label="Leaderboard scope">
        {scopes.map(({ id, label }) => (
          <button key={id} type="button" aria-pressed={scope === id} className={scope === id ? "mb-ss-seg-on" : undefined} onClick={() => onScope(id)}>{label}</button>
        ))}
      </span>
    </h3>
  );
}

// The rows, or why there are none. A request that has not gone out yet reads as loading.
export function BoardRows({ board, userId, size, onOpenPlayer }) {
  const { state, retry, entries } = board;
  if (state.status !== "ready") return <Notice state={state} retry={retry} loading="Loading scores…" failed="Couldn't load the leaderboard." />;
  if (!entries.length) return <div className="mb-ss-empty" role="status"><span>No scores on this level yet.</span></div>;
  return entries.map((entry, index) => (
    <BoardRow key={entry.userId} rank={index + 1} entry={entry} mine={entry.userId === userId} size={size} index={index} onOpenPlayer={onOpenPlayer} />
  ));
}

// The scores on one level of one song, for this server or for everyone. userId is yours: your row is lit, and
// pinned under the list with your rank when you are further down than the rows shown. A row opens that player.
export default function LevelBoard({ request, audioKey, difficulty, userId, onOpenPlayer, tour }) {
  const board = useLevelBoard({ request, audioKey, difficulty, userId });

  return (
    <div className={`mb-ss-panel mb-ss-block mb-ss-board mb-ss-d-${difficulty}`} data-tour={tour}>
      <BoardHeading difficulty={difficulty} scope={board.scope} onScope={board.setScope} />
      <div className="mb-ss-block-rows">
        {audioKey ? (
          <BoardRows board={board} userId={userId} onOpenPlayer={onOpenPlayer} />
        ) : (
          <div className="mb-ss-empty" role="status"><span>Play this song once to open its leaderboard.</span></div>
        )}
      </div>
      {board.pinned ? <BoardRow rank={board.pinned.rank} entry={board.pinned.best} mine pinned onOpenPlayer={onOpenPlayer} /> : null}
    </div>
  );
}
