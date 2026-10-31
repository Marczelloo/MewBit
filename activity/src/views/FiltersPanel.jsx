import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, Check, Faders, Headphones, Lightning, MicrophoneStage, Phone, Robot, Skull, Smiley, SpeakerHifi, SpeakerSimpleLow, SpeakerSimpleNone, SpinnerGap, SunHorizon, WaveSine, WaveTriangle } from "@phosphor-icons/react";
import Dropdown from "./Dropdown.jsx";
import "./filters.css";

// Lavalink exposes exactly these 15 fixed EQ bands (0–14). Keep the compact
// visual label separate from the full spoken frequency used by the slider.
const EQUALIZER_BANDS = Object.freeze([
  { label: "25", frequency: "25 Hz" },
  { label: "40", frequency: "40 Hz" },
  { label: "63", frequency: "63 Hz" },
  { label: "100", frequency: "100 Hz" },
  { label: "160", frequency: "160 Hz" },
  { label: "250", frequency: "250 Hz" },
  { label: "400", frequency: "400 Hz" },
  { label: "630", frequency: "630 Hz" },
  { label: "1k", frequency: "1,000 Hz" },
  { label: "1.6k", frequency: "1,600 Hz" },
  { label: "2.5k", frequency: "2,500 Hz" },
  { label: "4k", frequency: "4,000 Hz" },
  { label: "6.3k", frequency: "6,300 Hz" },
  { label: "10k", frequency: "10,000 Hz" },
  { label: "16k", frequency: "16,000 Hz" },
]);
const FILTER_PRESET_META = Object.freeze({
  nightcore: { label: "Nightcore", description: "Faster, brighter, and slightly higher pitch" },
  vaporwave: { label: "Vaporwave", description: "Slow, dreamy, and lower-pitched" },
  chipmunk: { label: "Chipmunk", description: "High-pitched meme mode" },
  deepvoice: { label: "Deep Voice", description: "Lower pitch for a darker voice" },
  eightd: { label: "8D", description: "Slow stereo rotation for an 8D effect" },
  karaoke: { label: "Karaoke", description: "Reduces center-panned vocals" },
  wobble: { label: "Wobble", description: "Adds a playful tremolo wobble" },
  vibrato: { label: "Vibrato", description: "Adds a noticeable vocal vibrato" },
  robot: { label: "Robot", description: "Crunchy robotic distortion" },
  telephone: { label: "Telephone", description: "Narrow, filtered telephone sound" },
  mono: { label: "Mono", description: "Folds stereo into a centered mono mix" },
  surround: { label: "Surround", description: "Gentle rotating surround feel" },
  meme: { label: "Meme", description: "Fast pitch plus wobble for cursed moments" },
});
const FILTER_PRESET_ICONS = Object.freeze({
  nightcore: Lightning,
  vaporwave: SunHorizon,
  chipmunk: Smiley,
  deepvoice: SpeakerSimpleLow,
  eightd: Headphones,
  karaoke: MicrophoneStage,
  wobble: WaveSine,
  vibrato: WaveTriangle,
  robot: Robot,
  telephone: Phone,
  mono: SpeakerSimpleNone,
  surround: SpeakerHifi,
  meme: Skull,
});
const EQ_BAND_GROUPS = Object.freeze([
  { label: "Bass", from: 0, to: 4 },
  { label: "Mids", from: 5, to: 9 },
  { label: "Treble", from: 10, to: 14 },
]);
// Lavalink gain is a linear multiplier; this app allows -0.25..0.2.
const EQ_MIN = -0.25;
const EQ_MAX = 0.2;
const EQ_RANGE = EQ_MAX - EQ_MIN;
const EQ_BAND_COUNT = EQUALIZER_BANDS.length;
const EQ_UNIT = 100; // SVG units per band column; the viewBox is EQ_BAND_COUNT * EQ_UNIT wide and 1000 tall
const EQ_GRID_DB = Object.freeze([1, 0, -1, -2]);
const MINUS = "−";

