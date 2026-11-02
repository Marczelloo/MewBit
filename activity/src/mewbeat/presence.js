import { gradeOf } from "./scoring.js";

function capitalize(text) {
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function scoreText(score) {
  return Math.round(score).toLocaleString("en-US");
}

// The Discord status of a mewbeat player: `details` is the song, `state` how the run is going. A run that isn't
// the player's own doing (autoplay, calibration, watching someone) says so instead of showing its numbers.
export function presenceOf({ track, difficulty, hud, summary, playing, paused, autoplay, calibrating, spectating }) {
  const title = summary?.title ?? track?.title;
  const artworkUrl = summary?.artworkUrl ?? track?.artworkUrl ?? null;
  const level = capitalize(summary?.difficulty ?? difficulty);
  const details = title ? (level ? `${title} · ${level}` : title) : "Playing mewbeat";
  if (summary) {
    if (summary.autoplay || summary.calibration) return { details, state: "Finished", artworkUrl };
    return { details, state: `Finished · ${summary.grade} · ${(summary.accuracy ?? 0).toFixed(2)}% · ${scoreText(summary.score)}`, artworkUrl };
  }
  if (!playing) return { details: "Playing mewbeat", state: "Choosing a song", artworkUrl: null };
  if (spectating) return { details, state: "Watching a run", artworkUrl };
  if (calibrating) return { details, state: "Calibrating", artworkUrl };
  if (autoplay) return { details, state: "Autoplay", artworkUrl };
  const accuracy = hud.accuracy ?? 100;
  const line = `${scoreText(hud.score)} · ${hud.combo}x · ${accuracy.toFixed(2)}% · ${gradeOf(accuracy)}`;
  return { details, state: paused ? `Paused · ${line}` : line, artworkUrl };
}
