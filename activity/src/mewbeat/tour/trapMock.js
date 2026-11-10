import { buildMockChart } from "../mockLink.js";
import { CALM, HEAVY, HEAVY_MS, trimChart } from "./trap.js";

// Dev only (?mock=1&firstrun&trap, behind import.meta.env.DEV in MewbeatGame.jsx): the trap with no bot. The heavy song
// is a silent generated buffer with the mock chart, so the sequence can be walked through in a browser. There is no real
// calm song to play afterwards: its entry carries no link, and "rude" just ends the tour.
function silent(context, seconds) {
  return context.createBuffer(2, Math.max(1, Math.round(context.sampleRate * seconds)), context.sampleRate);
}

export function mockTrapPrep(getContext) {
  const context = getContext();
  const track = (title) => ({ title, artist: "mewbeat mock", durationMs: 150_000, artworkUrl: null, queued: false });
  const result = {
    heavy: {
      audioKey: "mock:heavy:150000",
      track: track("The Quick Brown Fox (mock)"),
      chart: trimChart(buildMockChart("mock:heavy:150000", HEAVY.level), HEAVY.fromMs),
      level: HEAVY.level,
      buffer: silent(context, HEAVY_MS / 1000 + 1),
      fromMs: HEAVY.fromMs,
      durationMs: 150_000,
    },
    calm: { audioKey: "mock:calm:150000", track: track("Spotlight (mock)"), uri: null, source: null, level: CALM.level },
  };
  return { mock: true, result: () => result, done: Promise.resolve(), cancel: () => {} };
}
