import { Avatar, Notice, useReply } from "./PlayerPanel.jsx";
import { scopesFor, usePrivatePlace } from "./placeContext.js";
import { formatCount, formatPercent } from "./playerFormat.js";

const RANKING_LIMIT = 50;
const SCOPES = [
  { id: "global", label: "Global" },
  { id: "server", label: "This server" },
];

function RankRow({ entry, mine, pinned, onOpenPlayer }) {
  const open = () => onOpenPlayer?.(entry.userId);
  // The song select's own Enter starts the song; here Enter opens the player instead, so it stops at the row.
  const onKeyDown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    open();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      className={`mb-ss-rankrow${mine ? " mb-ss-rankrow-mine" : ""}${pinned ? " mb-ss-rankrow-pin" : ""}`}
      onClick={open}
      onKeyDown={onKeyDown}
    >
      <span className="mb-ss-rankn">{entry.rank}</span>
      <Avatar name={entry.username} avatarUrl={entry.avatarUrl} size={34} />
      <span className="mb-ss-rankname">{entry.username}</span>
      <span className="mb-ss-rankacc">{formatPercent(entry.accuracy)}</span>
      <span className="mb-ss-rankpp">{formatCount(Math.round(entry.pp ?? 0))} pp</span>
    </div>
  );
}

// Everyone by rating, across all servers or on this one. userId is yours: your row is lit, and pinned under the
// list with your rank when you are further down than the rows shown. A row opens that player's profile.
export default function RankingPanel({ request, userId, scope, onScope, onOpenPlayer }) {
  const scopes = scopesFor(SCOPES, usePrivatePlace());
  const [state, retry] = useReply(request, "mewbeat_ranking", { scope, limit: RANKING_LIMIT });
  const entries = state.reply?.entries ?? [];
  const own = state.reply?.own;
  const shown = entries.some((entry) => entry.userId === userId);
  // The reply gives your own name, picture and accuracy for this row; "You" and a dash stand in when it doesn't.
  const pinned = !shown && Number.isFinite(own?.rank)
    ? { rank: own.rank, userId, username: own.username || "You", avatarUrl: own.avatarUrl ?? null, accuracy: own.accuracy, pp: own.pp }
    : null;

  let body;
  if (state.status !== "ready") body = <Notice state={state} retry={retry} loading="Loading ranking…" failed="Couldn't load the ranking." />;
  else if (!entries.length) body = <div className="mb-ss-empty" role="status"><span>No ranked plays yet.</span></div>;
  else body = entries.map((entry) => <RankRow key={entry.userId} entry={entry} mine={entry.userId === userId} onOpenPlayer={onOpenPlayer} />);

  return (
    <div className="mb-ss-panel mb-ss-block mb-ss-ranking">
      <h3>
        <span>{scope === "global" ? "Global ranking" : "Server ranking"}</span>
        <span className="mb-ss-seg" role="group" aria-label="Ranking scope">
          {scopes.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={scope === id} className={scope === id ? "mb-ss-seg-on" : undefined} onClick={() => onScope(id)}>{label}</button>
          ))}
        </span>
      </h3>
      <div className="mb-ss-rankhead" aria-hidden="true">
        <span className="mb-ss-rankn">#</span>
        <span />
        <span>Player</span>
        <span className="mb-ss-rankacc">Acc</span>
        <span className="mb-ss-rankpp">Rating</span>
      </div>
      <div className="mb-ss-block-rows">{body}</div>
      {pinned ? <RankRow entry={pinned} mine pinned onOpenPlayer={onOpenPlayer} /> : null}
    </div>
  );
}
