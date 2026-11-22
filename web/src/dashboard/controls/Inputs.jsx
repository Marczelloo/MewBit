import { useEffect, useRef, useState } from "react";

export function Toggle({ checked, onChange, disabled, label, onLabel = "On", offLabel = "Off" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={checked ? "toggle is-on" : "toggle"}
    >
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob" />
      </span>
      <span className="toggle-text">{checked ? onLabel : offLabel}</span>
    </button>
  );
}

export function Select({ value, onChange, disabled, options, placeholder, id }) {
  return (
    <select
      id={id}
      className="select"
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * A range input that only reports the release.
 *
 * Dragging fires change continuously, and each report is a request, so the
 * value is held locally while the pointer is down and `onCommit` fires once
 * per gesture: on pointer release, key release, or blur.
 */
export function Slider({ value, onCommit, disabled, min, max, step, format, id, label }) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  // Read at commit time rather than `draft`: a keyboard step fires change and
  // keyup in the same tick, before the state update has landed.
  const latest = useRef(value);

  useEffect(() => {
    // Adopt server state only between gestures, or a save landing would snap
    // the thumb out from under the pointer.
    if (dirty.current) return;
    setDraft(value);
    latest.current = value;
  }, [value]);

  const release = () => {
    if (!dirty.current) return;
    dirty.current = false;
    onCommit(latest.current);
  };

  return (
    <div className="slider">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          dirty.current = true;
          latest.current = Number(event.target.value);
          setDraft(latest.current);
        }}
        onPointerUp={release}
        onKeyUp={release}
        onPointerCancel={release}
        onTouchEnd={release}
        onBlur={release}
      />
      <output className="mono slider-value">{format(draft)}</output>
    </div>
  );
}

/**
 * A set of independent on/off rows. Used where several things are configured
 * at once and a select would hide the ones that are off — log categories are
 * four separate switches, not one choice.
 */
export function ToggleRows({ rows, onChange, disabled }) {
  return (
    <div className="rows">
      {rows.map((row) => (
        <div key={row.id} className={row.disabled || disabled ? "row is-off" : "row"}>
          <span className="row-text">
            <b>{row.label}</b>
            <small>{row.describe}</small>
          </span>
          <Toggle
            label={row.label}
            checked={row.checked}
            disabled={row.disabled || disabled}
            onChange={(value) => onChange(row.id, value)}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Multi-select over roles. Every change is one grant or one revoke, matching
 * `/logs access`, because each one edits Discord permissions on the way
 * through — a bulk apply would leave no way to report which role failed.
 */
export function RoleChecklist({ selected, options, onToggle, disabled, empty }) {
  if (options.length === 0) return <p className="checklist-empty">{empty}</p>;

  return (
    <div className="checklist">
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <button
            type="button"
            key={option.value}
            role="checkbox"
            aria-checked={on}
            disabled={disabled}
            className={on ? "chip is-on" : "chip"}
            onClick={() => onToggle(option.value, !on)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The fifteen Lavalink equalizer bands.
 *
 * The dB label mirrors `formatGainValue` in helpers/equalizer/panel.js so the
 * dashboard and `/eqpanel` describe the same gain identically. The asymmetry
 * is Lavalink's, not a mistake: a cut reaches much further than a boost.
 */
export function BandSliders({ bands, frequencies, minGain, maxGain, onChange, onCommit, disabled }) {
  const toDb = (gain) => (gain >= 0 ? gain * 6 : gain * 48);

  return (
    <div className="bands">
      {bands.map((gain, index) => (
        <label className="band" key={frequencies[index] || index}>
          <span className="mono band-freq">{frequencies[index] || `Band ${index + 1}`}</span>
          <input
            className="band-input"
            type="range"
            min={minGain}
            max={maxGain}
            step={0.01}
            value={gain}
            disabled={disabled}
            aria-label={`${frequencies[index] || `Band ${index + 1}`} gain`}
            onChange={(event) => onChange(index, Number(event.target.value))}
            // Dragging fires change continuously; only the release is worth a
            // request, and a Lavalink filter update per pixel would be abuse.
            onPointerUp={onCommit}
            onKeyUp={onCommit}
            onPointerCancel={onCommit}
            onTouchEnd={onCommit}
            onBlur={onCommit}
          />
          <output className={gain === 0 ? "mono band-value" : "mono band-value is-set"}>
            {`${toDb(gain) >= 0 ? "+" : ""}${toDb(gain).toFixed(1)} dB`}
          </output>
        </label>
      ))}
    </div>
  );
}
