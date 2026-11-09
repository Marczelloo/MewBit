// When the results screen does what, and what sounds with it. The numbers and the sounds read this one table, so
// a sound falls on the frame it belongs to: a tick on a step of a count, a dink on the moment a stat lands.

// ms after the screen opens. Every stat lands before the next starts, and the screen ends on the grade.
export const REVEAL = { score: 300, accuracy: 1900, combo: 2500, fevers: 3100, offset: 3500, judges: 3800, timing: 5000, side: 5300, grade: 5700, verdict: 6200 };
export const COUNT_MS = { score: 1500, accuracy: 500, combo: 500, fevers: 300 }; // the score's is the swoosh's length
export const JUDGE_COUNT_MS = 420;
export const JUDGE_STEP_MS = 180; // as .mb-res-judges li in mewbeat.css
// The grade's pop settles this far in (.mb-res-grade), and the impacts peak about 15 ms into the sample.
export const IMPACT_DELAY_MS = 165;
// A full combo's fanfare comes this long after the impact, while the impact still rings (both samples are about 2 s).
export const FULL_COMBO_DELAY_MS = 450;
const OFFSET_SHOWS_MS = 60; // its rise has only just begun at its step

const IMPACTS = { S: "rank-impact-pass-ss", A: "rank-impact-pass", B: "rank-impact-fail", C: "rank-impact-fail", D: "rank-impact-fail-d" };
const SWOOSH_LEVEL = 0.4;
const SCORE_TICKS = 24;
const STAT_TICKS = 6;
const SCORE_TICK_LEVEL = [0.6, 1];
const STAT_TICK_LEVEL = 0.45;
const STAT_TICK_CLIMB = 0.5;
const JUDGE_DINK_LEVEL = 0.7;
const DINK_RATE_STEP = 0.03;

// How far a count has climbed at part k of its time: quick at first, slowing into its landing.
export const easeOut = (k) => 1 - (1 - k) ** 2;

// A tick for each equal step of a count's value, spaced as the count slows; the last step is the landing.
export function countTicks(value, start, duration, most) {
  if (!(value > 0)) return [];
  const steps = Number.isInteger(value) ? Math.min(most, value) : most;
  const ticks = [];
  for (let step = 1; step < steps; step += 1) {
    const part = step / steps;
    ticks.push({ at: start + duration * (1 - Math.sqrt(1 - part)), part });
  }
  return ticks;
}

// A finished run played by hand without a miss (autoplay and calibration are no score to be proud of).
export const isFullCombo = (summary) => Boolean(summary?.finished) && !summary.autoplay && !summary.calibration && summary.counts?.miss === 0;

// What a skip still sounds: the grade's impact and whatever follows it.
export function skipEvents(events) {
  const from = events.findIndex(({ at }) => at >= REVEAL.grade + IMPACT_DELAY_MS);
  return from < 0 ? [] : events.slice(from);
}

// Everything the screen sounds, in order, with the grade's impact last, or the full combo's fanfare when the run has one. rate climbs with the run's accuracy on the
// score's ticks, as in osu!, and a little with every stat on the dinks.
export function resultSoundEvents({ grade, score, accuracy, maxCombo, fevers, fullCombo = false }) {
  const events = [{ at: REVEAL.score, name: "swoosh", level: SWOOSH_LEVEL, rate: 1 }];
  let dinks = 0;
  const dink = (at, name = "dink", level = 1) => {
    events.push({ at, name, level, rate: 1 + dinks * DINK_RATE_STEP });
    dinks += 1;
  };

  const scoreLands = REVEAL.score + COUNT_MS.score;
  const [quietest, loudest] = SCORE_TICK_LEVEL;
  for (const { at, part } of countTicks(score, REVEAL.score, COUNT_MS.score, SCORE_TICKS)) {
    events.push({ at, name: "score-tick", level: quietest + (loudest - quietest) * part, rate: 1 + (accuracy ?? 0) / 100 * part });
  }
  dink(scoreLands);

  for (const [step, value] of [["accuracy", accuracy], ["combo", maxCombo], ["fevers", fevers]]) {
    for (const { at, part } of countTicks(value, REVEAL[step], COUNT_MS[step], STAT_TICKS)) {
      events.push({ at, name: "score-tick", level: STAT_TICK_LEVEL, rate: 1 + STAT_TICK_CLIMB * part });
    }
    dink(REVEAL[step] + COUNT_MS[step]);
  }

  dink(REVEAL.offset + OFFSET_SHOWS_MS);
  for (let row = 0; row < 4; row += 1) dink(REVEAL.judges + row * JUDGE_STEP_MS + JUDGE_COUNT_MS, "dink", JUDGE_DINK_LEVEL);
  dink(REVEAL.timing, "dink-max");

  events.sort((a, b) => a.at - b.at);
  const impactAt = REVEAL.grade + IMPACT_DELAY_MS;
  events.push({ at: impactAt, name: IMPACTS[grade] ?? IMPACTS.D, level: 1, rate: 1 });
  if (fullCombo) events.push({ at: impactAt + FULL_COMBO_DELAY_MS, name: "full-combo", level: 1, rate: 1 });
  return events;
}
