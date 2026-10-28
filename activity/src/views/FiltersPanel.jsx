import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Faders, SpinnerGap } from "@phosphor-icons/react";
import Dropdown from "./Dropdown.jsx";

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

function getFilterPresetMeta(preset) {
  const key = String(preset || "").toLowerCase();
  if (FILTER_PRESET_META[key]) return FILTER_PRESET_META[key];
  const label = key.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
  return { label: label || "Effect", description: "Applies a live sound effect" };
}

function formatEqGain(gain) {
  const value = Number(gain) || 0;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

export default function FiltersPanel({ filters, filterPresets, equalizerPresets = [], onAction, isActionPending = () => false, activeSection = "effects", canAdjust = true }) {
  const values = useMemo(() => Array.from({ length: EQUALIZER_BANDS.length }, (_, index) => filters.equalizer?.find((band) => band.band === index)?.gain ?? 0), [filters.equalizer]);
  const [bands, setBands] = useState(values);
  const bandsRef = useRef(values);
  const isAdjustingRef = useRef(false);
  const pendingBandsRef = useRef(null);
  const pendingBandsUntilRef = useRef(0);

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

  return (
    <div className={`filters-panel ${canAdjust ? "" : "is-unavailable"}`} aria-disabled={!canAdjust} inert={canAdjust ? undefined : ""}>
      {!canAdjust ? <p className="sound-unavailable" role="status">Start a track to adjust its sound.</p> : null}
      {activeSection === "effects" ? <div className="filter-section"><div className="filter-label-row"><div><strong>Fun Filters</strong><span>One-click Lavalink effects</span></div><button className="ghost-button" type="button" onClick={() => onAction("filter", { preset: "off" })} disabled={isActionPending("filter")}>{isActionPending("filter") ? <SpinnerGap className="button-spinner" size={15} aria-hidden="true" /> : null}Reset</button></div><div className="filter-grid">{(filterPresets || []).map((preset) => { const meta = getFilterPresetMeta(preset); return <button type="button" key={preset} className={`filter-tile ${filters.effectPreset === preset ? "is-selected" : ""}`} onClick={() => onAction("filter", { preset })} disabled={isActionPending("filter")}><span className="filter-tile-icon">{isActionPending("filter") && filters.effectPreset === preset ? <SpinnerGap className="button-spinner" size={17} aria-hidden="true" /> : <Faders size={17} aria-hidden="true" />}</span><span className="filter-tile-copy"><strong>{meta.label}</strong><small>{meta.description}</small></span>{filters.effectPreset === preset ? <Check size={15} weight="bold" aria-hidden="true" /> : null}</button>; })}</div></div> : null}
      {activeSection === "equalizer" ? <div className="filter-section eq-section"><div className="filter-label-row"><div><strong>15-band EQ</strong><span>{filters.preset === "custom" ? "Custom curve" : `${filters.preset || "flat"} preset`}</span></div><div className="eq-actions"><label className="eq-preset-control"><span>Preset</span><Dropdown value={filters.preset === "custom" ? "custom" : filters.preset || "flat"} onChange={(preset) => onAction("equalizer_preset", { preset })} disabled={isActionPending("equalizer_preset")} label="Equalizer preset" align="end" options={[{ value: "custom", label: "Custom curve", disabled: true }, ...equalizerPresets.map((preset) => ({ value: preset.name, key: `${preset.custom ? "custom" : "built-in"}-${preset.name}`, label: `${preset.name}${preset.custom ? " • custom" : ""}` }))]} /></label><button className="ghost-button" type="button" onClick={resetBands} disabled={isActionPending("equalizer")}>{isActionPending("equalizer") ? <SpinnerGap className="button-spinner" size={15} aria-hidden="true" /> : null}Flat</button></div></div><div className="eq-grid">{bands.map((gain, index) => { const band = EQUALIZER_BANDS[index]; return <label className="eq-band" key={index}><span className="eq-band-label">{band.label}</span><span className="eq-slider-control"><input type="range" min="-0.25" max="0.2" step="0.01" value={gain} aria-label={`${band.frequency} EQ band, ${formatEqGain(gain)} gain`} onPointerDown={() => { isAdjustingRef.current = true; }} onPointerCancel={commitBands} onChange={(event) => updateBand(index, event.target.value)} onPointerUp={commitBands} onKeyDown={(event) => { if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") isAdjustingRef.current = true; }} onKeyUp={(event) => { if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") commitBands(); }} /></span><span className="eq-band-value">{formatEqGain(gain)}</span></label>; })}</div></div> : null}
    </div>
  );
}
