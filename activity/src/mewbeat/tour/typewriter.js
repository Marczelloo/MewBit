// Mewbit "talks" in the tour: her line types in letter by letter, with a blip on some of the letters. This file is the
// pure part (the timing, the blips, the split between typed and not yet typed text); useTypewriter.js runs it.

// ---- PLACEHOLDER SOUND: the owner will pick the real blip. Change the sample, its level and its pitch here ---------
export const BLIP = { sound: "dink", level: 0.25, rateMin: 1.5, rateMax: 1.9 };
// -----------------------------------------------------------------------------------------------------------------

export const TYPE_MS = 28; // per character
export const PAUSE_MS = { ".": 200, "!": 200, "?": 200, ",": 110 }; // extra, after the mark (a run like "..." pauses once)
const BLIP_EVERY = [2, 3]; // a blip on every 2nd or 3rd letter or digit, at random
const SOUNDING = /[\p{L}\p{N}]/u;

// The options for one blip's playSfx: a little different in pitch each time, so a line does not drone.
export function blipOptions(random = Math.random) {
  return { level: BLIP.level, rate: BLIP.rateMin + random() * (BLIP.rateMax - BLIP.rateMin) };
}

// When each character of text appears, as { at, shown, blip } in order: at is ms from the start, shown is how many
// characters (code points) are out by then, blip says whether this one sounds. Spaces and punctuation never do.
export function typingPlan(text, random = Math.random) {
  const chars = Array.from(typeof text === "string" ? text : "");
  const plan = [];
  let pauses = 0;
  let sinceBlip = 0;
  let every = BLIP_EVERY[Math.floor(random() * BLIP_EVERY.length)];
  for (let i = 0; i < chars.length; i += 1) {
    const sounding = SOUNDING.test(chars[i]);
    let blip = false;
    if (sounding) {
      sinceBlip += 1;
      if (sinceBlip >= every) {
        blip = true;
        sinceBlip = 0;
        every = BLIP_EVERY[Math.floor(random() * BLIP_EVERY.length)];
      }
    }
    plan.push({ at: (i + 1) * TYPE_MS + pauses, shown: i + 1, blip });
    const pause = PAUSE_MS[chars[i]];
    if (pause && !(chars[i + 1] in PAUSE_MS)) pauses += pause;
  }
  return plan;
}

// The pieces of parts ({ text, tone }, as lineParts gives) cut after count characters: each piece comes back as
// { text: typed, rest: not yet typed, tone }. The sum of the lengths is the length of the whole line.
export function splitTyped(parts, count) {
  let left = Math.max(0, count);
  return parts.map((part) => {
    const chars = Array.from(part.text);
    const take = Math.min(left, chars.length);
    left -= take;
    return { tone: part.tone, text: chars.slice(0, take).join(""), rest: chars.slice(take).join("") };
  });
}

export const lengthOf = (parts) => parts.reduce((sum, part) => sum + Array.from(part.text).length, 0);
