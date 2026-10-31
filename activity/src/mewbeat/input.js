// Routes a keydown to the game. Returns true when the event was the game's, so the caller
// can preventDefault/stopPropagation it. Modified keys and auto-repeat never count: a held
// key must not hit a second note and Ctrl+D style shortcuts stay with the browser.
export function createKeyRouter({ keys, onLane, onFever, onExit }) {
  return (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.code === "Space") {
      onFever();
      return true;
    }
    if (event.code === "Escape") {
      onExit();
      return true;
    }
    const lane = keys.indexOf(event.code);
    if (lane < 0) return false;
    onLane(lane, event.timeStamp);
    return true;
  };
}
