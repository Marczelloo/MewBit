// Polish names, number/time formatting and binary search. No state here.

export const LEVELS = ["easy", "normal", "hard", "hell"];

export const STAGES = {
  gridLevel: "poziom wg siatki",
  level: "poza poziomem trudności",
  fastQuarter: "ćwierćnuta w szybkim utworze",
  leadIn: "przed startem chartu",
  silence: "cisza w utworze",
  thinChords: "przerzedzanie akordów",
  capMoments: "limit nut w jednej chwili",
  jacks: "limit jacków",
  floors: "minimalne odstępy",
  spaceChords: "odstępy akordów",
  planHolds: "plan holdów",
  groove: "powtórka układu taktu",
  orientDrums: "ułożenie perkusji",
  gapHolds: "holdy w pauzach",
  fillGaps: "wypełnienie perkusją",
  fillRests: "dźwięk w pauzie",
  hands: "balans rąk",
  spreadLanes: "rozkład na pasy",
  bandPath: "ścieżka po pasmach",
  sustainHolds: "holdy z długich dźwięków",
  clipHolds: "skracanie holdów",
  finalFloors: "końcowe odstępy",
  oneHold: "jeden hold naraz",
  holdShare: "limit udziału holdów",
};

export const RULES = {
  noteGap: "za blisko poprzedniej nuty",
  beatGap: "za blisko w uderzeniach",
  laneGap: "ten sam pas za szybko",
  sameSpot: "w tym miejscu jest już nuta",
  density: "za gęsto (limit nut na sekundę)",
};

export const KINDS = {
  event: "z dźwięku muzyki",
  copy: "kopia wcześniejszej frazy",
  bandPath: "ścieżka po pasmach",
  fillGaps: "wypełnienie perkusją pauzy",
  fillRests: "dźwięk w pauzie",
  gapHolds: "hold w pauzie",
  sustainHolds: "hold z długiego dźwięku",
};

export const KIND_SHORT = {
  event: "dźwięk",
  copy: "kopia",
  bandPath: "pasma",
  fillGaps: "perkusja w pauzie",
  fillRests: "dźwięk w pauzie",
};

export const SOURCES = { bass: "bas", drums: "perkusja", lead: "melodia (lead)", bands: "pasma" };

export const stageName = (s) => STAGES[s] ?? s;
export const ruleName = (r) => RULES[r] ?? r;
export const kindName = (k) => KINDS[k] ?? k;
export const sourceName = (s) => SOURCES[s] ?? s;

// "odstęp 120 ms, wymagane 240 ms" and friends.
export function ruleText(why) {
  if (!why) return "";
  const parts = [];
  if (why.dtMs != null) parts.push(`odstęp ${Math.round(why.dtMs)} ms`);
  if (why.needMs != null) parts.push(`wymagane ${Math.round(why.needMs)} ms`);
  for (const [k, v] of Object.entries(why)) {
    if (["rule", "t", "lane", "dtMs", "needMs"].includes(k)) continue;
    parts.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
  }
  const base = ruleName(why.rule);
  return parts.length ? `${base} (${parts.join(", ")})` : base;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// m:ss.mmm
export function fmt(ms, decimals = true) {
  if (ms == null || !isFinite(ms)) return "–";
  const neg = ms < 0;
  const total = Math.round(Math.abs(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const r = total % 1000;
  return `${neg ? "-" : ""}${m}:${String(s).padStart(2, "0")}${decimals ? "." + String(r).padStart(3, "0") : ""}`;
}

// "1:36", "1:36.5", "96.5", "96500ms", "1:02:03" -> ms, or null.
export function parseTime(text) {
  let s = String(text ?? "").trim().replace(",", ".");
  if (!s) return null;
  const msMatch = /^(-?\d+(?:\.\d+)?)\s*ms$/i.exec(s);
  if (msMatch) return Math.round(Number(msMatch[1]));
  s = s.replace(/s$/i, "");
  const parts = s.split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + Number(p);
  return Math.round(sec * 1000);
}

const byT = (x) => x.t;

// First index whose key is >= t.
export function lowerBound(arr, t, key = byT) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export function sortedByT(arr) {
  const out = Array.isArray(arr) ? arr.slice() : [];
  let sorted = true;
  for (let i = 1; i < out.length; i++) if (out[i].t < out[i - 1].t) { sorted = false; break; }
  if (!sorted) out.sort((a, b) => a.t - b.t);
  let maxLen = 0;
  for (const n of out) if ((n.len ?? 0) > maxLen) maxLen = n.len;
  out.maxLen = maxLen;
  return out;
}
