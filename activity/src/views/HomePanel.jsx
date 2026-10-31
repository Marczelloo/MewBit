import { useEffect, useMemo, useState } from "react";
import { Heart, MagnifyingGlass, Play, Plus, Sparkle, SpinnerGap } from "@phosphor-icons/react";
import "./home.css";

const MOODS = [
  { id: "chill", label: "Chill" },
  { id: "hype", label: "Hype" },
  { id: "focus", label: "Focus" },
  { id: "throwback", label: "Throwback" },
  { id: "late", label: "Late night" },
  { id: "discover", label: "Something new" },
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SESSION_GAP_MS = 30 * MINUTE; // a break longer than this starts a new session
const STATS_WINDOW_MS = 14 * DAY;
const RESUME_LIMIT = 100;
const RECENT_COUNT = 6;
const LIBRARY_OTHER_LIMIT = 5;

/* ------------------------------------------------------------------ helpers */

// Same proxying rule as the rest of the Activity: remote artwork goes through
// the gateway so Discord's CSP lets it load.
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

const trackKey = (track) => `${String(track?.title || "").trim().toLowerCase()}\u0000${String(track?.author || "").trim().toLowerCase()}`;
const isAutoplay = (track) => Boolean(track?.autoplay);
const requesterName = (track) => (isAutoplay(track) ? "Autoplay" : String(track?.requester || "Someone").trim() || "Someone");
const countLabel = (count, noun = "track") => `${count} ${count === 1 ? noun : `${noun}s`}`;

function toQueueTrack(track) {
  return {
    title: track.title,
    author: track.author,
    uri: track.uri || track.playQuery || "",
    source: track.source,
    durationMs: track.durationMs || 0,
    artworkUrl: track.artworkUrl || null,
  };
}

// Mirrors TrackRow's "Play now" so a history card behaves like a history row.
function playTrackPayload(track) {
  return {
    query: track.playQuery || track.uri || `${track.title} ${track.author}`,
    source: track.source,
    playNow: true,
    trackId: track.id,
  };
}

function formatClock(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
}

function formatDuration(ms) {
  const totalMinutes = Math.max(1, Math.round(ms / MINUTE));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} h ${String(minutes).padStart(2, "0")} min` : `${minutes} min`;
}

function startOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const dayDiff = (from, to) => Math.round((startOfDay(to) - startOfDay(from)) / DAY);

function formatAgo(timestamp, now) {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  const days = dayDiff(timestamp, now);
  if (days < 1) return `${Math.floor(elapsed / HOUR)} h ago`;
  if (days === 1) return "yesterday";
  return `${days} d ago`;
}

const isNightHour = (timestamp) => {
  const hour = new Date(timestamp).getHours();
  return hour >= 18 || hour < 5;
};

function sessionTitle(endedAt, now) {
  if (!isNightHour(endedAt)) return "Last session";
  // Shift by 5 h so a 01:00 session still belongs to the evening it started in.
  const nightGap = dayDiff(endedAt - 5 * HOUR, now - 5 * HOUR);
  if (nightGap === 0 && isNightHour(now)) return "Tonight’s session";
  if (nightGap <= 1) return "Last night’s session";
  return "Last session";
}

function sessionEnded(endedAt, now) {
  const days = dayDiff(endedAt, now);
  if (days < 1) return `ended ${formatClock(endedAt)}`;
  if (days === 1) return "ended yesterday";
  return `ended ${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(endedAt))}`;
}

// Deterministic gradient so a missing cover still looks intentional and the
// same item keeps the same colour between renders.
function tileStyle(seed) {
  let hash = 0;
  for (const char of String(seed || "m")) hash = (hash * 31 + char.codePointAt(0)) % 360;
  return { background: `linear-gradient(140deg, hsl(${hash} 42% 30%), hsl(${(hash + 48) % 360} 48% 14%))` };
}

/* --------------------------------------------------------------- primitives */

function Art({ src, label, className = "" }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const resolved = src && failedSrc !== src ? resolveArtworkUrl(src) : null;
  if (resolved) {
    return <img className={`home-art ${className}`} src={resolved} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />;
  }
  return <span className={`home-art home-art-fallback ${className}`} style={tileStyle(label)} aria-hidden="true">{String(label || "M").trim().charAt(0).toUpperCase()}</span>;
}

function Avatar({ name, url, auto = false, size = 16 }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const src = !auto && url && failedUrl !== url ? resolveArtworkUrl(url) : null;
  return (
    <span className={`home-avatar ${auto ? "is-auto" : ""}`} style={{ "--size": `${size}px` }} aria-hidden="true">
      {auto ? <Sparkle size={Math.round(size * 0.6)} weight="fill" /> : src ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} /> : String(name || "?").trim().charAt(0).toUpperCase()}
    </span>
  );
}

/* ------------------------------------------------------------------- hero */

function Hero({ onView, onAction, isActionPending, mood, setMood, session, now }) {
  const pending = isActionPending("surprise_me");
  const moodLabel = MOODS.find((item) => item.id === mood)?.label;
  return (
    <div className="home-hero">
      <div className="home-hero-copy">
        <h1>Start the room<br /><em>your way.</em></h1>
        <p>Play something specific, or let MewBit find a verified pick from your taste — pick a vibe to steer it.</p>
        <div className="home-actions">
          <button className="home-btn home-btn-primary" type="button" onClick={() => onAction("surprise_me", mood ? { mood } : undefined)} disabled={pending} aria-busy={pending || undefined}>
            {pending ? <SpinnerGap className="button-spinner" size={18} aria-hidden="true" /> : <Sparkle size={18} weight="fill" aria-hidden="true" />}
            {pending ? "Finding your next pick..." : moodLabel ? `Surprise me · ${moodLabel}` : "Surprise me"}
          </button>
          <button className="home-btn home-btn-secondary" type="button" onClick={() => onView("search")}>
            <MagnifyingGlass size={18} weight="bold" aria-hidden="true" /> Search music
          </button>
        </div>
        <div className="home-vibes">
          <span className="home-eyebrow" id="home-vibe-label">Pick a vibe</span>
          <div className="home-chips" role="group" aria-labelledby="home-vibe-label">
            {MOODS.map((item) => (
              <button key={item.id} className="home-chip" type="button" aria-pressed={mood === item.id} onClick={() => setMood((current) => (current === item.id ? null : item.id))}>{item.label}</button>
            ))}
          </div>
        </div>
      </div>
      <ResumeCard session={session} now={now} onView={onView} onAction={onAction} isActionPending={isActionPending} />
    </div>
  );
}

function ResumeCard({ session, now, onView, onAction, isActionPending }) {
  if (!session) {
    return (
      <aside className="home-resume is-empty" aria-label="Last session">
        <span className="home-eyebrow">Pick up where you left off</span>
        <strong className="home-resume-title">No sessions yet</strong>
        <p className="home-resume-meta">Your room&rsquo;s sessions show up here after the first track.</p>
      </aside>
    );
  }
  const resuming = isActionPending("queue_tracks");
  return (
    <aside className="home-resume" aria-label="Last session">
      <span className="home-eyebrow">Pick up where you left off</span>
      <div className="home-stack" aria-hidden="true">
        {session.covers.map((track, index) => <Art key={`${track.id || track.title}-${index}`} src={track.artworkUrl} label={track.title} />)}
      </div>
      <div className="home-resume-text">
        <strong className="home-resume-title">{sessionTitle(session.endedAt, now)}</strong>
        <p className="home-resume-meta">{countLabel(session.count)} · {formatDuration(session.durationMs)} · {sessionEnded(session.endedAt, now)}</p>
      </div>
      <div className="home-resume-actions">
        <button className="home-btn home-btn-soft" type="button" onClick={() => onAction("queue_tracks", { tracks: session.payload })} disabled={resuming} aria-busy={resuming || undefined}>
          {resuming ? <SpinnerGap className="button-spinner" size={16} aria-hidden="true" /> : <Play size={16} weight="fill" aria-hidden="true" />} Resume session
        </button>
        <button className="home-btn home-btn-ghost" type="button" onClick={() => onView("history")}>Open history</button>
      </div>
    </aside>
  );
}

/* ----------------------------------------------------------------- recents */

function RecentCard({ track, now, onAction, isActionPending }) {
  const pending = isActionPending(`play:${track.id}`);
  const auto = isAutoplay(track);
  const who = requesterName(track);
  return (
    <li className="home-card">
      <div className="home-card-art">
        <Art src={track.artworkUrl} label={track.title} />
        <button className="home-fab" type="button" aria-label={`Play ${track.title}`} onClick={() => onAction("play", playTrackPayload(track))} disabled={pending} aria-busy={pending || undefined}>
          {pending ? <SpinnerGap className="button-spinner" size={18} aria-hidden="true" /> : <Play size={18} weight="fill" aria-hidden="true" />}
        </button>
      </div>
      <div className="home-card-title" title={track.title}>{track.title}</div>
      <div className="home-card-artist" title={track.author}>{track.author}</div>
      <div className="home-card-who">
        <Avatar name={who} url={track.requesterAvatarUrl} auto={auto} size={16} />
        <span>{who} · {formatAgo(track.playedAt, now)}</span>
      </div>
    </li>
  );
}

function Recently({ tracks, now, onView, onAction, isActionPending }) {
  return (
    <section className="home-section" aria-labelledby="home-recent-title">
      <div className="home-section-head">
        <h2 id="home-recent-title">Recently in this room</h2>
        <button className="home-link" type="button" onClick={() => onView("history")}>See all</button>
      </div>
      <ul className="home-cards">
        {tracks.map((track) => <RecentCard key={`${track.id}-${track.playedAt}`} track={track} now={now} onAction={onAction} isActionPending={isActionPending} />)}
      </ul>
    </section>
  );
}

/* ----------------------------------------------------------------- library */

function PlaylistCover({ playlist }) {
  const artworks = (Array.isArray(playlist.artworks) ? playlist.artworks : []).filter(Boolean);
  if (artworks.length >= 4) {
    return <span className="home-tile-cover is-mosaic" aria-hidden="true">{artworks.slice(0, 4).map((src, index) => <Art key={`${src}-${index}`} src={src} label={playlist.name} />)}</span>;
  }
  return <span className="home-tile-cover" aria-hidden="true"><Art src={artworks[0] || playlist.thumbnail} label={playlist.name} /></span>;
}

function LibraryTile({ playlist, liked = false, onView, onAction, isActionPending }) {
  const count = Number(playlist.trackCount) || 0;
  return (
    <li className="home-tile">
      <button className="home-tile-main" type="button" onClick={() => onView("playlists")}>
        {liked ? <span className="home-tile-cover is-liked" aria-hidden="true"><Heart size={22} weight="fill" /></span> : <PlaylistCover playlist={playlist} />}
        <span className="home-tile-text">
          <strong>{liked ? "Liked songs" : playlist.name}</strong>
          <span>{countLabel(count)}</span>
        </span>
      </button>
      <button className="home-tile-play" type="button" aria-label={`Play ${liked ? "Liked songs" : playlist.name}`} onClick={() => onAction("play_playlist", { name: playlist.name })} disabled={!count || isActionPending("play_playlist")}>
        <Play size={16} weight="fill" aria-hidden="true" />
      </button>
    </li>
  );
}

function Library({ liked, others, onView, onAction, isActionPending }) {
  return (
    <section className="home-panel-box" aria-labelledby="home-library-title">
      <div className="home-section-head">
        <h2 id="home-library-title">Your library</h2>
        <button className="home-link" type="button" onClick={() => onView("playlists")}>All playlists</button>
      </div>
      <ul className="home-tiles">
        {liked ? <LibraryTile playlist={liked} liked onView={onView} onAction={onAction} isActionPending={isActionPending} /> : null}
        {others.map((playlist) => <LibraryTile key={playlist.id || playlist.name} playlist={playlist} onView={onView} onAction={onAction} isActionPending={isActionPending} />)}
        {others.length === 0 ? (
          <li className="home-tile home-tile-new">
            <button className="home-tile-main" type="button" onClick={() => onView("playlists")}>
              <span className="home-tile-cover is-new" aria-hidden="true"><Plus size={20} weight="bold" /></span>
              <span className="home-tile-text"><strong>Create playlist</strong><span>Start your own collection</span></span>
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------- stats */

function Stats({ stats }) {
  return (
    <section className="home-panel-box" aria-labelledby="home-stats-title">
      <div className="home-section-head"><h2 id="home-stats-title">This room · last 14 days</h2></div>
      <dl className="home-numbers">
        <div><dt>tracks played</dt><dd>{stats.tracks}</dd></div>
        <div><dt>hours of music</dt><dd>{stats.hours}</dd></div>
        <div><dt>{stats.listeners === 1 ? "listener" : "listeners"}</dt><dd>{stats.listeners}</dd></div>
      </dl>
      {stats.requesters.length ? (
        <div className="home-stat-block">
          <span className="home-eyebrow">Top requesters</span>
          <ul className="home-req-list">
            {stats.requesters.map((entry) => (
              <li key={entry.name} className={entry.auto ? "is-auto" : ""}>
                <Avatar name={entry.name} url={entry.avatarUrl} auto={entry.auto} size={24} />
                <span className="home-req-name">{entry.name}</span>
                <span className="home-req-bar" aria-hidden="true"><i style={{ width: `${Math.max(6, Math.round((entry.count / stats.maxCount) * 100))}%` }} /></span>
                <span className="home-req-count">{entry.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {stats.repeats.length ? (
        <div className="home-stat-block">
          <span className="home-eyebrow">On repeat</span>
          <ol className="home-repeat-list">
            {stats.repeats.map((entry, index) => (
              <li key={entry.track.id || entry.key}>
                <span className="home-repeat-rank">{index + 1}</span>
                <Art src={entry.track.artworkUrl} label={entry.track.title} />
                <span className="home-repeat-text"><strong title={entry.track.title}>{entry.track.title}</strong><span title={entry.track.author}>{entry.track.author}</span></span>
                <span className="home-repeat-count">×{entry.count}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------- main */

export default function HomePanel({ onView, onAction, isActionPending = () => false, loading = false, history = [], playlists = [] }) {
  const [mood, setMood] = useState(null);
  // Relative times ("2 h ago") drift while the idle screen stays open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (loading) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(timer);
  }, [loading]);

  // Played tracks, oldest first. Everything below derives from this.
  const played = useMemo(
    () => (Array.isArray(history) ? history : [])
      .filter((track) => track && Number(track.playedAt) > 0)
      .map((track) => ({ ...track, playedAt: Number(track.playedAt) }))
      .sort((left, right) => left.playedAt - right.playedAt),
    [history],
  );

  // The last session is the latest run of tracks whose neighbours are all
  // less than SESSION_GAP_MS apart.
  const session = useMemo(() => {
    if (!played.length) return null;
    let start = played.length - 1;
    while (start > 0 && played[start].playedAt - played[start - 1].playedAt < SESSION_GAP_MS) start -= 1;
    const tracks = played.slice(start);
    const covers = [];
    for (let index = tracks.length - 1; index >= 0 && covers.length < 3; index -= 1) {
      if (tracks[index].artworkUrl || covers.length === 0) covers.push(tracks[index]);
    }
    return {
      count: tracks.length,
      endedAt: tracks[tracks.length - 1].playedAt,
      durationMs: tracks.reduce((sum, track) => sum + (track.isStream ? 0 : Number(track.durationMs) || 0), 0),
      covers: covers.reverse(),
      payload: tracks.slice(-RESUME_LIMIT).map(toQueueTrack),
    };
  }, [played]);

  const recent = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (let index = played.length - 1; index >= 0 && result.length < RECENT_COUNT; index -= 1) {
      const key = trackKey(played[index]);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(played[index]);
    }
    return result;
  }, [played]);

  const stats = useMemo(() => {
    const windowed = played.filter((track) => track.playedAt >= now - STATS_WINDOW_MS);
    const byRequester = new Map();
    const byTrack = new Map();
    let durationMs = 0;
    for (const track of windowed) {
      durationMs += track.isStream ? 0 : Number(track.durationMs) || 0;
      const auto = isAutoplay(track);
      const name = requesterName(track);
      const entry = byRequester.get(name) || { name, auto, count: 0, avatarUrl: null };
      entry.count += 1;
      if (!entry.avatarUrl && track.requesterAvatarUrl) entry.avatarUrl = track.requesterAvatarUrl;
      byRequester.set(name, entry);
      const key = trackKey(track);
      const repeat = byTrack.get(key) || { key, track, count: 0 };
      repeat.count += 1;
      repeat.track = track; // keep the newest copy for artwork
      byTrack.set(key, repeat);
    }
    const requesters = [...byRequester.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)).slice(0, 4);
    return {
      tracks: windowed.length,
      hours: (durationMs / HOUR).toFixed(1),
      listeners: [...byRequester.values()].filter((entry) => !entry.auto).length,
      requesters,
      maxCount: Math.max(1, ...requesters.map((entry) => entry.count)),
      repeats: [...byTrack.values()].filter((entry) => entry.count >= 2).sort((left, right) => right.count - left.count || right.track.playedAt - left.track.playedAt).slice(0, 3),
    };
  }, [played, now]);

  const library = useMemo(() => {
    const list = Array.isArray(playlists) ? playlists : [];
    const liked = list.find((playlist) => playlist.isDefault) || null;
    const others = list.filter((playlist) => playlist !== liked && !playlist.isDefault).slice(0, LIBRARY_OTHER_LIMIT);
    return { liked, others };
  }, [playlists]);

  if (loading) return <section className="home-panel home-panel-loading panel-surface" aria-busy="true" aria-label="Synchronizing MewBit Activity"><div className="home-orbit" aria-hidden="true"><span /><span /><span /></div><div className="home-loading-copy"><span /><strong /><strong /><i /><i /><div><b /><b /></div></div><div className="home-signal" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /></div></section>;

  const hasHistory = played.length > 0;
  return (
    <section className="home-page" aria-label="Home">
      <div className="home-wrap">
        <Hero onView={onView} onAction={onAction} isActionPending={isActionPending} mood={mood} setMood={setMood} session={session} now={now} />
        {hasHistory ? <Recently tracks={recent} now={now} onView={onView} onAction={onAction} isActionPending={isActionPending} /> : null}
        <div className={`home-lower ${hasHistory ? "" : "is-solo"}`}>
          <Library liked={library.liked} others={library.others} onView={onView} onAction={onAction} isActionPending={isActionPending} />
          {hasHistory ? <Stats stats={stats} /> : null}
        </div>
      </div>
    </section>
  );
}
