import { forwardRef, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowBendUpRight,
  ArrowsClockwise,
  Bell,
  CaretRight,
  Check,
  ClockCounterClockwise,
  Cloud,
  DotsSixVertical,
  CopySimple,
  DotsThreeVertical,
  Faders,
  Globe,
  Heart,
  House,
  Keyboard,
  LinkSimple,
  MagnifyingGlass,
  MusicNotes,
  Pause,
  Play,
  Plus,
  Queue,
  Repeat,
  SkipBack,
  Shuffle,
  SkipForward,
  SlidersHorizontal,
  Sparkle,
  SpinnerGap,
  Trash,
  UploadSimple,
  UsersThree,
  VinylRecord,
  SpeakerHigh,
  SpeakerSlash,
  Stop,
  Quotes,
  Subtitles,
  Waveform,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { openExternalLink, setMewbitPresence, setupDiscord } from "./discord.js";
import { connectActivitySocket, fetchActivityState, searchActivity, searchActivityLibrary, searchActivitySimilar, sendActivityAction } from "./api.js";
import { parseMusicLink } from "./musicLink.js";
import { createMockState, createEmptyState, mockSearchResults } from "./mockState.js";
import { clamp, usePlayerPosition } from "./hooks/usePlayerPosition.js";

import ActivityGate from "./views/ActivityGate.jsx";
import Dropdown from "./views/Dropdown.jsx";

const LazyFiltersPanel = lazy(() => import("./views/FiltersPanel.jsx"));
const LazyHomePanel = lazy(() => import("./views/HomePanel.jsx"));
const LazyLyricsPanel = lazy(() => import("./views/LyricsPanel.jsx"));

const SOURCE_NAMES = ["auto", "youtube", "soundcloud", "deezer", "spotify"];
// Mock preview is a dev-only affordance: production builds never render mock
// data or search results, even if someone appends ?mock=1 to the URL.
const MOCK_PREVIEW = import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock");
const MOCK_IDLE_PREVIEW = MOCK_PREVIEW && new URLSearchParams(window.location.search).has("idle");
// Lets us verify the Discord minimized composition at a fixed desktop viewport.
// This is intentionally gated by both DEV and ?mock=1.
const MOCK_COMPACT_PREVIEW = MOCK_PREVIEW && new URLSearchParams(window.location.search).has("compact");
const COMPACT_STATUS_FALLBACKS = [
  "neon ears engaged",
  "the bassline has been peer reviewed",
  "catgirl-approved queue detected",
  "MewBit is judging this transition",
  "algorithmically silly, emotionally loud",
];

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function useBufferedSlider(externalValue, { acknowledgementTolerance = 0, optimisticLockMs = 5000 } = {}) {
  const [value, setValue] = useState(externalValue);
  const valueRef = useRef(externalValue);
  const isAdjustingRef = useRef(false);
  const pendingValueRef = useRef(null);
  const pendingUntilRef = useRef(0);

  useEffect(() => {
    if (isAdjustingRef.current) return;

    const pendingValue = pendingValueRef.current;
    if (pendingValue !== null) {
      if (Math.abs(externalValue - pendingValue) <= acknowledgementTolerance) {
        pendingValueRef.current = null;
      } else if (Date.now() < pendingUntilRef.current) {
        valueRef.current = pendingValue;
        setValue(pendingValue);
        return;
      } else {
        pendingValueRef.current = null;
      }
    }

    valueRef.current = externalValue;
    setValue(externalValue);
  }, [acknowledgementTolerance, externalValue]);

  const begin = useCallback(() => {
    isAdjustingRef.current = true;
  }, []);

  const update = useCallback((nextValue) => {
    const numericValue = Number(nextValue);
    if (!Number.isFinite(numericValue)) return valueRef.current;
    isAdjustingRef.current = true;
    pendingValueRef.current = null;
    valueRef.current = numericValue;
    setValue(numericValue);
    return numericValue;
  }, []);

  const commit = useCallback((nextValue) => {
    const committedValue = nextValue === undefined ? valueRef.current : update(nextValue);
    isAdjustingRef.current = false;
    pendingValueRef.current = committedValue;
    pendingUntilRef.current = Date.now() + optimisticLockMs;
    return committedValue;
  }, [optimisticLockMs, update]);

  return { value, begin, update, commit };
}

function formatQueueEta(queue = [], index = 0) {
  const waitMs = queue.slice(0, Math.max(0, index)).reduce((total, track) => total + Math.max(0, Number(track?.durationMs) || 0), 0);
  return waitMs > 0 ? `In ${formatTime(waitMs)}` : "Up next";
}

function VolumeSlider({ slider, onPreview, onCommit, className = "" }) {
  const [isAdjusting, setIsAdjusting] = useState(false);
  const sliderRef = useRef(null);
  const inputRef = useRef(null);
  const value = Math.round(slider.value);
  const [bubbleLeft, setBubbleLeft] = useState(15);

  const syncBubblePosition = useCallback(() => {
    const sliderElement = sliderRef.current;
    const inputElement = inputRef.current;
    if (!sliderElement || !inputElement) return;

    const sliderRect = sliderElement.getBoundingClientRect();
    const inputRect = inputElement.getBoundingClientRect();
    if (!sliderRect.width || !inputRect.width) return;

    // Native range thumbs travel inside the track, not from one outer edge to
    // the other. Measuring the actual input keeps the bubble pinned to the
    // thumb in both the main player and the compact bottom bar.
    const thumbSize = 13;
    const ratio = clamp(value / 100, 0, 1);
    const thumbCenter = inputRect.left - sliderRect.left
      + thumbSize / 2
      + Math.max(0, inputRect.width - thumbSize) * ratio;
    setBubbleLeft(Math.round(thumbCenter * 10) / 10);
  }, [value]);

  useLayoutEffect(() => {
    syncBubblePosition();
    const observe = () => syncBubblePosition();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(observe);
    if (resizeObserver) {
      resizeObserver.observe(sliderRef.current);
      resizeObserver.observe(inputRef.current);
    }
    window.addEventListener("resize", observe);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", observe);
    };
  }, [syncBubblePosition]);

  const startAdjusting = () => {
    slider.begin();
    setIsAdjusting(true);
  };
  const finishAdjusting = (nextValue) => {
    onCommit(nextValue);
    setIsAdjusting(false);
  };

  return (
    <div ref={sliderRef} className={`volume-slider ${className} ${isAdjusting ? "is-adjusting" : ""}`} style={{ "--volume-bubble-left": `${bubbleLeft}px` }}>
      <output className="volume-bubble" aria-live="polite">{value}</output>
      <input
        ref={inputRef}
        className="range range-volume"
        type="range"
        min="0"
        max="100"
        value={slider.value}
        aria-label="Player volume"
        style={{ "--range-progress": `${value}%` }}
        onPointerDown={startAdjusting}
        onPointerCancel={(event) => finishAdjusting(event.currentTarget.value)}
        onChange={(event) => onPreview(event.target.value)}
        onPointerUp={(event) => finishAdjusting(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") startAdjusting();
        }}
        onKeyUp={(event) => {
          if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") finishAdjusting(event.currentTarget.value);
        }}
        onBlur={() => setIsAdjusting(false)}
      />
    </div>
  );
}


function useCompactViewport() {
  const query = "(max-height: 360px), (max-width: 620px) and (max-height: 420px)";
  const readQuery = () => typeof window !== "undefined" && window.matchMedia(query).matches;
  const [isCompact, setIsCompact] = useState(readQuery);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setIsCompact(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return isCompact;
}

function sourceLabel(source) {
  return ({ deezer: "Deezer", youtube: "YouTube", spotify: "Spotify", soundcloud: "SoundCloud", auto: "YouTube first", direct: "Direct link" })[source] || source || "Unknown";
}

// A narrow stage leaves the search field only a sliver next to "YouTube first",
// so the trigger falls back to these; the open list keeps the full names.
const SOURCE_SHORT_LABELS = { auto: "Auto", youtube: "YT", soundcloud: "SC", deezer: "DZ", spotify: "SP" };
const SOURCE_OPTIONS = SOURCE_NAMES.map((name) => ({ value: name, label: sourceLabel(name), shortLabel: SOURCE_SHORT_LABELS[name] }));
const HISTORY_RANGE_OPTIONS = [
  { value: "all", label: "Any time" },
  { value: "1h", label: "Last hour" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
];
const PLAYLIST_SORT_OPTIONS = [
  { value: "recent", label: "Recently added" },
  { value: "title", label: "Title A–Z" },
  { value: "artist", label: "Artist A–Z" },
  { value: "duration-desc", label: "Longest first" },
  { value: "duration-asc", label: "Shortest first" },
];

const IconButton = forwardRef(function IconButton({ label, children, className = "", loading = false, disabled = false, ...props }, ref) {
  return (
    <button ref={ref} className={`icon-button ${className} ${loading ? "is-loading" : ""}`} aria-label={label} title={label} type="button" disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <SpinnerGap className="button-spinner" size={17} aria-hidden="true" /> : children}
    </button>
  );
});

const ACTIVITY_SHORTCUTS = [
  ["/", "Focus search"],
  ["Space", "Play or pause"],
  ["N", "Skip track"],
  ["P", "Restart current track"],
  ["L", "Open lyrics"],
  ["Q", "Toggle queue"],
  ["Alt + ↑ / ↓", "Move the focused queue item"],
  ["Esc", "Close an open menu or drawer"],
];

function ShortcutHelp({ placement = "toolbar" }) {
  const detailsRef = useRef(null);

  useEffect(() => {
    const closeOnEscapeOrOutside = (event) => {
      if (!detailsRef.current?.open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        detailsRef.current.open = false;
        detailsRef.current.querySelector("summary")?.focus();
      } else if (event.type === "pointerdown" && !detailsRef.current.contains(event.target)) {
        detailsRef.current.open = false;
      }
    };
    document.addEventListener("keydown", closeOnEscapeOrOutside);
    document.addEventListener("pointerdown", closeOnEscapeOrOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscapeOrOutside);
      document.removeEventListener("pointerdown", closeOnEscapeOrOutside);
    };
  }, []);

  return (
    <details ref={detailsRef} className={`shortcut-help shortcut-help-${placement}`}>
      <summary className="shortcut-help-toggle" aria-label="Show keyboard shortcuts">
        <Keyboard size={17} aria-hidden="true" />
        <span className="shortcut-help-label">Shortcuts</span>
      </summary>
      <div className="shortcut-help-popover" role="dialog" aria-label="Keyboard shortcuts">
        <div className="shortcut-help-heading">
          <strong>Keyboard shortcuts</strong>
          <span>Quick controls for the room</span>
        </div>
        <dl className="shortcut-list">
          {ACTIVITY_SHORTCUTS.map(([key, description]) => <div className="shortcut-row" key={key}><dt><kbd>{key}</kbd></dt><dd>{description}</dd></div>)}
        </dl>
      </div>
    </details>
  );
}

function getTrackLikeKey(track) {
  const normalize = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return `${normalize(track?.title)}::${normalize(track?.author)}`;
}

function isAutoplayQueueTrack(track) {
  return Boolean(track?.autoplay);
}

function partitionQueueForDisplay(queue = []) {
  const manual = [];
  const autoplay = [];
  for (const track of queue) (isAutoplayQueueTrack(track) ? autoplay : manual).push(track);
  return [...manual, ...autoplay];
}

function moveQueueTrackForDisplay(queue = [], from, to) {
  const tracks = partitionQueueForDisplay(queue);
  const moving = tracks[from];
  const target = tracks[to];
  if (!moving || !target) return tracks;

  const autoplay = isAutoplayQueueTrack(moving);
  const segment = tracks.filter((track) => isAutoplayQueueTrack(track) === autoplay);
  const sourceIndex = segment.indexOf(moving);
  const crossesDivider = isAutoplayQueueTrack(target) !== autoplay;
  let targetIndex = crossesDivider ? (autoplay ? 0 : segment.length) : segment.indexOf(target);
  segment.splice(sourceIndex, 1);
  if (!crossesDivider && sourceIndex < targetIndex) targetIndex -= 1;
  segment.splice(Math.max(0, Math.min(segment.length, targetIndex)), 0, moving);
  const partition = partitionQueueForDisplay(tracks);
  return autoplay ? [...partition.filter((track) => !isAutoplayQueueTrack(track)), ...segment] : [...segment, ...partition.filter(isAutoplayQueueTrack)];
}

function getActionPendingKey(action, payload = {}) {
  if (action === "remove_queue" || action === "play_next" || action === "replace_autoplay") return `${action}:${payload.queueItemId || Number(payload.position)}`;
  if (action === "move_queue") return `${action}:${payload.fromQueueItemId || Number(payload.from)}`;
  if (action === "play") return `${action}:${payload.trackId || payload.query || "unknown"}`;
  if (action === "toggle_like" || action === "track_feedback") return `${action}:${payload.track?.id || payload.trackId || "current"}`;
  return action;
}

function formatHistoryTime(timestamp) {
  const playedAt = Number(timestamp);
  if (!Number.isFinite(playedAt) || playedAt <= 0) return "Earlier";

  const elapsedMs = Math.max(0, Date.now() - playedAt);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(playedAt));
}

function trackFeedbackLabel(track) {
  const title = String(track?.title || "").trim();
  const author = String(track?.author || "").trim();
  if (!title) return "";
  return author ? `${title} — ${author}` : title;
}

function getActionFeedback(action, payload = {}, result = null, state = null) {
  const currentTrack = result?.track || state?.player?.currentTrack || payload.track || null;
  const track = trackFeedbackLabel(currentTrack);
  switch (action) {
    case "play": return payload.playNow ? (track ? `Playing now: ${track}` : "Playing now") : (track ? `Added to queue: ${track}` : "Added to queue");
    case "surprise_me": return track ? `Picked ${result?.surpriseIntent && result.surpriseIntent !== "freestyle" ? "for this room" : "from today’s chart"}: ${track}` : "Picked a verified surprise track";
    case "stop": return "Playback stopped and queue cleared";
    case "skip": return "Skipped to the next track";
    case "previous": return "Restarted the current track";
    case "shuffle": return "Queue shuffled";
    case "play_next": return "Moved to play next";
    case "replace_autoplay": return track ? `Autoplay pick replaced: ${track}` : "Finding a different autoplay pick";
    case "autoplay": return payload.enabled ? "Autoplay on — MewBit will keep the room moving" : "Autoplay off — the queue is now manual";
    case "loop": {
      const loop = state?.player?.loop || "NONE";
      return loop === "TRACK" ? "Looping this track" : loop === "QUEUE" ? "Looping the queue" : "Loop off";
    }
    case "toggle_mute": return result?.muted ? "Player muted" : `Volume restored to ${result?.volume ?? state?.player?.volume ?? 0}`;
    case "toggle_like": return result?.liked ? "Saved to Liked Songs" : "Removed from Liked Songs";
    case "add_to_playlist": return payload.name ? `Added to ${payload.name}` : "Added to playlist";
    case "create_playlist": return payload.name ? `Created ${payload.name}` : "Playlist created";
    case "import_playlist": return result?.count ? `Imported ${result.count} tracks` : "Playlist imported";
    case "play_playlist": return payload.shuffle ? "Playing playlist in shuffle" : "Playing playlist";
    case "filter": return String(payload.preset || "").toLowerCase() === "off" ? "Effects reset" : `Applied ${payload.preset} effect`;
    case "equalizer_preset": return `EQ preset: ${payload.preset}`;
    case "refresh_lyrics": return result?.lines?.length || result?.text ? "Lyrics refreshed" : "No lyrics found for this track";
    case "set_lyrics_offset": return "Lyrics timing saved";
    case "change_source": return `Trying the ${sourceLabel(payload.source)} version`;
    case "track_feedback": return payload.sentiment === "more" ? "MewBit will lean closer to this sound" : "MewBit will avoid this direction";
    case "update_playlist": return "Playlist changes saved";
    default: return null;
  }
}

