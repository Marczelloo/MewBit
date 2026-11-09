import { useEffect, useRef, useState } from "react";
import { WINDOWS } from "./scoring.js";
import { formatCount, formatDuration, formatOffsetMs, formatPercent, formatRank, formatSeconds, formatSince, timingWord } from "./playerFormat.js";
import RankingPanel from "./RankingPanel.jsx";
import { Cover, DIFFICULTIES, gradeClass, hueOf, resolveArtworkUrl } from "./SongSelect.jsx";

const GRADES = ["S", "A", "B", "C", "D"];
const JUDGEMENTS = [
  { id: "perfect", label: "Perfect" },
  { id: "great", label: "Great" },
  { id: "good", label: "Good" },
  { id: "miss", label: "Miss" },
];
// Another player's profile has no ranking of its own: the ranking is the same list, seen from your side.
const OTHER_TABS = [{ id: "profile", label: "Profile" }, { id: "stats", label: "Stats" }];
const OWN_TABS = [...OTHER_TABS, { id: "ranking", label: "Ranking" }];
const TIMING_SCALE_MS = WINDOWS.perfect; // the timing line runs from this early to this late

// What the stats cards show for a player with no totals yet.
const EMPTY_STATS = {
  plays: 0, avgAccuracy: 0, songs: 0, playMs: 0,
  counts: { perfect: 0, great: 0, good: 0, miss: 0 },
  presses: 0, emptyPresses: 0, holdMs: 0, longestHoldMs: 0, fevers: 0, fullCombos: 0,
  timing: { meanMs: null, spreadMs: null, earlyShare: null, lateShare: null },
  bestCombo: null,
  maps: [],
};

const FAILED_COPY = { not_found: "Couldn't find that player." };
const RETRY_FUTILE = new Set(["not_found"]); // asking again would get the same answer

// Asks the bot for a reply and keeps it with the request it answers, so a reply that arrives after the song,
// tab or level changed is dropped and never shown under the new ones. A null body asks nothing.
export function useReply(request, type, body) {
  const key = body ? `${type}:${JSON.stringify(body)}` : null;
  const [result, setResult] = useState({ key: null });
  const [reload, setReload] = useState(0);
  const bodyRef = useRef(body);
  bodyRef.current = body;

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    const settle = (next) => { if (!cancelled) setResult({ key, ...next }); };
    setResult({ key: null });
    Promise.resolve()
      .then(() => request(type, bodyRef.current))
      .then((reply) => settle(!reply || reply.status === "error" ? { status: "error", reason: reply?.reason } : { status: "ready", reply }))
      .catch(() => settle({ status: "error" }));
    return () => { cancelled = true; };
  }, [request, type, key, reload]);

  const state = key && result.key === key ? result : { status: key ? "loading" : "idle" };
  return [state, () => setReload((n) => n + 1)];
}

// The loading and failed look shared with the song list's empty state.
export function Notice({ state, retry, loading, failed }) {
  if (state.status === "error") {
    return (
      <div className="mb-ss-empty mb-ss-empty-error" role="alert">
        <span>{FAILED_COPY[state.reason] ?? failed}</span>
        {RETRY_FUTILE.has(state.reason) ? null : <button type="button" className="mb-btn" onClick={retry}>Try again</button>}
      </div>
    );
  }
  return <div className="mb-ss-empty" role="status"><span>{loading}</span></div>;
}

