import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ActivityGate from "./views/ActivityGate.jsx";
import "./styles.css";

/* A Discord Activity always runs inside Discord's iframe, so `self === top` is
   proof — not a guess — that this is not one. The check is deliberately made
   here rather than inside App: gating on the URL anywhere Discord can reach
   would risk blanking the Activity for everyone if Discord ever served it from
   a path other than the root. Outside the iframe there is nothing to break.
   Development keeps the standalone preview, which is the whole point of it. */
const embedded = window.self !== window.top;
const standalone = !import.meta.env.DEV && !embedded;
const isRoot = ["/", "/index.html"].includes(window.location.pathname);

/* Dev-only, the same shape as the ?mock=1 preview: the in-room states are
   otherwise reachable only by breaking something, which makes them the least
   reviewed screens in the app. A production build compiles import.meta.env.DEV
   to false and drops this branch entirely. */
const gatePreview = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get("gate")
  : null;

/* Dev-only too: the minimized-window tiles with sample data, ?mock=1&pip=1&pipState=select|paused|live|lobby. */
const pipParams = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
const pipPreview = Boolean(pipParams?.has("mock") && pipParams.has("pip"));
const MinimizedPreview = import.meta.env.DEV ? lazy(() => import("./mewbeat/MinimizedPreview.jsx")) : null;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {pipPreview ? (
      <Suspense fallback={null}><MinimizedPreview /></Suspense>
    ) : gatePreview ? (
      <ActivityGate
        variant={gatePreview}
        path={window.location.pathname}
        detail={gatePreview === "error" ? "The bot is not connected to this Discord server." : null}
        onRetry={gatePreview === "error" ? () => window.location.reload() : null}
      />
    ) : standalone ? (
      <ActivityGate variant={isRoot ? "outside" : "notfound"} path={window.location.pathname} />
    ) : (
      <App />
    )}
  </React.StrictMode>
);
