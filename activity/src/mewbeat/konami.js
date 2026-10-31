const SEQUENCE = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"];

// Tracks the typed keys; push() is true on the key that completes the code.
export function createKonamiMatcher() {
  let typed = [];
  return {
    push(key) {
      typed.push(String(key).toLowerCase());
      // Only the last SEQUENCE.length keys can matter, and the longest suffix equal to a
      // prefix of the code is the progress, so "up up up down ..." still completes.
      if (typed.length > SEQUENCE.length) typed = typed.slice(-SEQUENCE.length);
      for (let len = typed.length; len > 0; len--) {
        const offset = typed.length - len;
        if (typed.slice(offset).every((k, i) => k === SEQUENCE[i])) {
          if (len === SEQUENCE.length) {
            typed = [];
            return true;
          }
          typed = typed.slice(offset);
          return false;
        }
      }
      typed = [];
      return false;
    },
  };
}
