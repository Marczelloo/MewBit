import { SignOut } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import Lobby, { LeaveConfirm } from "./Lobby.jsx";
import Results from "./Results.jsx";
import { createMockRequest, MOCK_USER_ID } from "./mockRequests.js";
import { addNextSong, applyReady, createMockFinishedRoom, createMockRoom, createMockSummary, moveInQueue, removeFromQueue, restartClock, ROUND_CLOCK_MS } from "./mockRoom.js";
import { standingsOf, upNextOf } from "./room.js";

// The room lobby (?mock=1&lobby=1) and the end-of-run Results with room standings (&results=1) on fake data, in the
// game's frame. Dev server only: MewbeatGame.jsx loads this file through a dynamic import behind import.meta.env.DEV,
// so none of it, nor the fake names, reaches the production build.
//
//   &clock=8       seconds on the round clock to begin with (the last five show the countdown and Mewbit's hype)
//   &host=kuba     see the room as a guest instead of its owner
//   &last=1        the lobby after a finished round (the finished song in the queue; "Last round" standings for a spectator)
//
// The controls work on the fake room: Ready, level, Player / Spectator, Add songs, moving and removing queued songs, Send invite and
// Start now. Nothing leaves the page.

const LATENCY_MS = 120; // long enough to see a control's busy state
const START_NOW_CLOCK_MS = 5000; // "Start now" jumps the clock to the countdown
const AFTER_START_MS = 1600; // "GO!" stays up this long, then the clock starts over
const KEYS = ["KeyD", "KeyF", "KeyJ", "KeyK"];
const MODES = [{ id: "live", label: "Live" }, { id: "solo", label: "Solo" }, { id: "room", label: "Room" }];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function Frame({ children, onLeave }) {
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
    </div>
  );
}

function MockLobbyScreen({ options }) {
  const [request] = useState(createMockRequest);
  const [snap, setSnap] = useState(() => ({
    room: options.last ? restartClock(createMockFinishedRoom(options), options.clockMs) : createMockRoom(options),
    receivedAt: performance.now(),
  }));
  const [leaveOpen, setLeaveOpen] = useState(false);
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
      start: change((room) => ({ room: restartClock(room, START_NOW_CLOCK_MS), reply: { status: "ok" } })),
      invite: async () => {
        await wait(LATENCY_MS);
        return { status: "ok" };
      },
      songStats: async (audioKey) => {
        const reply = await request("mewbeat_song_stats", { audioKey });
        return reply.status === "ok" ? reply.stats ?? null : null;
      },
    };
  }, [request]);

  // The clock starts over a moment after it runs out, so the preview never sits at 0:00.
  const nextAt = snap.room.nextAt;
  useEffect(() => {
    if (nextAt == null) return undefined;
    const id = setTimeout(() => {
      const room = restartClock(roomRef.current, ROUND_CLOCK_MS);
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
  const room = useMemo(() => createMockFinishedRoom(options), [options]);
  const summary = useMemo(createMockSummary, []);
  const standings = useMemo(() => standingsOf(room, MOCK_USER_ID), [room]);
  return (
    <Frame onLeave={() => {}}>
      <Results
        summary={summary}
        mode="room"
        phase="ended"
        effects="full"
        standings={standings}
        upNext={upNextOf(room)}
        request={request}
        userId={MOCK_USER_ID}
        onNext={room.hostId === MOCK_USER_ID ? () => {} : undefined}
        nextLabel="Start next round"
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
  const clockMs = Number.isFinite(clock) && clock > 0 ? clock * 1000 : ROUND_CLOCK_MS;
  const last = params.has("last");
  const options = useMemo(() => ({ hostId, clockMs, last }), [hostId, clockMs, last]);
  return params.has("results") ? <MockResultsScreen options={options} /> : <MockLobbyScreen options={options} />;
}
