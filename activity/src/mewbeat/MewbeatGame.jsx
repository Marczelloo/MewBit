import { useEffect } from "react";
import "./mewbeat.css";

// Stub overlay: Task 8 replaces this with the game. It already receives the props the game will
// need (context, state, settings, onClose, mewbeatHandlerRef, mewbeatSocketRef) and ignores all
// but onClose.
export default function MewbeatGame({ onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="mb-game" role="dialog" aria-modal="true" aria-label="mewbeat">
      <div className="mb-game-stub">
        <h2 className="mb-game-stub-title">mewbeat</h2>
        <button type="button" className="mb-btn mb-btn-primary" onClick={onClose} autoFocus>Close</button>
      </div>
    </div>
  );
}
