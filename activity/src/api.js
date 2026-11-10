const configuredGateway = String(import.meta.env.VITE_ACTIVITY_GATEWAY_URL || "").replace(/\/$/, "");

function apiUrl(path) {
  return `${configuredGateway}${path}`;
}

function websocketUrl(path) {
  if (configuredGateway) {
    return configuredGateway.replace(/^http/i, "ws") + path;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

async function request(path, options = {}, accessToken = null) {
  const { timeoutMs = 12_000, ...fetchOptions } = options;
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(new Error("Activity request timed out.")), timeoutMs);
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(apiUrl(path), { ...fetchOptions, headers, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Activity request failed (${response.status}).`);
    return payload;
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new Error("Activity request timed out. Please try again.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function fetchActivityState({ guildId, accessToken }) {
  return request(`/api/activity/state?guildId=${encodeURIComponent(guildId)}`, {}, accessToken);
}

export function searchActivity({ guildId, accessToken, query, source, exact = false, signal }) {
  return request(
    "/api/activity/search",
    { method: "POST", body: JSON.stringify({ guildId, query, source, exact }), signal },
    accessToken
  );
}

export function searchActivityLibrary({ guildId, accessToken, query, signal }) {
  return request(
    "/api/activity/search/library",
    { method: "POST", body: JSON.stringify({ guildId, query }), signal },
    accessToken
  );
}

export function searchActivitySimilar({ guildId, accessToken, title, author, signal }) {
  return request(
    "/api/activity/search/similar",
    { method: "POST", body: JSON.stringify({ guildId, title, author }), signal },
    accessToken
  );
}

export function findActivityTrackSources({ guildId, accessToken, track }) {
  return request(
    "/api/activity/search/sources",
    {
      method: "POST",
      body: JSON.stringify({ guildId, title: track.title, author: track.author, uri: track.uri, source: track.source, durationMs: track.durationMs }),
    },
    accessToken
  );
}

export function sendActivityAction({ guildId, accessToken, action, payload }) {
  return request(
    "/api/activity/action",
    {
      method: "POST",
      body: JSON.stringify({ guildId, action, payload }),
      // Surprise me intentionally runs the full AI-first recommendation and
      // verification path. It can outlast a regular control request while
      // still succeeding, so do not report a false failure after 12 seconds.
      timeoutMs: action === "surprise_me" ? 75_000 : 12_000,
    },
    accessToken
  );
}

// The song for mewbeat solo play (Ogg Opus), as bytes for decodeAudioData. Goes through the same gateway base
// (and so the Discord proxy path) as the JSON requests; the response is not JSON, so it skips request().
//
// With clip the server answers with about 30 s of the song around fromMs (a smaller Ogg Opus file) and says where that
// cut sits in the song; the result is then { data, clipped, clipStartMs, fromMs, durationMs }. A server that can't cut
// answers with the whole song (clipped false). Without clip the result is the ArrayBuffer of the whole song.
export function clipInfoOf(headers) {
  const number = (name) => {
    const value = headers.get(name);
    if (value === null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    clipped: headers.get("X-Mewbeat-Clip") === "1",
    clipStartMs: number("X-Mewbeat-Clip-Start-Ms") ?? 0,
    fromMs: number("X-Mewbeat-From-Ms"),
    durationMs: number("X-Mewbeat-Duration-Ms"),
  };
}

export async function fetchMewbeatAudio({ guildId, accessToken, audioKey, signal, timeoutMs = 90_000, clip = false, fromMs = null }) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(new Error("The song took too long to download.")), timeoutMs);
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const clipQuery = clip ? `&clip=1${Number.isFinite(fromMs) && fromMs >= 0 ? `&fromMs=${Math.round(fromMs)}` : ""}` : "";
    const response = await fetch(
      apiUrl(`/api/activity/mewbeat/audio?guildId=${encodeURIComponent(guildId)}&audioKey=${encodeURIComponent(audioKey)}${clipQuery}`),
      { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, signal: controller.signal }
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Song download failed (${response.status}).`);
    }
    const data = await response.arrayBuffer();
    return clip ? { data, ...clipInfoOf(response.headers) } : data;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function connectActivitySocket({ guildId, accessToken, onState, onReady, onHeartbeat, onConnection, onError, onMewbeat }) {
  let socket = null;
  // The server rejects mewbeat_ messages until it has answered auth with ready.
  let authorized = false;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let stopped = false;
  let retryCount = 0;

  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(websocketUrl("/api/activity/ws"));
    socket.addEventListener("open", () => {
      retryCount = 0;
      authorized = false;
      onConnection?.({ status: "connecting", message: "Authorizing realtime connection" });
      socket.send(JSON.stringify({ type: "auth", guildId, token: accessToken }));
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "heartbeat" }));
      }, 5_000);
    });
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "state") onState(payload.state);
        if (payload.type === "ready") {
          authorized = true;
          onReady?.(payload.identity);
        }
        if (typeof payload.type === "string" && payload.type.startsWith("mewbeat_")) onMewbeat?.(payload);
        if (payload.type === "heartbeat") onHeartbeat?.(payload.time);
        if (payload.type === "error") onError?.(new Error(payload.error));
      } catch (error) {
        onError?.(error);
      }
    });
    socket.addEventListener("close", () => {
      authorized = false;
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (stopped) return;
      onConnection?.({ status: "reconnecting", message: "Realtime connection interrupted — reconnecting" });
      const baseDelay = Math.min(5000, 600 * (2 ** Math.min(retryCount, 3)));
      const delay = Math.round(baseDelay * (0.75 + Math.random() * 0.5));
      retryCount += 1;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(connect, delay);
    });
    socket.addEventListener("error", () => onError?.(new Error("Realtime Activity connection interrupted. Reconnecting…")));
  };

  connect();
  const stop = () => {
    stopped = true;
    window.clearTimeout(reconnectTimer);
    window.clearInterval(heartbeatTimer);
    socket?.close();
  };
  stop.send = (payload) => {
    if (!authorized || socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  };
  return stop;
}
