import { useEffect } from "react";
import { rand } from "./glitch.js";

// Hard bands from smooth noise: most of the range maps to "stay" (0.5), a few slices tear left or right.
const TEAR_TABLE = "0.5 0.5 0.5 0.5 0.5 0.16 0.5 0.8 0.5 0.36 0.5 0.94 0.5 0.5 0.5 0.5";
const NOISE_COLORS = ["103 227 244", "255 110 199", "167 139 250", "5 6 8", "5 6 8", "5 6 8", "244 246 249"];

// The filter tears what it is applied to, so the real screen rips instead of bars drawn on top of it.
function GlitchFilter({ id, margin }) {
  const region = { x: `${-margin}%`, y: `${-margin}%`, width: `${100 + 2 * margin}%`, height: `${100 + 2 * margin}%` };
  return (
    <filter id={id} {...region} colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.0001 0.028" numOctaves="2" seed="1" result="noise" />
      <feColorMatrix in="noise" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 1" result="solid" />
      <feComponentTransfer in="solid" result="bands"><feFuncR type="discrete" tableValues={TEAR_TABLE} /></feComponentTransfer>
      <feDisplacementMap in="SourceGraphic" in2="bands" scale="0" xChannelSelector="R" yChannelSelector="G" result="torn" />
      <feColorMatrix in="torn" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
      <feOffset in="red" dx="0" result="redShifted" />
      <feColorMatrix in="torn" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cyan" />
      <feOffset in="cyan" dx="0" result="cyanShifted" />
      <feBlend in="redShifted" in2="cyanShifted" mode="screen" />
    </filter>
  );
}

export function GlitchFilters() {
  return (
    <svg className="mb-glitch-defs" width="0" height="0" aria-hidden="true">
      <GlitchFilter id="mb-glitch-page" margin={0} />
      <GlitchFilter id="mb-glitch-sprite" margin={30} />
    </svg>
  );
}

export function setGlitchFilter(id, { seed, scale, split, freq }) {
  const filter = document.getElementById(id);
  if (!filter) return;
  const turbulence = filter.querySelector("feTurbulence");
  turbulence.setAttribute("seed", seed);
  turbulence.setAttribute("baseFrequency", `0.0001 ${freq}`);
  filter.querySelector("feDisplacementMap").setAttribute("scale", scale);
  const [red, cyan] = filter.querySelectorAll("feOffset");
  red.setAttribute("dx", -split);
  cyan.setAttribute("dx", split);
}

// Block noise on a small canvas that CSS scales up with hard pixels. Real signal damage clusters along a few
// scan bands and breaks into short runs, so it paints bands of broken blocks rather than loose bars.
export function paintNoise(canvas, amount, frame) {
  const context = canvas?.getContext("2d");
  if (!context) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  const bands = Math.round(amount * 9);
  for (let band = 0; band < bands; band += 1) {
    const salt = band * 100;
    const y = Math.floor(rand(frame, salt) * height);
    const rows = 1 + Math.floor(rand(frame, salt + 1) ** 2 * 4);
    const span = width * (0.1 + 0.5 * rand(frame, salt + 2));
    const startX = rand(frame, salt + 3) * width;
    for (let row = 0; row < rows; row += 1) {
      let x = startX + (rand(frame, salt + 4 + row) - 0.5) * 12;
      let run = 0;
      while (x < startX + span && run < 24) {
        const seed = salt + 10 + row * 7 + run * 3;
        const length = 1 + Math.floor(rand(frame, seed) ** 2 * 7);
        if (rand(frame, seed + 1) < 0.62) {
          const color = NOISE_COLORS[Math.floor(rand(frame, seed + 2) * NOISE_COLORS.length)];
          context.fillStyle = `rgb(${color} / ${(0.25 + 0.5 * rand(frame, seed + 3)).toFixed(2)})`;
          context.fillRect(Math.floor(x), y + row, length, 1);
        }
        x += length + Math.floor(rand(frame, seed + 4) * 4);
        run += 1;
      }
    }
  }
}

// While active, the app under the overlay carries the page filter. See .mb-glitching in mewbeat.css.
export function useGlitchPage(active) {
  useEffect(() => {
    if (!active) return undefined;
    const root = document.documentElement;
    root.classList.add("mb-glitching");
    return () => {
      root.classList.remove("mb-glitching");
      root.style.removeProperty("--mb-slip");
    };
  }, [active]);
}
