import { MagnifyingGlass, Play, Plus, Sparkle, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchActivity } from "../api.js";
import { describeLinkError, describeLinkNote, describePlayIssue, listedTracks, playIssueOf } from "./searchResults.js";
import LevelBoard from "./LevelBoard.jsx";
import ModifierPicker from "./ModifierPicker.jsx";
import PlayerPanel from "./PlayerPanel.jsx";
import { scopesFor, usePrivatePlace } from "./placeContext.js";
import { arrangeRows } from "./songList.js";
import "./songSelect.css";

export const DIFFICULTIES = [
  { id: "easy", label: "Easy" },
  { id: "normal", label: "Normal" },
  { id: "hard", label: "Hard" },
  { id: "hell", label: "Hell" },
];

const SCOPES = [
  { id: "server", label: "This server" },
  { id: "global", label: "Everywhere" },
  { id: "mine", label: "Played by you" },
];

const SORTS = [
  { id: "recent", label: "Recent" },
  { id: "stars", label: "Stars" },
  { id: "bpm", label: "BPM" },
  { id: "length", label: "Length" },
  { id: "plays", label: "Plays" },
  { id: "title", label: "Title" },
];

const FILTERS = [
  { id: "all", label: "All" },
  { id: "played", label: "Played" },
  { id: "unplayed", label: "Not played" },
];

const HEAD_LABELS = { easy: "EZ", normal: "NM", hard: "HD", hell: "HL" };

const EMPTY_COPY = {
  server: "No songs played here yet — search for one",
  global: "No songs played yet — search for one",
  mine: "You haven't played anything yet — search for a song",
};

const PLAYED_LIMIT = 500;
const MIN_QUERY = 2;
const SEARCH_DEBOUNCE_MS = 300;
const STARS_FULL_BAR = 8; // the stars value where a difficulty bar is full
const PREVIEW_DEBOUNCE_MS = 700; // browsing with the arrows doesn't start a preview per row

// Server reasons from mewbeat_solo_prepare, as short copy. Anything else (timeouts, no socket) is already text.
const PREPARE_ERRORS = {
  bad_uri: "That song link isn't valid.",
  bad_source: "That source isn't supported.",
  resolve_failed: "Couldn't load that song. Try another one.",
  not_found: "Couldn't find that song.",
  unsupported: "Live streams can't be played.",
  stream: "Live streams can't be played.",
  too_long: "Songs over 20 minutes can't be played.",
};

export function describePrepareError(error) {
  const reason = typeof error === "string" ? error : error?.message;
  return PREPARE_ERRORS[reason] ?? (reason || "That song can't be played here.");
}

// "Chart this map": asked again every few seconds, for a few minutes at most.
export const CHART_POLL_MS = 4000;
export const CHART_POLL_MAX_MS = 5 * 60_000;

// Server reasons from mewbeat_chart_map (the prepare reasons above apply too).
const CHART_ERRORS = {
  too_many: "You already have 3 songs being charted. Wait for one to finish.",
  busy: "The charting queue is full right now. Try again in a minute.",
  uncharted: "This song can't be charted (there is no music to follow in it).",
  failed: "Charting this song failed.",
  too_long: "Songs over 20 minutes can't be charted.",
  timeout: "Charting is taking longer than expected. Try again later.",
};

export function describeChartError(reason) {
  return CHART_ERRORS[reason] ?? PREPARE_ERRORS[reason] ?? (typeof reason === "string" && reason ? reason : CHART_ERRORS.failed);
}

// What a finished "chart this map" adds to a row: its audio key, the stars per level and the player's bests.
export function chartedFields(reply) {
  const stats = reply?.stats;
  if (!stats) return null;
  const stars = {};
  const bests = {};
  for (const { id } of DIFFICULTIES) {
    stars[id] = Number.isFinite(stats[id]?.stars) ? stats[id].stars : null;
    if (stats[id]?.best) bests[id] = stats[id].best;
  }
  if (Object.values(stars).every((value) => value === null)) return null;
  return { ...(reply.audioKey ? { audioKey: reply.audioKey } : null), stars, bests };
}

// What the song-select shows for the preview of a song, from what onPreview resolved: true (it plays), { error } (it
// could not, the reason goes in the chip's tooltip) or anything else (it was replaced or stopped: nothing to show).
export function previewState(key, result) {
  if (result === true) return { key, playing: true };
  if (result && typeof result === "object" && "error" in result) return { key, playing: false, error: String(result.error || "The preview could not be played.") };
  return null;
}

