import { ArrowClockwise, ArrowUpRight, Waveform } from "@phosphor-icons/react";

/* The site's address is a deployment fact, not a build constant — this one
   moved hosts once already. It is offered only when a deployment names it; the
   repository is true for every deployment, so that link is always shown. */
const siteUrl = String(import.meta.env.VITE_MEWBIT_SITE_URL || "").replace(/\/$/, "");
const repoUrl = "https://github.com/Marczelloo/NeoBeat-Buddy";

const COPY = {
  outside: {
    kicker: "MEWBIT LINK",
    title: "This player opens inside Discord.",
    body:
      "The MewBit Activity runs in a voice channel, where everyone in the room shares one queue, one set of artwork and one transport. Opened on its own it has no room to join — start it from the voice channel's activity shelf instead.",
  },
  notfound: {
    kicker: "MEWBIT LINK",
    title: "There is no page here.",
    body:
      "The Activity is a single surface; it has no other addresses. If you were looking for what MewBit is, how to run it, or the command reference, that lives on the website.",
  },
  dm: {
    kicker: "NO SERVER",
    title: "The music player needs a server.",
    body:
      "This conversation has no voice channel for the bot to play into, so there is no queue to share. For the music, open the Activity from a voice channel in a server MewBit has been invited to.",
  },
  error: {
    kicker: "NOT CONNECTED",
    title: "MewBit did not answer.",
    body:
      "The Activity reached Discord but could not reach the bot behind it. That usually means the bot is restarting, is offline, or is not in this server — it is rarely anything you did.",
  },
};

/**
 * Every terminal state this surface can land in.
 *
 * Before this, all of them ended the same way: the full cockpit rendered with
 * nothing in it — a search field that returns nothing, a transport that
 * controls nothing — and a toast that had already faded by the time anyone
 * read it. That reads as a broken product rather than as a room that was never
 * joined. It is built from the loader's own parts because it is the same world,
 * but it holds still: these are destinations, not waits.
 */
export default function ActivityGate({ variant = "outside", path = "/", detail = null, onRetry = null, action = null }) {
  const copy = COPY[variant] || COPY.outside;

  return (
    <section className="activity-gate" role="alert">
      <div className="loader-ambient loader-ambient-cyan" aria-hidden="true" />
      <div className="loader-ambient loader-ambient-magenta" aria-hidden="true" />

      <div className="gate-content">
        <span className="loader-kicker">
          <i /> {copy.kicker}
        </span>

        <h1>{copy.title}</h1>
        <p>{copy.body}</p>

        {/* The reason, verbatim. It is what makes the difference between "try
            again later" and "the bot is not in this server". */}
        {detail ? <p className="gate-detail">{detail}</p> : null}

        <div className="gate-actions">
          {action ? (
            <button type="button" className="gate-btn is-primary" onClick={action.onClick}>
              {action.label}
            </button>
          ) : null}

          {onRetry ? (
            <button type="button" className="gate-btn is-primary" onClick={onRetry}>
              <ArrowClockwise size={14} weight="bold" aria-hidden="true" />
              Try again
            </button>
          ) : null}

          {variant === "notfound" ? (
            <a className="gate-btn is-primary" href="/">
              Open the Activity
            </a>
          ) : null}

          {siteUrl ? (
            <a
              className={onRetry || variant === "notfound" ? "gate-btn" : "gate-btn is-primary"}
              href={siteUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              What MewBit is
              <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
            </a>
          ) : null}

          <a className="gate-btn" href={repoUrl} target="_blank" rel="noreferrer noopener">
            Run your own
            <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
          </a>
        </div>

        <p className="gate-foot">
          <Waveform size={13} weight="bold" aria-hidden="true" />
          <span className="gate-path">{path}</span>
        </p>
      </div>
    </section>
  );
}
