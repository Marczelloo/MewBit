import { useEffect, useState } from "react";
import { getInstance } from "../../api.js";

/**
 * The bot process itself, not this server.
 *
 * The one section that is not per-guild: it answers "is my instance healthy",
 * which is the self-hoster's question rather than the server owner's. It
 * carries no error text — messages can quote content from other servers, and
 * an operator here was trusted with one server, not with all of them.
 */
export default function InstanceSection() {
  const [instance, setInstance] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const load = () =>
      getInstance()
        .then((payload) => {
          if (!cancelled) setInstance(payload.instance);
        })
        .catch((apiError) => {
          if (!cancelled) setError(apiError.message);
        });

    load();
    // Slow enough to stay a readout rather than a monitor; the page is not a
    // dashboard for watching, and the read bucket is shared with settings.
    timer = setInterval(load, 15_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (error && !instance) return <p className="panel-error">{error}</p>;

  if (!instance) {
    return (
      <div aria-busy="true">
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-line is-short" />
      </div>
    );
  }

  const memory = instance.performance?.lastMemoryUsage;
  const lag = instance.performance?.eventLoopLag;

  const cards = [
    { label: "Version", value: `v${instance.version}` },
    { label: "Uptime", value: instance.uptime || "—" },
    { label: "Servers", value: String(instance.servers) },
    { label: "Lavalink", value: instance.lavalink?.connected ? "Connected" : "Disconnected" },
    { label: "Lavalink latency", value: instance.lavalink?.latency != null ? `${instance.lavalink.latency} ms` : "—" },
    { label: "Reconnects", value: String(instance.lavalink?.reconnects ?? 0) },
    { label: "Heap used", value: memory?.heapUsed != null && Number.isFinite(Number(memory.heapUsed)) ? `${Number(memory.heapUsed).toFixed(1)} MB` : "—" },
    { label: "Event loop lag", value: lag != null ? `${lag} ms` : "—" },
  ];

  return (
    <>
      <div className={instance.healthy ? "verdict is-ok" : "verdict is-warn"}>
        <b>{instance.healthy ? "Healthy" : "Needs attention"}</b>
        {instance.issues.length > 0 ? (
          <ul>
            {instance.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : (
          <p>Nothing is currently flagged.</p>
        )}
      </div>

      <div className="statgrid">
        {cards.map((card) => (
          <div className="statcard" key={card.label}>
            <span className="statcard-label">{card.label}</span>
            <b className="statcard-value is-small">{card.value}</b>
          </div>
        ))}
      </div>

      <div className="statblock">
        <h3>Since this process started</h3>
        <dl className="deflist">
          <div>
            <dt>Commands run</dt>
            <dd>
              {instance.commands.total} <small>({instance.commands.failed} failed)</small>
            </dd>
          </div>
          <div>
            <dt>Tracks played</dt>
            <dd>
              {instance.tracks.played} <small>({instance.tracks.failed} failed)</small>
            </dd>
          </div>
          <div>
            <dt>Errors logged</dt>
            <dd>{instance.errorCount}</dd>
          </div>
          <div>
            <dt>Warnings logged</dt>
            <dd>{instance.warningCount}</dd>
          </div>
        </dl>
        <p className="statblock-note">
          These describe the whole bot process, not this server, and reset when it restarts. The messages behind the
          error and warning counts are deliberately not shown here — they can quote content from other servers. Read
          them with <code className="mono">/health errors</code> in Discord.
        </p>
      </div>
    </>
  );
}
