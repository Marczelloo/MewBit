const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let pick;

test.before(async () => {
  pick = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/modifierPick.js")).href);
});

test("picking one modifier of a group unpicks the other", () => {
  assert.deepEqual(pick.toggleModifier(["nf"], "ol", { mode: "solo" }), ["ol"]);
  assert.deepEqual(pick.toggleModifier(["fs", "gn"], "ss", { mode: "solo" }), ["gn", "ss"]);
});

test("picking a picked modifier clears it", () => {
  assert.deepEqual(pick.toggleModifier(["nf", "gn"], "nf", { mode: "room" }), ["gn"]);
  assert.deepEqual(pick.toggleModifier(["gn"], "gn", { mode: "room" }), []);
});

test("modifiers outside a group stack, and the list comes back in MODIFIERS order", () => {
  assert.deepEqual(pick.toggleModifier(["st"], "gn", { mode: "room" }), ["gn", "st"]);
  assert.deepEqual(pick.toggleModifier(["mr", "st"], "nf", { mode: "room" }), ["nf", "st", "mr"]);
});

test("a speed modifier does nothing outside solo", () => {
  assert.deepEqual(pick.toggleModifier(["gn"], "fs", { mode: "room" }), ["gn"]);
  assert.deepEqual(pick.toggleModifier([], "ss", { mode: "live" }), []);
});

test("an unknown id changes nothing", () => {
  assert.deepEqual(pick.toggleModifier(["gn"], "zz", { mode: "solo" }), ["gn"]);
});

test("sanitizeModifiers drops what the mode refuses and a second pick of a group", () => {
  assert.deepEqual(pick.sanitizeModifiers(["fs", "gn", "zz"], { mode: "room" }), ["gn"]);
  assert.deepEqual(pick.sanitizeModifiers(["ol", "nf", "sf", "fs"], { mode: "solo" }), ["nf", "fs"]);
  assert.deepEqual(pick.sanitizeModifiers(undefined, { mode: "solo" }), []);
  assert.deepEqual(pick.sanitizeModifiers("gn", { mode: "solo" }), []);
});

test("a group of the picker holds its modifiers in order", () => {
  assert.deepEqual(pick.modifiersOfGroup("fail").map((modifier) => modifier.id), ["nf", "ol", "fl"]);
  assert.deepEqual(pick.modifiersOfGroup("notes").map((modifier) => modifier.id), ["gn", "st", "nc", "mr"]);
  assert.deepEqual(pick.modifiersOfGroup("speed").map((modifier) => modifier.id), ["fs", "sf", "ss"]);
});

test("bonus and multiplier labels", () => {
  assert.equal(pick.bonusLabel(0.08), "+8%");
  assert.equal(pick.bonusLabel(-0.3), "−30%");
  assert.equal(pick.bonusLabel(0), "±0");
  assert.equal(pick.multiplierLabel([]), "×1.00");
  assert.equal(pick.multiplierLabel(["gn", "st"]), "×1.28");
  assert.equal(pick.multiplierLabel(["ss"]), "×0.60");
});

test("roomModifiersToSend returns the room-legal list only when the member differs", () => {
  assert.deepEqual(pick.roomModifiersToSend(["gn", "st"], []), ["gn", "st"]);
  assert.equal(pick.roomModifiersToSend(["gn", "st"], ["gn", "st"]), null);
  assert.equal(pick.roomModifiersToSend([], undefined), null);
  // clearing the picks is a difference too: an empty list goes out
  assert.deepEqual(pick.roomModifiersToSend([], ["gn"]), []);
  // speed is solo only, so a saved speed pick never reaches the room
  assert.equal(pick.roomModifiersToSend(["fs"], []), null);
  assert.deepEqual(pick.roomModifiersToSend(["fs", "gn"], []), ["gn"]);
});
