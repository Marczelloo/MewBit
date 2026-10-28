import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check } from "@phosphor-icons/react";

// Discord's client draws a native <select> list with the OS light theme, which
// tears through the dark player. This listbox keeps the select's contract
// (value, options, onChange) and its keyboard behaviour, and renders the list
// in a portal so the topbar and scroll panels never clip it.
const LIST_GAP = 6;
const VIEWPORT_MARGIN = 8;

export default function Dropdown({ value, options, onChange, label, disabled = false, className = "", align = "start" }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value) || null;

  const enabledIndex = (from, step) => {
    for (let index = from, seen = 0; seen < options.length; index += step, seen += 1) {
      const wrapped = (index + options.length) % options.length;
      if (!options[wrapped].disabled) return wrapped;
    }
    return -1;
  };

  const openList = (startIndex) => {
    if (disabled) return;
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    setActiveIndex(startIndex ?? (selectedIndex >= 0 ? selectedIndex : enabledIndex(0, 1)));
    setOpen(true);
  };

  const close = ({ focusTrigger = true } = {}) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  };

  const choose = (option) => {
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close();
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const listHeight = listRef.current?.offsetHeight || 0;
      const listWidth = Math.max(rect.width, listRef.current?.offsetWidth || 0);
      const below = window.innerHeight - rect.bottom - LIST_GAP - VIEWPORT_MARGIN;
      const flip = listHeight > below && rect.top > below;
      const preferredLeft = align === "end" ? rect.right - listWidth : rect.left;
      setPosition({
        top: flip ? Math.max(VIEWPORT_MARGIN, rect.top - LIST_GAP - listHeight) : rect.bottom + LIST_GAP,
        left: Math.min(Math.max(VIEWPORT_MARGIN, preferredLeft), window.innerWidth - listWidth - VIEWPORT_MARGIN),
        minWidth: rect.width,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, align]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (triggerRef.current?.contains(event.target) || listRef.current?.contains(event.target)) return;
      close({ focusTrigger: false });
    };
    // A scrolled panel would leave the list floating away from its trigger.
    const onScroll = (event) => {
      if (listRef.current?.contains(event.target)) return;
      close({ focusTrigger: false });
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (open && activeIndex >= 0) listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const onKeyDown = (event) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => enabledIndex(index + 1, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => enabledIndex(index - 1, -1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(enabledIndex(0, 1));
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(enabledIndex(options.length - 1, -1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(options[activeIndex]);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case "Tab":
        close({ focusTrigger: false });
        break;
      default:
        break;
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`dropdown-trigger ${open ? "is-open" : ""} ${className}`}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="dropdown-value">
          {selected?.shortLabel ? (
            <>
              <span className="dropdown-label-full">{selected.label}</span>
              <span className="dropdown-label-short" aria-hidden="true">{selected.shortLabel}</span>
            </>
          ) : selected?.label ?? ""}
        </span>
        <CaretDown className="dropdown-caret" size={12} weight="bold" aria-hidden="true" />
      </button>
      {open ? createPortal(
        <ul
          ref={listRef}
          id={listId}
          className="dropdown-list"
          role="listbox"
          aria-label={label}
          style={position ? { top: position.top, left: position.left, minWidth: position.minWidth } : { visibility: "hidden" }}
        >
          {options.map((option, index) => (
            <li
              key={option.key ?? option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              className={`dropdown-option ${index === activeIndex ? "is-active" : ""}`}
              onPointerMove={() => { if (!option.disabled && index !== activeIndex) setActiveIndex(index); }}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={13} weight="bold" aria-hidden="true" /> : null}
            </li>
          ))}
        </ul>,
        document.body,
      ) : null}
    </>
  );
}
