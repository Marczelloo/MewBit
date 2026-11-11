import { useEffect, useState } from "react";
import { SUGGEST_POLL_MAX, SUGGEST_POLL_MS, describeSuggestError } from "./suggestions.js";

// The suggestions for a screen: { status: "loading" | "ready" | "error", reply, pending, error }. It asks once when
// enabled, then again every SUGGEST_POLL_MS while the bot says it is still looking (at most SUGGEST_POLL_MAX times),
// and stays quiet when disabled. seedKey (the song just played) is what the "similar" kind is built from; a new reload asks again.
export function useSuggestions({ request, enabled = true, seedKey = null, reload = 0 }) {
  const [state, setState] = useState({ status: "loading", reply: null, pending: false, error: null });
  useEffect(() => {
    if (!enabled || typeof request !== "function") return undefined;
    let cancelled = false;
    let timer = null;
    setState({ status: "loading", reply: null, pending: false, error: null });
    const ask = async (round) => {
      let reply;
      try {
        reply = await request("mewbeat_recs", seedKey ? { seedKey } : {});
      } catch (error) {
        reply = { status: "error", reason: error?.message };
      }
      if (cancelled) return;
      if (reply?.status !== "ok") {
        setState((current) => (current.reply ? current : { status: "error", reply: null, pending: false, error: describeSuggestError(reply?.reason) }));
        return;
      }
      const pending = Boolean(reply.pending);
      setState({ status: "ready", reply, pending: pending && round < SUGGEST_POLL_MAX, error: null });
      if (pending && round < SUGGEST_POLL_MAX) timer = window.setTimeout(() => ask(round + 1), SUGGEST_POLL_MS);
    };
    ask(0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [request, enabled, seedKey, reload]);
  return state;
}
