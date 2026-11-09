import { CaretDown, CaretUp, Check, Crown, DotsSixVertical, Play, Plus, X } from "@phosphor-icons/react";
import { memo, useEffect, useRef, useState } from "react";
import { formatScore } from "./GameHud.jsx";
import LevelBoard from "./LevelBoard.jsx";
import LiveBoard from "./LiveBoard.jsx";
import { Avatar } from "./PlayerPanel.jsx";
import { DIFFICULTIES, LevelTile, resolveArtworkUrl } from "./SongSelect.jsx";
import { keyLabel } from "./input.js";
import Mewbit from "./mewbit/Mewbit.jsx";
import {
  countdownDigit,
  formatClock,
  isHost,
  loadedCount,
  lobbyPose,
  memberOf,
  memberStatus,
  ownerFirst,
  remainingMs,
  roomErrorText,
  roundActive,
  serverToPerf,
  songProgress,
  timelineOf,
} from "./room.js";
import { sendRoomInvite } from "./roomInvite.js";
import "./lobby.css";

// While idle Mewbit runs the manifest's "idle" routine (neutral for a while, then a stretch or a headphone
// adjust); the bubble follows whichever of those is on screen.
const IDLE_TEXT = {
  neutral: "waiting for my song~",
  stretch: "warming up the paws…",
  adjust: "*adjusts headphones*",
};
const TOAST_MS = 4500;

// The leaderboard of the song on deck. Memoised on plain values, so a room snapshot (or the clock's tick) neither
// re-renders it nor asks the server again; it requests when the song, the level or the scope changes.
const SongBoard = memo(LevelBoard);

