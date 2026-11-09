// Web Worker for audioAlign.js: the song arrives in pieces (alignClient.js), each is folded into the energy of its
// milliseconds as it lands and dropped, then the notes' times give the lag. It keeps the last song's rise, so
// another chart of the same song (a new difficulty, a retry) only needs the times.
import { audioLagMs, energyInto, riseFromEnergy } from "./audioAlign.js";

let job = null; // { id, energy } while a song is arriving
let kept = null; // { key, rise } of the last finished song

self.onmessage = ({ data }) => {
  try {
    if (data.type === "begin") {
      job = { id: data.id, key: data.key, hop: data.hop, energy: new Float32Array(data.frames) };
      kept = null;
    } else if (data.type === "chunk") {
      if (job?.id !== data.id) return;
      energyInto(job.energy, data.at, data.left, data.right ?? data.left, job.hop);
    } else if (data.type === "finish") {
      if (job?.id !== data.id) return;
      kept = { key: job.key, rise: riseFromEnergy(job.energy) };
      job = null;
      self.postMessage({ id: data.id, lag: audioLagMs(kept.rise, data.times) });
    } else if (data.type === "retime") {
      if (kept?.key !== data.key) {
        self.postMessage({ id: data.id, missing: true });
        return;
      }
      self.postMessage({ id: data.id, lag: audioLagMs(kept.rise, data.times) });
    }
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error?.message ?? error) });
  }
};
