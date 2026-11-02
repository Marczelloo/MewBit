import { useEffect, useRef } from "react";
import { IMPACT_DELAY_MS } from "./resultTimeline.js";

// Plays the results' sounds (resultTimeline.js) on the screen's own clock. play: null keeps the screen silent.
// openedAt: when the screen opened. A skip, or motion turned off, cuts what is sounding and goes straight to the
// grade's impact, the last of the events.
export function useResultSounds({ play, openedAt, events, animate }) {
  const played = useRef(0); // how many events have sounded, so a re-run of the effect repeats none
  const stops = useRef([]);

  useEffect(() => () => {
    for (const stop of stops.current) stop?.();
  }, []);

  useEffect(() => {
    if (!play) return undefined;
    let timer = 0;
    const sound = ({ name, level, rate }) => {
      stops.current.push(play(name, { level, rate }));
    };

    if (!animate) {
      for (const stop of stops.current) stop?.();
      stops.current = [];
      if (played.current >= events.length) return undefined;
      timer = window.setTimeout(() => {
        played.current = events.length;
        sound(events[events.length - 1]);
      }, IMPACT_DELAY_MS);
      return () => window.clearTimeout(timer);
    }

    const next = () => {
      const event = events[played.current];
      if (!event) return;
      timer = window.setTimeout(() => {
        played.current += 1;
        sound(event);
        next();
      }, Math.max(0, openedAt + event.at - performance.now()));
    };
    next();
    return () => window.clearTimeout(timer);
  }, [play, openedAt, events, animate]);
}
