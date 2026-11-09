// What the minimized window (Discord's picture-in-picture and grid tiles) does and shows. No browser globals.

// ACTIVITY_LAYOUT_MODE_UPDATE's layout_mode (LayoutModeTypeObject in the Embedded App SDK).
export const LAYOUT_MODE = { UNHANDLED: -1, FOCUSED: 0, PIP: 1, GRID: 2 };

// The size the tile is drawn at; a smaller or larger window scales it.
export const TILE_WIDTH = 320;
export const TILE_HEIGHT = 180;
const TILE_SCALE_MAX = 1.5;

// A window this small is minimized whatever the SDK says (no SDK in the mock preview, or the subscription failed).
const SMALL_WIDTH = 480;
const SMALL_HEIGHT = 300;

export function layoutMinimized(layoutMode) {
  return layoutMode === LAYOUT_MODE.PIP || layoutMode === LAYOUT_MODE.GRID;
}

export function sizeMinimized(width, height) {
  return width > 0 && height > 0 && width <= SMALL_WIDTH && height <= SMALL_HEIGHT;
}

// A solo run that is going (or counting in) while the window is minimized gets paused. This is a state, not an edge:
// a song that finishes loading while minimized is paused the moment it starts, and a pause that is already on
// (stage "paused") asks for nothing, so a layout flicker never pauses twice. Live and Room keep running.
export function shouldAutoPause({ minimized, mode, stage, ended }) {
  return Boolean(minimized) && mode === "solo" && (stage === "playing" || stage === "countin") && !ended;
}

// Which tile the window shows. `running` is a run on stage (playing or paused). Anything without its own tile (song
// select, results, a song loading) falls back to "select": Mewbit and the song's title.
export function tileOf({ mode, running }) {
  if (mode === "solo") return running ? "paused" : "select";
  if (mode === "room") return running ? "live" : "lobby";
  return running ? "live" : "select";
}

export function tileScale(width, height) {
  if (!(width > 0) || !(height > 0)) return 1;
  return Math.min(width / TILE_WIDTH, height / TILE_HEIGHT, TILE_SCALE_MAX);
}

export function ordinal(n) {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

// The player's place among the board's entries (already sorted, best first): { place, total }, or null when the
// board is empty or the player is not on it.
export function placeOf(entries, meId) {
  if (!Array.isArray(entries) || !entries.length || meId === null || meId === undefined) return null;
  const index = entries.findIndex((entry) => entry.userId === meId);
  return index === -1 ? null : { place: index + 1, total: entries.length };
}

// Players (not spectators) who are ready, out of all of them.
export function readyOf(room) {
  const players = (room?.members ?? []).filter((member) => !member.spectator);
  return { ready: players.filter((member) => member.ready).length, total: players.length };
}
