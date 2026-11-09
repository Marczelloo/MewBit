// Runs audioAlign.js off the main thread. Scanning a decoded song takes long enough to drop frames as the count-in
// starts, so the worker (audioAlign.worker.js) folds the song in while the page keeps drawing. The song goes over in
// copied pieces, one per timer tick: the decoded buffer's own arrays must not be transferred (that would empty
// them), and one copy of a whole song would be a ~90 MB spike. Where a worker can't be made, or it fails, the
// answer is computed here, as before. Nothing here touches a browser global at load time.
import { audioLagMs, hopOf, riseEnvelope } from "./audioAlign.js";

const CHUNK_MS = 2000;

export function createAlignClient({
  makeWorker,
  schedule = (fn) => setTimeout(fn, 0),
} = {}) {
  let worker = null;
  let dead = false; // no worker can be had: everything is computed here
  let seq = 0;
  let pending = null; // { id, resolve, fallback } of the call being answered
  let held = null; // key of the song whose rise the worker still holds

  function fallbackNow(call) {
    pending = null;
    held = null;
    try {
      call.resolve(audioLagMs(riseEnvelope(call.channels, call.sampleRate), call.timesMs));
    } catch (error) {
      call.reject(error);
    }
  }

  function fail() {
    dead = true;
    held = null;
    try { worker?.terminate(); } catch { /* already gone */ }
    worker = null;
    if (pending) fallbackNow(pending);
  }

  function ensureWorker() {
    if (dead) return null;
    if (worker) return worker;
    try {
      worker = makeWorker?.() ?? null;
    } catch {
      worker = null;
    }
    if (!worker) {
      dead = true;
      return null;
    }
    worker.onmessage = ({ data }) => {
      if (!pending || data.id !== pending.id) return;
      const call = pending;
      if (data.missing) {
        held = null;
        sendSong(call);
        return;
      }
      pending = null;
      if (data.error) fallbackNow(call);
      else {
        held = call.key;
        call.resolve(data.lag);
      }
    };
    worker.onerror = () => fail();
    return worker;
  }

  function sendSong(call) {
    const { id, key, channels, sampleRate, timesMs } = call;
    const hop = hopOf(sampleRate);
    const left = channels[0];
    const right = channels[1] ?? null;
    const frames = hop > 0 ? Math.floor(left.length / hop) : 0;
    const span = hop * CHUNK_MS;
    held = null;
    worker.postMessage({ type: "begin", id, key, frames, hop });
    let at = 0;
    const step = () => {
      if (pending?.id !== id || !worker) return;
      if (at >= frames * hop) {
        worker.postMessage({ type: "finish", id, times: timesMs });
        return;
      }
      const to = Math.min(at + span, frames * hop);
      const partLeft = left.slice(at, to);
      const partRight = right ? right.slice(at, to) : null;
      const transfer = partRight ? [partLeft.buffer, partRight.buffer] : [partLeft.buffer];
      worker.postMessage({ type: "chunk", id, at: at / hop, left: partLeft, right: partRight }, transfer);
      at = to;
      schedule(step);
    };
    schedule(step);
  }

  // The lag of the song `key` (decoded as `channels`) against a chart's note times. Resolves null when a newer call
  // came meanwhile and this one is not wanted any more.
  function align({ key, channels, sampleRate, timesMs }) {
    if (pending) {
      pending.resolve(null);
      pending = null;
    }
    return new Promise((resolve, reject) => {
      const call = { id: ++seq, key, channels, sampleRate, timesMs, resolve, reject };
      if (!ensureWorker()) {
        fallbackNow(call);
        return;
      }
      pending = call;
      if (held !== null && held === key) {
        worker.postMessage({ type: "retime", id: call.id, key, times: timesMs });
      } else {
        sendSong(call);
      }
    });
  }

  function close() {
    if (pending) {
      pending.resolve(null);
      pending = null;
    }
    held = null;
    try { worker?.terminate(); } catch { /* already gone */ }
    worker = null;
    dead = false;
  }

  return { align, close };
}
