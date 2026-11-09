import { useState } from "react";
import { Avatar, Notice, useReply } from "./PlayerPanel.jsx";
import { formatCount, formatPercent } from "./playerFormat.js";
import { DIFFICULTIES, gradeClass } from "./SongSelect.jsx";

const BOARD_LIMIT = 50;
const SCOPES = [
  { id: "server", label: "This server" },
  { id: "global", label: "Global" },
];

function BoardRow({ rank, entry, mine, pinned, onOpenPlayer }) {
  return (
    <button
      type="button"
      className={`mb-ss-pl${mine ? " mb-ss-pl-mine" : ""}${pinned ? " mb-ss-pl-pin" : ""}`}
      onClick={() => onOpenPlayer?.(entry.userId)}
    >
      <span className="mb-ss-rk">{rank}</span>
      <Avatar name={entry.username} avatarUrl={entry.avatarUrl} size={26} />
      <span className="mb-ss-nm">{entry.username}</span>
      <span className={`mb-ss-gr ${gradeClass(entry.grade)}`}>{entry.grade ?? "—"}</span>
      <span className="mb-ss-r">{formatPercent(entry.accuracy, 2)}</span>
      <span className="mb-ss-s">{formatCount(entry.score)}</span>
    </button>
  );
}

// The scores on one level of one song, for this server or for everyone. userId is yours: your row is lit, and
// pinned under the list with your rank when you are further down than the rows shown. A row opens that player.
export default function LevelBoard({ request, audioKey, difficulty, userId, onOpenPlayer }) {
  const [scope, setScope] = useState("server");
  const [state, retry] = useReply(request, "mewbeat_board", audioKey ? { audioKey, difficulty, scope, limit: BOARD_LIMIT } : null);
  const entries = state.reply?.entries ?? [];
  const own = state.reply?.own;
  const shown = entries.some((entry) => entry.userId === userId);
  const pinned = !shown && own?.best && Number.isFinite(own.rank) ? own : null;

  let body;
  if (!audioKey) body = <div className="mb-ss-empty" role="status"><span>Play this song once to open its leaderboard.</span></div>;
  else if (state.status !== "ready") body = <Notice state={state} retry={retry} loading="Loading scores…" failed="Couldn't load the leaderboard." />;
  else if (!entries.length) body = <div className="mb-ss-empty" role="status"><span>No scores on this level yet.</span></div>;
  else {
    body = entries.map((entry, index) => (
      <BoardRow key={entry.userId} rank={index + 1} entry={entry} mine={entry.userId === userId} onOpenPlayer={onOpenPlayer} />
    ));
  }

  return (
    <div className={`mb-ss-panel mb-ss-block mb-ss-board mb-ss-d-${difficulty}`}>
      <h3>
        <span>Leaderboard · <span className="mb-ss-dl">{DIFFICULTIES.find((d) => d.id === difficulty)?.label ?? difficulty}</span></span>
        <span className="mb-ss-seg" role="group" aria-label="Leaderboard scope">
          {SCOPES.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={scope === id} className={scope === id ? "mb-ss-seg-on" : undefined} onClick={() => setScope(id)}>{label}</button>
          ))}
        </span>
      </h3>
      <div className="mb-ss-block-rows">{body}</div>
      {pinned ? <BoardRow rank={pinned.rank} entry={pinned.best} mine pinned onOpenPlayer={onOpenPlayer} /> : null}
    </div>
  );
}
