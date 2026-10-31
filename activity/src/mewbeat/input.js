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

export const KEYS_MESSAGE = "Pick four different keys. Space and Escape are taken.";

const ARROWS = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };

// KeyboardEvent.code as a readable label: "KeyD" -> "D", "Digit1" -> "1", "ArrowLeft" -> arrow.
export function keyLabel(code) {
  const text = String(code);
  return ARROWS[text] ?? text.replace(/^(Key|Digit)/, "");
}

// The server's keys rule (helpers/mewbeat/userSettings.js), so a bad pick is refused before it is sent.
export function keysProblem(keys) {
  const valid = Array.isArray(keys)
    && keys.length === 4
    && keys.every((code) => typeof code === "string" && /^[A-Za-z0-9]{1,32}$/.test(code) && code !== "Space" && code !== "Escape")
    && new Set(keys).size === 4;
  return valid ? null : KEYS_MESSAGE;
}
