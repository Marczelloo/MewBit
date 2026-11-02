const SYNC_BURST = 6;
const SYNC_BURST_GAP_MS = 120;
const SYNC_INTERVAL_MS = 1000;
const OFFLINE_AFTER_MS = 3000;
const CHART_RETRY_MS = 3000;
const CHART_MAX_SENDS = 5; // sends of one request that get no reply at all before the link gives up on it
const MAX_OPEN_SYNCS = 64;

// Runs the mewbeat conversation with the bot over the Activity socket: clock
// sync pings, anchor delivery and chart requests. It owns no clock maths; the
// server clock and song clock are injected.
export function createMewbeatLink({
  send,
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  serverClock,
  songClock,
}) {
  const anchorListeners = new Set();
  const chartListeners = new Set();
  const statusListeners = new Set();
  const openSyncs = new Map(); // id -> clientSentAt, insertion ordered
  const inflightCharts = new Map(); // "audioKey:difficulty" -> { audioKey, difficulty }
  const chartRetries = new Map(); // same key -> timer
  const chartSends = new Map(); // same key -> sends since the last reply
  let syncTimer = null;
  let offlineTimer = null;
  let syncCount = 0;
  let counter = 0;
  let status = "connecting";
  let running = false;
  let trackInfo = null;

  const chartKey = (audioKey, difficulty) => `${audioKey}:${difficulty}`;

  function emit(listeners, value) {
    for (const fn of [...listeners]) fn(value);
  }

  function subscribe(listeners, fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function setStatus(next) {
    if (next === status) return;
    status = next;
    emit(statusListeners, status);
  }

  function armOffline() {
    clearTimer(offlineTimer);
    offlineTimer = setTimer(() => {
      offlineTimer = null;
      setStatus("offline");
    }, OFFLINE_AFTER_MS);
  }

  function sendSync() {
    const id = `s${++counter}`;
    const clientSentAt = now();
    openSyncs.set(id, clientSentAt);
    if (openSyncs.size > MAX_OPEN_SYNCS) openSyncs.delete(openSyncs.keys().next().value);
    send({ type: "mewbeat_sync", id, clientSentAt });
  }

  function scheduleSync() {
    syncTimer = setTimer(() => {
      syncTimer = null;
      sendSync();
      syncCount += 1;
      scheduleSync();
    }, syncCount < SYNC_BURST ? SYNC_BURST_GAP_MS : SYNC_INTERVAL_MS);
  }

  function start() {
    stop();
    running = true;
    sendSync();
    syncCount = 1;
    scheduleSync();
    armOffline();
  }

  function stop() {
    running = false;
    clearTimer(syncTimer);
    clearTimer(offlineTimer);
    syncTimer = null;
    offlineTimer = null;
    for (const timer of chartRetries.values()) clearTimer(timer);
    chartRetries.clear();
    chartSends.clear();
    inflightCharts.clear();
  }

  function syncNow() {
    if (running) sendSync();
  }

  function sendChartRequest(request) {
    return send({ type: "mewbeat_chart", audioKey: request.audioKey, difficulty: request.difficulty }) !== false;
  }

  // Resends a request nobody answered yet (a lost reply) or that the server answered "pending"; a refused
  // send (socket reconnecting) just waits another round, and a track change in the meantime drops it.
  // A request that gets no reply at all for CHART_MAX_SENDS sends ends as a "failed" chart event, so the
  // game shows an error instead of charting forever. Any reply (pending included) restarts that count.
  function scheduleChartRetry(key) {
    clearTimer(chartRetries.get(key));
    chartRetries.set(key, setTimer(() => {
      chartRetries.delete(key);
      const request = inflightCharts.get(key);
      if (!request) return;
      if (request.audioKey !== songClock.audioKey()) {
        releaseChart(key);
      } else if ((chartSends.get(key) ?? 0) >= CHART_MAX_SENDS) {
        releaseChart(key);
        emit(chartListeners, { audioKey: request.audioKey, difficulty: request.difficulty, status: "failed", reason: "no_reply", chart: undefined });
      } else {
        if (sendChartRequest(request)) chartSends.set(key, (chartSends.get(key) ?? 0) + 1);
        scheduleChartRetry(key);
      }
    }, CHART_RETRY_MS));
  }

  // Returns false when nothing went out: already in flight, link stopped, or
  // the socket refused it (not ready yet). A refused key is released, so the
  // next requestChart goes out instead of being deduped against nothing.
  function requestChart(audioKey, difficulty) {
    const key = chartKey(audioKey, difficulty);
    if (!running || inflightCharts.has(key)) return false;
    const request = { audioKey, difficulty };
    inflightCharts.set(key, request);
    if (sendChartRequest(request)) {
      chartSends.set(key, 1);
      scheduleChartRetry(key);
      return true;
    }
    releaseChart(key);
    return false;
  }

  function releaseChart(key) {
    inflightCharts.delete(key);
    clearTimer(chartRetries.get(key));
    chartRetries.delete(key);
    chartSends.delete(key);
  }

  function handleSync(payload) {
    if (!openSyncs.has(payload.id)) return;
    const clientSentAt = openSyncs.get(payload.id);
    openSyncs.delete(payload.id);
    serverClock.addSample({ clientSentAt, serverNow: payload.serverNow, clientReceivedAt: now() });
    armOffline();
    setStatus("live");
    // Before enough samples the offset is unknown, so an anchor can't be placed yet.
    if (serverClock.ready()) emit(anchorListeners, songClock.setAnchor(payload.anchor ?? null));
  }

  function handleChart(payload) {
    const { audioKey, difficulty, status: chartStatus, reason, chart } = payload;
    const key = chartKey(audioKey, difficulty);
    if (!inflightCharts.has(key)) return;
    if (audioKey !== songClock.audioKey()) {
      releaseChart(key);
      return;
    }
    if (chartStatus === "pending") {
      chartSends.set(key, 1);
      scheduleChartRetry(key);
    } else {
      releaseChart(key);
    }
    emit(chartListeners, { audioKey, difficulty, status: chartStatus, reason, chart });
  }

  function handle(payload) {
    if (!running || !payload) return;
    if (payload.type === "mewbeat_sync") handleSync(payload);
    else if (payload.type === "mewbeat_chart") handleChart(payload);
  }

  return {
    start,
    stop,
    handle,
    syncNow,
    requestChart,
    songClock,
    status: () => status,
    onAnchor: (fn) => subscribe(anchorListeners, fn),
    onChart: (fn) => subscribe(chartListeners, fn),
    onStatus: (fn) => subscribe(statusListeners, fn),
    setTrackInfo: (info) => {
      trackInfo = info ?? null;
    },
    track: () => trackInfo,
  };
}
