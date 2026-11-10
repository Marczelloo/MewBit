// Memory the decoded-frame cache may use. A least-recently-used cache smaller than the loop it plays throws out each
// frame just before it comes round again and decodes forever, so the budget is counted in frames: the longest loop,
// the first frame of every pose of a screen, the warm window of the current pose and the frames requested ahead.
// Bytes follow from the size frames are decoded at, so a bigger canvas gets a bigger budget instead of a loop that no longer fits.
// `keptFrames` are the frames of a screen's `keep` poses (the miss reactions), held whole on top of all that.
export const frameBytes = (size) => size * size * 4;

export function budgetBytes({ size, loopFrames, screenPoses, warmFrames, lookahead, keptFrames = 0 }) {
  return frameBytes(size) * (loopFrames + screenPoses + warmFrames + lookahead + keptFrames);
}
