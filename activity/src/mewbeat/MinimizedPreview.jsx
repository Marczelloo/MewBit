import { MinimizedTile } from "./MinimizedTile.jsx";
import { PIP_MOCK, PIP_STATES } from "./minimizedMock.js";
import "./mewbeat.css";

// Dev only (main.jsx gates it): each minimized tile with sample data in a fixed 320x180 frame, the size Discord's
// picture-in-picture starts at. ?mock=1&pip=1&pipState=select|paused|live|lobby
export default function MinimizedPreview() {
  const asked = new URLSearchParams(window.location.search).get("pipState");
  const state = PIP_STATES.includes(asked) ? asked : "select";
  return (
    <div className="mb-game" style={{ position: "relative", inset: "auto", width: 320, height: 180, display: "block" }} data-pip-state={state}>
      <MinimizedTile {...PIP_MOCK[state]} />
    </div>
  );
}
