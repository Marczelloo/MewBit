import { useEffect, useRef } from "react";
import { IMPACT_DELAY_MS, REVEAL } from "./resultTimeline.js";

// Plays the results' sounds (resultTimeline.js) on the screen's own clock. play: null keeps the screen silent.
// openedAt: when the screen opened. A skip, or motion turned off, cuts what is sounding and goes straight to the
// grade's impact and what follows it (a full combo's fanfare), the tail of the events.
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
      const impactAt = REVEAL.grade + IMPACT_DELAY_MS;
      const first = events.findIndex(({ at }) => at >= impactAt);
      const from = Math.max(played.current, first);
      if (first < 0 || from >= events.length) return undefined;
      // The tail keeps its spacing, counted from the impact's own delay. Each one counts as played as it sounds.
      const timers = events.slice(from).map((event, index) => window.setTimeout(() => {
        played.current = from + index + 1;
        sound(event);
      }, IMPACT_DELAY_MS + Math.max(0, event.at - impactAt)));
      return () => timers.forEach((id) => window.clearTimeout(id));
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
