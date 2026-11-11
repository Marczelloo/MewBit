// Tells the game when the song is over for good. The song clock holds at the track's end and the audio is silent,
// but a run only finishes by judging its last note, which needs heard time to pass the note's window; with the
// clock stopped short of that it never would, and the stage stayed up with no way to the results. The watch says
// "over" once the clock has been at the end for a moment, which is the game's cue to settle what is left (run.tick's
// `over`). The moment is a grace for a press still on its way: a late hit on the last notes still counts.
export const END_GRACE_MS = 600;

export function createEndWatch({ graceMs = END_GRACE_MS } = {}) {
  let since = null;

  // `atEnd`: the clock is at the end right now; `perfMs`: the frame's time. True once it has been for graceMs.
  function update(atEnd, perfMs) {
    if (!atEnd) {
      since = null;
      return false;
    }
    if (since === null) since = perfMs;
    return perfMs - since >= graceMs;
  }

  function reset() {
    since = null;
  }

  return { update, reset };
}
