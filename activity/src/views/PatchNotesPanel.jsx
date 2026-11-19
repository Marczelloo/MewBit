import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise, CaretDown, SpinnerGap } from "@phosphor-icons/react";
import { fetchActivityChangelog } from "../api.js";
import "./patchNotes.css";

const SECTIONS = [
  { key: "features", label: "New" },
  { key: "changes", label: "Changed" },
  { key: "fixes", label: "Fixed" },
];

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function Release({ release, current, open, onToggle }) {
  const id = `release-${release.version.replace(/\W/g, "-")}`;
  const sections = SECTIONS.filter((section) => release[section.key]?.length);
  return (
    <article className={`pn-release ${open ? "is-open" : ""}`} aria-labelledby={`${id}-title`}>
      <button type="button" className="pn-release-head" aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle}>
        <span className="pn-version">v{release.version}</span>
        <span className="pn-heading">
          <span id={`${id}-title`} className="pn-title">{release.title || `Version ${release.version}`}</span>
          <span className="pn-date">{formatDate(release.date)}{current ? <span className="pn-current">Current</span> : null}</span>
        </span>
        <CaretDown className="pn-caret" size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div id={`${id}-body`} className="pn-release-body">
          {sections.length ? sections.map((section) => (
            <section key={section.key} className={`pn-section pn-section-${section.key}`}>
              <h3>{section.label}</h3>
              <ul>{release[section.key].map((line, index) => <li key={index}>{line}</li>)}</ul>
            </section>
          )) : <p className="pn-empty">No notes for this release.</p>}
        </div>
      ) : null}
    </article>
  );
}

// Every release's notes, newest first, read from the bot's own patch notes. The release the "What's new" window came
// from (or the newest) starts open; the rest open on a click.
export default function PatchNotesPanel({ focusVersion = null, fallback = null }) {
  const [status, setStatus] = useState("loading");
  const [data, setData] = useState(null);
  const [openVersions, setOpenVersions] = useState(() => new Set());

  const load = useCallback((signal) => {
    setStatus("loading");
    fetchActivityChangelog({ signal })
      .then((payload) => {
        if (signal?.aborted) return;
        setData({ current: payload.current, releases: Array.isArray(payload.releases) ? payload.releases : [] });
        setStatus("ready");
      })
      .catch(() => {
        if (signal?.aborted) return;
        // The local preview has no gateway: it reads the mock history instead of showing an error.
        if (fallback) { setData(fallback); setStatus("ready"); return; }
        setStatus("error");
      });
  }, [fallback]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!data?.releases?.length) return;
    const first = data.releases.find((release) => release.version === focusVersion) || data.releases[0];
    setOpenVersions(new Set([first.version]));
  }, [data, focusVersion]);

  const toggle = (version) => setOpenVersions((current) => {
    const next = new Set(current);
    if (next.has(version)) next.delete(version); else next.add(version);
    return next;
  });

  if (status === "loading") {
    return <div className="empty-state" aria-busy="true"><SpinnerGap className="button-spinner" size={28} aria-hidden="true" /><span>Loading patch notes</span></div>;
  }
  if (status === "error") {
    return (
      <div className="empty-state pn-error" role="alert">
        <span>The patch notes could not be loaded.</span>
        <button type="button" className="mbtn mbtn-ghost" onClick={() => load()}><ArrowClockwise size={15} aria-hidden="true" />Try again</button>
      </div>
    );
  }
  if (!data.releases.length) return <div className="empty-state"><span>No patch notes yet.</span></div>;

  return (
    <div className="pn-list">
      {data.releases.map((release) => (
        <Release
          key={release.version}
          release={release}
          current={release.version === data.current}
          open={openVersions.has(release.version)}
          onToggle={() => toggle(release.version)}
        />
      ))}
    </div>
  );
}
