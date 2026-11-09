import { useEffect, useState } from "react";
import { LAYOUT_MODE, layoutMinimized, sizeMinimized } from "./minimized.js";

// Events.ACTIVITY_LAYOUT_MODE_UPDATE in the Embedded App SDK, as the string it stands for (no SDK import in this chunk).
// It needs no scope or arguments. The SDK has no call to read the current mode, so a window starts out focused.
const LAYOUT_EVENT = "ACTIVITY_LAYOUT_MODE_UPDATE";

const smallNow = () => sizeMinimized(window.innerWidth, window.innerHeight);

// Whether the Activity is minimized: Discord says so (picture-in-picture or a grid tile), or the window is that small.
// A failed subscription leaves the size check, and the game carries on either way.
export function useMinimized(sdk) {
  const [layoutMode, setLayoutMode] = useState(LAYOUT_MODE.FOCUSED);
  const [small, setSmall] = useState(smallNow);

  useEffect(() => {
    if (!sdk?.subscribe) return undefined;
    const onUpdate = (data) => {
      if (Number.isInteger(data?.layout_mode)) setLayoutMode(data.layout_mode);
    };
    try {
      Promise.resolve(sdk.subscribe(LAYOUT_EVENT, onUpdate)).catch(() => {});
    } catch {
      return undefined;
    }
    return () => {
      try {
        Promise.resolve(sdk.unsubscribe(LAYOUT_EVENT, onUpdate)).catch(() => {});
      } catch {
        // the connection is gone with the screen
      }
    };
  }, [sdk]);

  useEffect(() => {
    const onResize = () => setSmall(smallNow());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return layoutMinimized(layoutMode) || small;
}
