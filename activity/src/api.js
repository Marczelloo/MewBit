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

export function connectActivitySocket({ guildId, accessToken, onState, onReady, onHeartbeat, onConnection, onError }) {
  let socket = null;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let stopped = false;
  let retryCount = 0;

  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(websocketUrl("/api/activity/ws"));
    socket.addEventListener("open", () => {
      retryCount = 0;
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
        if (payload.type === "ready") onReady?.(payload.identity);
        if (payload.type === "heartbeat") onHeartbeat?.(payload.time);
        if (payload.type === "error") onError?.(new Error(payload.error));
      } catch (error) {
        onError?.(error);
      }
    });
    socket.addEventListener("close", () => {
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
  return () => {
    stopped = true;
    window.clearTimeout(reconnectTimer);
    window.clearInterval(heartbeatTimer);
    socket?.close();
  };
}