const gainToDb = (gain) => 20 * Math.log10(Math.max(1 + (Number(gain) || 0), 0.0001));
const dbToGain = (db) => 10 ** (db / 20) - 1;
// Vertical position as a 0..100 percentage from the top of the fader travel.
const gainToPercent = (gain) => (1 - (Math.min(EQ_MAX, Math.max(EQ_MIN, Number(gain) || 0)) - EQ_MIN) / EQ_RANGE) * 100;

function getFilterPresetMeta(preset) {
  const key = String(preset || "").toLowerCase();
  if (FILTER_PRESET_META[key]) return FILTER_PRESET_META[key];
  const label = key.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
  return { label: label || "Effect", description: "Applies a live sound effect" };
}

function formatEqDb(gain) {
  const db = Math.round(gainToDb(gain) * 10) / 10;
  if (db === 0) return "0";
  return `${db > 0 ? "+" : MINUS}${Math.abs(db).toFixed(1)}`;
}

// Monotone cubic (Fritsch-Carlson) so the curve never overshoots the band values.
function buildCurve(gains) {
  const points = gains.map((gain, index) => [(index + 0.5) * EQ_UNIT, gainToPercent(gain) * 10]);
  const count = points.length;
  const slopes = points.slice(0, -1).map((point, index) => (points[index + 1][1] - point[1]) / EQ_UNIT);
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === count - 1) return slopes[count - 2];
    const before = slopes[index - 1];
    const after = slopes[index];
    return before * after <= 0 ? 0 : (2 * before * after) / (before + after);
  });
  const reach = EQ_UNIT / 3;
  let path = `M${points[0][0]} ${points[0][1].toFixed(2)}`;
  for (let index = 0; index < count - 1; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[index + 1];
    path += ` C${(x0 + reach).toFixed(2)} ${(y0 + tangents[index] * reach).toFixed(2)} ${(x1 - reach).toFixed(2)} ${(y1 - tangents[index + 1] * reach).toFixed(2)} ${x1} ${y1.toFixed(2)}`;
  }
  return path;
}

