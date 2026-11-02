import { MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { searchActivity } from "../api.js";

const MAX_RESULTS = 8;
const MIN_QUERY = 2;
const DEBOUNCE_MS = 400;

function formatLength(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Placeholder song pick for solo play (the song-select screen replaces it): search through the Activity's
// own search API and choose a result. onPick runs inside the click, which is the gesture the audio needs.
export default function SoloPicker({ context, onPick, onCancel, error = null }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | searching | empty | error
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_QUERY) {
      setResults([]);
      setStatus("idle");
      return undefined;
    }
    const controller = new AbortController();
    setStatus("searching");
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchActivity({ ...context, query: text, signal: controller.signal });
        const tracks = (response.tracks || []).filter((track) => track.uri && !track.isStream).slice(0, MAX_RESULTS);
        setResults(tracks);
        setStatus(tracks.length ? "idle" : "empty");
      } catch (searchError) {
        if (controller.signal.aborted) return;
        setResults([]);
        setStatus("error");
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // context identity changes with every App render of its object; only the credentials matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, context?.guildId, context?.accessToken]);

  // The game's keys are paused while the picker is up, so typing reaches the input; Esc leaves the screen.
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel?.();
    }
  };

  return (
    <div className="mb-picker" role="group" aria-label="Pick a song" onKeyDown={onKeyDown}>
      <b className="mb-picker-title">Pick a song</b>
      <label className="mb-picker-search">
        <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Search for a song"
          aria-label="Search for a song"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {error ? <p className="mb-picker-note mb-picker-error" role="alert">{error}</p> : null}
      {status === "searching" ? <p className="mb-picker-note" role="status">Searching…</p> : null}
      {status === "empty" ? <p className="mb-picker-note" role="status">No songs found.</p> : null}
      {status === "error" ? <p className="mb-picker-note mb-picker-error" role="alert">Search failed. Try again.</p> : null}
      <ul className="mb-picker-list">
        {results.map((track) => (
          <li key={track.id ?? track.uri}>
            <button type="button" className="mb-picker-item" onClick={() => onPick?.(track)}>
              <span className="mb-picker-name">{track.title}</span>
              <span className="mb-picker-artist">{track.author}</span>
              <span className="mb-picker-length">{formatLength(track.durationMs)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
