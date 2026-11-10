const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let m;

test.before(async () => {
  m = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/modifiers.js")).href);
});

test("an empty or missing list is valid and plain", () => {
  assert.deepEqual(m.normalizeModifiers(undefined), { ok: true, modifiers: [] });
  assert.deepEqual(m.normalizeModifiers(null), { ok: true, modifiers: [] });
  assert.deepEqual(m.normalizeModifiers([]), { ok: true, modifiers: [] });
});

test("an unknown id, a non-string or a non-list is refused", () => {
  assert.deepEqual(m.normalizeModifiers(["zz"]), { ok: false, reason: "unknown_modifier" });
  assert.deepEqual(m.normalizeModifiers([5]), { ok: false, reason: "unknown_modifier" });
  assert.deepEqual(m.normalizeModifiers("nf"), { ok: false, reason: "unknown_modifier" });
});

test("two modifiers of the same group conflict", () => {
  assert.deepEqual(m.normalizeModifiers(["nf", "ol"]), { ok: false, reason: "conflict" });
  assert.deepEqual(m.normalizeModifiers(["ol", "fl"]), { ok: false, reason: "conflict" });
  assert.deepEqual(m.normalizeModifiers(["fs", "ss"], { mode: "solo" }), { ok: false, reason: "conflict" });
});

test("a speed modifier is refused outside solo", () => {
  for (const mode of ["live", "room", undefined]) {
    assert.deepEqual(m.normalizeModifiers(["fs"], { mode }), { ok: false, reason: "solo_only" });
  }
  assert.deepEqual(m.normalizeModifiers(["fs"], { mode: "solo" }), { ok: true, modifiers: ["fs"] });
});

test("the result is deduped and in list order", () => {
  const result = m.normalizeModifiers(["st", "gn", "st", "ol"], { mode: "live" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.modifiers, m.MODIFIERS.map((mod) => mod.id).filter((id) => ["gn", "st", "ol"].includes(id)));
});

test("the multiplier sums the bonuses and rounds away float noise", () => {
  assert.equal(m.modifierMultiplier([]), 1);
  assert.equal(m.modifierMultiplier(), 1);
  assert.equal(m.modifierMultiplier(["gn"]), 1.16);
  assert.equal(m.modifierMultiplier(["gn", "st"]), 1.28);
  assert.equal(m.modifierMultiplier(["ss"]), 0.6);
  assert.equal(m.modifierMultiplier(["gn", "st", "sf"]), 1.58);
  assert.equal(m.modifierMultiplier(["nf", "mr"]), 1.02);
});

test("speedOf reads the speed modifier", () => {
  assert.equal(m.speedOf([]), 1);
  assert.equal(m.speedOf(["gn"]), 1);
  assert.equal(m.speedOf(["fs"]), 1.2);
  assert.equal(m.speedOf(["sf"]), 1.5);
  assert.equal(m.speedOf(["ss"]), 0.85);
});

test("the rules version is 3", () => {
  assert.equal(m.RULES_VERSION, 3);
});

test("No Colors is known, belongs to no group and adds 0.06", () => {
  const nc = m.MODIFIERS.find((mod) => mod.id === "nc");
  assert.ok(nc);
  assert.equal(nc.group, null);
  assert.equal(nc.bonus, 0.06);
  assert.deepEqual(m.normalizeModifiers(["nc", "gn"]), { ok: true, modifiers: ["gn", "nc"] });
  assert.equal(m.modifierMultiplier(["nc"]), 1.06);
});
