import { formatClock } from "./runGraph.js";

// The graph is drawn on a fixed grid and stretched to the card (preserveAspectRatio none), so a stroke keeps its width
// with vector-effect and every shape is one path: a long run is still a handful of elements.
const WIDTH = 1000;
const HEIGHT = 100;
const PAD = 5; // health 0 and 1 sit this far in from the edges, so the line is never cut off
const TICK = 11; // a miss's tick rises this far from the bottom

const xOf = (t, endMs) => ((Math.min(endMs, Math.max(0, t)) / endMs) * WIDTH).toFixed(1);
const yOf = (v) => (PAD + (1 - Math.min(1, Math.max(0, v))) * (HEIGHT - 2 * PAD)).toFixed(1);

function linePath(health, endMs) {
  return health.map(({ t, v }, index) => `${index ? "L" : "M"}${xOf(t, endMs)} ${yOf(v)}`).join("");
}

function describe(graph, failed) {
  const parts = [`${graph.misses.length} ${graph.misses.length === 1 ? "miss" : "misses"}`];
  if (graph.fevers.length) parts.push(`${graph.fevers.length} FEVER`);
  parts.push(failed && graph.failedAt != null ? `lost at ${formatClock(graph.failedAt)}` : "kept going to the end");
  return `Health over the run: ${parts.join(", ")}`;
}

// Health over the song with the run's FEVER stretches and misses along it. graph is runGraphOf's.
// `reveal` is the class that holds the card back until its step and plays its entrance (mb-res-in / mb-res-wait).
export default function RunGraph({ graph, failed = false, reveal }) {
  const { health, misses, fevers, endMs, failedAt } = graph;
  const line = linePath(health, endMs);
  const last = health.at(-1);
  const area = `${line}L${xOf(last.t, endMs)} ${HEIGHT}L0 ${HEIGHT}Z`;
  const ticks = misses.map((t) => `M${xOf(t, endMs)} ${HEIGHT}V${HEIGHT - TICK}`).join("");
  const lostAt = failed && failedAt != null ? (failedAt / endMs) * 100 : null;

  return (
    <div className={`mb-res-card mb-res-graph ${reveal}${failed ? " mb-res-graph-lost" : ""}`}>
      <div className="mb-res-graphhead">
        <span className="mb-res-label">Health</span>
        <span className="mb-res-label mb-res-legend" aria-hidden="true">
          {fevers.length ? <span><i className="mb-rg-key mb-rg-key-fever" />Fever</span> : null}
          {misses.length ? <span><i className="mb-rg-key mb-rg-key-miss" />Miss</span> : null}
        </span>
      </div>
      <div className="mb-res-graphplot" role="img" aria-label={describe(graph, failed)}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          {fevers.map(({ from, to }) => (
            <rect key={from} className="mb-rg-fever" x={xOf(from, endMs)} y="0" width={(xOf(to, endMs) - xOf(from, endMs)).toFixed(1)} height={HEIGHT} />
          ))}
          <path className="mb-rg-area" d={area} />
          <path className="mb-rg-line" d={line} vectorEffect="non-scaling-stroke" />
          {ticks ? <path className="mb-rg-misses" d={ticks} vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        {lostAt != null ? (
          <span className={`mb-rg-lost${lostAt > 55 ? " mb-rg-lost-left" : ""}`} style={{ left: `${lostAt}%` }}>
            <i />
            <b>{formatClock(failedAt)}</b>
          </span>
        ) : null}
      </div>
      <div className="mb-res-axis mb-res-label"><span>0:00</span><span>{formatClock(endMs)}</span></div>
    </div>
  );
}
