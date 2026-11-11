import { useEffect, useState } from "react";
import { SUGGEST_POLL_MAX, SUGGEST_POLL_MS, describeSuggestError } from "./suggestions.js";

// The suggestions for a screen: { status: "loading" | "ready" | "error", reply, pending, error }. It asks once when
// enabled, then again every SUGGEST_POLL_MS while the bot says it is still looking (at most SUGGEST_POLL_MAX times),
// and stays quiet when disabled. seedKey (the song just played) is what the "similar" kind is built from; a new reload asks again.
// rotate (0 up) is how often the lists were refreshed: the bot shows their next rows. A refresh keeps the rows on screen
// until the new ones arrive (asking: true meanwhile), where a new seed starts over from "loading".
export function useSuggestions({ request, enabled = true, seedKey = null, reload = 0, rotate = 0 }) {
  const [state, setState] = useState({ status: "loading", reply: null, pending: false, error: null, asking: false });
  useEffect(() => {
    if (!enabled || typeof request !== "function") return undefined;
    let cancelled = false;
    let timer = null;
    setState((current) => (current.reply && current.seedKey === seedKey ? { ...current, asking: true } : { status: "loading", reply: null, pending: false, error: null, asking: true, seedKey }));
    const ask = async (round) => {
      let reply;
      try {
        reply = await request("mewbeat_recs", { ...(seedKey ? { seedKey } : null), ...(rotate > 0 ? { rotate } : null) });
      } catch (error) {
        reply = { status: "error", reason: error?.message };
      }
      if (cancelled) return;
      if (reply?.status !== "ok") {
        setState((current) => (current.reply ? { ...current, asking: false } : { status: "error", reply: null, pending: false, error: describeSuggestError(reply?.reason), asking: false, seedKey }));
        return;
      }
      const pending = Boolean(reply.pending);
      setState({ status: "ready", reply, pending: pending && round < SUGGEST_POLL_MAX, error: null, asking: false, seedKey });
      if (pending && round < SUGGEST_POLL_MAX) timer = window.setTimeout(() => ask(round + 1), SUGGEST_POLL_MS);
    };
    ask(0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [request, enabled, seedKey, reload, rotate]);
  return state;
}
