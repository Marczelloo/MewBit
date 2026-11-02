import { useEffect, useRef, useState } from "react";

// Keeps a screen mounted for `ms` after its value goes null, so it can fade out instead of vanishing.
// `held` is the value to render (the last non-null one while leaving), `leaving` is true during that window.
// A new value inside the window cancels the exit. With ms <= 0 there is no hold at all.
export function useScreenExit(value, ms) {
  const present = value !== null && value !== undefined;
  const lastRef = useRef(null);
  if (present) lastRef.current = value;
  const [gone, setGone] = useState(!present);
  useEffect(() => {
    if (present) {
      setGone(false);
      return undefined;
    }
    if (!(ms > 0)) {
      lastRef.current = null;
      setGone(true);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      lastRef.current = null;
      setGone(true);
    }, ms);
    return () => window.clearTimeout(timer);
  }, [present, ms]);
  const leaving = !present && !gone && ms > 0 && lastRef.current !== null;
  return { held: present ? value : leaving ? lastRef.current : null, leaving };
}
