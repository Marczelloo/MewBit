import { useEffect, useRef, useState } from "react";

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function usePlayerPosition(player, offsetMs = 0) {
  const [now, setNow] = useState(() => Date.now());
  const anchorRef = useRef({ positionMs: Number(player?.positionMs) || 0, receivedAt: Date.now() });
  const trackId = player?.currentTrack?.id;
  const shouldTick = Boolean(player?.playing && !player?.paused && !player?.buffering && trackId);

  useEffect(() => {
    anchorRef.current = { positionMs: Number(player?.positionMs) || 0, receivedAt: Date.now() };
    setNow(Date.now());
  }, [player?.positionMs, player?.updatedAt, player?.playing, player?.paused, player?.buffering, trackId]);

  useEffect(() => {
    if (!shouldTick) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [shouldTick]);

  if (!shouldTick) return clamp((Number(player?.positionMs) || 0) + Number(offsetMs || 0), 0, Number(player?.durationMs) || Number.MAX_SAFE_INTEGER);
  const anchor = anchorRef.current;
  return clamp(anchor.positionMs + (now - anchor.receivedAt) + Number(offsetMs || 0), 0, Number(player?.durationMs) || Number.MAX_SAFE_INTEGER);
}
