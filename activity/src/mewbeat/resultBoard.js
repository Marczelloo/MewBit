// What the results screen asks the leaderboard for: the chart just played, at the difficulty played. A calibration
// run or one without a chart has none. ready: the run's own score is no longer on its way (saved, refused or lost),
// so asking now includes a new best.
export function resultBoardTarget(summary) {
  if (!summary || summary.calibration || !summary.audioKey || !summary.difficulty) return null;
  return { audioKey: summary.audioKey, difficulty: summary.difficulty, ready: summary.submit?.status !== "submitting" };
}