function PlaylistMenu({ track, playlists, onAction, className = "" }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const closeTimerRef = useRef(null);
  const triggerRef = useRef(null);

  const clearCloseTimer = () => window.clearTimeout(closeTimerRef.current);
  const closeMenu = (returnFocus = false) => {
    clearCloseTimer();
    setOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => closeMenu(), 260);
  };
  const toggleMenu = (event) => {
    clearCloseTimer();
    if (open) {
      closeMenu(true);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const menuHeight = Math.min(320, 56 + Math.max(1, playlists.length) * 37);
    const openAbove = window.innerHeight - rect.bottom < menuHeight + 14;
    setMenuPosition({
      top: openAbove ? Math.max(10, rect.top - menuHeight - 8) : Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 10),
      left: Math.max(10, Math.min(rect.right - 220, window.innerWidth - 230)),
      });
    setOpen(true);
  };

  useEffect(() => {
    const closeOnOutsidePointer = (event) => {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) closeMenu();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      clearCloseTimer();
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const focusMenuItem = (direction) => {
      const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])];
      if (!items.length) return;
      const index = items.indexOf(document.activeElement);
      const nextIndex = direction === "first" ? 0
        : direction === "last" ? items.length - 1
          : (index + direction + items.length) % items.length;
      items[nextIndex]?.focus();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        focusMenuItem(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusMenuItem(-1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusMenuItem("first");
      } else if (event.key === "End") {
        event.preventDefault();
        focusMenuItem("last");
      } else if (event.key === "Tab") {
        closeMenu();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const focusTimer = window.requestAnimationFrame(() => focusMenuItem("first"));
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.cancelAnimationFrame(focusTimer);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`playlist-menu-anchor ${className}`}
      onMouseEnter={clearCloseTimer}
      onMouseLeave={scheduleClose}
      onFocus={clearCloseTimer}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose(); }}
    >
      <IconButton ref={triggerRef} label="Add to playlist" className={open ? "is-active" : ""} onClick={toggleMenu} disabled={!track} aria-expanded={open} aria-haspopup="menu">
        <span className="playlist-add-icon"><VinylRecord size={16} aria-hidden="true" /><Plus size={9} weight="bold" aria-hidden="true" /></span>
      </IconButton>
      {open && menuPosition ? createPortal(
        <div ref={menuRef} className="playlist-context-menu" style={menuPosition} role="menu" aria-label={`Add ${track?.title || "track"} to playlist`} onMouseEnter={clearCloseTimer} onMouseLeave={scheduleClose}>
          <span className="playlist-menu-title">Add to playlist</span>
          {playlists.length ? playlists.map((playlist) => <button type="button" role="menuitem" key={playlist.id} onClick={() => { onAction("add_to_playlist", { name: playlist.name, track }); closeMenu(true); }}><VinylRecord size={14} aria-hidden="true" /><span>{playlist.name}</span></button>) : <span className="playlist-menu-empty">Create a playlist first</span>}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function TrackSaveActions({ track, playlists = [], likedTrackIds = [], onAction, isActionPending = () => false, className = "" }) {
  if (!track) return null;
  const isLiked = likedTrackIds.includes(track.id) || likedTrackIds.includes(getTrackLikeKey(track));
  return (
    <div className={`track-save-actions ${className}`}>
      <IconButton label={isLiked ? "Remove from liked songs" : "Add to liked songs"} className={`like-button ${isLiked ? "is-liked" : ""}`} loading={isActionPending(`toggle_like:${track.id}`)} onClick={() => onAction("toggle_like", { track })} aria-pressed={isLiked}>
        <Heart size={16} weight={isLiked ? "fill" : "regular"} aria-hidden="true" />
      </IconButton>
      <PlaylistMenu track={track} playlists={playlists} onAction={onAction} />
    </div>
  );
}


function useSmartMenuGuards(open, rootRef, menuRef, onClose) {
  const closeTimerRef = useRef(null);
  const openedAtRef = useRef(0);
  const clearCloseTimer = () => { window.clearTimeout(closeTimerRef.current); closeTimerRef.current = null; };
  const scheduleClose = (delay = 200) => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => { closeTimerRef.current = null; onClose(); }, delay);
  };
  const closeMenu = () => { clearCloseTimer(); onClose(); };

  useEffect(() => {
    if (!open) return undefined;
    // Forgiving proximity guard: a short grace period after opening absorbs
    // accidental flicks, then a 36px corridor around the menu/trigger keeps
    // it alive. Leaving the corridor starts a 200ms close timer; re-entering
    // cancels it. Clicks outside always close immediately.
    openedAtRef.current = performance.now();
    const rootEl = rootRef && typeof rootRef === "object" ? (rootRef.current ?? rootRef) : rootRef;
    const insideSafeZone = (x, y, target) => {
      const pad = 36;
      if (menuRef.current?.contains(target) || rootEl?.contains?.(target)) return true;
      return [menuRef.current?.getBoundingClientRect(), rootEl ? rootEl.getBoundingClientRect() : null].some((rect) => {
        if (!rect) return false;
        return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
      });
    };
    const onPointerMove = (event) => {
      if (performance.now() - openedAtRef.current < 350) { clearCloseTimer(); return; }
      if (insideSafeZone(event.clientX, event.clientY, event.target)) { clearCloseTimer(); return; }
      if (!closeTimerRef.current) scheduleClose();
    };
    const onPointerDown = (event) => {
      const rootContains = typeof rootEl?.contains === "function" ? rootEl.contains(event.target) : false;
      if (!menuRef.current?.contains(event.target) && !rootContains) closeMenu();
    };
    const onKeyDown = (event) => { if (event.key === "Escape") { event.stopPropagation(); closeMenu(); } };
    const onScrollOrResize = () => closeMenu();
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      clearCloseTimer();
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  return { clearCloseTimer, scheduleClose };
}

function SmartMenu({ open, position, rootRef, menuRef, guards, label, children }) {
  if (!open) return null;
  return createPortal(
    <div ref={menuRef} className="row-context-menu" style={{ top: position.top, left: position.left }} role="menu" aria-label={label}>
      {children}
    </div>,
    document.body,
  );
}

function useMediaQuery(query) {
  const readQuery = () => typeof window !== "undefined" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(readQuery);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);

  return matches;
}

function PlaylistSubmenuItem({ track, playlists = [], onAction, onClose }) {
  const [open, setOpen] = useState(false);
  const [opensLeft, setOpensLeft] = useState(false);
  const triggerRef = useRef(null);
  const submenuRef = useRef(null);
  const submenuGuards = useSmartMenuGuards(open, triggerRef, submenuRef, () => setOpen(false));
  const closeSubmenu = () => { submenuGuards.clearCloseTimer(); setOpen(false); };
  const scheduleClose = () => submenuGuards.scheduleClose(280);
  const openSubmenu = () => {
    submenuGuards.clearCloseTimer();
    const rect = triggerRef.current?.getBoundingClientRect();
    setOpensLeft(Boolean(rect && window.innerWidth - rect.right < 250));
    setOpen(true);
  };

  return (
    <div className={`row-menu-submenu ${open ? "is-open" : ""}`} onMouseEnter={openSubmenu} onMouseLeave={scheduleClose} onFocus={openSubmenu} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose(); }}>
      <button ref={triggerRef} type="button" role="menuitem" className="row-menu-item" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); openSubmenu(); }} aria-haspopup="menu" aria-expanded={open}>
        <MusicNotes size={15} aria-hidden="true" /><span>Add to playlist</span><CaretRight className="row-menu-chevron" size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div ref={submenuRef} className={`row-menu-submenu-panel ${opensLeft ? "opens-left" : ""}`} role="menu" aria-label="Available playlists" onMouseEnter={openSubmenu} onMouseLeave={scheduleClose}>
          {playlists.length ? playlists.map((playlist) => (
            <button type="button" role="menuitem" key={playlist.id} onClick={() => { onAction("add_to_playlist", { name: playlist.name, track }); onClose(); }}>
              <VinylRecord size={14} aria-hidden="true" /><span>{playlist.name}</span>
            </button>
          )) : <span className="row-menu-submenu-empty">Create a playlist first</span>}
        </div>
      ) : null}
    </div>
  );
}

function TrackMenuActions({ track, playlists = [], likedTrackIds = [], onAction, onClose }) {
  const isLiked = likedTrackIds.includes(track.id) || likedTrackIds.includes(getTrackLikeKey(track));
  const linkUrl = [track.uri, track.playQuery].find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
  return (
    <>
      <button type="button" role="menuitem" className={`row-menu-item ${isLiked ? "is-liked" : ""}`} onClick={() => { onAction("toggle_like", { track }); onClose(); }}>
        <Heart size={15} weight={isLiked ? "fill" : "regular"} aria-hidden="true" /><span>{isLiked ? "Remove from liked songs" : "Add to liked songs"}</span>
      </button>
      <PlaylistSubmenuItem track={track} playlists={playlists} onAction={onAction} onClose={onClose} />
      {track.recommendation?.reason ? <p className="row-menu-explainer"><strong>Why MewBit picked this</strong>{track.recommendation.reason}</p> : null}
      {track.autoplay ? <>
        <button type="button" role="menuitem" className="row-menu-item" onClick={() => { onAction("track_feedback", { track, sentiment: "more" }); onClose(); }}>
          <Sparkle size={15} weight="fill" aria-hidden="true" /><span>More like this</span>
        </button>
        <button type="button" role="menuitem" className="row-menu-item" onClick={() => { onAction("track_feedback", { track, sentiment: "less" }); onClose(); }}>
          <WarningCircle size={15} aria-hidden="true" /><span>Not this direction</span>
        </button>
      </> : null}
      {linkUrl ? (
        <button type="button" role="menuitem" className="row-menu-item" onClick={() => { navigator.clipboard?.writeText(linkUrl).catch(() => {}); onClose(); }}>
          <CopySimple size={15} aria-hidden="true" /><span>Copy link</span>
        </button>
      ) : (
        <button type="button" role="menuitem" className="row-menu-item" onClick={() => { navigator.clipboard?.writeText(`${track.title || ""} ${track.author || ""}`.trim()).catch(() => {}); onClose(); }}>
          <CopySimple size={15} aria-hidden="true" /><span>Copy track info</span>
        </button>
      )}
    </>
  );
}

