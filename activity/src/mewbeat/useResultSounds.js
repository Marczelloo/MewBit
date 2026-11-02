import { useEffect, useRef } from "react";

// The results in the order osu! sounds them, with its levels: a swoosh up while the score ticks slower and
// higher, a dink per stat, then the grade's impact.
const SWOOSH_LEVEL = 0.4;
const TICK_GAP_MS = [18, 300];
const TICK_LEVEL = [0.6, 1];
const DINK_RATE_STEP = 0.05;
const IMPACTS = { S: "rank-impact-pass-ss", A: "rank-impact-pass", B: "rank-impact-fail", C: "rank-impact-fail", D: "rank-impact-fail-d" };

const between = ([from, to], part) => from + (to - from) * part;

// play: null keeps the screen silent. reached and reveal: how far the screen has got, and when each step shows.
// dinks: the steps after the score, in order. accuracy: 0-100, how high the ticks climb.
export function useResultSounds({ play, reached, reveal, dinks, grade, accuracy }) {
  const progress = useRef({ started: false, dinks: 0, graded: false });
  const tickTimer = useRef(null);
  const stops = useRef([]);

  useEffect(() => () => {
    window.clearTimeout(tickTimer.current);
    for (const stop of stops.current) stop?.();
  }, []);

  useEffect(() => {
    const now = progress.current;
    if (!play || now.graded) return;
    if (reached >= reveal.grade) {
      now.graded = true;
      window.clearTimeout(tickTimer.current);
      stops.current.push(play(IMPACTS[grade]));
      return;
    }
    if (!now.started && reached >= reveal.score) {
      now.started = true;
      stops.current.push(play("swoosh", { level: SWOOSH_LEVEL }));
      const begin = performance.now();
      const length = reveal[dinks[0]] - reveal.score;
      const tick = () => {
        const elapsed = performance.now() - begin;
        if (elapsed >= length) return;
        const part = Math.sin((elapsed / length) * Math.PI / 2);
        play("score-tick", { level: between(TICK_LEVEL, part), rate: 1 + (accuracy ?? 0) / 100 * part });
        tickTimer.current = window.setTimeout(tick, between(TICK_GAP_MS, part));
      };
      tick();
    }
    if (now.dinks < dinks.length && reached >= reveal[dinks[now.dinks]]) {
      const name = now.dinks === dinks.length - 1 ? "dink-max" : "dink";
      play(name, { rate: 1 + now.dinks * DINK_RATE_STEP });
      now.dinks += 1;
    }
  }, [play, reached, reveal, dinks, grade, accuracy]);
}
