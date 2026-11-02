import { Plus, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { formatScore } from "./GameHud.jsx";
import LiveBoard from "./LiveBoard.jsx";
import { gradeClass, resolveArtworkUrl } from "./SongSelect.jsx";
import { keyLabel } from "./input.js";
import Mewbit from "./mewbit/Mewbit.jsx";
import {
  countdownDigit,
  formatClock,
  inviteMessage,
  isHost,
  lobbyPose,
  memberOf,
  memberStatus,
  remainingMs,
  roomErrorText,
  roundActive,
  serverToPerf,
  songProgress,
  timelineOf,
} from "./room.js";

const DIFFICULTIES = [
  { id: "easy", label: "Easy", tone: "cyan" },
  { id: "normal", label: "Normal", tone: "violet" },
  { id: "hard", label: "Hard", tone: "pink" },
  { id: "hell", label: "Hell", tone: "hell" },
];
const IDLE_BEATS = [
  { pose: "stretch", text: "warming up the paws…" },
  { pose: "adjust", text: "*adjusts headphones*" },
  { pose: "stretch", text: "waiting for my song~" },
];
const IDLE_BEAT_MS = 6000;
const TOAST_MS = 4500;

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

function Avatar({ name, url }) {
  const src = resolveArtworkUrl(url);
  if (src) return <img className="mb-lobby-av" src={src} alt="" draggable="false" />;
  return <span className="mb-lobby-av mb-lobby-av-text" aria-hidden="true">{String(name ?? "?").slice(0, 2).toUpperCase()}</span>;
}

// Mewbit on the stage with a speech bubble. The "go" pose carries its own bubble. Every new `tick` (the clock's
// second) sends a ring out from Mewbit, and in the final seconds it bumps too: swapping between two identical
// animations restarts the bump, and the ring restarts by remounting.
function StageMewbit({ pose, text, effects, tick = null, final = false }) {
  const beat = final ? ` mb-lobby-beat-${tick % 2 ? "a" : "b"}` : "";
  return (
    <div className="mb-lobby-mew">
      {text ? <div className="mb-lobby-bubble" key={text}>{text}</div> : null}
      <div className={`mb-lobby-mewbox${beat}`}>
        <div className="mb-lobby-spot" aria-hidden="true" />
        {tick != null ? <span key={tick} className={`mb-lobby-ring${final ? " mb-lobby-ring-final" : ""}`} aria-hidden="true" /> : null}
        <Mewbit pose={pose} effects={effects} />
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

function Timeline({ room, userId, nowPerf, mapping, busy, onRemove }) {
  const segments = timelineOf(room, userId);
  if (!segments.length) return <p className="mb-lobby-note">The queue is empty. Add a song to get a round going.</p>;
  const progress = songProgress(room, mapping, nowPerf);
  const nameOf = (id) => memberOf(room, id)?.username ?? "someone";
  return (
    <ol className="mb-tl" aria-label="Queue">
      {segments.map((segment) => {
        const { track } = segment;
        const live = segment.current && !segment.finished;
        const cls = ["mb-tl-seg", live ? "mb-tl-now" : "", segment.finished ? "mb-tl-done" : "", segment.mine && !segment.current ? "mb-tl-mine" : ""].filter(Boolean).join(" ");
        return (
          <li key={segment.key} className={cls} style={{ flex: segment.flex }}>
            <div className="mb-tl-bar"><i style={{ transform: `scaleX(${segment.current ? progress : 0})` }} /></div>
            <div className="mb-tl-txt">
              <b title={track.title}>{track.title}</b>
              <small>
                {live ? "now playing" : segment.finished ? "finished" : `${formatClock(track.durationMs)} · ${segment.mine ? "you" : nameOf(track.addedBy)}`}
              </small>
            </div>
            {segment.canRemove ? (
              <button type="button" className="mb-tl-x" aria-label={`Remove ${track.title}`} disabled={busy} onClick={() => onRemove(segment.index)}>
                <X size={12} weight="bold" aria-hidden="true" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// The room lobby: what is queued, when the round starts, who is here and what each of them plays.
// `view` is "lobby" (between rounds) or "watching" (a round is running without this player).
export default function Lobby({ room, userId, view, receivedAt, serverClock, store, board, effects, showMewbit = true, keys, offsetMs, notice, standings = [], onAddSongs, onCalibrate }) {
  const me = memberOf(room, userId);
  const host = isHost(room, userId);
  const active = roundActive(room);
  const watching = view === "watching";
  const nowPerf = useTick(room.nextAt != null ? 100 : 250);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [inviteNote, setInviteNote] = useState(null);
  // Per-difficulty stars, notes and my best of the hero song. Kept per song, so a new song shows names only
  // until its numbers arrive, and the old ones stay put while a refetch (after a round) is in flight.
  const [songStats, setSongStats] = useState({ key: null, stats: null });

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
  // answers null, which leaves the buttons with their names only.
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
  // Mewbit: hyped in the final seconds, peeking when the round is close, otherwise the idle poses in turn.
  const pose = lobbyPose({ remainingMs: left, digit });
  const beat = IDLE_BEATS[Math.floor(nowPerf / IDLE_BEAT_MS) % IDLE_BEATS.length];
  const stagePose = pose === "idle" ? beat.pose : pose;
  const stageText = pose === "idle" ? beat.text : { hype: "get ready~", peek: "it's almost our turn!" }[pose] ?? null;

  const canChange = Boolean(me) && !active;
  const spectating = Boolean(me?.watching); // chose to watch; a member who only joined mid-round is a plain spectator
  // A round with nobody playing has nothing to run (the server refuses it too).
  const canStart = host && !active && queue.length > 0 && room.members.some((member) => !member.watching);

  const players = room.members.filter((member) => !member.spectator);
  const readyCount = players.filter((member) => member.ready).length;

  let clockLabel;
  let clock;
  let clockText;
  if (left != null) {
    clockLabel = "Round starts in";
    clock = formatClock(left);
    clockText = <><strong>{readyCount} of {players.length}</strong> ready. The round starts when the clock runs out, or 5 seconds after everyone is ready.</>;
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

  return (
    <section className="mb-lobby" aria-label="Room lobby">
      <div className="mb-lobby-main">
        {notice ? <p className="mb-field-error" role="alert">{notice}</p> : null}

        <div className={`mb-lobby-hero${watching ? " mb-lobby-hero-watch" : showMewbit ? "" : " mb-lobby-hero-solo"}`}>
          <div className="mb-lobby-hero-left">
            <div className="mb-lobby-next">
              {heroTrack && resolveArtworkUrl(heroTrack.artworkUrl)
                ? <img className="mb-lobby-cover" src={resolveArtworkUrl(heroTrack.artworkUrl)} alt="" draggable="false" />
                : <div className="mb-lobby-cover mb-lobby-cover-empty" aria-hidden="true" />}
              <div className="mb-lobby-hero-text">
                <span className="mb-lobby-lbl">{heroTrack ? (active || watching ? `Now playing · queued by ${nameOf(heroTrack.addedBy)}` : `Next up · queued by ${nameOf(heroTrack.addedBy)}`) : "Nothing queued"}</span>
                <h2 title={heroTrack?.title}>{heroTrack?.title ?? "Pick the first song"}</h2>
                <span className="mb-lobby-artist">{heroTrack?.artist || (heroTrack ? "" : "Add songs and everyone plays them together.")}</span>
                {heroTrack ? (
                  <div className="mb-lobby-chips">
                    {heroTrack.durationMs > 0 ? <span className="mb-lobby-chip">{formatClock(heroTrack.durationMs)}</span> : null}
                    {heroTrack.source ? <span className="mb-lobby-chip">{heroTrack.source}</span> : null}
                  </div>
                ) : null}
              </div>
              {watching ? null : (
                <div className="mb-lobby-clock">
                  <span className="mb-lobby-lbl">{clockLabel}</span>
                  <b key={second ?? "idle"} className={`mb-lobby-time${digit != null ? " mb-lobby-time-final" : second != null ? " mb-lobby-time-tick" : ""}`}>{digit === 0 ? "GO!" : clock}</b>
                  {host ? (
                    <button type="button" className="mb-btn mb-lobby-start" disabled={!canStart || busy === "start"} onClick={() => run("start", () => store.start())}>
                      {busy === "start" ? "Starting…" : left != null ? "Start now" : "Start round"}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
            {watching ? null : <p className="mb-lobby-count-text">{clockText}</p>}
          </div>
          {watching ? (
            <div className="mb-lobby-watch">
              <span className="mb-lobby-lbl">Round in progress</span>
              <p className="mb-lobby-count-text">
                {me?.spectator ? "You're watching this one." : "You missed the start of this round."} {spectating ? "Pick Player to join the next one." : "You join the next round as a player."}
              </p>
              <LiveBoard store={board} session="room" meId={userId} label="Round" />
            </div>
          ) : showMewbit ? (
            <StageMewbit pose={stagePose} text={stageText} effects={effects} tick={second} final={digit != null} />
          ) : null}
        </div>

        <div className="mb-lobby-queue">
          <span className="mb-lobby-lbl">Queue</span>
          <Timeline
            room={room}
            userId={userId}
            nowPerf={nowPerf}
            mapping={mapping}
            busy={busy === "remove"}
            onRemove={(index) => run("remove", () => store.queueRemove(index))}
          />
        </div>

        <div className="mb-lobby-mine">
          <div className="mb-lobby-role">
            <span className="mb-lobby-lbl">You are</span>
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
          <div className="mb-lobby-actions">
            <button type="button" className="mb-btn mb-lobby-add" onClick={onAddSongs}>
              <Plus size={15} weight="bold" aria-hidden="true" /> Add songs
            </button>
            {spectating ? null : (
              <button
                type="button"
                className={`mb-lobby-ready${me?.ready ? " mb-lobby-ready-on" : ""}`}
                aria-pressed={Boolean(me?.ready)}
                disabled={!canChange || busy === "ready"}
                onClick={() => run("ready", () => store.ready({ ready: !me?.ready }))}
              >
                {me?.ready ? "Ready ✓" : "Ready"}
              </button>
            )}
          </div>
          {spectating ? (
            <div className="mb-lobby-watching">
              <p className="mb-lobby-count-text">You're watching. Pick Player to join the next round.</p>
              {standings.length ? (
                <ol className="mb-lobby-last" aria-label="Last round">
                  <li className="mb-lobby-lbl">Last round</li>
                  {standings.map((row, index) => (
                    <li key={row.userId} className={row.me ? "mb-lobby-last-me" : undefined}>
                      <span className="mb-lobby-last-pos">{index + 1}</span>
                      <b>{row.username}</b>
                      <span className="mb-lobby-last-score">{formatScore(row.score)}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : (
            <div className="mb-lobby-pick">
              <span className="mb-lobby-lbl">Your difficulty</span>
              <div className="mb-lobby-diffs" role="group" aria-label="Your difficulty">
                {DIFFICULTIES.map(({ id, label, tone }) => {
                  const stat = stats?.[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`mb-lobby-diff mb-lobby-diff-${tone}${me?.difficulty === id ? " mb-lobby-diff-on" : ""}`}
                      aria-pressed={me?.difficulty === id}
                      disabled={!canChange || busy === "difficulty"}
                      onClick={() => me?.difficulty !== id && run("difficulty", () => store.ready({ difficulty: id }))}
                    >
                      <b>{label}</b>
                      {stat ? (
                        <>
                          <small className="mb-lobby-diff-stars">{Number.isFinite(stat.stars) ? `★ ${stat.stars.toFixed(1)}` : "★ –"}</small>
                          <small>{Number.isFinite(stat.notes) ? `${stat.notes.toLocaleString("en-US")} notes` : ""}</small>
                          <small className="mb-lobby-diff-best">
                            {stat.best ? <>best {formatScore(stat.best.score)} · <b className={gradeClass(stat.best.grade)}>{stat.best.grade}</b></> : "no score yet"}
                          </small>
                        </>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="mb-lobby-side">
        <h3>Players <small>{room.members.length}</small></h3>
        <ul className="mb-lobby-players">
          {room.members.map((member) => {
            const status = memberStatus(room, member);
            const difficulty = DIFFICULTIES.find((d) => d.id === member.difficulty);
            const tone = difficulty?.tone ?? "violet";
            const isMe = member.userId === userId;
            return (
              <li key={member.userId} className={`mb-lobby-pl${isMe ? " mb-lobby-pl-me" : ""}`}>
                <Avatar name={member.username} url={member.avatarUrl} />
                <span className="mb-lobby-who">
                  <b><span>{member.username}</span>{isMe ? <span className="mb-lobby-you">YOU</span> : null}</b>
                  <small>{[member.userId === room.hostId ? "host" : null, member.watching ? "spectating" : member.spectator ? "spectator" : null].filter(Boolean).join(" · ") || " "}</small>
                </span>
                <span className="mb-lobby-state">
                  {member.spectator ? null : <span className={`mb-lobby-pill mb-lobby-pill-${tone}`}>{difficulty?.label ?? member.difficulty}</span>}
                  <span className={`mb-lobby-st mb-lobby-st-${status.tone}`}>{status.text}</span>
                </span>
              </li>
            );
          })}
        </ul>

        <div className="mb-lobby-invite">
          <span className="mb-lobby-lbl">Invite (optional)</span>
          <p>Posts one message in the voice channel chat with a Join button. Invited players don't need a code.</p>
          <button
            type="button"
            className="mb-btn"
            disabled={busy === "invite"}
            onClick={() => run("invite", async () => {
              const reply = await store.invite();
              const note = inviteMessage(reply);
              if (mounted.current) setInviteNote(note);
              return { status: "ok" };
            })}
          >
            {busy === "invite" ? "Sending…" : "Send invite"}
          </button>
          {inviteNote ? <p className={inviteNote.ok ? "mb-lobby-invite-ok" : "mb-field-error"} role="status">{inviteNote.text}</p> : null}
        </div>

        <div className="mb-lobby-keys">
          {keys.map((code) => <kbd key={code} className="mb-kbd">{keyLabel(code)}</kbd>)}
          <span>· offset {offsetMs >= 0 ? "+" : ""}{offsetMs} ms</span>
          <button type="button" className="mb-lobby-link" onClick={onCalibrate}>Calibrate</button>
        </div>
      </aside>

      {toast ? <div className={`mb-lobby-toast${toast.error ? " mb-lobby-toast-error" : ""}`} role="status">{toast.text}</div> : null}
    </section>
  );
}
