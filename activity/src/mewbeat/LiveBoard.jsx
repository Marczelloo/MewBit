import { useEffect, useState } from "react";
import { boardRows } from "./liveBoard.js";
import { formatScore } from "./GameHud.jsx";
import { resolveArtworkUrl } from "./SongSelect.jsx";

function Avatar({ name, url }) {
  const src = resolveArtworkUrl(url);
  if (src) return <img className="mb-lb-av" src={src} alt="" draggable="false" />;
  return <span className="mb-lb-av mb-lb-av-text" aria-hidden="true">{String(name ?? "?").slice(0, 2).toUpperCase()}</span>;
}

// Mini leaderboard in the side column: the top 5 players of the session plus the player's own row when it is
// further down. It shows only while a run is on stage and the store holds a board (the store drops it when
// pushes stop arriving).
export default function LiveBoard({ store, session, meId, label = "On the channel" }) {
  const [entries, setEntries] = useState(() => store.entries());
  useEffect(() => {
    store.setSession(session);
    setEntries(store.entries());
    return store.subscribe(setEntries);
  }, [store, session]);
  if (!session || !entries?.length) return null;
  const rows = boardRows(entries, meId);
  return (
    <section className="mb-card mb-lb" aria-label="Live leaderboard">
      <span className="mb-label">{label} · {entries.length} playing</span>
      <ol className="mb-lb-list">
        {rows.map(({ rank, entry, me }, index) => (
          <li
            key={entry.userId ?? rank}
            className={`mb-lb-row${me ? " mb-lb-me" : ""}${entry.ended ? " mb-lb-done" : ""}${index === 5 ? " mb-lb-gap" : ""}`.trim()}
          >
            <span className="mb-lb-rank">{rank}</span>
            <Avatar name={entry.username} url={entry.avatarUrl} />
            <span className="mb-lb-name">{entry.username}</span>
            <span className="mb-lb-score">{formatScore(entry.score ?? 0)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
