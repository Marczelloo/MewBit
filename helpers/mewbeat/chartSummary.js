const { starsOf } = require("./charts/stars");

const DIFFICULTIES = ["easy", "normal", "hard", "hell"];

// What the song lists and the rating read of a song's charts: for each level its version, stars, tempo, highlight and
// note count, so they need not hold or parse the notes. A level the charts lack is null; no charts at all give null.
function summarizeCharts(charts) {
  if (!charts) return null;
  return Object.fromEntries(DIFFICULTIES.map((difficulty) => {
    const chart = charts[difficulty];
    if (!chart) return [difficulty, null];
    return [difficulty, {
      version: chart.version,
      stars: chart.stars ?? starsOf(chart),
      bpm: chart.bpm,
      highlightMs: chart.highlightMs,
      notes: chart.notes?.length ?? null,
    }];
  }));
}

module.exports = { summarizeCharts };
