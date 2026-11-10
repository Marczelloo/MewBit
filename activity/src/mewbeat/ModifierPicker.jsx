import { Info } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MODIFIERS, modifierMultiplier } from "./modifiers.js";
import { MODIFIER_GROUPS, MODIFIER_HINTS, bonusLabel, modifiersOfGroup, multiplierLabel, sanitizeModifiers, toggleModifier } from "./modifierPick.js";
import "./modifierPicker.css";

const BY_ID = new Map(MODIFIERS.map((modifier) => [modifier.id, modifier]));

// Short tags (NF, GN, ...) for a list of modifier ids, nothing for an empty list. failed adds a red FAILED tag in front.
export function ModifierTags({ modifiers, failed = false }) {
  const known = Array.isArray(modifiers) ? modifiers.map((id) => BY_ID.get(id)).filter(Boolean) : [];
  if (!known.length && !failed) return null;
  return (
    <span className="mb-mod-tags">
      {failed ? <span className="mb-mod-tag mb-mod-tag-failed">FAILED</span> : null}
      {known.map((modifier) => (
        <span key={modifier.id} className="mb-mod-tag" title={modifier.name}>{modifier.short}</span>
      ))}
    </span>
  );
}

// The modifier bar and the panel behind its "Details" button. value is the list of picked ids; onChange gets the list
// after a click, always normalized. mode is "solo" | "room" | "live": the Speed group needs the music to itself, so only
// solo has it (the bar leaves its chips out, the panel says why). The bar is one row in the style of the level tiles:
// a chip toggles one modifier in a click, the multiplier of the pick sits on the right.
// onOpenChange(open) tells the game the panel has Esc, so its own Esc (the game menu) stands aside meanwhile.
export default function ModifierPicker({ value, onChange, mode = "solo", onOpenChange }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);
  const titleId = useId();
  const picked = sanitizeModifiers(value, { mode });
  const speedOff = mode !== "solo";
  const multiplier = modifierMultiplier(picked);
  const barGroups = MODIFIER_GROUPS.filter(({ id }) => !(id === "speed" && speedOff));
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  // While open: focus goes into the panel, Esc closes it, and focus comes back to the button afterwards.
  useEffect(() => {
    if (!open) return undefined;
    onOpenChangeRef.current?.(true);
    const onEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onEscape, true);
    const trigger = triggerRef.current;
    dialogRef.current?.querySelector("button[aria-pressed]:not(:disabled)")?.focus();
    return () => {
      window.removeEventListener("keydown", onEscape, true);
      onOpenChangeRef.current?.(false);
      trigger?.focus();
    };
  }, [open]);

  // The panel owns the keyboard: Tab stays inside it, the arrows walk the toggles, and nothing reaches the screen under it
  // (React sends events through a portal to its parents, and the song list moves on the arrows).
  const onKeyDown = (event) => {
    event.stopPropagation();
    const buttons = [...dialogRef.current.querySelectorAll("button:not(:disabled)")];
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement);
    if (event.key === "Tab") {
      const next = buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length];
      event.preventDefault();
      next.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowLeft") {
      const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
      event.preventDefault();
      buttons[(at + step + buttons.length) % buttons.length].focus();
    }
  };

  const host = open ? triggerRef.current?.closest(".mb-game") ?? document.body : null;

  return (
    <>
      <div className="mb-modbar" role="group" aria-label="Modifiers">
        <span className="mb-modbar-label">Modifiers</span>
        <div className="mb-modbar-chips">
          {barGroups.map(({ id: groupId, label }) => (
            <div key={groupId} className="mb-modbar-group" role="group" aria-label={label}>
              {modifiersOfGroup(groupId).map((modifier) => {
                const on = picked.includes(modifier.id);
                return (
                  <button
                    key={modifier.id}
                    type="button"
                    className={`mb-modbar-chip${on ? " is-on" : ""}`}
                    aria-pressed={on}
                    title={`${modifier.name} · ${bonusLabel(modifier.bonus)}`}
                    onClick={() => onChange?.(toggleModifier(picked, modifier.id, { mode }))}
                  >
                    {modifier.short}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mb-modbar-end">
          <b className={`mb-modbar-mult${multiplier > 1 ? " is-up" : multiplier < 1 ? " is-down" : ""}`} title="Score multiplier" aria-label={`Score multiplier ${multiplierLabel(picked)}`}>{multiplierLabel(picked)}</b>
          <button
            ref={triggerRef}
            type="button"
            className="mb-modbar-more"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
          >
            <Info size={13} weight="bold" aria-hidden="true" />
            Details
          </button>
        </div>
      </div>
      {host
        ? createPortal(
            <div className="mb-mod-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
              <div className="mb-mod" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
                <div className="mb-mod-head">
                  <h2 id={titleId} className="mb-mod-title">Modifiers</h2>
                  <span className="mb-mod-total" aria-live="polite">
                    <small>Score</small>
                    <b>{multiplierLabel(picked)}</b>
                  </span>
                  <button type="button" className="mb-btn mb-mod-done" onClick={() => setOpen(false)}>
                    Done <kbd className="mb-kbd">Esc</kbd>
                  </button>
                </div>
                <div className="mb-mod-body">
                  {MODIFIER_GROUPS.map(({ id: groupId, label }) => {
                    const off = groupId === "speed" && speedOff;
                    const noteId = `${titleId}-${groupId}`;
                    return (
                      <section key={groupId} className="mb-mod-group" role="group" aria-label={label} aria-describedby={off ? noteId : undefined}>
                        <h3 className="mb-label">{label}</h3>
                        {off ? (
                          <p id={noteId} className="mb-mod-note">
                            Solo only. {mode === "room" ? "The music is shared in a room, so its speed cannot change." : "The music is shared with the others, so its speed cannot change."}
                          </p>
                        ) : null}
                        <div className="mb-mod-opts">
                          {modifiersOfGroup(groupId).map((modifier) => {
                            const on = picked.includes(modifier.id);
                            return (
                              <button
                                key={modifier.id}
                                type="button"
                                className={`mb-mod-opt${on ? " is-on" : ""}`}
                                aria-pressed={on}
                                disabled={off}
                                onClick={() => onChange?.(toggleModifier(picked, modifier.id, { mode }))}
                              >
                                <i className="mb-mod-dot" aria-hidden="true" />
                                <span className="mb-mod-text">
                                  <b>{modifier.name}</b>
                                  <span>{MODIFIER_HINTS[modifier.id]}</span>
                                </span>
                                <span className={`mb-mod-bonus${modifier.bonus > 0 ? " is-up" : modifier.bonus < 0 ? " is-down" : ""}`}>{bonusLabel(modifier.bonus)}</span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            </div>,
            host,
          )
        : null}
    </>
  );
}