export function formatLength(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function starsOf(row, difficulty) {
  const value = row?.stars?.[difficulty];
  return Number.isFinite(value) ? value : null;
}

export function gradeClass(grade) {
  return `mb-ss-grade-${["S", "A", "B", "C"].includes(grade) ? grade : "D"}`;
}

// One difficulty tile: name, stars with a bar, optionally the note count, and the player's best. Solo renders it as a
// button (or a static div), the room lobby as a button that only picks which board to look at. `notes` shows the line
// only when given (null reads "—"); `tag` adds a small chip, `className` and the rest go on the root.
export function LevelTile({ as: Tag = "div", id, label, stars = null, best = null, notes, tag, className = "", children, ...props }) {
  return (
    <Tag {...props} className={`mb-ss-diff mb-ss-d-${id}${className ? ` ${className}` : ""}`}>
      <b>{label}</b>
      <small>{stars === null ? "—" : `★ ${stars.toFixed(1)}`}</small>
      <span className="mb-ss-bar" aria-hidden="true"><i style={{ width: `${stars === null ? 0 : Math.min(100, (stars / STARS_FULL_BAR) * 100)}%` }} /></span>
      {notes !== undefined ? <small className="mb-ss-notes">{notes === null ? "—" : `${notes} notes`}</small> : null}
      <small className="mb-ss-best">{best ? <><b className={gradeClass(best.grade)}>{best.grade}</b> {best.score.toLocaleString("en-US")}</> : "no score yet"}</small>
      {tag ? <span className="mb-ss-diff-tag">{tag}</span> : null}
      {children}
    </Tag>
  );
}

// Artwork goes through the gateway's artwork proxy like the music panel's (Discord's CSP blocks other origins).
// size ("small" for list rows, "medium" for a detail cover) asks the proxy for a smaller image where the host has one.
export function resolveArtworkUrl(artworkUrl, size = "") {
  if (!artworkUrl) return null;
  try {
    const parsed = new URL(artworkUrl, window.location.origin);
    if (["data:", "blob:"].includes(parsed.protocol) || parsed.origin === window.location.origin) return parsed.toString();
    return `/api/activity/artwork?url=${encodeURIComponent(parsed.toString())}${size === "small" || size === "medium" ? `&size=${size}` : ""}`;
  } catch {
    return null;
  }
}

export function hueOf(text) {
  let hash = 0;
  for (const char of String(text ?? "")) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

// size asks the artwork proxy for a smaller image; box (px) is the cover's displayed size, so the page does not
// reflow when it arrives.
export function Cover({ row, className, size = "", box }) {
  const src = resolveArtworkUrl(row.artworkUrl, size);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (src && !failed) return <img className={className} src={src} alt="" width={box} height={box} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />;
  const hue = hueOf(row.title);
  return <span className={className} style={{ background: `linear-gradient(135deg, hsl(${hue} 80% 55%), hsl(${(hue + 60) % 360} 70% 22%))` }} aria-hidden="true" />;
}

// Played-list entries and search results as one row shape.
function playedRow(track) {
  return {
    key: track.audioKey ?? track.uri,
    audioKey: track.audioKey ?? null, // what the level leaderboard asks for
    uri: track.uri,
    source: track.source,
    title: track.title ?? "Unknown title",
    artist: track.artist ?? "",
    artworkUrl: track.artworkUrl ?? null,
    durationMs: track.durationMs ?? 0,
    bpm: track.bpm ?? null,
    plays: track.plays ?? null,
    playsBy: track.playsBy ?? {},
    stars: track.stars ?? null,
    bests: track.bests ?? {},
    highlightMs: track.highlightMs ?? null,
    playIssue: null,
  };
}

function searchRow(track) {
  return {
    key: track.uri,
    audioKey: track.audioKey ?? null, // the bot knows it for every playable result; the leaderboard asks for it
    uri: track.uri,
    source: track.source,
    title: track.title ?? "Unknown title",
    artist: track.author ?? "",
    artworkUrl: track.artworkUrl ?? null,
    durationMs: track.durationMs ?? 0,
    bpm: null,
    plays: null,
    playsBy: {},
    stars: track.stars ?? null, // set when the song already has charts
    bests: {},
    highlightMs: null,
    playIssue: playIssueOf(track), // a live stream or a song over the length limit is listed, and cannot be played
  };
}

// The Solo picker's left side sits in one column that fills the section; the room's window keeps its own layout.
function ProfileColumn({ wrap, children }) {
  return wrap ? <div className="mb-ss-left">{children}</div> : children;
}

// One level's column in a song row: the stars in the level's colour, the player's best grade beneath.
function LevelCell({ row, id, label }) {
  const stars = starsOf(row, id);
  const best = row.bests?.[id];
  return (
    <span className={`mb-ss-lv mb-ss-d-${id}${stars === null ? " mb-ss-lv-none" : ""}`} title={`${label}${best ? ` · best ${best.grade}` : ""}`}>
      <b>{stars === null ? "—" : stars.toFixed(1)}</b>
      <i className={best ? gradeClass(best.grade) : undefined}>{best ? best.grade : ""}</i>
    </span>
  );
}

// "2:36 · 240 BPM"; either part is left out when the song doesn't have it.
function rowMeta(row) {
  return [formatLength(row.durationMs), describePlayIssue(row.playIssue), Number.isFinite(row.bpm) ? `${Math.round(row.bpm)} BPM` : ""].filter(Boolean).join(" · ");
}

// One song in the list. A pick or a state push re-renders only the rows whose own props changed (up to 500 rows):
// the handlers are stable, and `on` and `preparing` say what the row needs from the screen's state.
const SongRow = memo(function SongRow({ row, on, preparing, onPick, onPrimary }) {
  return (
    <div
      role="option"
      aria-selected={on}
      className={`mb-ss-row${on ? " mb-ss-row-on" : ""}${row.playIssue ? " mb-ss-row-blocked" : ""}`}
      onClick={() => onPick(row)}
      onDoubleClick={() => { onPick(row); onPrimary(); }}
    >
      <Cover row={row} className="mb-ss-art" size="small" box={44} />
      <span className="mb-ss-info">
        <b>{row.title}</b>
        <small>{row.artist}</small>
        {preparing ? <span className="mb-ss-meta mb-ss-preparing">Preparing…</span> : <span className="mb-ss-meta">{rowMeta(row)}</span>}
      </span>
      {DIFFICULTIES.map(({ id, label }) => <LevelCell key={id} row={row} id={id} label={label} />)}
    </div>
  );
});

// The song-select screen: what the server has played (this server or anywhere) or a search over every source,
// then a song's difficulties and Play. onPlay(row, difficulty) returns a promise that rejects with the reason
// the song can't be played; onAddToRoom(row), when given, adds an "Add to room queue" button.
// Without onPlay (picking songs for a room) adding is the main action: Enter and a double click add, the
// picker stays open for more, and a rejection's message is shown. The levels only inform there: each player
// picks theirs in the lobby. onPreview(row), when given, previews the song
// the player picked and resolves whether it plays; onPreview(null) stops it.
// With player ({ userId }, only the Solo picker passes it) the left side is the player's Profile and Stats until
// a song is picked, and a picked song shows its leaderboard; without it (the room's add-songs window) the left
// side is the song's details alone.
// onUnlockAudio(), when given, runs synchronously inside the click or key press that picks a row: the browser only lets
// audio start from a gesture, and the preview itself comes a moment later, from a timer.
export default function SongSelect({ context, request, player, defaultDifficulty = "normal", onPlay, onAddToRoom, onPreview, onUnlockAudio, onClose, onSelected, startSelectedKey = null, modifiers = [], onModifiers, onModifiersOpen }) {
  const isPrivate = usePrivatePlace();
  const [scope, setScope] = useState(isPrivate ? "global" : "server");
  const [query, setQuery] = useState("");
  const [played, setPlayed] = useState({ status: "loading", rows: [] });
  const [found, setFound] = useState({ status: "idle", rows: [], link: null }); // link: what a pasted link was (the server's answer)
  const [reload, setReload] = useState(0);
  const [selectedKey, setSelectedKey] = useState(startSelectedKey); // the first-run tour opens with its sample song picked
  const [difficulty, setDifficulty] = useState(DIFFICULTIES.some((d) => d.id === defaultDifficulty) ? defaultDifficulty : "normal");
  const [preparing, setPreparing] = useState(null); // the row key being prepared
  const [playError, setPlayError] = useState(null);
  const [addedNote, setAddedNote] = useState(null); // confirmation after a song went into the room queue
  const [previewing, setPreviewing] = useState(null); // { key, playing, error? } of the song being previewed
  // "Chart this map": { id, row: { key, audioKey, uri, source }, status: "running" | "error", error?, startedAt, retry }
  // for the song being charted, and what finished jobs added to rows (key -> { audioKey, stars, bests }).
  const [chartJob, setChartJob] = useState(null);
  const [charted, setCharted] = useState({});
  const [sort, setSort] = useState("recent");
  const [direction, setDirection] = useState("desc");
  const [filter, setFilter] = useState("all");
  const [level, setLevel] = useState(difficulty); // the level the sort and the filters look at
  // What the left side shows while no song is picked. userId null is yourself; picking a song leaves this alone,
  // so "← Profile" comes back to what was there. from is the tab another player's profile was opened from, where
  // "← Your profile" returns to.
  const [leftView, setLeftView] = useState({ tab: "profile", userId: null, from: "profile" });
  const [rankingScope, setRankingScope] = useState("global"); // kept here, so it survives opening a player from the ranking
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    inputRef.current?.focus();
    return () => { mountedRef.current = false; };
  }, []);

  // Settings can change the default while this screen is up.
  useEffect(() => {
    if (DIFFICULTIES.some((d) => d.id === defaultDifficulty)) setDifficulty(defaultDifficulty);
  }, [defaultDifficulty]);

  // The Level select follows the difficulty tile; changing the select leaves the tile alone.
  useEffect(() => setLevel(difficulty), [difficulty]);

  const text = query.trim();
  const searching = text.length >= MIN_QUERY;

  // The played list for the chosen scope.
  useEffect(() => {
    let cancelled = false;
    setPlayed({ status: "loading", rows: [] });
    Promise.resolve()
      .then(() => request("mewbeat_played", { scope, limit: PLAYED_LIMIT }))
      .then((reply) => {
        if (cancelled) return;
        if (reply.status === "error" || !Array.isArray(reply.tracks)) setPlayed({ status: "error", rows: [] });
        else setPlayed({ status: "ready", rows: reply.tracks.filter((track) => track?.uri).map(playedRow) });
      })
      .catch(() => { if (!cancelled) setPlayed({ status: "error", rows: [] }); });
    return () => { cancelled = true; };
  }, [request, scope, reload]);

  // The server's song search (a pasted link included), debounced. Streams and songs over the length limit are listed
  // and marked; they can't be played or charted.
  useEffect(() => {
    if (!searching) {
      setFound({ status: "idle", rows: [] });
      return undefined;
    }
    const controller = new AbortController();
    setFound({ status: "searching", rows: [] });
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchActivity({ ...context, query: text, game: true, signal: controller.signal });
        const rows = listedTracks(response).map(searchRow);
        setFound({ status: rows.length ? "ready" : "empty", rows, link: response.link ?? null });
      } catch {
        if (!controller.signal.aborted) setFound({ status: "error", rows: [] });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // The context object is rebuilt on every App render; only the credentials matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, searching, context?.guildId, context?.accessToken]);

  // Rows whose charts were made here get their stars, bests and audio key (other rows keep their identity).
  const withCharts = useCallback((list) => (Object.keys(charted).length ? list.map((row) => (charted[row.key] ? { ...row, ...charted[row.key] } : row)) : list), [charted]);
  const playedRows = useMemo(() => withCharts(played.rows), [withCharts, played.rows]);
  const foundRows = useMemo(() => withCharts(found.rows), [withCharts, found.rows]);
  const arranged = useMemo(() => arrangeRows(playedRows, { sort, level, direction, filter }), [playedRows, sort, level, direction, filter]);
  const list = searching ? found : played;
  // A search keeps the order it came in; the tools only arrange the played list.
  const rows = searching ? foundRows : arranged;
  // No list picks a song by itself: the details, the preview and Play wait for the player's pick. It is looked up in
  // every row, so a level or filter that hides the song from the list does not drop it.
  const selected = useMemo(() => (searching ? foundRows : playedRows).find((row) => row.key === selectedKey) ?? null, [searching, foundRows, playedRows, selectedKey]);

  // The charting of the picked song: asks the bot now and then (the request answers "queued" until the stars are
  // there). It stops when the player picks another song, after a few minutes, and on the first error.
  const activeKey = selected?.key ?? null;
  useEffect(() => {
    if (!chartJob || chartJob.status !== "running" || chartJob.row.key !== activeKey) return undefined;
    let cancelled = false;
    let timer = null;
    const fail = (error) => setChartJob((job) => (job?.id === chartJob.id ? { ...job, status: "error", error } : job));
    const ask = async (retry) => {
      let reply;
      try {
        const { audioKey, uri, source } = chartJob.row;
        reply = await request("mewbeat_chart_map", { uri, source, ...(audioKey ? { audioKey } : null), ...(retry ? { retry: true } : null) });
      } catch (error) {
        reply = { status: "error", reason: error?.message };
      }
      if (cancelled) return;
      if (reply?.status === "ok" && reply.state === "ready") {
        const fields = chartedFields(reply);
        if (!fields) return fail(describeChartError("failed"));
        setCharted((current) => ({ ...current, [chartJob.row.key]: fields }));
        setChartJob((job) => (job?.id === chartJob.id ? null : job));
      } else if (reply?.status === "ok") {
        if (Date.now() - chartJob.startedAt > CHART_POLL_MAX_MS) fail(describeChartError("timeout"));
        else timer = window.setTimeout(() => ask(false), CHART_POLL_MS);
      } else {
        fail(describeChartError(reply?.reason));
      }
    };
    ask(chartJob.retry);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [chartJob, activeKey, request]);

  const startChart = useCallback((row, retry = false) => {
    setChartJob({ id: Date.now(), row: { key: row.key, audioKey: row.audioKey, uri: row.uri, source: row.source }, status: "running", startedAt: Date.now(), retry });
  }, []);
  // The minimized window shows the selected song.
  useEffect(() => {
    onSelected?.(selected ? { title: selected.title, artist: selected.artist, artworkUrl: selected.artworkUrl } : null);
  }, [selected?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new order or filter can move the selected row out of sight; it comes back into view if it is still listed.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [selected?.key, sort, level, direction, filter]);

  const previewRow = (onPlay && preparing !== null) || selected?.playIssue ? null : selected;
  const previewRowRef = useRef(previewRow);
  previewRowRef.current = previewRow;
  const previewKey = previewRow?.key ?? null;
  useEffect(() => {
    if (!onPreview || previewKey === null) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPreviewing({ key: previewKey, playing: false });
      Promise.resolve()
        .then(() => onPreview(previewRowRef.current))
        .then((result) => { if (!cancelled) setPreviewing(previewState(previewKey, result)); })
        .catch((error) => { if (!cancelled) setPreviewing(previewState(previewKey, { error: error?.message })); });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setPreviewing(null);
      onPreview(null);
    };
  }, [previewKey, onPreview]);

  const unlockRef = useRef(onUnlockAudio);
  unlockRef.current = onUnlockAudio;
  const select = useCallback((row) => {
    try { unlockRef.current?.(); } catch { /* a blocked context shows up as a failed preview */ }
    setSelectedKey(row.key);
    setPlayError(null);
    setAddedNote(null);
  }, []);

  const move = (step) => {
    if (!rows.length) return;
    const index = rows.findIndex((row) => row.key === selected?.key);
    select(rows[index < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, index + step))]);
  };

  const play = useCallback(async () => {
    if (!selected || preparing) return;
    if (selected.playIssue) {
      setPlayError(describePrepareError(selected.playIssue));
      return;
    }
    setPreparing(selected.key);
    setPlayError(null);
    try {
      await onPlay(selected, difficulty);
    } catch (error) {
      if (mountedRef.current) setPlayError(describePrepareError(error));
    } finally {
      if (mountedRef.current) setPreparing(null);
    }
  }, [selected, preparing, onPlay, difficulty]);

  const addToRoom = useCallback(async () => {
    if (!selected || preparing || !onAddToRoom) return;
    if (selected.playIssue) {
      setPlayError(describePrepareError(selected.playIssue));
      return;
    }
    setPreparing(selected.key);
    setPlayError(null);
    setAddedNote(null);
    try {
      await onAddToRoom(selected);
      if (mountedRef.current) setAddedNote(`Added "${selected.title}" to the room queue.`);
    } catch (error) {
      if (mountedRef.current) setPlayError(describePrepareError(error));
    } finally {
      if (mountedRef.current) setPreparing(null);
    }
  }, [selected, preparing, onAddToRoom]);
  const primary = onPlay ? play : addToRoom;
  // The rows get this one function for good: a double click runs whatever the latest render's primary action is.
  const primaryRef = useRef(primary);
  primaryRef.current = primary;
  const runPrimary = useCallback(() => primaryRef.current(), []);

  // The game's keys are paused while this screen is up, so typing reaches the search box.
  const onKeyDown = (event) => {
    const isSelect = event.target instanceof HTMLElement && event.target.tagName === "SELECT"; // a select keeps its own keys
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !isSelect) {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && !isSelect && !(event.target instanceof HTMLElement && event.target.tagName === "BUTTON")) {
      event.preventDefault();
      primary();
    }
  };

  // Typing leaves the picked song behind: its details and its preview go with it.
  const changeQuery = (next) => {
    setQuery(next);
    if (next.trim() === text) return;
    setSelectedKey(null);
    setPlayError(null);
    setAddedNote(null);
  };

  const pickScope = (id) => {
    setQuery("");
    setScope(id);
    setSelectedKey(null);
    setPlayError(null);
    setAddedNote(null);
  };

  let emptyCopy = null;
  if (list.status === "loading" || list.status === "searching" || (searching && list.status === "idle")) emptyCopy = searching ? "Searching…" : "Loading songs…";
  else if (list.status === "empty") emptyCopy = found.link ? describeLinkError(found.link) : "No songs found.";
  else if (list.status === "error") emptyCopy = searching ? "Search failed." : "Couldn't load the played songs.";
  else if (!rows.length && !searching && played.rows.length) emptyCopy = "No songs match this filter.";
  else if (!rows.length) emptyCopy = EMPTY_COPY[scope];

  // A leaderboard or ranking row opens that player's profile. Your own row opens yours. Clearing the selection
  // also stops the preview, through the effect on previewKey.
  const openPlayer = (userId, from = "profile") => {
    setLeftView({ tab: "profile", userId: userId === player?.userId ? null : userId, from });
    setSelectedKey(null);
  };

  // Title reads from A down; every other sort starts with the most.
  const pickSort = (next) => {
    if (next === sort) return;
    if (next === "title") setDirection("asc");
    else if (sort === "title") setDirection("desc");
    setSort(next);
  };

  const selectedStars = starsOf(selected, difficulty);
  const uncharted = Boolean(selected) && !selected.playIssue && DIFFICULTIES.every(({ id }) => starsOf(selected, id) === null);
  const ownJob = chartJob && chartJob.row.key === selected?.key ? chartJob : null;
  const chartRunning = ownJob?.status === "running";
  const chartError = ownJob?.status === "error" ? ownJob.error : null;
  const selectedBest = selected?.bests?.[difficulty] ?? null;
  const busy = preparing !== null;
  const Tile = onPlay ? "button" : "div";

  return (
    <div className="mb-ss" role="group" aria-label="Song select" onKeyDown={onKeyDown}>
      <section className="mb-ss-detail">
        {onClose ? (
          <div className="mb-ss-top">
            <button type="button" className="mb-btn mb-ss-close" onClick={onClose}>Close <kbd className="mb-kbd">Esc</kbd></button>
          </div>
        ) : null}
        <ProfileColumn wrap={Boolean(player)}>
        {selected ? (
          <>
            {player ? (
              <div className="mb-ss-mode">
                <span className="mb-ss-label">Selected song</span>
                <button type="button" className="mb-ss-back" onClick={() => setSelectedKey(null)}>← Profile</button>
              </div>
            ) : null}
            <div className="mb-ss-hero" data-tour="track">
              <Cover row={selected} className="mb-ss-cover" size="medium" />
              <div className="mb-ss-hero-text">
                <span className="mb-ss-label">{selected.plays ? `played ${selected.plays}×` : searching ? "search result" : "song"}</span>
                <h2>{selected.title}</h2>
                <div className="mb-ss-artist">{selected.artist}</div>
                <div className="mb-ss-chips">
                  {selected.durationMs ? <span className="mb-ss-chip">{formatLength(selected.durationMs)}</span> : null}
                  {player && selected.bpm ? <span className="mb-ss-chip">{Math.round(selected.bpm)} BPM</span> : null}
                  {selected.source ? <span className="mb-ss-chip">{selected.source}</span> : null}
                  {selected.playIssue ? <span className="mb-ss-chip mb-ss-chip-blocked" role="status">{describePlayIssue(selected.playIssue)}: can't be played</span> : null}
                  {previewing?.key === selected.key ? (
                    previewing.error ? (
                      <span className="mb-ss-chip mb-ss-chip-unavailable" role="status" title={previewing.error}>
                        <SpeakerSlash size={12} weight="fill" aria-hidden="true" />
                        Preview unavailable
                      </span>
                    ) : (
                      <span className={`mb-ss-chip mb-ss-chip-preview${previewing.playing ? " mb-ss-chip-preview-on" : ""}`} role="status">
                        <SpeakerHigh size={12} weight="fill" aria-hidden="true" />
                        {previewing.playing ? "Preview" : "Loading preview…"}
                      </span>
                    )
                  ) : null}
                </div>
              </div>
            </div>
            <div className="mb-ss-diffs" data-tour="diff" role={onPlay ? "radiogroup" : undefined} aria-label={onPlay ? "Difficulty" : undefined}>
              {DIFFICULTIES.map(({ id, label }) => {
                return (
                  <LevelTile
                    key={id}
                    as={Tile}
                    id={id}
                    label={label}
                    stars={starsOf(selected, id)}
                    best={selected.bests?.[id]}
                    {...(onPlay ? { type: "button", role: "radio", "aria-checked": difficulty === id, disabled: busy, onClick: () => setDifficulty(id) } : null)}
                    className={!onPlay ? "mb-ss-diff-static" : difficulty === id ? "mb-ss-diff-on" : ""}
                  />
                );
              })}
            </div>
            {/* A song with no stars gets the chart button; with the leaderboard below, the note has nothing else to say. */}
            {uncharted && request ? (
              <div className="mb-ss-chart" data-tour="chart">
                <button
                  type="button"
                  className="mb-btn mb-ss-chart-btn"
                  disabled={chartRunning}
                  aria-busy={chartRunning || undefined}
                  onClick={() => startChart(selected, Boolean(chartError))}
                >
                  {chartRunning ? <><span className="mb-ss-spin" aria-hidden="true" />Charting…</> : <><Sparkle size={14} weight="fill" aria-hidden="true" />{chartError ? "Try again" : "Chart this map"}</>}
                </button>
                {chartError ? (
                  <p className="mb-ss-error" role="alert">{chartError}</p>
                ) : (
                  <p className="mb-ss-note" role="status">{chartRunning ? "Charting this map. It takes about half a minute; the stars appear here when it is done." : "Not charted yet. Charting takes about half a minute."}</p>
                )}
              </div>
            ) : player && selectedStars !== null ? null : (
              <p className="mb-ss-note">
                {selected.playIssue ? describePrepareError(selected.playIssue) : !onPlay ? "Each player picks their level in the lobby." : selectedStars === null ? "Levels are charted the first time you play this song." : selectedBest ? "Your best is on the server board." : "Beat it to get on the board."}
              </p>
            )}
            {player ? (
              <>
                {/* The picker only shows where the caller keeps the choice. */}
                {onModifiers ? <ModifierPicker value={modifiers} onChange={onModifiers} mode="solo" onOpenChange={onModifiersOpen} /> : null}
                <LevelBoard request={request} audioKey={selected.audioKey} difficulty={difficulty} userId={player.userId} onOpenPlayer={openPlayer} tour="board" />
              </>
            ) : null}
          </>
        ) : player ? (
          <PlayerPanel
            request={request}
            tab={leftView.tab}
            userId={leftView.userId}
            ownUserId={player.userId}
            onTab={(tab) => setLeftView((view) => ({ ...view, tab }))}
            onBack={() => setLeftView((view) => ({ tab: view.from, userId: null, from: "profile" }))}
            rankingScope={rankingScope}
            onRankingScope={setRankingScope}
            onOpenPlayer={openPlayer}
          />
        ) : (
          <div className="mb-ss-placeholder">
            <b>{searching ? "Pick a result" : "Pick a song"}</b>
            <span>{searching ? "Click a song to see its levels and hear a preview." : "Choose one that was played, or search above."}</span>
          </div>
        )}
        </ProfileColumn>
      </section>

      <aside className="mb-ss-list" data-tour="list">
        <div className="mb-ss-tabs" role="tablist" aria-label="Songs">
          {scopesFor(SCOPES, isPrivate).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={!searching && scope === id}
              className={`mb-ss-tab${!searching && scope === id ? " mb-ss-tab-on" : ""}`}
              onClick={() => pickScope(id)}
            >
              {label}
            </button>
          ))}
          {searching ? <span className="mb-ss-tab mb-ss-tab-on mb-ss-tab-static">Search results</span> : null}
        </div>
        <label className="mb-ss-search">
          <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Search a song, or paste a link…"
            aria-label="Search for a song"
            autoComplete="off"
            onChange={(event) => changeQuery(event.target.value)}
          />
        </label>

        {!searching ? (
          <div className="mb-ss-tools">
            <label className="mb-ss-select">
              <small>Sort</small>
              <select aria-label="Sort by" value={sort} onChange={(event) => pickSort(event.target.value)}>
                {SORTS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className={`mb-ss-select mb-ss-d-${level}`} title="Which level the sort and the filters look at">
              <small>Level</small>
              <select aria-label="Level for sorting and filtering" value={level} onChange={(event) => setLevel(event.target.value)}>
                {DIFFICULTIES.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className="mb-ss-select">
              <small>Filter</small>
              <select aria-label="Filter songs" value={filter} onChange={(event) => setFilter(event.target.value)}>
                {FILTERS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="mb-ss-dir"
              aria-label={direction === "desc" ? "Descending, switch to ascending" : "Ascending, switch to descending"}
              onClick={() => setDirection((current) => (current === "desc" ? "asc" : "desc"))}
            >
              {direction === "desc" ? "↓" : "↑"}
            </button>
          </div>
        ) : null}

        <div className="mb-ss-rows" ref={listRef} role="listbox" aria-label={searching ? "Search results" : "Played songs"}>
          {emptyCopy ? (
            <div className={`mb-ss-empty${list.status === "error" ? " mb-ss-empty-error" : ""}`} role={list.status === "error" ? "alert" : "status"}>
              <span>{emptyCopy}</span>
              {list.status === "error" && !searching ? <button type="button" className="mb-btn" onClick={() => setReload((n) => n + 1)}>Try again</button> : null}
            </div>
          ) : null}
          {!searching && rows.length ? (
            <div className="mb-ss-head" aria-hidden="true">
              <span />
              <span />
              {DIFFICULTIES.map(({ id }) => <span key={id} className={`mb-ss-d-${id}`}>{HEAD_LABELS[id]}</span>)}
            </div>
          ) : null}
          {searching && list.status === "ready" && describeLinkNote(found.link, rows.length) ? <p className="mb-ss-note mb-ss-linknote">{describeLinkNote(found.link, rows.length)}</p> : null}
          {rows.map((row) => (
            <SongRow key={row.key} row={row} on={row.key === selected?.key} preparing={preparing === row.key} onPick={select} onPrimary={runPrimary} />
          ))}
        </div>

        <div className="mb-ss-actions">
          {playError ? <p className="mb-ss-error" role="alert">{playError}</p> : null}
          {addedNote ? <p className="mb-ss-added" role="status">{addedNote}</p> : null}
          {onPlay ? (
            <button type="button" className="mb-btn mb-btn-primary mb-ss-play" disabled={!selected || busy || Boolean(selected?.playIssue)} onClick={play}>
              <Play size={16} weight="fill" aria-hidden="true" />
              {busy ? "Preparing…" : <>Play{selected ? <small>{DIFFICULTIES.find((d) => d.id === difficulty)?.label}</small> : null}</>}
            </button>
          ) : null}
          {onAddToRoom ? (
            <button type="button" className={`mb-btn mb-ss-add${onPlay ? "" : " mb-btn-primary"}`} disabled={!selected || busy || Boolean(selected?.playIssue)} onClick={addToRoom}>
              <Plus size={16} weight="bold" aria-hidden="true" />
              {busy && !onPlay ? "Adding…" : "Add to room queue"}
            </button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
