import { SignOut } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import Lobby, { LeaveConfirm } from "./Lobby.jsx";
import Results from "./Results.jsx";
import { createMockRequest, MOCK_USER_ID } from "./mockRequests.js";
import { addNextSong, applyReady, clearCountdown, createMockFinishedRoom, createMockRoom, createMockSummary, forceStart, mockTrack, MOCK_VERSUS, moveInQueue, removeFromQueue, startCountdown } from "./mockRoom.js";
import Stage from "./Stage.jsx";
import { standingsOf, upNextOf, voteOf } from "./room.js";

// The room lobby (?mock=1&lobby=1) and the end-of-run Results with room standings (&results=1) on fake data, in the
// game's frame. Dev server only: MewbeatGame.jsx loads this file through a dynamic import behind import.meta.env.DEV,
// so none of it, nor the fake names, reaches the production build.
//
//   &clock=8       seconds on the final countdown to begin with (the last five show the digits and Mewbit's hype)
//   &host=kuba     see the room as a guest instead of its owner
//   &charting=1    an uncharted song heads the queue: the levels row shows where it stands in line and the time it has waited
//   &last=1        the lobby after a finished round (the finished song in the queue; "Last round" standings for a spectator)
//   &solo=1        (with &results=1) the results of a Solo run, with no room around them
//   &versus=worse  (with &results=1) the run's pp and best before it: better (default), worse, first or none
//   &reply=2500    (with &results=1) the score reply arrives that many ms after the screen does
//
// The room starts with two of four players voted for the next map, so nothing counts down. The controls work on the
// fake room: the vote (a majority starts the final seconds, as on the bot), level, Player / Spectator, Add songs, moving
// and removing queued songs, Send invite and the host's Force start. Nothing leaves the page.

const LATENCY_MS = 120; // long enough to see a control's busy state
const AFTER_START_MS = 1600; // "GO!" stays up this long, then the vote starts over
const KEYS = ["KeyD", "KeyF", "KeyJ", "KeyK"];
const MODES = [{ id: "live", label: "Live" }, { id: "solo", label: "Solo" }, { id: "room", label: "Room" }];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// stage: a track whose painted scene sits behind the screen, as the game's stage does (results show it through).
function Frame({ children, onLeave, stage = null }) {
  return (
    <div className="mb-game mb-fx-full" role="dialog" aria-modal="true" aria-label="mewbeat">
      <header className="mb-header">
        <div className="mb-header-brand"><span className="mb-wordmark">mewbeat</span></div>
        <div className="mb-modes" role="group" aria-label="Mode">
          {MODES.map(({ id, label }) => {
            const active = id === "room";
            return (
              <button key={id} type="button" className={`mb-mode${active ? " mb-mode-on" : ""}`} aria-pressed={active} disabled={!active} title={active ? undefined : "Not available in the mock preview"}>
                {label}
              </button>
            );
          })}
        </div>
        <div className="mb-header-actions">
          <button type="button" className="mb-btn" onClick={onLeave}>
            <SignOut size={16} weight="bold" aria-hidden="true" /> Leave room
          </button>
        </div>
      </header>
      <div className="mb-screen">{children}</div>
      {stage ? <div className="mb-stage"><Stage track={stage} vibe={0} /></div> : null}
    </div>
  );
}

function MockLobbyScreen({ options }) {
  const [request] = useState(createMockRequest);
  const [snap, setSnap] = useState(() => ({
    room: options.last
      ? (options.clockMs ? startCountdown(createMockFinishedRoom(options), options.clockMs) : createMockFinishedRoom(options))
      : createMockRoom(options),
    receivedAt: performance.now(),
  }));
  const [leaveOpen, setLeaveOpen] = useState(false);
  // The picker's choice lives here; it also goes to the mock room so the player's own badges show, like the real send.
  const [modifiers, setModifiers] = useState([]);
  const roomRef = useRef(snap.room);

  const store = useMemo(() => {
    const commit = (room) => {
      roomRef.current = room;
      setSnap({ room, receivedAt: performance.now() });
    };
    // Every control answers after a short wait, then applies to the latest room.
    const change = (fn) => async (...args) => {
      await wait(LATENCY_MS);
      const { room, reply } = fn(roomRef.current, ...args);
      if (reply.status === "ok") commit(room);
      return reply;
    };
    return {
      ready: change((room, patch) => applyReady(room, MOCK_USER_ID, patch)),
      queueRemove: change((room, index) => removeFromQueue(room, MOCK_USER_ID, index)),
      queueMove: change((room, from, to) => moveInQueue(room, MOCK_USER_ID, from, to)),
      queueAdd: change((room) => addNextSong(room, MOCK_USER_ID)),
      start: change((room) => forceStart(room, MOCK_USER_ID)),
      invite: async () => {
        await wait(LATENCY_MS);
        return { status: "ok" };
      },
      songStats: async (audioKey, { onQueue } = {}) => {
        const reply = await request("mewbeat_song_stats", { audioKey });
        onQueue?.(reply.status === "ok" ? reply.queue ?? null : null);
        return reply.status === "ok" ? reply.stats ?? null : null;
      },
    };
  }, [request]);

  // The vote starts over a moment after the countdown runs out (the round would have begun), so the preview can be run again.
  const nextAt = snap.room.nextAt;
  useEffect(() => {
    if (nextAt == null) return undefined;
    const id = setTimeout(() => {
      const room = clearCountdown(roomRef.current);
      roomRef.current = room;
      setSnap({ room, receivedAt: performance.now() });
    }, Math.max(0, nextAt - Date.now()) + AFTER_START_MS);
    return () => clearTimeout(id);
  }, [nextAt]);

  return (
    <Frame onLeave={() => setLeaveOpen(true)}>
      <Lobby
        room={snap.room}
        userId={MOCK_USER_ID}
        view="lobby"
        receivedAt={snap.receivedAt}
        serverClock={null}
        store={store}
        request={request}
        board={null}
        standings={standingsOf(snap.room, MOCK_USER_ID)}
        modifiers={modifiers}
        onModifiers={(ids) => {
          setModifiers(ids);
          store.ready({ modifiers: ids });
        }}
        effects="full"
        showMewbit
        keys={KEYS}
        offsetMs={12}
        notice={null}
        onAddSongs={() => store.queueAdd()}
        onCalibrate={() => {}}
      />
      {leaveOpen ? <LeaveConfirm onStay={() => setLeaveOpen(false)} onLeave={() => setLeaveOpen(false)} /> : null}
    </Frame>
  );
}

