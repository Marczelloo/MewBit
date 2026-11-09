// A value outside React that components subscribe to one slice of. The game loop writes the HUD here on every
// judgement, and only the leaves that show a changed slice render again, not the whole session.
export function createStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// Wraps `select` so the same input gives the same output object. useSyncExternalStore asks for the snapshot more than
// once per render and renders again when it differs, so a selector that builds an object must not build a new one each time.
export function memoSelect(select) {
  let seen;
  let result;
  let primed = false;
  return (input) => {
    if (primed && Object.is(input, seen)) return result;
    seen = input;
    result = select(input);
    primed = true;
    return result;
  };
}
