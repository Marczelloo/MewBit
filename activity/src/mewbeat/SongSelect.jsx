import { MagnifyingGlass, Play, Plus, SpeakerHigh } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchActivity } from "../api.js";
import LevelBoard from "./LevelBoard.jsx";
import PlayerPanel from "./PlayerPanel.jsx";
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
const SEARCH_LIMIT = 20;
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
};

export function describePrepareError(error) {
  const reason = typeof error === "string" ? error : error?.message;
  return PREPARE_ERRORS[reason] ?? (reason || "That song can't be played here.");
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

// Artwork goes through the gateway's artwork proxy like the music panel's (Discord's CSP blocks other origins).
export function resolveArtworkUrl(artworkUrl) {
  if (!artworkUrl) return null;
  try {
    const parsed = new URL(artworkUrl, window.location.origin);
    if (["data:", "blob:"].includes(parsed.protocol) || parsed.origin === window.location.origin) return parsed.toString();
    return `/api/activity/artwork?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return null;
  }
}

export function hueOf(text) {
  let hash = 0;
  for (const char of String(text ?? "")) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

export function Cover({ row, className }) {
  const src = resolveArtworkUrl(row.artworkUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (src && !failed) return <img className={className} src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
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
  };
}

function searchRow(track) {
  return {
    key: track.uri,
    audioKey: null, // a search result has no chart yet, so no leaderboard
    uri: track.uri,
    source: track.source,
    title: track.title ?? "Unknown title",
    artist: track.author ?? "",
    artworkUrl: track.artworkUrl ?? null,
    durationMs: track.durationMs ?? 0,
    bpm: null,
    plays: null,
    playsBy: {},
    stars: null,
    bests: {},
    highlightMs: null,
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
  return [formatLength(row.durationMs), Number.isFinite(row.bpm) ? `${Math.round(row.bpm)} BPM` : ""].filter(Boolean).join(" · ");
}

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
export default function SongSelect({ context, request, player, defaultDifficulty = "normal", onPlay, onAddToRoom, onPreview, onClose }) {
  const [scope, setScope] = useState("server");
  const [query, setQuery] = useState("");
  const [played, setPlayed] = useState({ status: "loading", rows: [] });
  const [found, setFound] = useState({ status: "idle", rows: [] });
  const [reload, setReload] = useState(0);
  const [selectedKey, setSelectedKey] = useState(null);
  const [difficulty, setDifficulty] = useState(DIFFICULTIES.some((d) => d.id === defaultDifficulty) ? defaultDifficulty : "normal");
  const [preparing, setPreparing] = useState(null); // the row key being prepared
  const [playError, setPlayError] = useState(null);
  const [addedNote, setAddedNote] = useState(null); // confirmation after a song went into the room queue
  const [previewing, setPreviewing] = useState(null); // { key, playing } of the song being previewed
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

  // Search across every source but Deezer, debounced. Streams can't be charted, so they are left out too.
  useEffect(() => {
    if (!searching) {
      setFound({ status: "idle", rows: [] });
      return undefined;
    }
    const controller = new AbortController();
    setFound({ status: "searching", rows: [] });
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchActivity({ ...context, query: text, signal: controller.signal });
        const rows = (response.tracks || []).filter((track) => track.uri && !track.isStream && track.source !== "deezer").slice(0, SEARCH_LIMIT).map(searchRow);
        setFound({ status: rows.length ? "ready" : "empty", rows });
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

  const arranged = useMemo(() => arrangeRows(played.rows, { sort, level, direction, filter }), [played.rows, sort, level, direction, filter]);
  const list = searching ? found : played;
  // A search keeps the order it came in; the tools only arrange the played list.
  const rows = searching ? found.rows : arranged;
  // No list picks a song by itself: the details, the preview and Play wait for the player's pick. It is looked up in
  // every row, so a level or filter that hides the song from the list does not drop it.
  const selected = useMemo(() => (searching ? found.rows : played.rows).find((row) => row.key === selectedKey) ?? null, [searching, found.rows, played.rows, selectedKey]);

  // A new order or filter can move the selected row out of sight; it comes back into view if it is still listed.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [selected?.key, sort, level, direction, filter]);

  const previewRow = onPlay && preparing !== null ? null : selected;
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
        .then((playing) => { if (!cancelled) setPreviewing(playing ? { key: previewKey, playing: true } : null); })
        .catch(() => { if (!cancelled) setPreviewing(null); });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setPreviewing(null);
      onPreview(null);
    };
  }, [previewKey, onPreview]);

  const select = useCallback((row) => {
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
  else if (list.status === "empty") emptyCopy = "No songs found.";
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
            <div className="mb-ss-hero">
              <Cover row={selected} className="mb-ss-cover" />
              <div className="mb-ss-hero-text">
                <span className="mb-ss-label">{selected.plays ? `played ${selected.plays}×` : searching ? "search result" : "song"}</span>
                <h2>{selected.title}</h2>
                <div className="mb-ss-artist">{selected.artist}</div>
                <div className="mb-ss-chips">
                  {selected.durationMs ? <span className="mb-ss-chip">{formatLength(selected.durationMs)}</span> : null}
                  {player && selected.bpm ? <span className="mb-ss-chip">{Math.round(selected.bpm)} BPM</span> : null}
                  {selected.source ? <span className="mb-ss-chip">{selected.source}</span> : null}
                  {previewing?.key === selected.key ? (
                    <span className={`mb-ss-chip mb-ss-chip-preview${previewing.playing ? " mb-ss-chip-preview-on" : ""}`} role="status">
                      <SpeakerHigh size={12} weight="fill" aria-hidden="true" />
                      {previewing.playing ? "Preview" : "Loading preview…"}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="mb-ss-diffs" role={onPlay ? "radiogroup" : undefined} aria-label={onPlay ? "Difficulty" : undefined}>
              {DIFFICULTIES.map(({ id, label }) => {
                const stars = starsOf(selected, id);
                const best = selected.bests?.[id];
                return (
                  <Tile
                    key={id}
                    {...(onPlay ? { type: "button", role: "radio", "aria-checked": difficulty === id, disabled: busy, onClick: () => setDifficulty(id) } : null)}
                    className={`mb-ss-diff mb-ss-d-${id}${!onPlay ? " mb-ss-diff-static" : difficulty === id ? " mb-ss-diff-on" : ""}`}
                  >
                    <b>{label}</b>
                    <small>{stars === null ? "—" : `★ ${stars.toFixed(1)}`}</small>
                    <span className="mb-ss-bar" aria-hidden="true"><i style={{ width: `${stars === null ? 0 : Math.min(100, (stars / STARS_FULL_BAR) * 100)}%` }} /></span>
                    <small className="mb-ss-best">{best ? <><b className={gradeClass(best.grade)}>{best.grade}</b> {best.score.toLocaleString("en-US")}</> : "no score yet"}</small>
                  </Tile>
                );
              })}
            </div>
            {/* With the leaderboard below, the note only has the uncharted case left to say. */}
            {player && selectedStars !== null ? null : (
              <p className="mb-ss-note">
                {!onPlay ? "Each player picks their level in the lobby." : selectedStars === null ? "Levels are charted the first time you play this song." : selectedBest ? "Your best is on the server board." : "Beat it to get on the board."}
              </p>
            )}
            {player ? (
              <>
                <div className="mb-ss-panel mb-ss-mods" role="group" aria-label="Modifiers">
                  <span className="mb-ss-label">Modifiers</span>
                  {[0, 1, 2, 3].map((slot) => <span key={slot} className="mb-ss-slot">soon</span>)}
                </div>
                <LevelBoard request={request} audioKey={selected.audioKey} difficulty={difficulty} userId={player.userId} onOpenPlayer={openPlayer} />
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

      <aside className="mb-ss-list">
        <div className="mb-ss-tabs" role="tablist" aria-label="Songs">
          {SCOPES.map(({ id, label }) => (
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
            placeholder="Search YouTube, Spotify, Deezer…"
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
          {rows.map((row) => (
            <div
              key={row.key}
              role="option"
              aria-selected={row.key === selected?.key}
              className={`mb-ss-row${row.key === selected?.key ? " mb-ss-row-on" : ""}`}
              onClick={() => select(row)}
              onDoubleClick={() => { select(row); primary(); }}
            >
              <Cover row={row} className="mb-ss-art" />
              <span className="mb-ss-info">
                <b>{row.title}</b>
                <small>{row.artist}</small>
                {preparing === row.key ? <span className="mb-ss-meta mb-ss-preparing">Preparing…</span> : <span className="mb-ss-meta">{rowMeta(row)}</span>}
              </span>
              {DIFFICULTIES.map(({ id, label }) => <LevelCell key={id} row={row} id={id} label={label} />)}
            </div>
          ))}
        </div>

        <div className="mb-ss-actions">
          {playError ? <p className="mb-ss-error" role="alert">{playError}</p> : null}
          {addedNote ? <p className="mb-ss-added" role="status">{addedNote}</p> : null}
          {onPlay ? (
            <button type="button" className="mb-btn mb-btn-primary mb-ss-play" disabled={!selected || busy} onClick={play}>
              <Play size={16} weight="fill" aria-hidden="true" />
              {busy ? "Preparing…" : <>Play{selected ? <small>{DIFFICULTIES.find((d) => d.id === difficulty)?.label}</small> : null}</>}
            </button>
          ) : null}
          {onAddToRoom ? (
            <button type="button" className={`mb-btn mb-ss-add${onPlay ? "" : " mb-btn-primary"}`} disabled={!selected || busy} onClick={addToRoom}>
              <Plus size={16} weight="bold" aria-hidden="true" />
              {busy && !onPlay ? "Adding…" : "Add to room queue"}
            </button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
