// Constants live here so the rating can be tuned by feel after playing.
const PP = { base: 8, starPower: 2.2, accuracyFloor: 50, accuracyPower: 2.5, decay: 0.95 };

// What one play is worth: stars carry it, accuracy scales it. Nothing at or below the floor, so a
// sloppy run on a hard chart does not outrank a clean run on an easier one.
function playPp({ stars, accuracy }) {
  if (!Number.isFinite(stars) || stars <= 0 || !Number.isFinite(accuracy)) return 0;
  if (accuracy <= PP.accuracyFloor) return 0;
  const share = (Math.min(accuracy, 100) - PP.accuracyFloor) / (100 - PP.accuracyFloor);
  return PP.base * stars ** PP.starPower * share ** PP.accuracyPower;
}

// What a run is worth in the rating: one that stopped early is rated on the share of the map it played, while the
// accuracy shown stays its own. The ranking and the score reply both read it here.
function runPp({ stars, accuracy, completion }) {
  return playPp({ stars, accuracy: accuracy * (completion ?? 1) });
}

// A player's rating: the best plays first, each next one counting a little less.
function ratingOf(pps) {
  const sorted = [...pps].sort((a, b) => b - a);
  return sorted.reduce((total, pp, rank) => total + pp * PP.decay ** rank, 0);
}

module.exports = { PP, playPp, runPp, ratingOf };
