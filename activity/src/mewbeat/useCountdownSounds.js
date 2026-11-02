import { useEffect, useRef } from "react";
import { countdownSounds, nextCountdownSecond } from "./room.js";

// Sounds a room countdown on timers of its own rather than on the screen's repaint, where a tick could land
// 100 ms off. startPerf: the start on the local clock, null when nothing counts down. started: the round is on.
// calm: something else is on stage (the results), so only the final seconds sound.
export function useCountdownSounds({ startPerf, started, calm, play }) {
  const lastSecond = useRef(null);
  const lastStart = useRef(null);
  const calmRef = useRef(calm);
  calmRef.current = calm;

  useEffect(() => {
    if (startPerf == null) return undefined;
    lastStart.current = startPerf;
    let timer = null;
    const arm = () => {
      const step = nextCountdownSecond(startPerf - performance.now());
      if (!step) return;
      timer = window.setTimeout(() => {
        // A clock sample can move the start across a second that has just sounded.
        if (step.second !== lastSecond.current) {
          lastSecond.current = step.second;
          for (const { name, level } of countdownSounds(step.second)) {
            if (level === 1 || !calmRef.current) play(name, { level });
          }
        }
        arm();
      }, step.inMs);
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [startPerf, play]);

  // The server can open the round a hair before this clock reaches the start, which cancels the timer above.
  useEffect(() => {
    if (!started) return;
    if (lastSecond.current !== 0 && lastStart.current != null && Math.abs(lastStart.current - performance.now()) < 1000) play("go");
    lastSecond.current = null;
    lastStart.current = null;
  }, [started, play]);
}