function MockResultsScreen({ options }) {
  const [request] = useState(createMockRequest);
  // The vote works on the fake room, so the toggle, the count and the countdown can be tried.
  const [room, setRoom] = useState(() => createMockFinishedRoom(options));
  const [receivedAt, setReceivedAt] = useState(() => performance.now());
  const settled = useMemo(() => createMockSummary({ failed: options.failed, nf: options.nf, versus: options.versus }), [options.failed, options.nf, options.versus]);
  // &reply=<ms>: the score reply is still on its way for that long, as on a slow bot.
  const [replied, setReplied] = useState(!options.replyMs);
  useEffect(() => {
    if (replied) return undefined;
    const timer = setTimeout(() => setReplied(true), options.replyMs);
    return () => clearTimeout(timer);
  }, [replied, options.replyMs]);
  const summary = useMemo(() => (replied || options.failed ? settled : { ...settled, submit: { status: "submitting" } }), [replied, settled, options.failed]);
  const solo = options.solo;
  const standings = useMemo(() => (solo ? null : standingsOf(room, MOCK_USER_ID)), [room, solo]);
  const tally = voteOf(room);
  const me = room.members.find((m) => m.userId === MOCK_USER_ID);
  const commit = (next) => { setRoom(next); setReceivedAt(performance.now()); };
  const startPerf = room.nextAt != null ? receivedAt + (room.nextAt - room.serverNow) : null;
  const stage = useMemo(() => mockTrack(summary.title, MOCK_USER_ID), [summary.title]);
  return (
    <Frame onLeave={() => {}} stage={stage}>
      <Results
        summary={summary}
        mode={solo ? "solo" : "room"}
        phase="ended"
        effects="full"
        standings={standings}
        upNext={solo ? null : upNextOf(room)}
        request={request}
        userId={MOCK_USER_ID}
        onRestart={() => {}}
        onNext={solo ? undefined : () => { const { room: next, reply } = applyReady(room, MOCK_USER_ID, { ready: !me.ready }); if (reply.status === "ok") commit(next); }}
        nextOn={Boolean(me?.ready)}
        nextLabel="Play next"
        nextCount={`${tally.votes}/${tally.needed}`}
        vote={{ votes: tally.votes, needed: tally.needed, names: tally.voters.map((m) => m.username), forced: tally.forced, startPerf: tally.counting ? startPerf : null }}
        onForce={!solo && room.hostId === MOCK_USER_ID ? () => { const { room: next, reply } = forceStart(room, MOCK_USER_ID); if (reply.status === "ok") commit(next); } : undefined}
        onSuggest={solo ? undefined : () => Promise.resolve()}
        suggestLabel="Add"
        suggestDoneLabel="Added"
        savedOffset={12}
        onApplyOffset={() => {}}
        onBack={() => {}}
      />
    </Frame>
  );
}

export default function MockLobby({ search }) {
  const params = new URLSearchParams(search);
  const clock = Number(params.get("clock"));
  const hostId = params.get("host") === "kuba" ? "kuba" : MOCK_USER_ID;
  const clockMs = Number.isFinite(clock) && clock > 0 ? clock * 1000 : null;
  const last = params.has("last");
  // &failed=1: the results of a lost run; &nf=1: a No Fail run whose health ran out.
  const failed = params.has("failed");
  const nf = params.has("nf");
  const charting = params.has("charting");
  // &solo=1: the same results as a Solo run's, with no room around them; &versus=better|worse|first|none: what the score
  // reply says of the pp and the best before the run; &reply=2500: the reply arrives that many ms after the screen.
  const solo = params.has("solo");
  const versus = MOCK_VERSUS.includes(params.get("versus")) ? params.get("versus") : undefined;
  const reply = Number(params.get("reply"));
  const replyMs = Number.isFinite(reply) && reply > 0 ? reply : 0;
  const options = useMemo(() => ({ hostId, clockMs, last, failed, nf, charting, solo, versus, replyMs }), [hostId, clockMs, last, failed, nf, charting, solo, versus, replyMs]);
  return params.has("results") ? <MockResultsScreen options={options} /> : <MockLobbyScreen options={options} />;
}