// A player's picture through the artwork proxy, or their first letter on a coloured circle.
export function Avatar({ name, avatarUrl, size }) {
  const src = resolveArtworkUrl(avatarUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const style = { "--size": `${size}px` };
  if (src && !failed) return <img className="mb-ss-av" style={style} src={src} alt="" draggable={false} onError={() => setFailed(true)} />;
  const initial = [...String(name ?? "").trim()][0]?.toUpperCase() ?? "?";
  return <span className="mb-ss-av" style={{ ...style, background: `hsl(${hueOf(name)} 75% 70%)` }} aria-hidden="true">{initial}</span>;
}

function difficultyLabel(id) {
  return DIFFICULTIES.find((d) => d.id === id)?.label ?? id ?? "";
}

function ModeBar({ tab, viewing, name, onTab, onBack }) {
  return (
    <div className="mb-ss-mode">
      <div role="tablist" aria-label="Player" className="mb-ss-ptabs">
        {(viewing ? OTHER_TABS : OWN_TABS).map(({ id, label }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`mb-ss-ptab${tab === id ? " mb-ss-ptab-on" : ""}`} onClick={() => onTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {viewing ? (
        <span className="mb-ss-viewing">
          <span>{name ? `Viewing ${name}` : "Viewing a player"}</span>
          <button type="button" className="mb-ss-back" onClick={onBack}>← Your profile</button>
        </span>
      ) : null}
    </div>
  );
}

function PlayLine({ play, sub, value, note }) {
  return (
    <div className="mb-ss-line">
      <Cover row={{ title: play.title, artworkUrl: play.artworkUrl }} className="mb-ss-cv" />
      <span className="mb-ss-tt">
        <b>{play.title}</b>
        <small className={`mb-ss-d-${play.difficulty}`}>{sub}</small>
      </span>
      <span className="mb-ss-val">{value}<small>{note}</small></span>
    </div>
  );
}

function Block({ title, empty, children }) {
  return (
    <div className="mb-ss-panel mb-ss-block">
      <h3>{title}</h3>
      <div className="mb-ss-block-rows">
        {children}
        {empty ? <p className="mb-ss-block-empty">{empty}</p> : null}
      </div>
    </div>
  );
}

function Tile({ label, children, note, className }) {
  return (
    <div className={`mb-ss-tile${className ? ` ${className}` : ""}`}>
      <span className="mb-ss-label">{label}</span>
      <b>{children}</b>
      {note !== undefined ? <small>{note}</small> : null}
    </div>
  );
}

function Profile({ reply }) {
  const { player, rating, summary, recent, best } = reply;
  const grades = summary?.bestGrades ?? {};
  const since = formatSince(player?.firstAt);
  const recentRows = recent ?? [];
  const bestRows = best ?? [];
  return (
    <>
      <div className="mb-ss-panel mb-ss-me">
        <Avatar name={player?.username} avatarUrl={player?.avatarUrl} size={64} />
        <div className="mb-ss-me-name">
          <h2>{player?.username ?? "Unknown player"}</h2>
          {since ? <small>playing since {since}</small> : null}
        </div>
        <div className="mb-ss-rating">
          <b>{formatCount(Math.round(rating?.pp ?? 0))}<i>pp</i></b>
          <div className="mb-ss-ranks">
            <span>Global <em>{formatRank(rating?.global)}</em></span>
            <span>Server <em>{formatRank(rating?.server)}</em></span>
          </div>
        </div>
      </div>
      <div className="mb-ss-panel mb-ss-tiles">
        <Tile label="Plays">{formatCount(summary?.plays)}</Tile>
        <Tile label="Avg accuracy">{summary?.plays > 0 ? formatPercent(summary.avgAccuracy) : "—"}</Tile>
        <Tile label="Songs">{formatCount(summary?.songs)}</Tile>
        <Tile label="Time played">{formatDuration(summary?.playMs)}</Tile>
        <div className="mb-ss-tile mb-ss-tile-grades">
          <span className="mb-ss-label">Best grades</span>
          <div className="mb-ss-grades">
            {GRADES.map((grade) => <span key={grade}><i className={gradeClass(grade)}>{grade}</i>{formatCount(grades[grade])}</span>)}
          </div>
        </div>
      </div>
      <div className="mb-ss-two">
        <Block title="Recent plays" empty={recentRows.length ? null : "No plays yet."}>
          {recentRows.map((play, index) => (
            <PlayLine
              key={`${play.audioKey}|${play.difficulty}|${index}`}
              play={play}
              sub={<><span className="mb-ss-dl">{difficultyLabel(play.difficulty)}</span>{Number.isFinite(play.accuracy) ? ` · ${formatPercent(play.accuracy, 2)}` : ""}</>}
              value={<span className={gradeClass(play.grade)}>{play.grade ?? "—"}</span>}
              note={formatCount(play.score)}
            />
          ))}
        </Block>
        <Block title="Best plays" empty={bestRows.length ? null : "No rated plays yet."}>
          {bestRows.map((play, index) => (
            <PlayLine
              key={`${play.audioKey}|${play.difficulty}|${index}`}
              play={play}
              sub={<><span className="mb-ss-dl">{difficultyLabel(play.difficulty)}</span>{Number.isFinite(play.stars) ? ` · ★${play.stars.toFixed(1)}` : ""}</>}
              value={`${formatCount(Math.round(play.pp))} pp`}
              note={<span className={gradeClass(play.grade)}>{play.grade ?? "—"}</span>}
            />
          ))}
        </Block>
      </div>
    </>
  );
}

// The band the player's hits fall in on a line from early to late: their mean offset, give or take the spread.
function timingBand({ meanMs, spreadMs }) {
  if (!Number.isFinite(meanMs) || !Number.isFinite(spreadMs)) return null;
  const toPercent = (ms) => Math.max(0, Math.min(100, 50 + (ms / TIMING_SCALE_MS) * 50));
  const from = toPercent(meanMs - spreadMs);
  return { left: from, width: Math.max(1.5, toPercent(meanMs + spreadMs) - from) };
}

function Stats({ reply }) {
  const stats = reply.stats ?? EMPTY_STATS;
  const { counts, timing } = stats;
  const judged = JUDGEMENTS.reduce((sum, { id }) => sum + (counts[id] || 0), 0);
  const share = (id) => (judged > 0 ? ((counts[id] || 0) / judged) * 100 : null);
  const band = timingBand(timing);
  const share100 = (value) => (Number.isFinite(value) ? formatPercent(value * 100, 0) : "—");
  return (
    <>
      <div className="mb-ss-panel mb-ss-jud">
        <span className="mb-ss-label">Judgements</span>
        <div className="mb-ss-jbar" aria-hidden="true">
          {JUDGEMENTS.map(({ id }) => <i key={id} className={`mb-ss-j-${id}`} style={{ width: `${share(id) ?? 0}%` }} />)}
        </div>
        <div className="mb-ss-jcells">
          {JUDGEMENTS.map(({ id, label }) => (
            <div key={id} className={`mb-ss-jcell mb-ss-j-${id}`}>
              <span>{label}</span>
              <b>{formatCount(counts[id])}</b>
              <small>{formatPercent(share(id))}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="mb-ss-panel mb-ss-tiles mb-ss-six">
        <Tile label="Key presses" note={`${formatCount(stats.emptyPresses)} on empty air`}>{formatCount(stats.presses)}</Tile>
        <Tile label="Holds held" note={`longest ${formatSeconds(stats.longestHoldMs)}`}>{formatDuration(stats.holdMs)}</Tile>
        <Tile label="Best combo" note={stats.bestCombo?.title || "—"}>{stats.bestCombo ? formatCount(stats.bestCombo.value) : "—"}</Tile>
        <Tile label="Full combos" note={`of ${formatCount(stats.plays)} plays`} className="mb-ss-fc">{formatCount(stats.fullCombos)}</Tile>
        <Tile label="FEVERs" note={stats.plays > 0 ? `${(stats.fevers / stats.plays).toFixed(1)} per play` : "—"}>{formatCount(stats.fevers)}</Tile>
        <Tile label="Time played" note={`${formatCount(stats.songs)} songs`}>{formatDuration(stats.playMs)}</Tile>
      </div>
      <div className="mb-ss-two">
        <div className="mb-ss-panel mb-ss-block">
          <h3>Timing</h3>
          <div className="mb-ss-timing">
            <div className="mb-ss-tbig">{formatOffsetMs(timing.meanMs)}<small>{timingWord(timing.meanMs)}</small></div>
            <div className="mb-ss-tline" aria-hidden="true">
              {band ? <i style={{ left: `${band.left}%`, width: `${band.width}%` }} /> : null}
              <u />
            </div>
            <div className="mb-ss-tscale" aria-hidden="true"><span>early</span><span>0</span><span>late</span></div>
            <div className="mb-ss-trow"><span>Spread</span><em>{Number.isFinite(timing.spreadMs) ? `±${Math.round(timing.spreadMs)} ms` : "—"}</em></div>
            <div className="mb-ss-trow"><span>Early hits</span><em>{share100(timing.earlyShare)}</em></div>
            <div className="mb-ss-trow"><span>Late hits</span><em>{share100(timing.lateShare)}</em></div>
          </div>
        </div>
        <Block title="Max combo by map" empty={stats.maps.length ? null : "No maps played yet."}>
          {stats.maps.map((map) => (
            <div key={`${map.audioKey}|${map.difficulty}`} className="mb-ss-line">
              <Cover row={{ title: map.title }} className="mb-ss-cv" />
              <span className="mb-ss-tt">
                <b>{map.title}</b>
                <small className={`mb-ss-d-${map.difficulty}`}><span className="mb-ss-dl">{difficultyLabel(map.difficulty)}</span></small>
              </span>
              <span className={`mb-ss-val${map.fullCombo ? " mb-ss-fc" : ""}`}>
                {formatCount(map.maxCombo)}
                <small>{map.fullCombo ? "full combo" : `of ${formatCount(map.parts)}`}</small>
              </span>
            </div>
          ))}
        </Block>
      </div>
    </>
  );
}

// The left side of the Solo song select while no song is picked: a player's Profile or Stats, or the Ranking.
// userId is null for your own, or another player's id when you opened theirs; ownUserId is yours, to light your row
// in the ranking. onOpenPlayer(id, from) opens a player; from names the tab "← Your profile" returns to. The ranking's
// scope is held by the caller, so it is still chosen when the ranking comes back.
export default function PlayerPanel({ request, tab, userId, ownUserId, rankingScope, onRankingScope, onTab, onBack, onOpenPlayer }) {
  const viewing = userId !== null && userId !== undefined;
  const shownTab = viewing && tab === "ranking" ? "profile" : tab;
  const ranking = shownTab === "ranking";
  const type = shownTab === "stats" ? "mewbeat_stats" : "mewbeat_profile";
  const [state, retry] = useReply(request, type, ranking ? null : viewing ? { userId } : {});
  const View = shownTab === "stats" ? Stats : Profile;
  return (
    <>
      <ModeBar tab={shownTab} viewing={viewing} name={state.reply?.player?.username} onTab={onTab} onBack={onBack} />
      {ranking ? <RankingPanel request={request} userId={ownUserId} scope={rankingScope} onScope={onRankingScope} onOpenPlayer={(id) => onOpenPlayer(id, "ranking")} /> : null}
      {!ranking && state.status === "ready" ? <View reply={state.reply} /> : null}
      {!ranking && state.status !== "ready"
        ? <Notice state={state} retry={retry} loading={shownTab === "stats" ? "Loading stats…" : "Loading profile…"} failed={shownTab === "stats" ? "Couldn't load the stats." : "Couldn't load the profile."} />
        : null}
    </>
  );
}