// Re-renders on an interval with performance.now(), for the clocks that count down on screen.
function useTick(intervalMs, active = true) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(performance.now());
    const id = window.setInterval(() => setNow(performance.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

// Mewbit on the stage with a speech bubble. The "go" pose carries its own bubble. Every new `tick` (the clock's
// second) sends a ring out from Mewbit, and in the final seconds it bumps too: swapping between two identical
// animations restarts the bump, and the ring restarts by remounting.
function StageMewbit({ pose, text, effects, tick = null, final = false, onShow = null }) {
  const beat = final ? ` mb-lobby-beat-${tick % 2 ? "a" : "b"}` : "";
  return (
    <div className="mb-lobby-stage">
      {text ? <div className="mb-lobby-bubble" key={text}>{text}</div> : null}
      <div className={`mb-lobby-mewbox${beat}`}>
        <div className="mb-lobby-spot" aria-hidden="true" />
        {tick != null ? <span key={tick} className={`mb-lobby-ring${final ? " mb-lobby-ring-final" : ""}`} aria-hidden="true" /> : null}
        <Mewbit pose={pose} effects={effects} onShow={onShow} />
      </div>
    </div>
  );
}

export function LeaveConfirm({ onStay, onLeave }) {
  const stayRef = useRef(null);
  useEffect(() => {
    stayRef.current?.focus();
  }, []);
  return (
    <div className="mb-pause-scrim">
      <div className="mb-pause" role="alertdialog" aria-modal="true" aria-label="Leave round?">
        <b className="mb-pause-title">Leave round?</b>
        <p className="mb-lobby-confirm-text">You leave the room too, and this round's score won't count.</p>
        <div className="mb-pause-actions">
          <button type="button" className="mb-btn mb-btn-primary" ref={stayRef} onClick={onStay}>
            Keep playing <kbd className="mb-kbd">Esc</kbd>
          </button>
          <button type="button" className="mb-btn" onClick={onLeave}>Leave room</button>
        </div>
      </div>
    </div>
  );
}

// The queue as a list: what was played, greyed out and scrolled past, then the round running, then what waits. The
// owner reorders it, by dragging a row or with its arrows; a row can be removed by the owner or whoever added it.
function Timeline({ room, userId, nowPerf, mapping, busy, onRemove, onMove }) {
  const rows = timelineOf(room, userId);
  const listRef = useRef(null);
  const [drag, setDrag] = useState(null); // { from, over }, queue positions while a row is being dragged
  const playedCount = rows.filter((row) => row.played).length;
  const waiting = room.queue?.length ?? 0;

  useEffect(() => {
    const first = listRef.current?.children[playedCount];
    if (first) listRef.current.scrollTop = first.offsetTop;
  }, [playedCount]);

  if (!rows.length) return <p className="mb-lobby-note">The queue is empty. Add a song to get a round going.</p>;
  const progress = songProgress(room, mapping, nowPerf);
  const nameOf = (id) => memberOf(room, id)?.username ?? "someone";

  return (
    <ol ref={listRef} className={`mb-tl${isHost(room, userId) ? " mb-tl-owner" : ""}`} aria-label="Queue">
      {rows.map((row) => {
        const { track, index } = row;
        const live = row.current && !row.finished;
        const cover = resolveArtworkUrl(track.artworkUrl);
        const over = drag && index != null && drag.over === index && drag.from !== index ? (drag.from > index ? " mb-tl-over-up" : " mb-tl-over-down") : "";
        const cls = `mb-tl-row${live ? " mb-tl-now" : ""}${row.finished ? " mb-tl-done" : ""}${row.mine && !row.current && !row.played ? " mb-tl-mine" : ""}${drag?.from === index && index != null ? " mb-tl-dragged" : ""}${over}`;
        const about = [track.artist, track.durationMs > 0 ? formatClock(track.durationMs) : null, row.mine ? "you" : nameOf(track.addedBy)].filter(Boolean).join(" · ");
        const dropProps = drag && index != null ? {
          onDragOver: (event) => {
            event.preventDefault();
            if (drag.over !== index) setDrag({ ...drag, over: index });
          },
          onDrop: (event) => {
            event.preventDefault();
            if (drag.from !== index) onMove(drag.from, index);
            setDrag(null);
          },
        } : null;
        return (
          <li
            key={row.key}
            className={cls}
            draggable={row.canMove && !busy}
            onDragStart={row.canMove ? (event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(index));
              setDrag({ from: index, over: index });
            } : undefined}
            onDragEnd={() => setDrag(null)}
            {...dropProps}
          >
            <span className="mb-tl-grip" aria-hidden="true">{row.canMove ? <DotsSixVertical size={14} weight="bold" /> : null}</span>
            <span className="mb-tl-pos">
              {index != null ? index + 1 : live ? <Play size={11} weight="fill" aria-label="Now playing" /> : <Check size={12} weight="bold" aria-label="Played" />}
            </span>
            {cover ? <img className="mb-tl-cover" src={cover} alt="" draggable="false" loading="lazy" /> : <span className="mb-tl-cover mb-tl-cover-empty" aria-hidden="true" />}
            <div className="mb-tl-txt">
              <b title={track.title}>{track.title}</b>
              <small>{live ? `now playing · ${about}` : about}</small>
            </div>
            {row.canMove || row.canRemove ? (
              <div className="mb-tl-acts">
                {row.canMove ? (
                  <>
                    <button type="button" className="mb-tl-act" aria-label={`Move ${track.title} up`} disabled={busy || index === 0} onClick={() => onMove(index, index - 1)}>
                      <CaretUp size={13} weight="bold" aria-hidden="true" />
                    </button>
                    <button type="button" className="mb-tl-act" aria-label={`Move ${track.title} down`} disabled={busy || index === waiting - 1} onClick={() => onMove(index, index + 1)}>
                      <CaretDown size={13} weight="bold" aria-hidden="true" />
                    </button>
                  </>
                ) : null}
                {row.canRemove ? (
                  <button type="button" className="mb-tl-act mb-tl-x" aria-label={`Remove ${track.title}`} disabled={busy} onClick={() => onRemove(index)}>
                    <X size={12} weight="bold" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : null}
            {row.current ? <i className="mb-tl-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

// The room lobby: the song on deck with the round clock, the queue, the levels and their leaderboard on the left;
// Mewbit, who is here and what each of them plays, invite, keys and my own controls on the right.
// `view` is "lobby" (between rounds) or "watching" (a round is running without this player).
export default function Lobby({ room, userId, view, receivedAt, serverClock, store, request, board, effects, showMewbit = true, keys, offsetMs, notice, sdk = null, standings = [], onAddSongs, onCalibrate }) {
  const me = memberOf(room, userId);
  const host = isHost(room, userId);
  const active = roundActive(room);
  const watching = view === "watching";
  const nowPerf = useTick(room.nextAt != null ? 100 : 250);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [inviteNote, setInviteNote] = useState(null);
  // Per-difficulty stars, notes and my best of the hero song. Kept per song, so a new song shows dashes
  // until its numbers arrive, and the old ones stay put while a refetch (after a round) is in flight.
  const [songStats, setSongStats] = useState({ key: null, stats: null });
  const [viewedLevel, setViewedLevel] = useState({ key: null, id: null }); // the level whose board is on screen, for one song
  const [mewShown, setMewShown] = useState(null); // the pose Mewbit has on screen, for the idle bubble

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const id = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  async function run(key, call, onOk) {
    if (busy) return;
    setBusy(key);
    try {
      const reply = await call();
      if (!mounted.current) return;
      if (reply?.status === "ok") onOk?.();
      else setToast({ text: roomErrorText(reply), error: true });
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  const mapping = { offsetMs: serverClock?.offsetMs?.() ?? null, serverNow: room.serverNow, receivedAtMs: receivedAt };
  const left = room.nextAt != null ? remainingMs(room.nextAt, mapping, nowPerf) : null;
  const queue = room.queue ?? [];
  const heroTrack = active || (watching && room.current) ? room.current : queue[0] ?? null;
  const nameOf = (id) => memberOf(room, id)?.username ?? "someone";

  // Fetched again when the song changes and when a round ends (my best may have moved). A failed fetch
  // answers null, which leaves the tiles with dashes.
  const heroKey = heroTrack?.audioKey ?? null;
  useEffect(() => {
    if (!heroKey || active || !store?.songStats) return undefined;
    let cancelled = false;
    store.songStats(heroKey).then((stats) => {
      if (!cancelled && mounted.current) setSongStats({ key: heroKey, stats });
    });
    return () => {
      cancelled = true;
    };
  }, [heroKey, active, room.round, store]);
  const stats = songStats.key === heroKey ? songStats.stats : null;

  // The clock's whole second and, in the final seconds, its digit (0 is "GO!"). It reads the start time mapped
  // onto the local clock, so it stays in step with the server.
  const second = left != null ? Math.max(0, Math.ceil(left / 1000)) : null;
  const digit = !watching && left != null ? countdownDigit(serverToPerf(room.nextAt, mapping), nowPerf) : null;
  // Mewbit: hyped in the final seconds, peeking when the round is close, otherwise the idle routine.
  const stagePose = lobbyPose({ remainingMs: left, digit });
  const stageText = stagePose === "idle" ? IDLE_TEXT[mewShown] ?? null : { hype: "get ready~", peek: "it's almost our turn!" }[stagePose] ?? null;

  const canChange = Boolean(me) && !active;
  const spectating = Boolean(me?.watching); // chose to watch; a member who only joined mid-round is a plain spectator
  // A round with nobody playing has nothing to run (the server refuses it too).
  const canStart = host && !active && queue.length > 0 && room.members.some((member) => !member.watching);
  // A player's level tile is their choice of level and the board follows it. A spectator has none to choose, so a tile
  // only picks which board to look at.
  const myLevel = me?.difficulty ?? "normal";
  const picksLevel = Boolean(me) && !spectating;
  const viewed = !picksLevel && viewedLevel.key === heroKey && viewedLevel.id ? viewedLevel.id : myLevel;

  const players = room.members.filter((member) => !member.spectator);
  const readyCount = players.filter((member) => member.ready).length;
  const loading = room.phase === "loading";
  const loaded = loadedCount(room);

  let clockLabel;
  let clock;
  let clockText;
  if (left != null) {
    clockLabel = "Round starts in";
    clock = formatClock(left);
    clockText = (
      <>
        <strong>{readyCount} of {players.length}</strong> ready.{" "}
        <span className="mb-lobby-long">The round starts when the clock runs out, or 5 seconds after everyone is ready.</span>
        <span className="mb-lobby-short">Starts at 0:00, or 5 s after all are ready.</span>
      </>
    );
  } else if (!queue.length) {
    clockLabel = "The queue is empty";
    clock = "–:––";
    clockText = <>Add a song and press Ready to start the clock.</>;
  } else if (room.members.every((member) => member.watching)) {
    clockLabel = "Nobody is playing";
    clock = "–:––";
    clockText = <>A round needs at least one player. Everyone here is watching.</>;
  } else {
    clockLabel = "Waiting for Ready";
    clock = "–:––";
    clockText = <>The clock starts when someone presses <strong>Ready</strong>.</>;
  }
  if (watching) {
    clockLabel = loading ? "Players loaded" : "Round in progress";
    clock = loading ? `${loaded.loaded}/${loaded.total}` : "LIVE";
    clockText = (
      <>
        {me?.spectator ? "You're watching this one." : "You missed the start of this round."} {spectating ? "Pick Player to join the next one." : "You join the next round as a player."}
      </>
    );
  }

  const levelLabel = (id) => DIFFICULTIES.find((d) => d.id === id)?.label ?? id;
  const readyLabel = active ? (loading ? "Loading…" : "Round in progress") : me?.ready ? "Ready ✓" : "Ready";

  return (
    <section className="mb-lobby" aria-label="Room lobby">
      <div className="mb-lobby-main">
        {notice ? <p className="mb-field-error" role="alert">{notice}</p> : null}

        <div className="mb-ss-panel mb-lobby-hero">
          <div className="mb-lobby-hero-top">
            {heroTrack && resolveArtworkUrl(heroTrack.artworkUrl)
              ? <img className="mb-lobby-cover" src={resolveArtworkUrl(heroTrack.artworkUrl)} alt="" draggable="false" />
              : <div className="mb-lobby-cover mb-lobby-cover-empty" aria-hidden="true" />}
            <div className="mb-lobby-hero-text">
              <span className="mb-ss-label">{heroTrack ? (active || watching ? `Now playing · queued by ${nameOf(heroTrack.addedBy)}` : `Next up · queued by ${nameOf(heroTrack.addedBy)}`) : "Nothing queued"}</span>
              <h2 title={heroTrack?.title}>{heroTrack?.title ?? "Pick the first song"}</h2>
              <span className="mb-lobby-artist">{heroTrack?.artist || (heroTrack ? "" : "Add songs and everyone plays them together.")}</span>
              {heroTrack ? (
                <div className="mb-lobby-chips">
                  {heroTrack.durationMs > 0 ? <span className="mb-lobby-chip">{formatClock(heroTrack.durationMs)}</span> : null}
                  {heroTrack.source ? <span className="mb-lobby-chip">{heroTrack.source}</span> : null}
                </div>
              ) : null}
            </div>
            <div className="mb-lobby-clock">
              <span className="mb-ss-label">{clockLabel}</span>
              <div className="mb-lobby-crow">
                <b key={watching ? "watch" : second ?? "idle"} className={`mb-lobby-time${watching ? "" : digit != null ? " mb-lobby-time-final" : second != null ? " mb-lobby-time-tick" : ""}`}>{digit === 0 ? "GO!" : clock}</b>
                {host && !watching ? (
                  <button type="button" className="mb-btn mb-lobby-start" disabled={!canStart || busy === "start"} onClick={() => run("start", () => store.start())}>
                    {busy === "start" ? "Starting…" : left != null ? "Start now" : "Start round"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <p className="mb-lobby-ctext">{clockText}</p>
        </div>

        {!watching && heroKey ? (
          <section className="mb-lobby-levels" aria-label="Levels">
            <span className="mb-ss-label mb-lobby-lvhead">{picksLevel ? "Pick your level" : "Levels of this song · tap one to see its board"}</span>
            <div className="mb-ss-diffs">
              {DIFFICULTIES.map(({ id, label }) => {
                const stat = stats?.[id];
                return (
                  <LevelTile
                    key={id}
                    as="button"
                    type="button"
                    id={id}
                    label={label}
                    stars={Number.isFinite(stat?.stars) ? stat.stars : null}
                    notes={Number.isFinite(stat?.notes) ? stat.notes.toLocaleString("en-US") : null}
                    best={stat?.best ?? null}
                    tag={picksLevel && myLevel === id ? "your level" : undefined}
                    aria-pressed={viewed === id}
                    className={viewed === id ? "mb-ss-diff-on" : ""}
                    disabled={picksLevel && (!canChange || busy === "difficulty")}
                    onClick={() => {
                      if (!picksLevel) setViewedLevel({ key: heroKey, id });
                      else if (myLevel !== id) run("difficulty", () => store.ready({ difficulty: id }));
                    }}
                  />
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="mb-lobby-queue" aria-label="Queue">
          <div className="mb-lobby-qhead">
            <span className="mb-ss-label">Queue · {queue.length} {queue.length === 1 ? "song" : "songs"}</span>
            <button type="button" className="mb-btn mb-btn-primary mb-lobby-add" onClick={onAddSongs}>
              <Plus size={16} weight="bold" aria-hidden="true" /> Add songs
            </button>
          </div>
          <Timeline
            room={room}
            userId={userId}
            nowPerf={nowPerf}
            mapping={mapping}
            busy={busy === "remove" || busy === "move"}
            onRemove={(index) => run("remove", () => store.queueRemove(index, queue[index]?.audioKey))}
            onMove={(from, to) => run("move", () => store.queueMove(from, to, queue[from]?.audioKey))}
          />
        </section>

        {watching ? (
          <div className="mb-ss-panel mb-lobby-watch">
            <span className="mb-ss-label">Round</span>
            <LiveBoard store={board} session="room" meId={userId} label="Round" />
          </div>
        ) : heroKey ? (
          <SongBoard request={request} audioKey={heroKey} difficulty={viewed} userId={userId} />
        ) : (
          <div className="mb-ss-panel mb-lobby-nosong">
            <b>No song on deck</b>
            <span>The four levels of the next song and its leaderboard show up here.</span>
          </div>
        )}
      </div>

      <aside className="mb-lobby-side">
        {showMewbit ? <StageMewbit pose={stagePose} text={stageText} effects={effects} tick={watching ? null : second} final={digit != null} onShow={setMewShown} /> : null}

        <section className="mb-lobby-plist" aria-label="Players">
          <h3 className="mb-lobby-shead">
            <span>Players <small>{room.members.length}</small></span>
            <em>{watching && loading ? <><strong>{loaded.loaded} of {loaded.total}</strong> loaded</> : <><strong>{readyCount} of {players.length}</strong> ready</>}</em>
          </h3>
          <ul className="mb-lobby-players">
            {ownerFirst(room).map((member) => {
              const status = memberStatus(room, member);
              const text = member.watching && !member.spectator ? "Spectating" : status.text;
              const tone = member.watching && !member.spectator ? "wait" : status.tone;
              const label = levelLabel(member.difficulty);
              const isMe = member.userId === userId;
              return (
                <li key={member.userId} className={`mb-lobby-pr${isMe ? " mb-lobby-pr-me" : ""}`}>
                  <Avatar name={member.username} avatarUrl={member.avatarUrl} size={34} />
                  <span className="mb-lobby-who">
                    <b>
                      <span>{member.username}</span>
                      {member.userId === room.hostId ? <span className="mb-lobby-owner"><Crown size={10} weight="fill" aria-hidden="true" />Owner</span> : null}
                      {isMe ? <span className="mb-lobby-you">YOU</span> : null}
                    </b>
                    <small className={`mb-lobby-st mb-lobby-st-${tone}`}>
                      <i className="mb-lobby-dot" aria-hidden="true" />
                      {text}
                      {member.spectator ? null : <span className={`mb-lobby-pill mb-lobby-pill-in mb-ss-d-${member.difficulty}`}>{label}</span>}
                    </small>
                  </span>
                  {member.spectator ? null : <span className={`mb-lobby-pill mb-ss-d-${member.difficulty}`}>{label}</span>}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="mb-ss-panel mb-lobby-invite">
          <div className="mb-lobby-invite-row">
            <span className="mb-ss-label">Invite (optional)</span>
            <button
              type="button"
              className="mb-btn"
              disabled={busy === "invite"}
              onClick={() => run("invite", async () => {
                const note = await sendRoomInvite({ store, sdk });
                if (mounted.current) setInviteNote(note);
                return { status: "ok" };
              })}
            >
              {busy === "invite" ? "Sending…" : "Send invite"}
            </button>
          </div>
          <p>Posts a Join button in your voice channel's chat. Not on one? Share a link to this room with anyone.</p>
          {inviteNote ? <p className={inviteNote.ok ? "mb-lobby-invite-ok" : "mb-field-error"} role="status">{inviteNote.text}</p> : null}
        </div>

        <div className="mb-lobby-keys">
          {keys.map((code) => <kbd key={code} className="mb-kbd">{keyLabel(code)}</kbd>)}
          <span className="mb-lobby-ofs">· offset {offsetMs >= 0 ? "+" : ""}{offsetMs} ms</span>
          <button type="button" className="mb-lobby-link" onClick={onCalibrate}>Calibrate</button>
        </div>

        {spectating && standings.length ? (
          <ol className="mb-lobby-last" aria-label="Last round">
            <li className="mb-ss-label">Last round</li>
            {standings.map((row, index) => (
              <li key={row.userId} className={row.me ? "mb-lobby-last-me" : undefined}>
                <span className="mb-lobby-last-pos">{index + 1}</span>
                <b>{row.username}</b>
                <span className="mb-lobby-last-score">{formatScore(row.score)}</span>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="mb-lobby-bar">
          <div className="mb-lobby-role">
            <span className="mb-ss-label">You are</span>
            <div className="mb-lobby-mode" role="group" aria-label="Player or spectator">
              {[{ id: false, label: "Player" }, { id: true, label: "Spectator" }].map(({ id, label }) => (
                <button
                  key={label}
                  type="button"
                  className={`mb-lobby-mode-btn${spectating === id ? " mb-lobby-mode-on" : ""}`}
                  aria-pressed={spectating === id}
                  disabled={!me || busy === "spectate"}
                  onClick={() => spectating !== id && run("spectate", () => store.ready({ spectate: id }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {spectating ? (
            <p className="mb-lobby-specnote">You're watching. Pick Player to join the next round.</p>
          ) : (
            <button
              type="button"
              className={`mb-lobby-ready${me?.ready && !active ? " mb-lobby-ready-on" : ""}`}
              aria-pressed={Boolean(me?.ready)}
              disabled={!canChange || busy === "ready"}
              onClick={() => run("ready", () => store.ready({ ready: !me?.ready }))}
            >
              {readyLabel}
            </button>
          )}
        </div>
      </aside>

      {toast ? <div className={`mb-lobby-toast${toast.error ? " mb-lobby-toast-error" : ""}`} role="status">{toast.text}</div> : null}
    </section>
  );
}