export default function FiltersPanel({ filters, filterPresets, equalizerPresets = [], onAction, isActionPending = () => false, activeSection = "effects", canAdjust = true }) {
  const values = useMemo(() => Array.from({ length: EQUALIZER_BANDS.length }, (_, index) => filters.equalizer?.find((band) => band.band === index)?.gain ?? 0), [filters.equalizer]);
  const [bands, setBands] = useState(values);
  const bandsRef = useRef(values);
  const isAdjustingRef = useRef(false);
  const pendingBandsRef = useRef(null);
  const pendingBandsUntilRef = useRef(0);
  const gradientId = `fx-fill-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    if (isAdjustingRef.current) return;
    const pendingBands = pendingBandsRef.current;
    if (pendingBands) {
      const acknowledged = pendingBands.every((gain, index) => Math.abs((values[index] || 0) - gain) < 0.0001);
      if (acknowledged) pendingBandsRef.current = null;
      else if (Date.now() < pendingBandsUntilRef.current) {
        bandsRef.current = pendingBands;
        setBands(pendingBands);
        return;
      } else pendingBandsRef.current = null;
    }
    bandsRef.current = values;
    setBands(values);
  }, [values]);

  const updateBand = (index, nextGain) => {
    isAdjustingRef.current = true;
    pendingBandsRef.current = null;
    const nextBands = bandsRef.current.map((gain, band) => (band === index ? Number(nextGain) : gain));
    bandsRef.current = nextBands;
    setBands(nextBands);
  };
  const resetBands = () => {
    if (!canAdjust) return;
    const flatBands = Array(EQUALIZER_BANDS.length).fill(0);
    isAdjustingRef.current = false;
    pendingBandsRef.current = flatBands;
    pendingBandsUntilRef.current = Date.now() + 5000;
    bandsRef.current = flatBands;
    setBands(flatBands);
    // The backend recognizes an empty curve as the real flat preset rather
    // than leaving the player in a visually misleading custom state.
    onAction("equalizer", { bands: [] });
  };
  const commitBands = () => {
    isAdjustingRef.current = false;
    const committedBands = [...bandsRef.current];
    pendingBandsRef.current = committedBands;
    pendingBandsUntilRef.current = Date.now() + 5000;
    onAction("equalizer", { bands: committedBands.map((gain, band) => ({ band, gain })) });
  };

  const zeroPercent = gainToPercent(0);
  const curve = useMemo(() => buildCurve(bands), [bands]);
  const plotWidth = EQ_BAND_COUNT * EQ_UNIT;
  const fillPath = `${curve} L${plotWidth - EQ_UNIT / 2} ${zeroPercent * 10} L${EQ_UNIT / 2} ${zeroPercent * 10} Z`;
  const isFlat = bands.every((gain) => Math.abs(gain) < 0.0001);
  const eqStatus = filters.preset === "custom" ? (isFlat ? "Flat" : "Custom curve") : String(filters.preset || "flat").toLowerCase() === "flat" ? "Flat" : filters.preset;
  const activeEffect = filters.effectPreset && filters.effectPreset !== "off" && filters.effectPreset !== "none" ? filters.effectPreset : null;
  const filterPending = isActionPending("filter");

  return (
    <div className={`filters-panel fx-root ${canAdjust ? "" : "is-unavailable"}`} aria-disabled={!canAdjust} inert={canAdjust ? undefined : ""}>
      {!canAdjust ? <p className="sound-unavailable" role="status">Start a track to adjust its sound.</p> : null}
      {activeSection === "effects" ? (
        <section className="fx-section fx-effects" aria-label="Sound effects">
          <header className="fx-head">
            <div className="fx-head-copy">
              <h3 className="fx-title">Effects</h3>
              <p className={`fx-status ${activeEffect ? "is-on" : ""}`}>{activeEffect ? <>Active: <b>{getFilterPresetMeta(activeEffect).label}</b></> : "One-click Lavalink effects"}</p>
            </div>
            <button className="fx-btn" type="button" onClick={() => onAction("filter", { preset: "off" })} disabled={filterPending || !activeEffect}>
              {filterPending ? <SpinnerGap className="button-spinner" size={14} aria-hidden="true" /> : <ArrowCounterClockwise size={14} aria-hidden="true" />}
              Reset
            </button>
          </header>
          <div className="fx-grid">
            {(filterPresets || []).map((preset, index) => {
              const meta = getFilterPresetMeta(preset);
              const Icon = FILTER_PRESET_ICONS[String(preset || "").toLowerCase()] || Faders;
              const selected = filters.effectPreset === preset;
              return (
                <button type="button" key={preset} className={`fx-tile ${selected ? "is-selected" : ""}`} style={{ "--i": index }} aria-pressed={selected} onClick={() => onAction("filter", { preset })} disabled={filterPending}>
                  <span className="fx-tile-icon">{filterPending && selected ? <SpinnerGap className="button-spinner" size={18} aria-hidden="true" /> : <Icon size={18} weight={selected ? "fill" : "regular"} aria-hidden="true" />}</span>
                  <span className="fx-tile-copy"><strong>{meta.label}</strong><small>{meta.description}</small></span>
                  <span className="fx-tile-check" aria-hidden="true"><Check size={11} weight="bold" /></span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
      {activeSection === "equalizer" ? (
        <section className="fx-section fx-eq" aria-label="Equalizer">
          <header className="fx-head">
            <div className="fx-head-copy">
              <h3 className="fx-title">Equalizer</h3>
              <p className={`fx-status ${eqStatus === "Flat" ? "" : "is-on"}`}>{eqStatus}</p>
            </div>
            <div className="fx-head-actions">
              <div className="fx-preset">
                <Dropdown value={filters.preset === "custom" ? "custom" : filters.preset || "flat"} onChange={(preset) => onAction("equalizer_preset", { preset })} disabled={isActionPending("equalizer_preset")} label="Equalizer preset" align="end" options={[{ value: "custom", label: "Custom curve", disabled: true }, ...equalizerPresets.map((preset) => ({ value: preset.name, key: `${preset.custom ? "custom" : "built-in"}-${preset.name}`, label: `${preset.name}${preset.custom ? " • custom" : ""}` }))]} />
              </div>
              <button className="fx-btn" type="button" onClick={resetBands} disabled={isActionPending("equalizer")}>
                {isActionPending("equalizer") ? <SpinnerGap className="button-spinner" size={14} aria-hidden="true" /> : <ArrowCounterClockwise size={14} aria-hidden="true" />}
                Reset to flat
              </button>
            </div>
          </header>
          <div className="fx-eq-card">
            <div className="fx-eq-scroll">
              <div className="fx-plot">
                <div className="fx-axis" aria-hidden="true">
                  <div className="fx-axis-inner">
                    {EQ_GRID_DB.map((db) => <span key={db} className={`fx-axis-label ${db === 0 ? "is-zero" : ""}`} style={{ top: `${gainToPercent(dbToGain(db))}%` }}>{db === 0 ? "0" : `${db > 0 ? "+" : MINUS}${Math.abs(db)}`}</span>)}
                  </div>
                </div>
                <div className="fx-stage">
                  <svg className="fx-curve" viewBox={`0 0 ${plotWidth} 1000`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
                    <defs>
                      <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="1000">
                        <stop offset="0" stopColor="#67e3f4" stopOpacity="0.36" />
                        <stop offset={zeroPercent / 100} stopColor="#67e3f4" stopOpacity="0" />
                        <stop offset="1" stopColor="#67e3f4" stopOpacity="0.36" />
                      </linearGradient>
                    </defs>
                    {EQ_GRID_DB.filter((db) => db !== 0).map((db) => <line key={db} className="fx-grid-line" x1="0" x2={plotWidth} y1={gainToPercent(dbToGain(db)) * 10} y2={gainToPercent(dbToGain(db)) * 10} />)}
                    <line className="fx-baseline" x1="0" x2={plotWidth} y1={zeroPercent * 10} y2={zeroPercent * 10} />
                    <path d={fillPath} fill={`url(#${gradientId})`} />
                    <path className="fx-curve-glow" d={curve} />
                    <path className="fx-curve-line" d={curve} />
                  </svg>
                  <div className="fx-cols fx-faders">
                    {bands.map((gain, index) => {
                      const band = EQUALIZER_BANDS[index];
                      const position = gainToPercent(gain);
                      const dbLabel = formatEqDb(gain);
                      return (
                        <div className="fx-fader" key={index}>
                          <span className="fx-track" aria-hidden="true">
                            <span className="fx-fill" style={{ top: `${Math.min(position, zeroPercent)}%`, height: `${Math.abs(position - zeroPercent)}%` }} />
                            <span className="fx-zero-tick" style={{ top: `${zeroPercent}%` }} />
                          </span>
                          <input className={Math.abs(gain) >= 0.005 ? "is-set" : ""} type="range" min="-0.25" max="0.2" step="0.01" value={gain} aria-label={`${band.frequency} EQ band, ${dbLabel} dB`} aria-valuetext={`${dbLabel} dB`} onPointerDown={() => { isAdjustingRef.current = true; }} onPointerCancel={commitBands} onChange={(event) => updateBand(index, event.target.value)} onPointerUp={commitBands} onKeyDown={(event) => { if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") isAdjustingRef.current = true; }} onKeyUp={(event) => { if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") commitBands(); }} />
                        </div>
                      );
                    })}
                  </div>
                </div>
                <span className="fx-rowlabel" aria-hidden="true">dB</span>
                <div className="fx-cols fx-values" aria-hidden="true">
                  {bands.map((gain, index) => <span key={index} className={Math.abs(gain) >= 0.005 ? "is-set" : ""}>{formatEqDb(gain)}</span>)}
                </div>
                <span className="fx-rowlabel" aria-hidden="true">Hz</span>
                <div className="fx-cols fx-freqs" aria-hidden="true">
                  {EQUALIZER_BANDS.map((band) => <span key={band.label}>{band.label}</span>)}
                </div>
                <span aria-hidden="true" />
                <div className="fx-cols fx-groups" aria-hidden="true">
                  {EQ_BAND_GROUPS.map((group) => <span key={group.label} style={{ gridColumn: `${group.from + 1} / ${group.to + 2}` }}>{group.label}</span>)}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
