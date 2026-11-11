import { useEffect, useReducer, useSyncExternalStore } from "react";
import { waitLine } from "./chartWait.js";

// The one-line wait status of a chart (see chartWait.js). It ticks on a timer of its own, so only this span repaints each
// second, never the screen around it. With nothing to wait for it shows `fallback` (or nothing); with `requireQueue` it
// stays hidden until the bot has said where the song stands once.
// `showAfterMs`: for the first moments the fallback stays, so a chart that is ready at once never flashes a line.
export default function ChartWaitLine({ store, fallback = null, className, requireQueue = false, showAfterMs = 0 }) {
  const wait = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [, tick] = useReducer((count) => count + 1, 0);
  const waiting = wait.key !== null;
  useEffect(() => {
    if (!waiting) return undefined;
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [waiting, wait.since]);

  const elapsed = store.elapsed();
  const show = waiting && (wait.seen || !requireQueue) && (wait.seen || elapsed >= showAfterMs);
  const text = show ? waitLine(wait.queue, elapsed) : fallback;
  if (text === null || text === undefined || text === "") return null;
  return <span className={className ? `mb-wait ${className}` : "mb-wait"} aria-live="off">{text}</span>;
}
