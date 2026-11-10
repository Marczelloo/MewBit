const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let tw;

test.before(async () => {
  tw = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/tour/typewriter.js")).href);
});

// A deterministic stand-in for Math.random, cycling through values.
const cycle = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

test("every character appears in order, about 28 ms apart", () => {
  const plan = tw.typingPlan("abcdef", cycle(0));
  assert.equal(plan.length, 6);
  assert.deepEqual(plan.map((p) => p.shown), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(plan.map((p) => p.at), [28, 56, 84, 112, 140, 168]);
});

test("a mark pauses the next character, and a run of marks pauses once", () => {
  const plan = tw.typingPlan("hi. ok...!? x,y", cycle(0));
  // "hi. ok...!? x,y": indexes 0..14; step(i) is the wait before character i.
  const step = (i) => plan[i].at - plan[i - 1].at;
  assert.equal(step(3), tw.TYPE_MS + tw.PAUSE_MS["."]); // after "hi."
  for (const i of [5, 7, 8, 9, 10]) assert.equal(step(i), tw.TYPE_MS, `inside the run, step ${i}`);
  assert.equal(step(11), tw.TYPE_MS + tw.PAUSE_MS["?"]); // after "...!?" once
  assert.equal(step(14), tw.TYPE_MS + tw.PAUSE_MS[","]); // a comma pauses less
  assert.ok(tw.PAUSE_MS[","] < tw.PAUSE_MS["."]);
});

test("blips fall on every 2nd or 3rd letter or digit, never on spaces or punctuation", () => {
  const text = "hello there, 42 cats! nya~ wow...";
  for (const random of [cycle(0), cycle(0.99), cycle(0, 0.99), cycle(0.3, 0.7, 0.1)]) {
    const plan = tw.typingPlan(text, random);
    const chars = Array.from(text);
    let gap = 0;
    let blips = 0;
    plan.forEach((item, i) => {
      if (/[\p{L}\p{N}]/u.test(chars[i])) gap += 1;
      if (item.blip) {
        assert.match(chars[i], /[\p{L}\p{N}]/u, `blip on ${JSON.stringify(chars[i])}`);
        assert.ok(gap === 2 || gap === 3, `gap ${gap}`);
        gap = 0;
        blips += 1;
      }
    });
    assert.ok(blips >= 5, `blips ${blips}`);
  }
});

test("text with nothing to say gives an empty plan, and astral characters count once", () => {
  assert.deepEqual(tw.typingPlan(""), []);
  assert.deepEqual(tw.typingPlan(undefined), []);
  assert.equal(tw.typingPlan("a\u{1F63A}b").length, 3);
});

test("a blip's pitch stays between 1.5 and 1.9 at a quiet level", () => {
  assert.deepEqual(tw.blipOptions(() => 0), { level: tw.BLIP.level, rate: 1.5 });
  assert.ok(Math.abs(tw.blipOptions(() => 1).rate - 1.9) < 1e-9);
  assert.ok(tw.BLIP.level <= 0.3);
  assert.equal(tw.BLIP.sound, "dink");
});

test("splitTyped cuts tone pieces at the typed count and keeps the rest", () => {
  const parts = [{ text: "vibes: ", tone: null }, { text: "immaculate", tone: "cyan" }, { text: " ok", tone: null }];
  assert.deepEqual(tw.splitTyped(parts, 0).map((p) => p.text), ["", "", ""]);
  assert.deepEqual(tw.splitTyped(parts, 10), [
    { tone: null, text: "vibes: ", rest: "" },
    { tone: "cyan", text: "imm", rest: "aculate" },
    { tone: null, text: "", rest: " ok" },
  ]);
  const all = tw.splitTyped(parts, tw.lengthOf(parts));
  assert.equal(all.map((p) => p.text).join(""), "vibes: immaculate ok");
  assert.ok(all.every((p) => p.rest === ""));
  assert.equal(tw.lengthOf(parts), 20);
  assert.equal(tw.splitTyped(parts, 999).map((p) => p.rest).join(""), "");
});
