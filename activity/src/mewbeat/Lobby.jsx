import { Plus, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import LiveBoard from "./LiveBoard.jsx";
import { resolveArtworkUrl } from "./SongSelect.jsx";
import { keyLabel } from "./input.js";
import Mewbit from "./mewbit/Mewbit.jsx";
import {
  GO_WINDOW_MS,
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
  songProgress,
  timelineOf,
} from "./room.js";

const DIFFICULTIES = [
  { id: "easy", label: "Easy", tone: "cyan" },
  { id: "normal", label: "Normal", tone: "violet" },
  { id: "hard", label: "Hard", tone: "pink" },
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

// Mewbit on the stage with a speech bubble. The "go" pose carries its own bubble.
export function StageMewbit({ pose, text, effects, className = "" }) {
  return (
    <div className={`mb-lobby-mew ${className}`.trim()}>
      <div className="mb-lobby-spot" aria-hidden="true" />
      <div className="mb-lobby-mewbox"><Mewbit pose={pose} effects={effects} /></div>
      {text ? <div className="mb-lobby-bubble" key={text}>{text}</div> : null}
    </div>
  );
}

// The full-screen 5-4-3-2-1-GO. It reads the start time the room link mapped onto the local clock, so it
// stays in step with the audio, and goes away by itself once GO has been on screen.
export function CountdownOverlay({ startPerf, title, effects }) {
  const [digit, setDigit] = useState(() => countdownDigit(startPerf, performance.now()));
  useEffect(() => {
    if (!Number.isFinite(startPerf)) return undefined;
    let frame = 0;
    const loop = () => {
      const now = performance.now();
      setDigit(countdownDigit(startPerf, now));
      if (startPerf - now > -GO_WINDOW_MS) frame = window.requestAnimationFrame(loop);
    };
    loop();
    return () => window.cancelAnimationFrame(frame);
  }, [startPerf]);
  if (digit == null) return null;
  const go = digit === 0;
  return (
    <div className="mb-countdown" role="status" aria-live="assertive">
      <div className="mb-countdown-inner">
        <span className="mb-countdown-label">{go ? "" : "Get ready"}{!go && title ? <> · <b>{title}</b></> : null}</span>
        <b key={digit} className={`mb-countdown-num${go ? " mb-countdown-go" : ""}`}>{go ? "GO!" : digit}</b>
        <StageMewbit className="mb-lobby-mew-small" pose={go ? "go" : "hype"} text={go ? null : "LET'S GOOO!!"} effects={effects} />
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
export default function Lobby({ room, userId, view, receivedAt, serverClock, store, board, effects, keys, offsetMs, notice, onAddSongs, onLeave, onCalibrate }) {
  const me = memberOf(room, userId);
  const host = isHost(room, userId);
  const active = roundActive(room);
  const watching = view === "watching";
  const nowPerf = useTick(250);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [inviteNote, setInviteNote] = useState(null);

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
  const left = room.phase === "intermission" ? remainingMs(room.nextAt, mapping, nowPerf) : null;
  const queue = room.queue ?? [];
  const heroTrack = active || (watching && room.current) ? room.current : queue[0] ?? null;
  const nameOf = (id) => memberOf(room, id)?.username ?? "someone";

  // Mewbit: peek in the last seconds of the intermission, otherwise the idle poses in turn.
  const pose = lobbyPose({ phase: room.phase, remainingMs: left });
  const beat = IDLE_BEATS[Math.floor(nowPerf / IDLE_BEAT_MS) % IDLE_BEATS.length];
  const stagePose = pose === "peek" ? "peek" : beat.pose;
  const stageText = pose === "peek" ? "it's almost our turn!" : beat.text;

  const canChange = Boolean(me) && !active;
  const canStart = host && !active && queue.length > 0;

  let clockLabel;
  let clock;
  let clockText;
  if (room.phase === "intermission" && left != null) {
    clockLabel = "Round starts in";
    clock = formatClock(left);
    clockText = <><strong>{queue.length} {queue.length === 1 ? "song" : "songs"}</strong> in the queue. The next round starts by itself{host ? ", or press Start now" : ""}.</>;
  } else if (!queue.length) {
    clockLabel = "The queue is empty";
    clock = "–:––";
    clockText = <>Add a song and the round can begin.</>;
  } else {
    clockLabel = host ? "Ready when you are" : "Waiting for the host";
    clock = "–:––";
    clockText = host ? <>Press Start when everyone is here.</> : <>{nameOf(room.hostId)} starts the round. Add songs while you wait.</>;
  }

  return (
    <section className="mb-lobby" aria-label="Room lobby">
      <div className="mb-lobby-main">
        <div className="mb-lobby-top">
          <button type="button" className="mb-btn" onClick={onLeave}>Leave room</button>
          <span className="mb-lobby-crumb">/ lobby · {room.members.length} {room.members.length === 1 ? "player" : "players"}</span>
          {watching ? <span className="mb-lobby-badge" role="status">Round in progress</span> : null}
        </div>

        {notice ? <p className="mb-field-error" role="alert">{notice}</p> : null}

        <div className="mb-lobby-hero">
          {heroTrack && resolveArtworkUrl(heroTrack.artworkUrl)
            ? <img className="mb-lobby-cover" src={resolveArtworkUrl(heroTrack.artworkUrl)} alt="" draggable="false" />
            : <div className="mb-lobby-cover mb-lobby-cover-empty" aria-hidden="true" />}
          <div className="mb-lobby-hero-text">
            <span className="mb-lobby-lbl">{heroTrack ? (active || watching ? `Now playing · queued by ${nameOf(heroTrack.addedBy)}` : `Round queued by ${nameOf(heroTrack.addedBy)}`) : "Nothing queued"}</span>
            <h2>{heroTrack?.title ?? "Pick the first song"}</h2>
            <span className="mb-lobby-artist">{heroTrack?.artist || (heroTrack ? "" : "Add songs to the queue and everyone plays them together.")}</span>
            {heroTrack ? (
              <div className="mb-lobby-chips">
                {heroTrack.durationMs > 0 ? <span className="mb-lobby-chip">{formatClock(heroTrack.durationMs)}</span> : null}
                {heroTrack.source ? <span className="mb-lobby-chip">{heroTrack.source}</span> : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mb-lobby-stage">
          {watching ? (
            <div className="mb-lobby-watch">
              <span className="mb-lobby-lbl">Round in progress</span>
              <p className="mb-lobby-count-text">
                {me?.spectator ? "You're watching this one." : "You missed the start of this round."} You join the next round as a player.
              </p>
              <LiveBoard store={board} session="room" meId={userId} label="Round" />
            </div>
          ) : (
            <div className="mb-lobby-clock">
              <span className="mb-lobby-lbl">{clockLabel}</span>
              <div className="mb-lobby-count">
                <b className="mb-lobby-time">{clock}</b>
                <p className="mb-lobby-count-text">{clockText}</p>
              </div>
              {host ? (
                <button type="button" className="mb-btn mb-btn-primary mb-lobby-start" disabled={!canStart || busy === "start"} onClick={() => run("start", () => store.start())}>
                  {busy === "start" ? "Starting…" : room.phase === "intermission" ? "Start now" : "Start round"}
                </button>
              ) : null}
            </div>
          )}
          <StageMewbit pose={stagePose} text={stageText} effects={effects} />
        </div>

        <div className="mb-lobby-queue">
          <div className="mb-lobby-queue-head">
            <span className="mb-lobby-lbl">Queue</span>
            <button type="button" className="mb-btn mb-lobby-add" onClick={onAddSongs}>
              <Plus size={14} weight="bold" aria-hidden="true" /> Add songs
            </button>
          </div>
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
          <div>
            <span className="mb-lobby-lbl">Your difficulty</span>
            <div className="mb-lobby-diffs" role="group" aria-label="Your difficulty">
              {DIFFICULTIES.map(({ id, label, tone }) => (
                <button
                  key={id}
                  type="button"
                  className={`mb-lobby-diff mb-lobby-diff-${tone}${me?.difficulty === id ? " mb-lobby-diff-on" : ""}`}
                  aria-pressed={me?.difficulty === id}
                  disabled={!canChange || busy === "difficulty"}
                  onClick={() => me?.difficulty !== id && run("difficulty", () => store.ready({ difficulty: id }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className={`mb-lobby-ready${me?.ready ? " mb-lobby-ready-on" : ""}`}
            aria-pressed={Boolean(me?.ready)}
            disabled={!canChange || busy === "ready"}
            onClick={() => run("ready", () => store.ready({ ready: !me?.ready }))}
          >
            {me?.ready ? "Ready ✓" : "Ready"}
          </button>
        </div>
      </div>

      <aside className="mb-lobby-side">
        <h3>Players <small>{room.members.length} in the room</small></h3>
        <ul className="mb-lobby-players">
          {room.members.map((member) => {
            const status = memberStatus(room, member);
            const tone = DIFFICULTIES.find((d) => d.id === member.difficulty)?.tone ?? "violet";
            const isMe = member.userId === userId;
            return (
              <li key={member.userId} className={`mb-lobby-pl${isMe ? " mb-lobby-pl-me" : ""}`}>
                <Avatar name={member.username} url={member.avatarUrl} />
                <span className="mb-lobby-who">
                  <b>{member.username}{isMe ? <span className="mb-lobby-you">YOU</span> : null}</b>
                  <small>{[member.userId === room.hostId ? "host" : null, member.spectator ? "spectator" : null].filter(Boolean).join(" · ") || " "}</small>
                </span>
                <span className="mb-lobby-state">
                  {member.spectator ? null : <span className={`mb-lobby-pill mb-lobby-pill-${tone}`}>{DIFFICULTIES.find((d) => d.id === member.difficulty)?.label ?? member.difficulty}</span>}
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
