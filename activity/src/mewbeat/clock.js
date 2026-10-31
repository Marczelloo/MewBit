const MAX_RTT_MS = 2000;
const MIN_READY_SAMPLES = 3;

function median(sorted) {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Estimates the server's Date.now() offset from the client's performance.now()
// using ping/pong samples. Only the lowest-rtt samples count, since their
// midpoint assumption is the least wrong.
export function createServerClock({ maxSamples = 16, bestOf = 5 } = {}) {
  const samples = [];

  function addSample({ clientSentAt, serverNow, clientReceivedAt }) {
    const rtt = clientReceivedAt - clientSentAt;
    if (!Number.isFinite(rtt) || rtt < 0 || rtt > MAX_RTT_MS) return;
    const offset = serverNow - (clientSentAt + clientReceivedAt) / 2;
    if (!Number.isFinite(offset)) return;
    samples.push({ rtt, offset });
    if (samples.length > maxSamples) samples.shift();
  }

  function offsetMs() {
    if (!samples.length) return null;
    const best = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, bestOf);
    return median(best.map((s) => s.offset).sort((a, b) => a - b));
  }

  // Before any sample the offset is taken as 0; callers check ready() first.
  function serverTimeAt(perfMs) {
    return perfMs + (offsetMs() ?? 0);
  }

  return { addSample, offsetMs, ready: () => samples.length >= MIN_READY_SAMPLES, serverTimeAt };
}

// Turns server playback anchors into a smooth song time. A small disagreement
// with the running clock is slewed out over slewMs of perf time, so song time
// never jumps or runs backwards; anything larger snaps. The user offset is
// applied by the caller.
export function createSongClock(
  serverClock,
  { snapMs = 250, slewMs = 600, now = () => performance.now() } = {}
) {
  let anchor = null;
  let slewFrom = 0; // perf time the current slew started at
  let slewDelta = 0; // correction added to the new line at slewFrom, fading to 0

  // Unclamped, so slew maths never sees a clamp's kink.
  function rawAt(perfMs) {
    if (anchor.paused) return anchor.positionMs;
    const line = anchor.positionMs + (serverClock.serverTimeAt(perfMs) - anchor.at);
    return line + slewDelta * Math.max(0, 1 - (perfMs - slewFrom) / slewMs);
  }

  function rebase(next, correction = 0) {
    anchor = next;
    slewFrom = now();
    slewDelta = correction;
  }

  function setAnchor(next) {
    if (!next) {
      anchor = null;
      slewDelta = 0;
      return "clear";
    }
    if (!anchor) {
      rebase(next);
      return "init";
    }
    if (next.audioKey !== anchor.audioKey) {
      rebase(next);
      return "keyChange";
    }
    if (Boolean(next.paused) !== Boolean(anchor.paused)) {
      rebase(next);
      return next.paused ? "pause" : "resume";
    }
    const t0 = now();
    const current = rawAt(t0);
    if (next.paused) {
      const moved = next.positionMs - current;
      rebase(next);
      return Math.abs(moved) > snapMs ? "snap" : "slew";
    }
    const correction = current - (next.positionMs + (serverClock.serverTimeAt(t0) - next.at));
    if (Math.abs(correction) > snapMs) {
      rebase(next);
      return "snap";
    }
    rebase(next, correction);
    return "slew";
  }

  function songTimeAt(perfMs) {
    if (!anchor) return null;
    const time = Math.max(0, rawAt(perfMs));
    return anchor.durationMs > 0 ? Math.min(time, anchor.durationMs) : time;
  }

  return {
    setAnchor,
    songTimeAt,
    audioKey: () => anchor?.audioKey ?? null,
    paused: () => Boolean(anchor?.paused),
  };
}
