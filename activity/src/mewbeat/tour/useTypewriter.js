import { useEffect, useRef, useState } from "react";
import { blipOptions, typingPlan } from "./typewriter.js";

// How many characters of text are out. id names the line: a new id starts the typing over, even for the same text.
// With enabled false the whole text is there from the start and nothing sounds. With hold true (and enabled) the line
// waits, empty, until hold is false: the caller holds the first line until its sound can play. onBlip is called on the
// letters that sound. The typing stops when the line changes or the component goes.
export function useTypewriter(text, { id = text, enabled = true, hold = false, onBlip } = {}) {
  const total = Array.from(text).length;
  const [state, setState] = useState({ id: null, shown: 0 });
  const blipRef = useRef(onBlip);
  blipRef.current = onBlip;

  useEffect(() => {
    if (!enabled || hold) return undefined;
    const plan = typingPlan(text);
    let at = 0;
    let timer = 0;
    const step = () => {
      const item = plan[at];
      setState({ id, shown: item.shown });
      if (item.blip) {
        try { blipRef.current?.(blipOptions()); } catch { /* a blip is never worth an error */ }
      }
      at += 1;
      if (at < plan.length) timer = setTimeout(step, plan[at].at - item.at);
    };
    if (plan.length) timer = setTimeout(step, plan[0].at);
    return () => clearTimeout(timer);
  }, [id, text, enabled, hold]);

  if (!enabled) return total;
  if (hold) return 0;
  return state.id === id ? state.shown : 0; // a new line starts empty in the very render that brings it
}
