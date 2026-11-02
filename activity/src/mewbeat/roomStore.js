// The room as the Activity sees it: the newest snapshot the bot pushed, whether this client wants to be
// in the room, and the requests that go with it. Joining is remembered, so a socket that dropped and came
// back (the server removes a member when its socket closes) re-joins on its own.
export function createRoomStore({ requests, now = () => performance.now(), onRoom = () => {} }) {
  const listeners = new Set();
  let view = { room: null, receivedAt: 0, joining: false, joinError: null };
  let wanted = false;
  let joinToken = 0;
  let counter = 0;

  function set(patch) {
    view = { ...view, ...patch };
    for (const fn of [...listeners]) fn(view);
  }

  async function act(type, body = {}, timeoutMs) {
    try {
      return await requests.request(type, body, timeoutMs);
    } catch {
      return { status: "error", reason: "unreachable" };
    }
  }

  async function join() {
    wanted = true;
    const mine = ++joinToken;
    set({ joining: true, joinError: null });
    const reply = await act("mewbeat_room_join");
    if (mine !== joinToken || !wanted) return reply;
    set({ joining: false, joinError: reply.status === "ok" ? null : reply.reason ?? "unreachable" });
    return reply;
  }

  function leave() {
    const was = wanted;
    wanted = false;
    joinToken += 1;
    onRoom(null, now());
    set({ room: null, joining: false, joinError: null });
    if (was) requests.send({ type: "mewbeat_room_leave", id: `rs${++counter}` });
  }

  // Everything the socket delivers passes through here first; it consumes only the room push.
  function handle(message) {
    if (message?.type === "mewbeat_socket_ready") {
      if (wanted) join();
      return false;
    }
    if (message?.type !== "mewbeat_room") return false;
    if (!wanted) return true; // a push for a room this client already left
    const receivedAt = now();
    const room = message.room ?? null;
    onRoom(room, receivedAt);
    set({ room, receivedAt, joining: false, joinError: null });
    return true;
  }

  return {
    join,
    leave,
    handle,
    get: () => view,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    wanted: () => wanted,
    ready: (body) => act("mewbeat_room_ready", body),
    start: () => act("mewbeat_room_start"),
    queueAdd: ({ uri, source }) => act("mewbeat_room_queue_add", { uri, source }, 40_000),
    queueRemove: (index) => act("mewbeat_room_queue_remove", { index }),
    invite: () => act("mewbeat_room_invite"),
    // Per-difficulty stars, note counts and my best for a song; null when the bot can't tell (never throws).
    songStats: async (audioKey) => {
      const reply = await act("mewbeat_song_stats", { audioKey });
      return reply?.status === "ok" ? reply.stats ?? null : null;
    },
  };
}