function TrackContextMenu({ track, playlists = [], likedTrackIds = [], onAction, open, position, onOpen, onClose }) {
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const { clearCloseTimer, scheduleClose } = useSmartMenuGuards(open, rootRef, menuRef, onClose);
  const closeMenu = () => { clearCloseTimer(); onClose(); };

  if (!track) return null;
  const playQuery = track.playQuery || track.uri || `${track.title} ${track.author}`;

  return (
    <>
      <IconButton
        ref={rootRef}
        label="More actions"
        className={`row-dots ${open ? "is-active" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          if (open) { closeMenu(); return; }
          const rect = event.currentTarget.getBoundingClientRect();
          onOpen({
            top: Math.max(10, Math.min(rect.bottom + 4, window.innerHeight - 238)),
            left: Math.max(10, Math.min(rect.left + rect.width / 2 - 110, window.innerWidth - 246)),
          });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpen({
            top: Math.max(10, Math.min(event.clientY + 6, window.innerHeight - 238)),
            left: Math.max(10, Math.min(event.clientX - 10, window.innerWidth - 246)),
          });
        }}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <DotsThreeVertical size={16} weight="bold" aria-hidden="true" />
      </IconButton>
      <SmartMenu open={open} position={position} rootRef={rootRef} menuRef={menuRef} label={`Actions for ${track.title}`}>
        <>
          <button type="button" role="menuitem" className="row-menu-item" onClick={() => { onAction("play", { query: playQuery, source: track.source, playNow: true }); closeMenu(); }}>
            <Play size={15} weight="fill" aria-hidden="true" /><span>Play now</span>
          </button>
          <button type="button" role="menuitem" className="row-menu-item" onClick={() => { onAction("play", { query: playQuery, source: track.source }); closeMenu(); }}>
            <Plus size={15} weight="bold" aria-hidden="true" /><span>Add to queue</span>
          </button>
          <span className="row-menu-divider" aria-hidden="true" />
          <TrackMenuActions track={track} playlists={playlists} likedTrackIds={likedTrackIds} onAction={onAction} onClose={closeMenu} />
        </>
      </SmartMenu>
    </>
  );
}

function SourceTag({ source }) {
  return <span className={`source-tag source-${source || "unknown"}`}>{sourceLabel(source)}</span>;
}

function TrackBadges({ track, className = "" }) {
  const text = `${track?.title || ""} ${track?.author || ""}`.toLowerCase();
  const badges = [
    (track?.explicit || /\bexplicit\b|\buncensored\b|\buncut\b/.test(text)) && "Explicit",
    /\bclean\b|\bcensored\b|radio edit/.test(text) && "Clean",
    /\blive\b|\bconcert\b|\bsession\b/.test(text) && "Live",
    /\bremix\b|\bremaster(?:ed)?\b/.test(text) && "Remix",
  ].filter(Boolean);
  if (!badges.length) return null;
  return <span className={`track-badges ${className}`} aria-label={`Track versions: ${badges.join(", ")}`}>{badges.map((badge) => <span key={badge} className={`track-badge track-badge-${badge.toLowerCase()}`}>{badge}</span>)}</span>;
}

function resolveArtworkUrl(artworkUrl) {
  if (!artworkUrl) return null;

  try {
    const parsed = new URL(artworkUrl, window.location.origin);
    if (["data:", "blob:"].includes(parsed.protocol) || parsed.origin === window.location.origin) return parsed.toString();
    return `/api/activity/artwork?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return null;
  }
}

function Artwork({ track, size = "large" }) {
  const [attempt, setAttempt] = useState(0);
  const artworkUrl = track?.artworkUrl;
  const artworkCandidates = [...new Set([artworkUrl, track?.artworkFallbackUrl].filter(Boolean))];
  const resolvedArtworkUrl = resolveArtworkUrl(artworkCandidates[attempt]);

  useEffect(() => setAttempt(0), [artworkUrl, track?.artworkFallbackUrl]);

  if (!resolvedArtworkUrl) {
    return (
      <div className={`artwork artwork-${size} artwork-fallback`} aria-label="No artwork available">
        <span className="artwork-letter" aria-hidden="true">{(track?.title || "M").trim().charAt(0).toUpperCase()}</span>
      </div>
    );
  }

  return (
    <img
      className={`artwork artwork-${size}`}
      src={resolvedArtworkUrl}
      alt={`${track.title} artwork`}
      onError={() => setAttempt((current) => current + 1)}
    />
  );
}

function PanelTitle({ icon, title, description, action }) {
  return (
    <div className="panel-title">
      <div className="panel-heading">
        <span className="panel-icon">{icon}</span>
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

function formatActivityEventTime(timestamp) {
  const delta = Math.max(0, Date.now() - Number(timestamp || 0));
  if (delta < 10_000) return "now";
  if (delta < 60_000) return `${Math.floor(delta / 1_000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

function ActivityFeedPanel({ events = [] }) {
  if (!events.length) {
    return <div className="activity-feed-empty"><Bell size={26} weight="duotone" aria-hidden="true" /><strong>Room is quiet</strong><span>Actions and playback issues will appear here.</span></div>;
  }

  return (
    <ol className="activity-feed-list" aria-label="Recent room activity">
      {events.map((event) => (
        <li key={event.id} className={`activity-feed-event is-${event.level || "info"}`}>
          <span className="activity-feed-marker" aria-hidden="true" />
          <div className="activity-feed-copy">
            <div><strong>{event.actor || event.title}</strong><time dateTime={new Date(Number(event.timestamp) || Date.now()).toISOString()}>{formatActivityEventTime(event.timestamp)}</time></div>
            <p>{event.actor ? event.detail : [event.title, event.detail].filter(Boolean).join(" · ")}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function TrackFeedbackActions({ track, onAction, isActionPending = () => false, className = "" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const firstActionRef = useRef(null);

  useEffect(() => setOpen(false), [track?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const closeIfOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("keydown", onKeyDown);
    const focusFrame = window.requestAnimationFrame(() => firstActionRef.current?.focus());
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("keydown", onKeyDown);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [open]);

  if (!track) return null;
  const pending = isActionPending(`track_feedback:${track.id}`);
  const submitFeedback = (sentiment) => {
    onAction("track_feedback", { track, sentiment });
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`track-feedback-actions ${className}`}>
      <IconButton
        ref={triggerRef}
        label="Tune autoplay recommendations"
        className={open ? "is-active" : ""}
        onClick={() => setOpen((current) => !current)}
        disabled={pending}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Waveform size={16} weight={open ? "fill" : "regular"} aria-hidden="true" />
      </IconButton>
      {open ? <div className="track-feedback-menu" role="menu" aria-label="Tune autoplay recommendations">
        <button ref={firstActionRef} type="button" role="menuitem" onClick={() => submitFeedback("more")} disabled={pending}>
          <Sparkle size={15} weight="fill" aria-hidden="true" />
          <span><strong>More like this</strong><small>Keep this energy in the next picks</small></span>
        </button>
        <button type="button" role="menuitem" onClick={() => submitFeedback("less")} disabled={pending}>
          <WarningCircle size={15} aria-hidden="true" />
          <span><strong>Not this direction</strong><small>Steer the next picks away from this sound</small></span>
        </button>
      </div> : null}
    </div>
  );
}

function HomePanelFallback() {
  return <section className="home-panel home-panel-loading panel-surface" aria-busy="true" aria-label="Loading Activity view"><div className="home-orbit" aria-hidden="true"><span /><span /><span /></div><div className="home-loading-copy"><span /><strong /><strong /><i /><i /><div><b /><b /></div></div><div className="home-signal" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /></div></section>;
}

function LazyLiveLyricsPanel({ player, onAction, isActionPending }) {
  const position = usePlayerPosition(player, player.lyricsSyncOffsetMs);
  return <LazyLyricsPanel lyrics={player.lyrics} position={position} syncOffsetMs={player.lyricsSyncOffsetMs} defaultSyncOffsetMs={player.lyricsDefaultSyncOffsetMs} onAction={onAction} isActionPending={isActionPending} PanelTitle={PanelTitle} />;
}

function ExternalLinkConfirmDialog({ request, onCancel, onConfirm }) {
  const dialogRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!request) return undefined;
    const returnFocus = document.activeElement;
    window.requestAnimationFrame(() => confirmRef.current?.focus());
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll("button:not([disabled])") || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocus?.focus?.();
    };
  }, [onCancel, request]);

  if (!request) return null;
  let host = "this music site";
  try { host = new URL(request.url).hostname.replace(/^www\./, ""); } catch { /* URL was already validated before opening. */ }

  return (
    <div className="external-link-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section ref={dialogRef} className="external-link-dialog" role="dialog" aria-modal="true" aria-labelledby="external-link-title" aria-describedby="external-link-description">
        <button className="external-link-close" type="button" onClick={onCancel} aria-label="Cancel opening browser"><X size={17} aria-hidden="true" /></button>
        <div className="external-link-icon" aria-hidden="true"><ArrowBendUpRight size={21} weight="bold" /></div>
        <h2 id="external-link-title">Open this track in your browser?</h2>
        <p id="external-link-description">Discord will take you to <strong>{host}</strong> for <span>{request.title || "this track"}</span>.</p>
        <div className="external-link-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>Stay in Discord</button>
          <button ref={confirmRef} className="primary-button" type="button" onClick={onConfirm}><ArrowBendUpRight size={16} weight="bold" aria-hidden="true" /> Open browser</button>
        </div>
      </section>
    </div>
  );
}

function PlayerControls({ player, playlists = [], likedTrackIds = [], onTab, onAction, isActionPending = () => false }) {
  const isPlaying = player.playing && !player.paused;
  const isMuted = Boolean(player.muted);
  const volume = clamp(Number(player.volume || 0), 0, 100);
  const volumeSlider = useBufferedSlider(volume);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeWrapRef = useRef(null);
  useEffect(() => {
    if (!volumeOpen) return undefined;
    const onPointerDown = (event) => { if (!volumeWrapRef.current?.contains(event.target)) setVolumeOpen(false); };
    const onKeyDown = (event) => { if (event.key === "Escape") setVolumeOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [volumeOpen]);
  const previewVolume = (nextValue) => { onAction("volume-preview", { volume: volumeSlider.update(nextValue) }); };
  const commitVolume = (nextValue) => onAction("volume", { volume: volumeSlider.commit(nextValue) });

  return (
    <div className="player-control-deck">
      <div className="deck-side deck-left">
        <button className={`autoplay-control ${player.autoplay ? "is-on" : ""}`} type="button" onClick={() => onAction("autoplay", { enabled: !player.autoplay })} disabled={!player.currentTrack || isActionPending("autoplay")} aria-busy={isActionPending("autoplay") || undefined} aria-pressed={player.autoplay}>
          {isActionPending("autoplay") ? <SpinnerGap className="button-spinner" size={15} aria-hidden="true" /> : <Sparkle size={15} weight={player.autoplay ? "fill" : "regular"} aria-hidden="true" />}
          <span>Autoplay</span>
        </button>
        <TrackSaveActions track={player.currentTrack} playlists={playlists} likedTrackIds={likedTrackIds} onAction={onAction} isActionPending={isActionPending} className="main-save-actions" />
        <TrackFeedbackActions track={player.currentTrack} onAction={onAction} isActionPending={isActionPending} className="main-feedback-actions" />
      </div>
      <div className="transport-controls">
        <IconButton label={`Loop mode ${player.loop}`} className={player.loop !== "NONE" ? "is-active" : ""} loading={isActionPending("loop")} onClick={() => onAction("loop")}>
          <Repeat size={19} weight={player.loop !== "NONE" ? "fill" : "regular"} aria-hidden="true" />
        </IconButton>
        <IconButton label="Play previous track" loading={isActionPending("previous")} onClick={() => onAction("previous")}>
          <SkipBack size={20} weight="regular" aria-hidden="true" />
        </IconButton>
        <button className="play-button" type="button" aria-label={isPlaying ? "Pause track" : "Play track"} onClick={() => onAction("toggle")} disabled={isActionPending("toggle")} aria-busy={isActionPending("toggle") || undefined}>
          {isActionPending("toggle") ? <SpinnerGap className="button-spinner" size={24} aria-hidden="true" /> : isPlaying ? <Pause size={24} weight="fill" aria-hidden="true" /> : <Play size={24} weight="fill" aria-hidden="true" />}
        </button>
        <IconButton label="Stop playback and clear queue" loading={isActionPending("stop")} onClick={() => onAction("stop")} disabled={!player.currentTrack}>
          <Stop size={19} weight="fill" aria-hidden="true" />
        </IconButton>
        <IconButton label="Skip track" loading={isActionPending("skip")} onClick={() => onAction("skip", { expectedTrackId: player.currentTrack?.id })}>
          <SkipForward size={20} weight="regular" aria-hidden="true" />
        </IconButton>
        <IconButton label="Shuffle queue" loading={isActionPending("shuffle")} onClick={() => onAction("shuffle")}>
          <Shuffle size={19} weight="regular" aria-hidden="true" />
        </IconButton>
      </div>
      <div className="deck-side deck-right">
        <IconButton label="Open lyrics" onClick={() => onTab("lyrics")} disabled={!player.currentTrack}><MusicNotes size={19} weight="regular" aria-hidden="true" /></IconButton>
        <div className="deck-volume" ref={volumeWrapRef}>
          <IconButton label={isMuted ? "Unmute player" : "Mute player"} className={`volume-toggle ${isMuted ? "is-muted" : ""}`} loading={isActionPending("toggle_mute")} onClick={() => onAction("toggle_mute")} aria-pressed={isMuted}>
            {isMuted ? <SpeakerSlash size={18} weight="fill" aria-hidden="true" /> : <SpeakerHigh size={18} weight="fill" aria-hidden="true" />}
          </IconButton>
          <VolumeSlider className="volume-inline-control" slider={volumeSlider} onPreview={previewVolume} onCommit={commitVolume} />
          <IconButton label={volumeOpen ? "Close volume controls" : "Adjust volume"} className={`volume-mobile-trigger ${volumeOpen ? "is-active" : ""}`} onClick={() => setVolumeOpen((value) => !value)} aria-expanded={volumeOpen} aria-haspopup="true"><Faders size={17} weight="regular" aria-hidden="true" /></IconButton>
          <div className={`volume-popover vol-pop-mobile ${volumeOpen ? "is-open" : ""}`} role="group" aria-label="Volume control">
            <VolumeSlider slider={volumeSlider} onPreview={previewVolume} onCommit={commitVolume} />
          </div>
          </div>
      </div>
    </div>
  );
}

// YouTube uploads carry the episode, the language and "lyrics" in the title;
// the hero steps those down a size and clamps them instead of letting them
// push the controls off the stage.
function titleLengthClass(title = "") {
  if (title.length > 72) return "xlong";
  if (title.length > 40) return "long";
  return "normal";
}

// A word wider than its column can only break mid-letter ("Caramelldanse|n"),
// so the hero title shrinks until its longest word fits on one line.
function useFitLongestWord(titleRef, title) {
  useLayoutEffect(() => {
    const heading = titleRef.current?.closest("h1");
    // Measure the column, not the heading: a ch-based max width would follow
    // the font size it is fitting and never settle.
    const column = heading?.parentElement;
    const longestWord = String(title || "").split(/\s+/).reduce((longest, word) => (word.length > longest.length ? word : longest), "");
    if (!heading || !column || !longestWord) return undefined;
    let fittedWidth = -1;
    const fit = () => {
      // Height changes from the resize itself must not refit in a loop.
      if (column.clientWidth === fittedWidth) return;
      heading.style.fontSize = "";
      fittedWidth = column.clientWidth;
      // Measure in the title button itself so its own font and spacing apply.
      const probe = document.createElement("span");
      probe.textContent = longestWord;
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;";
      titleRef.current.appendChild(probe);
      const wordWidth = probe.getBoundingClientRect().width;
      probe.remove();
      if (fittedWidth > 0 && wordWidth > fittedWidth) {
        const fontSize = parseFloat(getComputedStyle(heading).fontSize);
        heading.style.fontSize = `${Math.max(16, Math.floor((fontSize * fittedWidth) / wordWidth))}px`;
      }
    };
    fit();
    document.fonts?.ready.then(() => { fittedWidth = -1; fit(); });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(column);
    return () => {
      observer?.disconnect();
      heading.style.fontSize = "";
    };
  }, [titleRef, title]);
}

function NowPlaying({ state, onTab, onAction, onOpenExternalLink, isActionPending, className = "" }) {
  const { player } = state;
  const position = usePlayerPosition(player);
  const track = player.currentTrack;
  const duration = Math.max(player.durationMs || track?.durationMs || 0, 1);
  const progress = clamp(position, 0, duration);
  const seekSlider = useBufferedSlider(progress, { acknowledgementTolerance: 1500, optimisticLockMs: 1800 });
  const [titleMenu, setTitleMenu] = useState(null);
  const titleRef = useRef(null);
  const titleMenuRef = useRef(null);
  const titleGuards = useSmartMenuGuards(Boolean(titleMenu), titleRef, titleMenuRef, () => setTitleMenu(null));
  const closeTitleMenu = () => { titleGuards.clearCloseTimer(); setTitleMenu(null); };
  const trackLinkUrl = [track?.uri, track?.playQuery].find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) || null;
  const commitSeek = (nextValue) => onAction("seek", { positionMs: seekSlider.commit(nextValue) });
  const titleLength = titleLengthClass(track?.title);
  useFitLongestWord(titleRef, track?.title);

  useEffect(() => {
    setTitleMenu(null);
  }, [track?.id]);

  return (
    <section className={`now-playing panel-surface ${className}`}>
      <div className="now-playing-main">
        <div className={`cover-wrap ${player.playing ? "is-playing" : ""}`}>
          <Artwork track={track} size="large" />
          <div className="cover-signal" aria-hidden="true"><span /><span /><span /><span /></div>
        </div>
        <div className="track-copy">
          <div className="track-copy-grid">
            <div className="track-text">
              <h1 data-length={titleLength}>
                {track ? (
                  <button
                    ref={titleRef}
                    className="track-title-link"
                    type="button"
                    disabled={!trackLinkUrl}
                    onClick={() => onOpenExternalLink?.(trackLinkUrl, track.title)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setTitleMenu({
                        top: Math.max(10, Math.min(event.clientY + 6, window.innerHeight - 260)),
                        left: Math.max(10, Math.min(event.clientX - 10, window.innerWidth - 246)),
                      });
                    }}
                    aria-haspopup="menu"
                    title={titleLength === "normal" ? (trackLinkUrl ? "Open the original track page" : undefined) : track.title}
                  >{track.title}</button>
                ) : "Nothing is playing"}
              </h1>
              <p className="track-author">{track?.author || "Pick a track from search to start the room"}</p>
            </div>
            <IconButton label={state.likedTrackIds.includes(track?.id) ? "Remove from liked songs" : "Add to liked songs"} className={`like-button ${state.likedTrackIds.includes(track?.id) ? "is-liked" : ""}`} loading={isActionPending(`toggle_like:${track?.id}`)} onClick={() => onAction("toggle_like", { track })} aria-pressed={state.likedTrackIds.includes(track?.id)}>
              <Heart size={20} aria-hidden="true" />
            </IconButton>
          </div>
          <div className="track-meta">
            <SourceTag source={track?.source} />
            {track?.requester ? <span className="meta-requester">added by {track.requester}</span> : null}
          </div>
        </div>
      </div>
      <PlayerControls player={player} playlists={state.playlists} likedTrackIds={state.likedTrackIds || []} onTab={onTab} onAction={onAction} isActionPending={isActionPending} />
      <div className="progress-block">
        <input
          className="range range-progress"
          type="range"
          min="0"
          max={duration}
          value={seekSlider.value}
          aria-label="Seek through current track"
          style={{ "--range-progress": `${(seekSlider.value / duration) * 100}%` }}
          onPointerDown={seekSlider.begin}
          onPointerCancel={(event) => commitSeek(event.currentTarget.value)}
          onChange={(event) => seekSlider.update(event.target.value)}
          onPointerUp={(event) => commitSeek(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") seekSlider.begin();
          }}
          onKeyUp={(event) => {
            if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") commitSeek();
          }}
        />
        <div className="time-row"><span>{formatTime(seekSlider.value)}</span><span>{formatTime(duration)}</span></div>
      </div>
      <SmartMenu open={Boolean(titleMenu)} position={titleMenu || { top: 0, left: 0 }} rootRef={titleRef} menuRef={titleMenuRef} label={`Actions for ${track?.title || "track"}`}>
        {track ? <TrackMenuActions track={track} playlists={state.playlists} likedTrackIds={state.likedTrackIds || []} onAction={onAction} onClose={closeTitleMenu} /> : null}
      </SmartMenu>
    </section>
  );
}

function CompactPlayer({ state }) {
  const { player } = state;
  const position = usePlayerPosition(player, player.lyricsSyncOffsetMs);
  const track = player.currentTrack;
  const duration = Math.max(player.durationMs || track?.durationMs || 0, 1);
  const progress = clamp(position, 0, duration);
  const lines = player.lyrics?.lines || [];
  const lyricIndex = lines.reduce((last, line, index) => line.timestamp <= position ? index : last, -1);
  const currentLyricIndex = lyricIndex >= 0 ? lyricIndex : 0;
  const activeLyric = lines[currentLyricIndex]?.line || player.lyrics?.text?.split("\n").find(Boolean);
  const previousLyric = lines[currentLyricIndex - 1]?.line;
  const upcomingLyric = lines[currentLyricIndex + 1]?.line;
  const hasLyrics = Boolean(activeLyric);

  if (!track) {
    return (
      <section className="compact-player compact-idle" aria-label="MewBit compact player idle">
        <strong>Nothing is playing</strong>
        <span>Start a track in MewBit.</span>
      </section>
    );
  }

  const statusSeed = `${track.id || "mewbit"}`.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const statusLine = state.botStatus || COMPACT_STATUS_FALLBACKS[statusSeed % COMPACT_STATUS_FALLBACKS.length];

  if (hasLyrics) {
    return (
      <section className="compact-player compact-lyrics-preview" aria-label="MewBit compact lyrics">
        <div className="compact-lyrics-stack" aria-live="polite" aria-atomic="true">
          <span className={`compact-lyrics-line is-adjacent ${previousLyric ? "" : "is-empty"}`}>{previousLyric || "·"}</span>
          <p className="compact-lyrics-line is-current" key={`${currentLyricIndex}-${activeLyric}`}>{activeLyric}</p>
          <span className={`compact-lyrics-line is-adjacent ${upcomingLyric ? "" : "is-empty"}`}>{upcomingLyric || "·"}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="compact-player compact-now-playing" aria-label="MewBit compact player">
      <div className="compact-header">
        <div className="compact-artwork-wrap">
          <Artwork track={track} size="compact" />
        </div>
        <div className="compact-copy">
          <strong title={track?.title || "Nothing is playing"}>{track?.title || "Nothing is playing"}</strong>
          <div className="compact-meta"><span title={track?.author || "Waiting for a track"}>{track?.author || "Waiting for a track"}</span><SourceTag source={track?.source} /></div>
        </div>
      </div>
      <div className="compact-progress" role="progressbar" aria-label="Track progress" aria-valuemin="0" aria-valuemax={duration} aria-valuenow={progress}>
        <span style={{ "--compact-progress": `${(progress / duration) * 100}%` }} />
      </div>
      {player.autoplay || player.loop !== "NONE" ? <div className="compact-flags" aria-label="Player modes">
        {player.autoplay ? <span className="is-on">Autoplay on</span> : null}
        {player.loop !== "NONE" ? <span className="is-on">Loop {player.loop.toLowerCase()}</span> : null}
      </div> : null}
      <p className="compact-presence">{statusLine}</p>
    </section>
  );
}

function QueuePanel({ queue, playlists = [], likedTrackIds = [], onAction, isActionPending = () => false }) {
  const [draggedQueueItemId, setDraggedQueueItemId] = useState(null);
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null);
  const guards = useSmartMenuGuards(Boolean(menu), null, menuRef, () => setMenu(null));
  const closeMenu = () => { guards.clearCloseTimer(); setMenu(null); };
  const menuTrack = menu ? queue.find((track) => track.queueItemId === menu.queueItemId) : null;
  const menuIndex = menuTrack ? queue.indexOf(menuTrack) : -1;
  const moveTrack = (track, index, targetIndex) => {
    const target = queue[targetIndex];
    if (!track || !target || track.queueItemId === target.queueItemId) return;
    onAction("move_queue", {
      from: index,
      to: targetIndex,
      fromQueueItemId: track.queueItemId,
      toQueueItemId: target.queueItemId,
    });
  };

  return (
    <div className="queue-list" onDragOver={(event) => event.preventDefault()}>
      {queue.length === 0 ? (
        <div className="empty-state compact"><Queue size={30} weight="duotone" aria-hidden="true" /><strong>Queue is clear</strong><span>Search for a track to keep the room moving.</span></div>
      ) : <>
        <div className="queue-group-kicker">From the room</div>
        {queue.map((track, index) => <div key={track.queueItemId || `${track.id}-${index}`}>
          {track.autoplay && index > 0 && !queue[index - 1]?.autoplay ? <div className="queue-group-kicker" role="separator">MewBit autoplay</div> : null}
          <div
            className={`queue-row ${draggedQueueItemId === track.queueItemId ? "is-dragged" : ""}`}
            draggable
            tabIndex={0}
            onDragStart={() => setDraggedQueueItemId(track.queueItemId)}
            onDragEnd={() => setDraggedQueueItemId(null)}
            onKeyDown={(event) => {
              if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault();
              moveTrack(track, index, event.key === "ArrowUp" ? index - 1 : index + 1);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDraggedQueueItemId(null);
              setMenu({
                queueItemId: track.queueItemId,
                top: Math.max(10, Math.min(event.clientY + 4, window.innerHeight - 300)),
                left: Math.max(10, Math.min(event.clientX + 4, window.innerWidth - 246)),
              });
            }}
            onDrop={() => {
              const draggedIndex = queue.findIndex((item) => item.queueItemId === draggedQueueItemId);
              const draggedTrack = queue[draggedIndex];
              if (draggedTrack && draggedIndex !== index) moveTrack(draggedTrack, draggedIndex, index);
              setDraggedQueueItemId(null);
            }}
          >
            <span className="queue-num" aria-hidden="true">{index + 1}</span>
            <Artwork track={track} size="small" />
            <div className="queue-track-copy">
              <strong>{track.title}</strong>
              <span>{track.author} · {sourceLabel(track.source)} · {formatQueueEta(queue, index)}</span>
            </div>
            <div className="queue-side">
              {track.autoplay ? <span className="auto-pill" title="Added by MewBit autoplay">AUTO</span> : null}
              <div className="queue-side-btns">
                {track.autoplay ? <IconButton label={`Find a different autoplay pick than ${track.title}`} className="queue-replace-autoplay" loading={isActionPending(`replace_autoplay:${track.queueItemId}`)} onClick={() => onAction("replace_autoplay", { position: index, queueItemId: track.queueItemId })}>
                  <ArrowsClockwise size={15} aria-hidden="true" />
                </IconButton> : null}
                <IconButton label={`Play ${track.title} next`} className="queue-play-next" loading={isActionPending(`play_next:${track.queueItemId}`)} onClick={() => onAction("play_next", { position: index, queueItemId: track.queueItemId })}>
                  <ArrowBendUpRight size={15} aria-hidden="true" />
                </IconButton>
                <IconButton label={`Remove ${track.title} from queue`} className="queue-remove" loading={isActionPending(`remove_queue:${track.queueItemId}`)} onClick={() => onAction("remove_queue", { position: index, queueItemId: track.queueItemId })}>
                  <Trash size={15} aria-hidden="true" />
                </IconButton>
              </div>
              <span className="queue-duration">{formatTime(track.durationMs)}</span>
            </div>
          </div>
        </div>)}
      </>}
      {(menuTrack ? (<SmartMenu open position={menu} rootRef={null} menuRef={menuRef} label={`Actions for ${menuTrack.title}`}>
        <>
          {menuTrack.autoplay ? <button type="button" role="menuitem" className="row-menu-item" onClick={() => { onAction("replace_autoplay", { position: menuIndex, queueItemId: menuTrack.queueItemId }); closeMenu(); }}>
            <ArrowsClockwise size={15} aria-hidden="true" /><span>Find a different autoplay pick</span>
          </button> : null}
          <button type="button" role="menuitem" className="row-menu-item" onClick={() => { onAction("play_next", { position: menuIndex, queueItemId: menuTrack.queueItemId }); closeMenu(); }}>
            <Play size={15} weight="fill" aria-hidden="true" /><span>Play next</span>
          </button>
          <button type="button" role="menuitem" className="row-menu-item" onClick={() => { moveTrack(menuTrack, menuIndex, 0); closeMenu(); }} disabled={menuIndex === 0}>
            <ArrowBendUpRight size={15} aria-hidden="true" /><span>Move to top</span>
          </button>
          <button type="button" role="menuitem" className="row-menu-item" onClick={() => { onAction("remove_queue", { position: menuIndex, queueItemId: menuTrack.queueItemId }); closeMenu(); }}>
            <Trash size={15} aria-hidden="true" /><span>Remove from queue</span>
          </button>
          <button type="button" role="menuitem" className="row-menu-item" onClick={() => { moveTrack(menuTrack, menuIndex, menuIndex - 1); closeMenu(); }} disabled={menuIndex <= 0}>
            <ArrowBendUpRight size={15} aria-hidden="true" /><span>Move up</span>
          </button>
          <button type="button" role="menuitem" className="row-menu-item" onClick={() => { moveTrack(menuTrack, menuIndex, menuIndex + 1); closeMenu(); }} disabled={menuIndex < 0 || menuIndex >= queue.length - 1}>
            <ArrowBendUpRight size={15} aria-hidden="true" /><span>Move down</span>
          </button>
          <span className="row-menu-divider" aria-hidden="true" />
          <QueueRowLikeMenuItem track={menuTrack} playlists={playlists} likedTrackIds={likedTrackIds} onAction={onAction} onClose={closeMenu} />
        </>
      </SmartMenu>) : null)}
    </div>
  );
}

function QueueRowLikeMenuItem({ track, playlists = [], likedTrackIds = [], onAction, onClose }) {
  if (!track) return null;
  return <TrackMenuActions track={track} playlists={playlists} likedTrackIds={likedTrackIds} onAction={onAction} onClose={onClose} />;
}

function QueueHistoryPanel({ history = [], sessionStartedAt }) {
  const [userFilter, setUserFilter] = useState("all");
  const [rangeFilter, setRangeFilter] = useState("all");
  const [sessionOnly, setSessionOnly] = useState(false);

  const users = useMemo(() => [...new Set(history
    .map((track) => String(track?.requester || (track?.autoplay ? "MewBit" : "Unknown")).trim())
    .filter(Boolean))].sort((left, right) => left.localeCompare(right)), [history]);

  const filteredHistory = useMemo(() => {
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const rangeStart = {
      "1h": now - 60 * 60_000,
      today: startOfToday.getTime(),
      "7d": now - 7 * 24 * 60 * 60_000,
    }[rangeFilter] || 0;
    const sessionStart = sessionOnly ? Number(sessionStartedAt || 0) : 0;

    return history.filter((track) => {
      const requester = String(track?.requester || (track?.autoplay ? "MewBit" : "Unknown")).trim();
      const playedAt = Number(track?.playedAt || 0);
      return (userFilter === "all" || requester === userFilter)
        && (!rangeStart || playedAt >= rangeStart)
        && (!sessionStart || playedAt >= sessionStart);
    });
  }, [history, rangeFilter, sessionOnly, sessionStartedAt, userFilter]);

  return (
    <section className="queue-history" aria-label="Playback history">
      <div className="history-filter-grid">
        <label>
          <span>Played by</span>
          <Dropdown value={userFilter} onChange={setUserFilter} label="Played by" options={[{ value: "all", label: "Everyone" }, ...users.map((user) => ({ value: user, label: user }))]} />
        </label>
        <label>
          <span>When</span>
          <Dropdown value={rangeFilter} onChange={setRangeFilter} label="When" options={HISTORY_RANGE_OPTIONS} />
        </label>
      </div>
      <label className={`history-session-toggle ${sessionOnly ? "is-active" : ""}`}>
        <input type="checkbox" checked={sessionOnly} onChange={(event) => setSessionOnly(event.target.checked)} />
        <span>This room session</span>
      </label>
      {filteredHistory.length === 0 ? <div className="empty-state compact queue-history-empty"><ClockCounterClockwise size={28} weight="duotone" aria-hidden="true" /><strong>{history.length ? "No matching tracks" : "Nothing has finished yet"}</strong><span>{history.length ? "Try another person or time range." : "Finished tracks will appear here for this room session."}</span></div> : (
        <div className="history-list">
          {filteredHistory.map((track, index) => (
            <article className="history-row" key={`${track.id}-${track.playedAt || index}`}>
              <Artwork track={track} size="small" />
              <div className="history-track-copy">
                <strong title={track.title}>{track.title}</strong>
                <span title={track.author}>{track.author}</span>
                <div className="history-track-meta"><SourceTag source={track.source} /><span>{track.requester || (track.autoplay ? "MewBit" : "Unknown")}</span></div>
              </div>
              <time dateTime={track.playedAt ? new Date(track.playedAt).toISOString() : undefined} title={track.playedAt ? new Date(track.playedAt).toLocaleString() : undefined}>{formatHistoryTime(track.playedAt)}</time>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

const LIBRARY_ORIGIN_LABELS = { liked: "Liked", playlist: "In your playlists", history: "Played before" };

// "Linkin Park", "Linkin Park - Topic" and "LinkinParkVEVO" are one artist
// when grouping results under the top one.
function normalizeArtistKey(author) {
  return String(author || "")
    .toLowerCase()
    .replace(/\s*-\s*topic$|vevo$|official$/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function SearchPanel({ query, setQuery, source, setSource, results, libraryResults = [], similarResults = [], status, correction = null, suggestions = [], onSearch, onSearchExact, onAction, playlists = [], likedTrackIds = [], isActionPending = () => false, showSearchBar = true }) {
  const directLink = parseMusicLink(query);
  const directSource = directLink?.source === "direct" ? "auto" : directLink?.source;
  const [menuState, setMenuState] = useState(null);
  const renderResultRow = (track) => (
        <div
          className={`result-row ${menuState?.id === track.id ? "is-menu-open" : ""}`}
          key={track.id}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenuState({
              id: track.id,
              top: Math.max(10, Math.min(event.clientY + 6, window.innerHeight - 238)),
              left: Math.max(10, Math.min(event.clientX - 10, window.innerWidth - 246)),
            });
          }}
        >
          <Artwork track={track} size="small" />
          <div className="result-copy">
            <strong>{track.title}</strong>
            <span className="result-subline">{track.author} · {LIBRARY_ORIGIN_LABELS[track.origin] || sourceLabel(track.source)}</span>
          </div>
          <span className="result-duration">{formatTime(track.durationMs)}</span>
          <div className="result-actions">
            <button className="row-play" type="button" onClick={() => onAction("play", { query: track.playQuery || track.uri || `${track.title} ${track.author}`, source: track.source, playNow: true, trackId: track.id })} disabled={isActionPending(`play:${track.id}`)} aria-label="Play">
              <Play size={14} weight="fill" aria-hidden="true" />
            </button>
            <button className="row-add" type="button" onClick={() => onAction("play", { query: track.playQuery || track.uri || `${track.title} ${track.author}`, source: track.source, trackId: track.id })} disabled={isActionPending(`play:${track.id}`)} aria-label="Add to queue">
              <Plus size={14} aria-hidden="true" />
            </button>
            <TrackContextMenu
              track={track}
              playlists={playlists}
              likedTrackIds={likedTrackIds}
              onAction={onAction}
              isActionPending={isActionPending}
              open={menuState?.id === track.id}
              position={{ top: menuState?.top ?? 0, left: menuState?.left ?? 0 }}
              onOpen={(pos) => setMenuState({ id: track.id, top: pos.top, left: pos.left })}
              onClose={() => setMenuState(null)}
            />
          </div>
        </div>
  );
  const libraryUris = new Set(libraryResults.map((track) => track.uri).filter(Boolean));
  const providerResults = results.filter((track) => !track.uri || !libraryUris.has(track.uri));
  // Previous results stay on screen, dimmed, while the next search runs; the
  // skeleton is only for the very first search.
  const isRefreshing = status === "searching" && providerResults.length > 0;
  const [topResult, ...otherResults] = providerResults;
  const topArtist = normalizeArtistKey(topResult?.author);
  const artistResults = topArtist ? otherResults.filter((track) => normalizeArtistKey(track.author) === topArtist).slice(0, 4) : [];
  const artistIds = new Set(artistResults.length >= 2 ? artistResults.map((track) => track.id) : []);
  const songResults = otherResults.filter((track) => !artistIds.has(track.id));
  const shownUris = new Set([...libraryUris, ...providerResults.map((track) => track.uri)].filter(Boolean));
  const similarShown = similarResults.filter((track) => !track.uri || !shownUris.has(track.uri));
  const playTrack = (track, playNow) => onAction("play", { query: track.playQuery || track.uri || `${track.title} ${track.author}`, source: track.source, playNow, trackId: track.id });
  const resultList = (tracks) => <div className={`search-results ${menuState ? "has-menu-open" : ""}`}>{tracks.map(renderResultRow)}</div>;

  return (
    <div className="search-panel">
      {showSearchBar ? <div className="search-bar-row">
        <div className="search-input-wrap"><MagnifyingGlass size={18} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSearch(); }} placeholder="Search title, artist, or a direct link" aria-label="Search music" /></div>
        <Dropdown className="source-dropdown" value={source} onChange={setSource} label="Search source" options={SOURCE_OPTIONS} align="end" />
        <button className="primary-button" type="button" onClick={onSearch}><MagnifyingGlass size={17} weight="bold" aria-hidden="true" /> Search</button>
      </div> : null}
      {directLink ? <div className="search-caption"><span>Direct link detected — the source picker is ignored</span></div> : null}
      {status === "searching" && !isRefreshing ? <div className="skeleton-list" aria-label="Loading search results"><span /><span /><span /></div> : null}
      {!directLink && status !== "searching" && correction ? <div className="search-correction" role="status">
        <span>Showing results for <button className="search-correction-query" type="button" onClick={() => setQuery(correction.query)}>{correction.query}</button></span>
        <span className="search-correction-original">Search instead for <button type="button" onClick={() => onSearchExact?.(correction.original)}>{correction.original}</button></span>
      </div> : null}
      {!directLink && status !== "searching" && suggestions.length > 0 ? <div className="search-suggestions" aria-label="Suggested searches">{suggestions.slice(0, 6).map((suggestion) => (
        <button className="search-suggestion" type="button" key={suggestion} onClick={() => setQuery(suggestion)}><MagnifyingGlass size={13} aria-hidden="true" /> {suggestion}</button>
      ))}</div> : null}
      {status === "error" ? <div className="inline-error"><WarningCircle size={18} aria-hidden="true" /> Search is temporarily unavailable. Check the Lavalink connection.</div> : null}
      {directLink ? <section className="direct-link-card" aria-label="Direct music link ready">
        <div className="direct-link-icon"><LinkSimple size={22} weight="bold" aria-hidden="true" /></div>
        <div className="direct-link-copy">
          <strong>Ready to play this link</strong>
          <span><SourceTag source={directLink.source} /> Original provider resolution — no search substitute.</span>
          <code title={directLink.url}>{directLink.url}</code>
        </div>
        <div className="direct-link-actions">
          <button className="result-action" type="button" onClick={() => onAction("play", { query: directLink.url, source: directSource, playNow: true, trackId: directLink.url })} disabled={isActionPending(`play:${directLink.url}`)} aria-busy={isActionPending(`play:${directLink.url}`) || undefined}>{isActionPending(`play:${directLink.url}`) ? <SpinnerGap className="button-spinner" size={16} aria-hidden="true" /> : <Play size={16} weight="fill" aria-hidden="true" />} Play now</button>
          <button className="secondary-button" type="button" onClick={() => onAction("play", { query: directLink.url, source: directSource, trackId: directLink.url })} disabled={isActionPending(`play:${directLink.url}`)} aria-busy={isActionPending(`play:${directLink.url}`) || undefined}>{isActionPending(`play:${directLink.url}`) ? <SpinnerGap className="button-spinner" size={16} aria-hidden="true" /> : <Plus size={16} weight="bold" aria-hidden="true" />} Add to queue</button>
        </div>
      </section> : null}
      {!directLink && status === "empty" && !libraryResults.length ? <div className="empty-state compact"><MagnifyingGlass size={30} weight="duotone" aria-hidden="true" /><strong>No close matches</strong><span>Try the artist name, a direct URL, or another source.</span></div> : null}
      {!directLink && libraryResults.length > 0 ? <section className="search-library" aria-label="From your library">
        <h3 className="search-section-title">From your library</h3>
        {resultList(libraryResults)}
      </section> : null}
      {!directLink && (status !== "searching" || isRefreshing) && topResult ? <div className={`search-sections ${isRefreshing ? "is-refreshing" : ""}`} aria-busy={isRefreshing || undefined}>
        <section className="search-top" aria-label="Top result">
          <h3 className="search-section-title">Top result</h3>
          <div className="search-top-card">
            <div className="search-top-artwork"><Artwork track={topResult} size="large" /></div>
            <div className="search-top-copy">
              <strong title={topResult.title}>{topResult.title}</strong>
              <span>{topResult.author} · {sourceLabel(topResult.source)}{topResult.durationMs ? ` · ${formatTime(topResult.durationMs)}` : ""}</span>
              <div className="search-top-actions">
                <button className="result-action" type="button" onClick={() => playTrack(topResult, true)} disabled={isActionPending(`play:${topResult.id}`)} aria-busy={isActionPending(`play:${topResult.id}`) || undefined}>{isActionPending(`play:${topResult.id}`) ? <SpinnerGap className="button-spinner" size={16} aria-hidden="true" /> : <Play size={16} weight="fill" aria-hidden="true" />} Play</button>
                <button className="secondary-button" type="button" onClick={() => playTrack(topResult, false)} disabled={isActionPending(`play:${topResult.id}`)}><Plus size={16} weight="bold" aria-hidden="true" /> Add to queue</button>
              </div>
            </div>
          </div>
        </section>
        {artistIds.size > 0 ? <section className="search-group" aria-label={`More from ${topResult.author}`}>
          <h3 className="search-section-title">More from {topResult.author}</h3>
          {resultList(artistResults)}
        </section> : null}
        {songResults.length > 0 ? <section className="search-group" aria-label="Songs">
          <h3 className="search-section-title">Songs</h3>
          {resultList(songResults)}
        </section> : null}
        {similarShown.length > 0 ? <section className="search-group" aria-label="Similar songs">
          <h3 className="search-section-title">Similar to {results[0]?.title}</h3>
          {resultList(similarShown)}
        </section> : null}
      </div> : null}
    </div>
  );
}

function PlaylistsPanel({ playlists, currentTrack, selectedPlaylist, playlistDetail, likedTrackIds = [], composerOpen = false, onComposerClose, onAction }) {
  const [name, setName] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importName, setImportName] = useState("");
  const [composerTab, setComposerTab] = useState("create");
  const [editor, setEditor] = useState(null);
  const [sortMode, setSortMode] = useState("recent");
  const composerRef = useRef(null);
  const composerReturnFocusRef = useRef(null);
  const selectedSummary = playlists.find((playlist) => playlist.name === selectedPlaylist) || playlists.find((playlist) => playlist.id === selectedPlaylist);

  useEffect(() => {
    if (selectedPlaylist === null) {
      setEditor(null);
      setSortMode("recent");
    }
  }, [selectedPlaylist]);

  useEffect(() => {
    if (playlistDetail) setEditor({ ...playlistDetail, newName: playlistDetail.name });
  }, [playlistDetail]);

  useEffect(() => {
    if (composerOpen) setComposerTab("create");
  }, [composerOpen]);

  const closeComposer = useCallback(() => {
    onComposerClose?.();
    window.requestAnimationFrame(() => composerReturnFocusRef.current?.focus?.());
  }, [onComposerClose]);

  useEffect(() => {
    if (!composerOpen) return undefined;
    composerReturnFocusRef.current = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeComposer();
        return;
      }
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && document.activeElement?.getAttribute("role") === "tab") {
        event.preventDefault();
        const nextTab = composerTab === "create" ? "import" : "create";
        setComposerTab(nextTab);
        window.requestAnimationFrame(() => composerRef.current?.querySelector(`[data-composer-tab="${nextTab}"]`)?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(composerRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(document.activeElement);
      if (event.shiftKey && (currentIndex <= 0 || currentIndex === -1)) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeComposer, composerOpen, composerTab]);

  const sortedTracks = useMemo(() => {
    const tracks = (editor?.tracks || []).map((track, index) => ({ track, index }));
    return tracks.sort((left, right) => {
      const a = left.track;
      const b = right.track;
      if (sortMode === "title") {
        return String(a.title || "").localeCompare(String(b.title || ""), undefined, { numeric: true, sensitivity: "base" }) || left.index - right.index;
      }
      if (sortMode === "artist") {
        return String(a.author || "").localeCompare(String(b.author || ""), undefined, { numeric: true, sensitivity: "base" })
          || String(a.title || "").localeCompare(String(b.title || ""), undefined, { numeric: true, sensitivity: "base" })
          || left.index - right.index;
      }
      if (sortMode === "duration-desc") return Number(b.durationMs || 0) - Number(a.durationMs || 0) || left.index - right.index;
      if (sortMode === "duration-asc") return Number(a.durationMs || 0) - Number(b.durationMs || 0) || left.index - right.index;
      return (Number(b.addedAt) || right.index) - (Number(a.addedAt) || left.index) || right.index - left.index;
    });
  }, [editor?.tracks, sortMode]);

  const submit = () => { if (!name.trim()) return; onAction("create_playlist", { name: name.trim() }); setName(""); closeComposer(); };
  const submitImport = () => { if (!importUrl.trim()) return; onAction("import_playlist", { url: importUrl.trim(), name: importName.trim() }); setImportUrl(""); setImportName(""); closeComposer(); };
  const selectedName = editor?.name || selectedSummary?.name;
  const saveEditor = () => {
    if (!editor || !selectedName) return;
    onAction("update_playlist", {
      name: selectedName,
      newName: editor.newName,
      description: editor.description,
      thumbnail: editor.thumbnail,
      public: editor.public,
      collaborative: editor.collaborative,
    });
  };
  return (
    <div className="playlists-panel">
      {editor ? <section className="playlist-detail" aria-label={`${editor.name} playlist editor`}>
        <div className="playlist-detail-heading"><div><span className="sidebar-kicker">PLAYLIST EDITOR</span><h3>{editor.name}</h3><span>{editor.tracks?.length || 0} tracks</span></div><div className="playlist-detail-actions"><button className="primary-button" type="button" onClick={() => onAction("play_playlist", { name: editor.name })}><Play size={15} weight="fill" aria-hidden="true" /> Play</button><button className="secondary-button" type="button" onClick={() => onAction("play_playlist", { name: editor.name, shuffle: true })}><Shuffle size={15} aria-hidden="true" /> Shuffle</button>{!editor.isDefault ? <button className="ghost-button danger-button" type="button" onClick={() => onAction("delete_playlist", { name: editor.name })}><Trash size={15} aria-hidden="true" /> Delete</button> : null}</div></div>
        <div className="playlist-editor-grid"><label>Name<input value={editor.newName ?? editor.name} disabled={editor.isDefault} onChange={(event) => setEditor((value) => ({ ...value, newName: event.target.value }))} /></label><label>Description<textarea value={editor.description || ""} onChange={(event) => setEditor((value) => ({ ...value, description: event.target.value }))} rows="2" /></label><label>Artwork URL<input value={editor.thumbnail || ""} onChange={(event) => setEditor((value) => ({ ...value, thumbnail: event.target.value }))} placeholder="https://…" /></label><div className="playlist-checks"><label className={`playlist-check-toggle ${editor.public ? "is-on" : ""}`}><input type="checkbox" checked={Boolean(editor.public)} disabled={editor.isDefault} onChange={(event) => setEditor((value) => ({ ...value, public: event.target.checked }))} /><Globe size={16} aria-hidden="true" /><span><strong>Public</strong><small>Visible to shared listeners</small></span></label><label className={`playlist-check-toggle ${editor.collaborative ? "is-on" : ""}`}><input type="checkbox" checked={Boolean(editor.collaborative)} disabled={editor.isDefault} onChange={(event) => setEditor((value) => ({ ...value, collaborative: event.target.checked }))} /><UsersThree size={16} aria-hidden="true" /><span><strong>Collaborative</strong><small>Let others add tracks</small></span></label><button className="secondary-button" type="button" onClick={saveEditor}><Check size={15} weight="bold" aria-hidden="true" /> Save changes</button></div></div>
        <div className="playlist-detail-toolbar"><strong>Tracks</strong><label className="playlist-sort-control"><span>Sort</span><Dropdown value={sortMode} onChange={setSortMode} label="Sort playlist tracks" options={PLAYLIST_SORT_OPTIONS} align="end" /></label></div>
        <div className="playlist-track-list">{sortedTracks.length ? sortedTracks.map(({ track, index }) => <div className="playlist-track-row" key={`${track.id}-${index}`}><Artwork track={track} size="small" /><div className="playlist-track-copy"><strong>{track.title}</strong><span>{track.author}</span><SourceTag source={track.source} /></div><span className="playlist-track-duration">{formatTime(track.durationMs)}</span><TrackSaveActions track={track} playlists={playlists} likedTrackIds={likedTrackIds} onAction={onAction} className="playlist-track-save-actions" /><button className="playlist-action danger-button" type="button" onClick={() => onAction("remove_playlist_track", { name: editor.name, position: index })} title="Remove track"><Trash size={15} aria-hidden="true" /></button></div>) : <div className="empty-state compact"><MusicNotes size={30} weight="duotone" aria-hidden="true" /><strong>Playlist is empty</strong><span>Add the current track or save one from search.</span></div>}</div>
      </section> : null}
      {!editor ? <div className="empty-state compact playlist-selection-empty"><VinylRecord size={30} weight="duotone" aria-hidden="true" /><strong>{selectedSummary ? `Opening ${selectedSummary.name}` : "Select a playlist to edit"}</strong><span>Choose a playlist from Your Library on the left.</span></div> : null}
      {composerOpen ? <div className="playlist-composer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeComposer(); }}>
        <section ref={composerRef} className="playlist-composer" role="dialog" aria-modal="true" aria-labelledby="playlist-composer-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="playlist-composer-heading"><div><span className="sidebar-kicker">YOUR LIBRARY</span><h3 id="playlist-composer-title">Add a playlist</h3></div><button className="icon-button" type="button" onClick={closeComposer} aria-label="Close playlist dialog" title="Close"><X size={17} aria-hidden="true" /></button></div>
          <div className="playlist-composer-tabs" role="tablist" aria-label="Playlist actions"><button data-composer-tab="create" id="playlist-tab-create" type="button" role="tab" aria-controls="playlist-panel-create" aria-selected={composerTab === "create"} className={composerTab === "create" ? "is-active" : ""} onClick={() => setComposerTab("create")}><Plus size={15} weight="bold" aria-hidden="true" /> Create</button><button data-composer-tab="import" id="playlist-tab-import" type="button" role="tab" aria-controls="playlist-panel-import" aria-selected={composerTab === "import"} className={composerTab === "import" ? "is-active" : ""} onClick={() => setComposerTab("import")}><UploadSimple size={15} aria-hidden="true" /> Import</button></div>
          {composerTab === "create" ? <form id="playlist-panel-create" className="playlist-composer-form" role="tabpanel" aria-labelledby="playlist-tab-create" onSubmit={(event) => { event.preventDefault(); submit(); }}><label>Playlist name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Night Drive" aria-label="New playlist name" /></label><div className="playlist-composer-actions"><button className="secondary-button" type="button" onClick={closeComposer}>Cancel</button><button className="primary-button" type="submit" disabled={!name.trim()}><Plus size={15} weight="bold" aria-hidden="true" /> Create playlist</button></div></form> : <form id="playlist-panel-import" className="playlist-composer-form" role="tabpanel" aria-labelledby="playlist-tab-import" onSubmit={(event) => { event.preventDefault(); submitImport(); }}><label>Playlist URL<input autoFocus value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="Paste Spotify, YouTube, SoundCloud or Deezer URL" aria-label="Playlist URL" /></label><label>Playlist name <span className="field-hint">optional</span><input value={importName} onChange={(event) => setImportName(event.target.value)} placeholder="Use the provider name if empty" aria-label="Imported playlist name" /></label><div className="playlist-composer-actions"><button className="secondary-button" type="button" onClick={closeComposer}>Cancel</button><button className="primary-button" type="submit" disabled={!importUrl.trim()}><UploadSimple size={15} aria-hidden="true" /> Import playlist</button></div></form>}
        </section>
      </div> : null}
    </div>
  );
}

function GlobalSearch({ query, setQuery, source, setSource, onSearch, onFocus }) {
  return (
    <div className="global-search">
      <MagnifyingGlass size={18} aria-hidden="true" />
      <input
        value={query}
        onFocus={onFocus}
        onChange={(event) => { onFocus?.(); setQuery(event.target.value); }}
        onKeyDown={(event) => { if (event.key === "Enter") onSearch(); }}
        placeholder="What do you want to play?"
        aria-label="Search music"
      />
      <Dropdown className="source-dropdown" value={source} onChange={setSource} label="Search source" options={SOURCE_OPTIONS} align="end" />
      <button className="global-search-submit" type="button" onClick={onSearch} aria-label="Search music" title="Search music">
        <MagnifyingGlass size={17} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}

function PlaylistSidebar({ playlists, selectedPlaylist, onSelect, onCreate, onAction, onToggle, loading = false }) {
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null);
  const rowRefs = useRef({});
  const guards = useSmartMenuGuards(Boolean(menu), null, menuRef, () => setMenu(null));
  const closeMenu = () => { guards.clearCloseTimer(); setMenu(null); };
  const openMenuAt = (playlistId, x, y) => setMenu({
    id: playlistId,
    top: Math.max(10, Math.min(y + 4, window.innerHeight - 200)),
    left: Math.max(10, Math.min(x + 4, window.innerWidth - 246)),
  });
  const menuPlaylist = menu ? (playlists || []).find((playlist) => playlist.id === menu.id) : null;

  return (
    <div className="sidebar-content library-sidebar-content">
      <div className="sidebar-heading library-heading"><button className="drawer-close" type="button" aria-label="Close playlists panel" onClick={onToggle}><X size={16} aria-hidden="true" /></button>
        <h2>Library</h2>
        <span className="library-count">{loading ? "…" : (playlists || []).length}</span>
      </div>
      {loading ? <div className="sidebar-skeletons" aria-label="Loading playlists"><span /><span /><span /></div> : (
        <div className="library-stack">
          <div className="playlist-nav-list">
            {(playlists || []).map((playlist) => (
              <button
                ref={(node) => { if (node) rowRefs.current[playlist.id] = node; }}
                className={`playlist-nav-row ${selectedPlaylist === playlist.id ? "is-active" : ""}`}
                type="button"
                key={playlist.id}
                onClick={() => onSelect(playlist.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openMenuAt(playlist.id, event.clientX, event.clientY);
                }}
                aria-haspopup="menu"
              >
                {/^liked songs$/i.test(playlist.name || "")
                  ? <span className="library-tile liked-tile"><Heart size={18} aria-hidden="true" /></span>
                  : <Artwork track={{ title: playlist.name, artworkUrl: playlist.thumbnail }} size="small" />}
                <span className="library-row-text"><strong>{playlist.name}</strong><small>{playlist.trackCount} tracks</small></span>
              </button>
            ))}
          </div>
          <button className="library-row new-playlist" type="button" onClick={onCreate}>
            <span className="library-tile new-tile"><Plus size={16} weight="bold" aria-hidden="true" /></span>
            <span className="library-row-text"><strong>New playlist</strong></span>
          </button>
        </div>
      )}
      {(menuPlaylist ? (<SmartMenu open position={menu} rootRef={rowRefs.current[menuPlaylist.id]} menuRef={menuRef} label={`Actions for ${menuPlaylist.name}`}>
        <>
          <button type="button" role="menuitem" className="row-menu-item" onClick={() => { onAction("play_playlist", { name: menuPlaylist.name }); closeMenu(); }}>
            <Play size={15} weight="fill" aria-hidden="true" /><span>Play playlist</span>
          </button>
          <button type="button" role="menuitem" className="row-menu-item" onClick={() => { onSelect(menuPlaylist.id); closeMenu(); }}>
            <MusicNotes size={15} aria-hidden="true" /><span>Open playlist</span>
          </button>
          <span className="row-menu-divider" aria-hidden="true" />
          <button type="button" role="menuitem" className="row-menu-item" onClick={() => { navigator.clipboard?.writeText(menuPlaylist.name).catch(() => {}); closeMenu(); }}>
            <CopySimple size={15} aria-hidden="true" /><span>Copy name</span>
          </button>
          {menuPlaylist && !menuPlaylist.isDefault ? (
            <button type="button" role="menuitem" className="row-menu-item row-menu-danger" onClick={() => { onAction("delete_playlist", { name: menuPlaylist.name }); closeMenu(); }}>
              <Trash size={15} aria-hidden="true" /><span>Delete playlist</span>
            </button>
          ) : null}
        </>
      </SmartMenu>) : null)}
    </div>
  );
}

function QueueSidebar({ queue, history = [], sessionStartedAt = null, playlists = [], likedTrackIds = [], queueOpen, onToggleQueue, onAction, isActionPending, loading = false }) {
  const [view, setView] = useState("queue");
  const showingHistory = view === "history";

  return (
    <div className="sidebar-content queue-sidebar-content">
      <div className="sidebar-heading"><button className="drawer-close" type="button" aria-label="Close queue panel" onClick={onToggleQueue}><X size={16} aria-hidden="true" /></button>
        <h2>{showingHistory ? "History" : "Queue"}</h2>
        <div className="queue-head-meta">
          <span className="queue-upnext">{loading ? "…" : (showingHistory ? `${history.length} played` : `${queue.length} up next`)}</span>
          <IconButton label={showingHistory ? "Show queue" : "Show playback history"} className={`queue-history-button ${showingHistory ? "is-active" : ""}`} onClick={() => setView((current) => current === "queue" ? "history" : "queue")} disabled={loading} aria-pressed={showingHistory}><ClockCounterClockwise size={16} aria-hidden="true" /></IconButton>
          {!showingHistory ? <IconButton label="Clear queue" loading={isActionPending("clear_queue")} onClick={() => onAction("clear_queue")} disabled={loading || !queue.length}><Trash size={16} aria-hidden="true" /></IconButton> : null}
        </div>
      </div>
      {loading ? <div className="queue-skeletons" aria-label="Loading queue"><span /><span /><span /></div> : (showingHistory ? <QueueHistoryPanel history={history} sessionStartedAt={sessionStartedAt} /> : <QueuePanel queue={queue} playlists={playlists} likedTrackIds={likedTrackIds} onAction={onAction} isActionPending={isActionPending} />)}
    </div>
  );
}

function ActivityLoader({ message, leaving }) {
  return (
    <section
      className={`activity-loader ${leaving ? "is-leaving" : ""}`}
      aria-label="MewBit is connecting to the listening room"
      aria-live="polite"
      aria-busy="true"
    >
        <div className="loader-ambient loader-ambient-cyan" aria-hidden="true" />
        <div className="loader-ambient loader-ambient-magenta" aria-hidden="true" />
        <div className="loader-content">
          <div className="loader-signal" aria-hidden="true">
            <div className="loader-signal-echo loader-signal-echo-back" />
            <div className="loader-signal-echo loader-signal-echo-mid" />
            <div className="loader-signal-panel">
              <div className="loader-signal-heading">
                <Waveform size={15} weight="bold" />
                <span>ROOM SIGNAL</span>
              </div>
              <div className="loader-spectrum">
                {Array.from({ length: 13 }, (_, index) => <i key={index} style={{ "--bar-index": index }} />)}
              </div>
              <div className="loader-scan" />
              <div className="loader-signal-footer">
                <span>MEWBIT</span>
                <div><i /><i /><i /></div>
              </div>
            </div>
            <div className="loader-packets"><i /><i /><i /></div>
          </div>
        <div className="loader-copy">
          <span className="loader-kicker"><i /> MEWBIT LINK</span>
          <h1>Tuning into the room</h1>
          <p>{message || "Synchronizing player state"}</p>
        </div>
        <div className="loader-progress" role="progressbar" aria-label="Connecting">
          <span />
        </div>
        <div className="loader-steps" aria-hidden="true">
          <span>Discord</span><i />
          <span>Gateway</span><i />
          <span>Player</span>
        </div>
      </div>
    </section>
  );
}

function PlayerBar({ state, onAction, onView, onOpenExternalLink, isActionPending }) {
  const { player } = state;
  const isMuted = Boolean(player.muted);
  const position = usePlayerPosition(player);
  const track = player.currentTrack;
  const duration = Math.max(player.durationMs || track?.durationMs || 0, 1);
  const progress = clamp(position, 0, duration);
  const volume = clamp(Number(player.volume || 0), 0, 100);
  const isPlaying = player.playing && !player.paused;
  const seekSlider = useBufferedSlider(progress, { acknowledgementTolerance: 1500, optimisticLockMs: 1800 });
  const volumeSlider = useBufferedSlider(volume);
  const [titleMenu, setTitleMenu] = useState(null);
  const titleRef = useRef(null);
  const titleMenuRef = useRef(null);
  const titleGuards = useSmartMenuGuards(Boolean(titleMenu), titleRef, titleMenuRef, () => setTitleMenu(null));
  const closeTitleMenu = () => { titleGuards.clearCloseTimer(); setTitleMenu(null); };
  const isLiked = track ? state.likedTrackIds.includes(track.id) || state.likedTrackIds.includes(getTrackLikeKey(track)) : false;
  const trackLinkUrl = [track?.uri, track?.playQuery].find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) || null;

  const commitSeek = (nextValue) => onAction("seek", { positionMs: seekSlider.commit(nextValue) });
  const previewVolume = (nextValue) => {
    const nextVolume = volumeSlider.update(nextValue);
    onAction("volume-preview", { volume: nextVolume });
  };
  const commitVolume = (nextValue) => onAction("volume", { volume: volumeSlider.commit(nextValue) });

  const openFullPlayerFromBackground = (event) => {
    if (event.target.closest("button, a, input, .row-context-menu")) return;
    if (event.target.closest(".player-bar-track")) return;
    onView("home");
  };

  return (
    <footer className="player-bar" onClick={openFullPlayerFromBackground} title="Open full player">
      <div className="player-bar-leading">
        <div className="player-bar-track">
          <Artwork track={track} size="small" />
          <span className="bar-track-copy">
            <strong>
              {track ? (
                <button
                  ref={titleRef}
                  className="bar-title-link"
                  type="button"
                  disabled={!trackLinkUrl}
                  onClick={(event) => { event.stopPropagation(); onOpenExternalLink?.(trackLinkUrl, track.title); }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setTitleMenu({
                      top: Math.max(10, Math.min(event.clientY + 6, window.innerHeight - 260)),
                      left: Math.max(10, Math.min(event.clientX - 10, window.innerWidth - 246)),
                    });
                  }}
                  aria-haspopup="menu"
                  title={trackLinkUrl ? "Open the original track page" : undefined}
                >{track.title}</button>
              ) : "Nothing is playing"}
            </strong>
            <small>{track?.author || "Choose a track to start the room"}</small>
          </span>
        </div>
        {track ? (
          <IconButton label={isLiked ? "Remove from liked songs" : "Add to liked songs"} className={`like-button ${isLiked ? "is-liked" : ""}`} loading={isActionPending(`toggle_like:${track?.id}`)} onClick={() => onAction("toggle_like", { track })} aria-pressed={isLiked}>
            <Heart size={16} weight={isLiked ? "fill" : "regular"} aria-hidden="true" />
          </IconButton>
        ) : null}
        <IconButton label={player.autoplay ? "Disable autoplay" : "Enable autoplay"} className={`bar-autoplay ${player.autoplay ? "is-active" : ""}`} loading={isActionPending("autoplay")} onClick={() => onAction("autoplay", { enabled: !player.autoplay })} aria-pressed={player.autoplay}>
          <Sparkle size={16} weight={player.autoplay ? "fill" : "regular"} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="player-bar-center">
        <div className="bar-controls">
          {track ? <SourceTag source={track.source} /> : null}
          <IconButton label={`Loop mode ${player.loop}`} className={`bar-loop ${player.loop !== "NONE" ? "is-active" : ""}`} loading={isActionPending("loop")} onClick={() => onAction("loop")} disabled={!track}><Repeat size={16} weight={player.loop !== "NONE" ? "fill" : "regular"} aria-hidden="true" /></IconButton>
          <IconButton label="Play previous track" className="bar-previous" loading={isActionPending("previous")} onClick={() => onAction("previous")} disabled={!track}><SkipBack size={17} weight="regular" aria-hidden="true" /></IconButton>
          <button className="bar-play" type="button" aria-label={isPlaying ? "Pause track" : "Play track"} onClick={() => onAction("toggle")} disabled={!track || isActionPending("toggle")} aria-busy={isActionPending("toggle") || undefined}>{isActionPending("toggle") ? <SpinnerGap className="button-spinner" size={18} aria-hidden="true" /> : isPlaying ? <Pause size={18} weight="fill" aria-hidden="true" /> : <Play size={18} weight="fill" aria-hidden="true" />}</button>
          <IconButton label="Stop playback and clear queue" className="bar-stop" loading={isActionPending("stop")} onClick={() => onAction("stop")} disabled={!track}><Stop size={16} weight="fill" aria-hidden="true" /></IconButton>
          <IconButton label="Skip track" className="bar-skip" loading={isActionPending("skip")} onClick={() => onAction("skip", { expectedTrackId: track?.id })} disabled={!track}><SkipForward size={17} weight="regular" aria-hidden="true" /></IconButton>
          <IconButton label="Shuffle queue" className="bar-shuffle" loading={isActionPending("shuffle")} onClick={() => onAction("shuffle")} disabled={!track}><Shuffle size={16} weight="regular" aria-hidden="true" /></IconButton>
        </div>
        <div className="bar-progress">
          <span>{formatTime(seekSlider.value)}</span>
          <input className="range range-progress" type="range" min="0" max={duration} value={seekSlider.value} aria-label="Seek through current track" style={{ "--range-progress": `${(seekSlider.value / duration) * 100}%` }} onPointerDown={seekSlider.begin} onPointerCancel={(event) => commitSeek(event.currentTarget.value)} onChange={(event) => seekSlider.update(event.target.value)} onPointerUp={(event) => commitSeek(event.currentTarget.value)} onKeyDown={(event) => { if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") seekSlider.begin(); }} onKeyUp={(event) => { if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") commitSeek(); }} disabled={!track} />
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <div className="player-bar-actions">
        <IconButton label="Open lyrics" onClick={() => onView("lyrics")} disabled={!track}><Subtitles size={17} weight="regular" aria-hidden="true" /></IconButton>
        <IconButton label={isMuted ? "Unmute player" : "Mute player"} className={isMuted ? "is-muted" : ""} loading={isActionPending("toggle_mute")} onClick={() => onAction("toggle_mute")} aria-pressed={isMuted}>{isMuted ? <SpeakerSlash size={17} weight="fill" aria-hidden="true" /> : <SpeakerHigh size={17} weight="fill" aria-hidden="true" />}</IconButton>
        <VolumeSlider className="bar-volume-control" slider={volumeSlider} onPreview={previewVolume} onCommit={commitVolume} />
      </div>
      <SmartMenu open={Boolean(titleMenu)} position={titleMenu || { top: 0, left: 0 }} rootRef={titleRef} menuRef={titleMenuRef} label={`Actions for ${track?.title || "track"}`}>
        <>
          <TrackMenuActions track={track} playlists={state.playlists} likedTrackIds={state.likedTrackIds} onAction={onAction} onClose={closeTitleMenu} />
        </>
      </SmartMenu>
    </footer>
  );
}

function App() {
  const [state, setState] = useState(() => {
    if (!import.meta.env.DEV) return createEmptyState();
    return createMockState({ idle: MOCK_IDLE_PREVIEW });
  });
  const [context, setContext] = useState({ mode: "local", guildId: "demo", accessToken: null, user: { username: "Local Listener" } });
  const [connection, setConnection] = useState({ status: "connecting", message: "Starting Activity" });
  const [activeTab, setActiveTab] = useState("home");
  const [externalLinkRequest, setExternalLinkRequest] = useState(null);
  const [soundSection, setSoundSection] = useState("effects");
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 900);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 900);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [selectedPlaylistDetail, setSelectedPlaylistDetail] = useState(null);
  const [playlistComposerOpen, setPlaylistComposerOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [pendingActions, setPendingActions] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSource, setSearchSource] = useState("auto");
  const [searchResults, setSearchResults] = useState([]);
  const [searchStatus, setSearchStatus] = useState("idle");
  // The server's "showing results for" correction and related searches, plus
  // the query the user asked to search exactly as typed instead.
  const [searchMeta, setSearchMeta] = useState({ correction: null, suggestions: [] });
  const [exactSearchQuery, setExactSearchQuery] = useState("");
  const [libraryResults, setLibraryResults] = useState([]);
  const [similarResults, setSimilarResults] = useState([]);
  const [isHydrating, setIsHydrating] = useState(true);
  const [showLoader, setShowLoader] = useState(true);
  const hydrationStartedAt = useRef(Date.now());
  const hydrationTimer = useRef(null);
  const appliedSnapshot = useRef({ revision: -1, generatedAt: -1 });
  const searchRequest = useRef({ id: 0, controller: null });
  const actionQueue = useRef(Promise.resolve());
  const controlActionQueue = useRef(Promise.resolve());
  const coalescedActions = useRef(new Map());
  const pendingActionCounts = useRef(new Map());
  const localUndoSnapshots = useRef(new Map());
  const stateRef = useRef(state);
  const seenActivityEventIds = useRef(new Set());
  const activityFeedReady = useRef(false);
  // This timestamp tracks the last accepted player-state snapshot, not the
  // WebSocket transport heartbeat. A healthy socket can still stop delivering
  // state messages, and transport pongs must not hide that condition.
  const lastActivityStateAt = useRef(0);
  const isCompactViewport = useCompactViewport();
  const isCompact = MOCK_COMPACT_PREVIEW || isCompactViewport;
  const isDrawerViewport = useMediaQuery("(max-width: 900px)");
  // Sidebars open by default on a wide stage. When Discord shrinks the window
  // into drawer range they would both stay open and cover the player, so
  // crossing into it closes them; the user reopens one at a time from there.
  useEffect(() => {
    if (!isDrawerViewport) return;
    setLeftSidebarOpen(false);
    setRightSidebarOpen(false);
  }, [isDrawerViewport]);
  const activityEvents = state.activity?.events || [];
  const hasActivityErrors = activityEvents.some((event) => event.level === "error" || event.level === "warning");
  const appShellRef = useRef(null);
  const activityReturnTab = useRef("home");

  useEffect(() => {
    if (!isDrawerViewport || (!leftSidebarOpen && !rightSidebarOpen)) return undefined;
    const openDrawer = appShellRef.current?.querySelector(leftSidebarOpen ? ".sidebar-left .sidebar-content" : ".sidebar-right .sidebar-content");
    const closeButton = openDrawer?.querySelector(".drawer-close");
    const focusableSelector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])";
    window.requestAnimationFrame(() => closeButton?.focus());
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setLeftSidebarOpen(false);
        setRightSidebarOpen(false);
        return;
      }
      if (event.key !== "Tab" || !openDrawer) return;
      const focusable = [...openDrawer.querySelectorAll(focusableSelector)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isDrawerViewport, leftSidebarOpen, rightSidebarOpen]);

  const goToView = useCallback((view) => {
    setActiveTab((current) => {
      if (view === "activity") {
        if (current === "activity") return activityReturnTab.current || "home";
        activityReturnTab.current = current || "home";
        return "activity";
      }
      if (current !== "activity") activityReturnTab.current = view;
      return view;
    });
  }, []);

  const showToast = useCallback((message, type = "info", action = null) => {
    setToast({ message, type, action });
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const requestExternalLink = useCallback((url, title) => {
    if (!/^https?:\/\//i.test(String(url || ""))) {
      showToast("This track does not have an external source page.", "error");
      return;
    }
    setExternalLinkRequest({ url, title });
  }, [showToast]);

  const confirmExternalLink = useCallback(async () => {
    const request = externalLinkRequest;
    if (!request) return;
    setExternalLinkRequest(null);
    try {
      await openExternalLink(context.sdk, request.url);
    } catch (error) {
      showToast(error.message || "Could not open the browser.", "error");
    }
  }, [context.sdk, externalLinkRequest, showToast]);

  useEffect(() => {
    const events = state.activity?.events || [];
    if (!activityFeedReady.current) {
      events.forEach((event) => seenActivityEventIds.current.add(event.id));
      activityFeedReady.current = true;
      return;
    }

    const incoming = events.filter((event) => !seenActivityEventIds.current.has(event.id));
    incoming.forEach((event) => seenActivityEventIds.current.add(event.id));
    const latestIssue = incoming.find((event) => event.level === "error" || event.level === "warning");
    if (latestIssue) showToast([latestIssue.title, latestIssue.detail].filter(Boolean).join(": "), latestIssue.level === "error" ? "error" : "info");
  }, [state.activity?.events, showToast]);

  const applyState = useCallback((nextState) => {
    if (!nextState) return false;
    const revision = Number(nextState.revision ?? 0);
    const generatedAt = Number(nextState.generatedAt ?? nextState.player?.updatedAt ?? 0);
    const current = appliedSnapshot.current;
    if (revision < current.revision || (revision === current.revision && generatedAt < current.generatedAt)) return false;
    appliedSnapshot.current = { revision, generatedAt };
    setState(nextState);
    return true;
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Rich Presence is a per-user Discord Activity feature. Keep the payload
  // event-driven so the 4 Hz player clock does not spam Discord RPC.
  useEffect(() => {
    if (context.mode !== "discord" || !context.sdk) return undefined;
    setMewbitPresence(context.sdk, state.player).catch(() => {
      // Presence is an enhancement; a denied scope or an older Discord client
      // must not make the shared player appear broken.
    });
    return undefined;
  }, [
    context.mode,
    context.sdk,
    state.player.currentTrack?.id,
    state.player.currentTrack?.title,
    state.player.currentTrack?.author,
    state.player.currentTrack?.source,
    state.player.currentTrack?.artworkUrl,
    state.player.currentTrack?.artworkFallbackUrl,
    state.player.playing,
    state.player.paused,
    state.player.buffering,
    state.player.autoplay,
    state.player.loop,
    state.player.shuffleActive,
  ]);

  const finishHydration = useCallback(() => {
    const remaining = Math.max(0, 720 - (Date.now() - hydrationStartedAt.current));
    window.clearTimeout(hydrationTimer.current);
    hydrationTimer.current = window.setTimeout(() => setIsHydrating(false), remaining);
  }, []);

  useEffect(() => {
    if (isHydrating) return undefined;
    const timer = window.setTimeout(() => setShowLoader(false), 320);
    return () => window.clearTimeout(timer);
  }, [isHydrating]);

  useEffect(() => {
    let stopSocket = null;
    let healthWatchTimer = null;
    let reconciliationInFlight = false;
    let alive = true;

    setupDiscord()
      .then(async (nextContext) => {
        if (!alive) return;
        setContext(nextContext);

        /* Launched from a DM or a group DM there is no guild, so there is no
           room, no queue and nothing to play into. Reconciling anyway would
           make the gateway answer about a server that was never involved. */
        if (nextContext.mode === "discord" && nextContext.inGuild === false) {
          setConnection({ status: "no-guild", message: "This conversation has no voice channel." });
          finishHydration();
          return;
        }

        const connectLocalPreview = nextContext.mode === "local" && import.meta.env.VITE_ACTIVITY_CONNECT_LOCAL === "true";
        if (nextContext.mode === "local" && !connectLocalPreview) {
          setConnection({ status: "preview", message: nextContext.reason || "Local Activity preview" });
          finishHydration();
          return;
        }

        const reconcile = async ({ quiet = true } = {}) => {
          if (!alive || reconciliationInFlight) return false;
          reconciliationInFlight = true;
          try {
            const response = await fetchActivityState(nextContext);
            if (alive && response.state) {
              if (applyState(response.state)) lastActivityStateAt.current = Date.now();
              setConnection({ status: "live", message: "Realtime gateway connected" });
              return true;
            }
          } catch (error) {
            if (!quiet && alive && nextContext.mode === "discord") {
              setConnection({ status: "reconnecting", message: "State sync failed — waiting for realtime recovery" });
            }
          } finally {
            reconciliationInFlight = false;
          }
          return false;
        };

        try {
          const response = await fetchActivityState(nextContext);
          if (alive && response.state && applyState(response.state)) lastActivityStateAt.current = Date.now();
          if (alive) setConnection({ status: "live", message: "Realtime gateway connected" });
        } catch (error) {
          if (alive) {
            if (nextContext.mode === "local") {
              setConnection({ status: "preview", message: error.message });
            } else {
              setConnection({ status: "error", message: error.message });
              showToast(`Live Activity gateway unavailable: ${error.message}`, "error");
            }
          }
        } finally {
          if (alive) finishHydration();
        }

        stopSocket = connectActivitySocket({
          ...nextContext,
          onState: (nextState) => {
            if (alive) {
              if (applyState(nextState)) lastActivityStateAt.current = Date.now();
              setConnection({ status: "live", message: "Realtime gateway connected" });
              finishHydration();
            }
          },
          onReady: () => { if (alive) setConnection({ status: "live", message: "Realtime gateway connected" }); },
          onConnection: (nextConnection) => { if (alive && nextContext.mode === "discord") setConnection(nextConnection); },
          onError: (error) => { if (alive && nextContext.mode === "discord") setConnection({ status: "reconnecting", message: error.message }); },
        });

        // Socket messages are the state path. HTTP only repairs a socket that
        // became silent (Discord iframe/proxy edge case), on return to the
        // foreground, or after an explicit reconnect — never continuously.
        const resyncIfStale = () => {
          if (Date.now() - lastActivityStateAt.current >= 3_000) void reconcile({ quiet: true });
        };
        healthWatchTimer = window.setInterval(resyncIfStale, 1_000);
        const onVisibilityChange = () => {
          if (document.visibilityState === "visible") void reconcile({ quiet: false });
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        stopSocket = (() => {
          const closeSocket = stopSocket;
          return () => { document.removeEventListener("visibilitychange", onVisibilityChange); closeSocket?.(); };
        })();
      })
      .catch((error) => {
        if (alive) {
          setConnection({ status: "error", message: error.message });
          showToast(`Discord Activity connection failed: ${error.message}`, "error");
          finishHydration();
        }
      });

    return () => {
      alive = false;
      stopSocket?.();
      window.clearInterval(healthWatchTimer);
      window.clearTimeout(hydrationTimer.current);
    };
  }, [applyState, finishHydration, showToast]);

  const updateActionPending = useCallback((key, change) => {
    const nextCount = Math.max(0, (pendingActionCounts.current.get(key) || 0) + change);
    if (nextCount) pendingActionCounts.current.set(key, nextCount);
    else pendingActionCounts.current.delete(key);
    setPendingActions(Object.fromEntries(pendingActionCounts.current));
  }, []);

  const isActionPending = useCallback((key) => Boolean(pendingActions[key]), [pendingActions]);

  const localMutation = useCallback((action, payload) => {
    setState((current) => {
      const next = structuredClone(current);
      if (action === "toggle") next.player.playing = !next.player.playing, next.player.paused = !next.player.playing;
      if (action === "pause") next.player.playing = false, next.player.paused = true;
      if (action === "resume") next.player.playing = true, next.player.paused = false;
      if (action === "stop") { next.player.currentTrack = null; next.player.queue = []; next.player.playing = false; next.player.paused = true; next.player.positionMs = 0; }
      if (action === "volume" || action === "volume-preview") {
        next.player.volume = payload.volume;
        next.player.muted = Number(payload.volume) === 0;
        if (Number(payload.volume) > 0) next.player.lastAudibleVolume = Number(payload.volume);
      }
      if (action === "toggle_mute") {
        const currentVolume = clamp(Number(next.player.volume) || 0, 0, 100);
        if (currentVolume > 0) {
          next.player.lastAudibleVolume = currentVolume;
          next.player.volume = 0;
          next.player.muted = true;
        } else {
          next.player.volume = clamp(Number(next.player.lastAudibleVolume) || 52, 1, 100);
          next.player.muted = false;
        }
      }
      if (action === "seek") next.player.positionMs = payload.positionMs;
      if (action === "autoplay") next.player.autoplay = payload.enabled;
      if (action === "loop") next.player.loop = next.player.loop === "NONE" ? "TRACK" : next.player.loop === "TRACK" ? "QUEUE" : "NONE";
      if (action === "skip") {
        const [nextTrack, ...remaining] = next.player.queue;
        if (nextTrack) {
          next.player.currentTrack = nextTrack;
          next.player.durationMs = nextTrack.durationMs;
          next.player.positionMs = 0;
          next.player.queue = remaining;
          next.player.playing = true;
          next.player.paused = false;
        } else {
          next.player.playing = false;
          next.player.paused = true;
        }
      }
      if (action === "previous") next.player.positionMs = 0;
      if (action === "shuffle") {
        const manual = next.player.queue.filter((track) => !isAutoplayQueueTrack(track)).sort(() => Math.random() - 0.5);
        const autoplay = next.player.queue.filter(isAutoplayQueueTrack).sort(() => Math.random() - 0.5);
        next.player.queue = [...manual, ...autoplay];
        next.player.shuffleActive = true;
      }
      if (action === "remove_queue") { const index = next.player.queue.findIndex((track) => track.queueItemId === payload.queueItemId); next.player.queue.splice(index >= 0 ? index : payload.position, 1); next.player.queue = partitionQueueForDisplay(next.player.queue); }
      if (action === "clear_queue") next.player.queue = [];
      if (action === "play_next") { const index = next.player.queue.findIndex((track) => track.queueItemId === payload.queueItemId); const [track] = next.player.queue.splice(index >= 0 ? index : payload.position, 1); if (track) { track.autoplay = false; next.player.queue.unshift(track); } next.player.queue = partitionQueueForDisplay(next.player.queue); }
      if (action === "replace_autoplay") {
        const index = next.player.queue.findIndex((track) => track.queueItemId === payload.queueItemId);
        const position = index >= 0 ? index : payload.position;
        const current = next.player.queue[position];
        const replacement = mockSearchResults.find((track) => track.id !== current?.id) || null;
        if (current && replacement) next.player.queue.splice(position, 1, { ...replacement, autoplay: true, requester: "MewBit", queueItemId: current.queueItemId });
        next.player.queue = partitionQueueForDisplay(next.player.queue);
      }
      if (action === "move_queue") { const from = next.player.queue.findIndex((track) => track.queueItemId === payload.fromQueueItemId); const to = next.player.queue.findIndex((track) => track.queueItemId === payload.toQueueItemId); next.player.queue = moveQueueTrackForDisplay(next.player.queue, from >= 0 ? from : payload.from, to >= 0 ? to : payload.to); }
      if (action === "undo_queue") {
        const snapshot = localUndoSnapshots.current.get(payload.token);
        if (snapshot) {
          next.player.queue = partitionQueueForDisplay(structuredClone(snapshot));
          localUndoSnapshots.current.delete(payload.token);
        }
      }
      if (action === "filter") next.player.filters.effectPreset = payload.preset;
      if (action === "equalizer") { next.player.filters.equalizer = payload.bands; next.player.filters.preset = payload.bands?.length ? "custom" : "flat"; }
      if (action === "equalizer_preset") {
        const preset = next.equalizerPresets?.find((item) => item.name === payload.preset);
        next.player.filters.equalizer = preset?.bands || [];
        next.player.filters.preset = payload.preset;
      }
      if (action === "set_lyrics_offset") next.player.lyricsSyncOffsetMs = Number(payload.offsetMs) || 0;
      if (action === "surprise_me") {
        const result = mockSearchResults.find((track) => track.id === "search-afterglow") || mockSearchResults[0];
        if (result) {
          next.player.currentTrack = { ...result, requester: "Local Listener", autoplay: false };
          next.player.durationMs = result.durationMs;
          next.player.positionMs = 0;
          next.player.playing = true;
          next.player.paused = false;
        }
      }
      if (action === "play") {
        const result = searchResults.find((track) => track.playQuery === payload.query);
        if (result && next.player.currentTrack) {
          if (payload.playNow) {
            next.player.queue.unshift(next.player.currentTrack);
            next.player.currentTrack = result;
            next.player.durationMs = result.durationMs;
            next.player.positionMs = 0;
            next.player.playing = true;
            next.player.paused = false;
          } else {
            const autoplayIndex = next.player.queue.findIndex((track) => track.autoplay);
            if (autoplayIndex === -1) next.player.queue.push(result);
            else next.player.queue.splice(autoplayIndex, 0, result);
          }
        } else if (result) {
          next.player.currentTrack = result;
          next.player.durationMs = result.durationMs;
          next.player.positionMs = 0;
          next.player.playing = true;
          next.player.paused = false;
        }
      }
      next.player.updatedAt = Date.now();
      return next;
    });
  }, [searchResults]);

  const onAction = useCallback((action, payload = {}) => {
    if (action === "volume-preview") { localMutation(action, payload); return; }
    const pendingKey = getActionPendingKey(action, payload);
    const execute = async (nextPayload = payload) => {
      try {
        const shouldHitGateway = context.mode === "discord" || (import.meta.env.VITE_ACTIVITY_GATEWAY_URL !== "" && import.meta.env.VITE_ACTIVITY_CONNECT_LOCAL);
        if (shouldHitGateway) {
          const response = await sendActivityAction({ ...context, action, payload: nextPayload });
          applyState(response.state);
          if (response.result?.success === false) throw new Error(response.result.error || "Activity action failed.");
          if (response.result?.playlist) setSelectedPlaylistDetail(response.result.playlist);
          if (action === "delete_playlist" && response.result?.success) { setSelectedPlaylistDetail(null); setSelectedPlaylist(null); }
          if (action === "get_playlist" && response.result?.playlist) { setSelectedPlaylist(response.result.playlist.id || response.result.playlist.name); goToView("playlists"); }
          const successMessage = getActionFeedback(action, nextPayload, response.result, response.state);
          if (successMessage) showToast(successMessage, "success");
          if ((action === "remove_queue" || action === "clear_queue") && response.result?.undoToken) {
            showToast(action === "clear_queue" ? "Queue cleared" : "Track removed", "info", { label: "Undo", action: "undo_queue", payload: { token: response.result.undoToken } });
          }
          if (action === "undo_queue" && response.result?.success) showToast("Queue restored", "success");
        } else {
          let undoToken = null;
          if (action === "remove_queue" || action === "clear_queue") {
            undoToken = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            localUndoSnapshots.current.set(undoToken, structuredClone(stateRef.current.player.queue || []));
          }
          localMutation(action, nextPayload);
          const successMessage = getActionFeedback(action, nextPayload, null, stateRef.current);
          if (successMessage) showToast(successMessage, "info");
          if (undoToken) showToast(action === "clear_queue" ? "Queue cleared" : "Track removed", "info", { label: "Undo", action: "undo_queue", payload: { token: undoToken } });
          if (action === "undo_queue") showToast("Queue restored", "success");
        }
      } catch (error) {
        if (context.mode === "local") { localMutation(action, nextPayload); showToast("Local preview updated. The live gateway is offline.", "info"); }
        else showToast(error.message, "error");
      }
    };
    const enqueue = (queue, task) => {
      updateActionPending(pendingKey, 1);
      const queued = queue.current.then(task, task);
      queue.current = queued.catch(() => undefined);
      return queued.finally(() => updateActionPending(pendingKey, -1));
    };
    if (action === "seek" || action === "volume") {
      const queuedAction = coalescedActions.current.get(action);
      if (queuedAction) {
        queuedAction.payload = payload;
        return queuedAction.promise;
      }
      const holder = { payload, promise: null };
      holder.promise = enqueue(controlActionQueue, () => execute(holder.payload)).finally(() => coalescedActions.current.delete(action));
      coalescedActions.current.set(action, holder);
      return holder.promise;
    }
    const realtimeActions = new Set(["pause", "resume", "toggle", "skip", "previous", "stop", "volume", "seek"]);
    return enqueue(realtimeActions.has(action) ? controlActionQueue : actionQueue, () => execute(payload));
  }, [applyState, context, goToView, localMutation, showToast, updateActionPending]);

  const runSearch = useCallback(async () => {
    const query = searchQuery.trim();
    searchRequest.current.controller?.abort();
    const requestId = searchRequest.current.id + 1;
    searchRequest.current = { id: requestId, controller: null };

    setSearchMeta({ correction: null, suggestions: [] });
    if (query.length < 2) { setSearchResults([]); setSearchStatus("idle"); return; }
    if (parseMusicLink(query)) {
      setSearchResults([]);
      setSearchStatus("direct");
      return;
    }
    setSearchStatus("searching");
    try {
        if (import.meta.env.DEV && context.mode === "local" && import.meta.env.VITE_ACTIVITY_CONNECT_LOCAL !== "true") {
        const normalized = query.toLowerCase();
        const localResults = mockSearchResults.filter((track) => `${track.title} ${track.author}`.toLowerCase().includes(normalized) || normalized.split(" ").some((token) => `${track.title} ${track.author}`.toLowerCase().includes(token)));
        setSearchResults(localResults);
        setSearchStatus(localResults.length ? "idle" : "empty");
      } else {
        const controller = new AbortController();
        searchRequest.current = { id: requestId, controller };
        const response = await searchActivity({ ...context, query, source: searchSource, exact: query === exactSearchQuery, signal: controller.signal });
        if (searchRequest.current.id !== requestId) return;
        const nextResults = response.tracks || [];
        setSearchMeta({ correction: response.correction || null, suggestions: response.suggestions || [] });
        setSearchResults(nextResults);
        setSearchStatus(nextResults.length ? "idle" : "empty");
      }
    } catch (error) {
      if (error?.name === "AbortError" || searchRequest.current.id !== requestId) return;
      setSearchResults([]);
      setSearchStatus("error");
      showToast(error.message, "error");
    }
  }, [context, exactSearchQuery, searchQuery, searchSource, showToast]);

  useEffect(() => {
    if (MOCK_PREVIEW && activeTab === "search") {
      setSearchResults(mockSearchResults);
      setSearchStatus("idle");
      return undefined;
    }
    if (activeTab !== "search" || (searchQuery.trim().length < 2 && !MOCK_PREVIEW)) {
      searchRequest.current.id += 1;
      searchRequest.current.controller?.abort();
      searchRequest.current.controller = null;
      if (activeTab === "search") {
        setSearchResults([]);
        setSearchStatus("idle");
      }
      return undefined;
    }
    const timer = window.setTimeout(runSearch, 560);
    return () => {
      window.clearTimeout(timer);
      searchRequest.current.id += 1;
      searchRequest.current.controller?.abort();
      searchRequest.current.controller = null;
    };
  }, [activeTab, runSearch, searchQuery, searchSource]);

  // The user's own library answers almost instantly, so it runs on a short
  // debounce of its own instead of waiting for the provider search.
  useEffect(() => {
    const query = searchQuery.trim();
    const localMock = import.meta.env.DEV && context.mode === "local" && import.meta.env.VITE_ACTIVITY_CONNECT_LOCAL !== "true";
    if (activeTab !== "search" || query.length < 2 || parseMusicLink(query) || MOCK_PREVIEW || localMock) {
      setLibraryResults([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchActivityLibrary({ ...context, query, signal: controller.signal })
        .then((response) => setLibraryResults(response.tracks || []))
        .catch((error) => { if (error?.name !== "AbortError") setLibraryResults([]); });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeTab, context, searchQuery]);

  // "Similar to" the best match, fetched after the results arrive so it never
  // competes with them. Results stay set while the next search runs, so the
  // row only reloads when the best match changes.
  const similarReference = searchResults[0];
  const similarTitle = similarReference?.title || "";
  const similarAuthor = similarReference?.author || "";
  useEffect(() => {
    const localMock = import.meta.env.DEV && context.mode === "local" && import.meta.env.VITE_ACTIVITY_CONNECT_LOCAL !== "true";
    setSimilarResults([]);
    if (activeTab !== "search" || !similarTitle || !similarAuthor || MOCK_PREVIEW || localMock) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchActivitySimilar({ ...context, title: similarTitle, author: similarAuthor, signal: controller.signal })
        .then((response) => setSimilarResults(response.tracks || []))
        .catch(() => {});
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeTab, context, similarAuthor, similarTitle]);

  const searchProps = {
    query: searchQuery,
    setQuery: setSearchQuery,
    source: searchSource,
    setSource: setSearchSource,
    results: searchResults,
    libraryResults,
    similarResults,
    status: searchStatus,
    correction: searchMeta.correction,
    suggestions: searchMeta.suggestions,
    onSearch: runSearch,
    onSearchExact: (original) => {
      setExactSearchQuery(original);
      setSearchQuery(original);
    },
    playlists: state.playlists,
    likedTrackIds: state.likedTrackIds || [],
    isActionPending,
  };

  const closePlaylistComposer = useCallback(() => setPlaylistComposerOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        goToView("search");
        window.requestAnimationFrame(() => document.querySelector('.global-search input, .search-input-wrap input')?.focus());
        return;
      }
      if (event.key.toLowerCase() === "q") {
        event.preventDefault();
        setRightSidebarOpen((value) => !value);
        return;
      }
      if (!state.player.currentTrack) return;
      if (event.key === " ") { event.preventDefault(); onAction("toggle"); }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); onAction("skip", { expectedTrackId: state.player.currentTrack.id }); }
      if (event.key.toLowerCase() === "p") { event.preventDefault(); onAction("previous"); }
      if (event.key.toLowerCase() === "l") { event.preventDefault(); goToView("lyrics"); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToView, onAction, state.player.currentTrack]);

  /* Terminal states: the room cannot be joined at all, so the cockpit would be
     a set of controls wired to nothing. */
  const gate = connection.status === "no-guild" ? "dm" : connection.status === "error" ? "error" : null;

  /* Not terminal: everything still renders and the queue still reads, but
     nothing can play or be searched, so this warns without taking the surface
     away. Absent on older payloads, hence the explicit false. */
  const lavalinkDown = state.lavalink ? state.lavalink.connected === false : false;
  const showAlert = lavalinkDown && !gate && !showLoader && !isCompact;

  return (
    <main
      className={`activity-app ${isCompact ? "is-compact" : ""} ${isHydrating ? "is-hydrating" : ""} ${
        showAlert ? "has-alert" : ""
      }`}
    >
      {showAlert ? (
        <div className="activity-alert" role="status">
          <WarningCircle size={16} weight="bold" aria-hidden="true" />
          <span>
            <b>The audio node is offline.</b> Playback and search are unavailable until it reconnects. The queue and
            everything already saved are untouched.
          </span>
        </div>
      ) : null}
      {gate ? (
        <ActivityGate
          variant={gate}
          path={typeof window === "undefined" ? "/" : window.location.pathname}
          detail={gate === "error" ? connection.message : null}
          onRetry={gate === "error" ? () => window.location.reload() : null}
        />
      ) : null}
      {showLoader && !gate ? <ActivityLoader message={connection.message} leaving={!isHydrating} /> : null}
      <div className="activity-content" aria-hidden={showLoader ? "true" : undefined} inert={showLoader || undefined}>
      {isCompact ? <CompactPlayer state={state} /> : <>
        <div ref={appShellRef} className={`app-shell ${leftSidebarOpen ? "left-open" : "left-closed"} ${rightSidebarOpen ? "right-open" : "right-closed"}`}>
          <div
            className={`drawer-scrim ${leftSidebarOpen || rightSidebarOpen ? "is-open" : ""}`}
            onClick={() => { setLeftSidebarOpen(false); setRightSidebarOpen(false); }}
            aria-hidden="true"
          />
          <aside className="sidebar sidebar-left" aria-label="Playlists sidebar" role={isDrawerViewport ? "dialog" : undefined} aria-modal={isDrawerViewport && leftSidebarOpen ? "true" : undefined} aria-hidden={isDrawerViewport && !leftSidebarOpen ? "true" : undefined} inert={isDrawerViewport && !leftSidebarOpen || undefined}>
            <PlaylistSidebar
              playlists={state.playlists}
              selectedPlaylist={selectedPlaylist}
              onSelect={(playlistId) => { setPlaylistComposerOpen(false); setSelectedPlaylist(playlistId); setSelectedPlaylistDetail(null); goToView("playlists"); const playlist = state.playlists.find((item) => item.id === playlistId); if (playlist) onAction("get_playlist", { name: playlist.name }); }}
              onCreate={() => { setPlaylistComposerOpen(true); goToView("playlists"); }}
              onAction={onAction}
              onToggle={() => setLeftSidebarOpen((value) => !value)}
              loading={isHydrating}
            />
          </aside>
          <section className="main-stage" aria-hidden={isDrawerViewport && (leftSidebarOpen || rightSidebarOpen) ? "true" : undefined} inert={isDrawerViewport && (leftSidebarOpen || rightSidebarOpen) || undefined}>
            <div className="stage-toolbar">
              <div className="stage-toolbar-inner">
                <div className="stage-navigation" aria-label="Activity navigation">
                  <IconButton label="Toggle playlists" className={leftSidebarOpen ? "is-active" : ""} aria-pressed={leftSidebarOpen} onClick={() => { if (window.matchMedia("(max-width: 900px)").matches) setRightSidebarOpen(false); setLeftSidebarOpen((value) => !value); }}><VinylRecord size={17} weight={leftSidebarOpen ? "fill" : "regular"} aria-hidden="true" /></IconButton>
                </div>
                <div className="stage-center">
                  <IconButton label="Home" className={activeTab === "home" ? "is-active" : ""} onClick={() => goToView("home")}><House size={17} weight={activeTab === "home" ? "fill" : "regular"} aria-hidden="true" /></IconButton>
                  <GlobalSearch {...searchProps} onFocus={() => goToView("search")} />
                  <IconButton label="Sound settings" className={activeTab === "filters" ? "is-active" : ""} onClick={() => goToView("filters")}><SlidersHorizontal size={17} aria-hidden="true" /></IconButton>
                </div>
                <div className="stage-actions" aria-label="Player tools">
                  <IconButton label="Room activity" className={`${activeTab === "activity" ? "is-active" : ""} ${hasActivityErrors ? "has-issues" : ""}`} onClick={() => goToView("activity")}><Bell size={17} weight={activeTab === "activity" ? "fill" : "regular"} aria-hidden="true" /></IconButton>
                  <IconButton label="Toggle queue" className={rightSidebarOpen ? "is-active" : ""} aria-pressed={rightSidebarOpen} onClick={() => { if (window.matchMedia("(max-width: 900px)").matches) setLeftSidebarOpen(false); setRightSidebarOpen((value) => !value); }}><Queue size={17} weight={rightSidebarOpen ? "fill" : "regular"} aria-hidden="true" /></IconButton>
                </div>
              </div>
            </div>
            <div className={`main-content main-view-${activeTab}`}>
              {activeTab === "home" ? (isHydrating ? <Suspense fallback={<HomePanelFallback />}><LazyHomePanel loading /></Suspense> : state.player.currentTrack ? <NowPlaying className="now-playing-stage" state={state} onTab={goToView} onAction={onAction} onOpenExternalLink={requestExternalLink} isActionPending={isActionPending} /> : <Suspense fallback={<HomePanelFallback />}><LazyHomePanel onView={goToView} onAction={onAction} isActionPending={isActionPending} /></Suspense>) : null}
              {activeTab === "search" ? <section className="content-panel panel-surface"><PanelTitle icon={<MagnifyingGlass size={18} aria-hidden="true" />} title="Find a track" description="Search providers together, then choose the exact source" /><SearchPanel {...searchProps} showSearchBar={false} onAction={onAction} /></section> : null}
              {activeTab === "filters" ? <section className={`content-panel panel-surface filters-surface filters-surface-${soundSection}`}><PanelTitle icon={<SlidersHorizontal size={18} aria-hidden="true" />} title="Shape the sound" description="EQ and playful filters are applied to the live player" action={<div className="sound-mode-actions" role="tablist" aria-label="Sound controls"><button type="button" role="tab" aria-selected={soundSection === "effects"} className={soundSection === "effects" ? "is-active" : ""} onClick={() => setSoundSection("effects")}><Faders size={15} aria-hidden="true" /><span>Effects</span></button><button type="button" role="tab" aria-selected={soundSection === "equalizer"} className={soundSection === "equalizer" ? "is-active" : ""} onClick={() => setSoundSection("equalizer")}><SlidersHorizontal size={15} aria-hidden="true" /><span>Equalizer</span></button></div>} /><Suspense fallback={<div className="empty-state" aria-busy="true"><SpinnerGap className="button-spinner" size={28} aria-hidden="true" /><span>Loading sound controls</span></div>}><LazyFiltersPanel filters={state.player.filters} filterPresets={state.filterPresets} equalizerPresets={state.equalizerPresets} activeSection={soundSection} canAdjust={Boolean(state.player.currentTrack)} onAction={onAction} isActionPending={isActionPending} /></Suspense></section> : null}
              {activeTab === "lyrics" ? <section className="content-panel panel-surface"><Suspense fallback={<div className="empty-state" aria-busy="true"><SpinnerGap className="button-spinner" size={28} aria-hidden="true" /><span>Loading lyrics</span></div>}><LazyLiveLyricsPanel player={state.player} onAction={onAction} isActionPending={isActionPending} /></Suspense></section> : null}
              {activeTab === "activity" ? <section className="content-panel panel-surface activity-feed-panel"><PanelTitle icon={<Bell size={18} aria-hidden="true" />} title="Room activity" description="Live actions and playback issues from this listening room" action={<ShortcutHelp placement="activity" />} /><ActivityFeedPanel events={activityEvents} /></section> : null}
              {activeTab === "playlists" ? <section className="content-panel panel-surface"><PlaylistsPanel playlists={state.playlists} currentTrack={state.player.currentTrack} likedTrackIds={state.likedTrackIds || []} selectedPlaylist={selectedPlaylistDetail?.name || selectedPlaylist} playlistDetail={selectedPlaylistDetail} composerOpen={playlistComposerOpen} onComposerClose={closePlaylistComposer} onAction={onAction} /></section> : null}
            </div>
          </section>
          <aside className="sidebar sidebar-right" aria-label="Queue sidebar" role={isDrawerViewport ? "dialog" : undefined} aria-modal={isDrawerViewport && rightSidebarOpen ? "true" : undefined} aria-hidden={isDrawerViewport && !rightSidebarOpen ? "true" : undefined} inert={isDrawerViewport && !rightSidebarOpen || undefined}>
            <QueueSidebar queue={state.player.queue} history={state.player.history || []} sessionStartedAt={state.player.sessionStartedAt} playlists={state.playlists} likedTrackIds={state.likedTrackIds || []} queueOpen={rightSidebarOpen} onToggleQueue={() => setRightSidebarOpen((value) => !value)} onAction={onAction} isActionPending={isActionPending} loading={isHydrating} />
          </aside>
        </div>
        {activeTab === "home" ? null : <div className="player-bar-shell" aria-hidden={isDrawerViewport && (leftSidebarOpen || rightSidebarOpen) ? "true" : undefined} inert={isDrawerViewport && (leftSidebarOpen || rightSidebarOpen) || undefined}><PlayerBar state={state} onAction={onAction} onView={goToView} onOpenExternalLink={requestExternalLink} isActionPending={isActionPending} /></div>}
      </>}
      </div>
      <ExternalLinkConfirmDialog request={externalLinkRequest} onCancel={() => setExternalLinkRequest(null)} onConfirm={confirmExternalLink} />
      {toast ? <div className={`toast toast-${toast.type}`} role="status"><span>{toast.type === "error" ? <WarningCircle size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}</span><span className="toast-message">{toast.message}</span>{toast.action ? <button className="toast-action" type="button" onClick={() => { const action = toast.action; setToast(null); onAction(action.action, action.payload); }}>{toast.action.label}</button> : null}<button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={16} aria-hidden="true" /></button></div> : null}
    </main>
  );
}

export default App;









