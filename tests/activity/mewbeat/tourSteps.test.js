const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let steps;

test.before(async () => {
  steps = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/tour/steps.js")).href);
});

const KEYS = ["D", "F", "J", "K"];
const IDS = [
  "welcome", "solo", "list", "charting", "levels", "live", "room", "lobby-players", "lobby-queue", "lobby-invite", "fork",
  "keys", "setkeys", "offset", "sound", "end", "after-sorry", "after-generator", "after-modifiers", "after-links", "after-report", "after-bye",
];
const byId = (id) => steps.TOUR_STEPS[steps.stepIndex(id)];

test("the tour has its steps in the agreed order, each with its own id", () => {
  const { TOUR_STEPS } = steps;
  assert.deepEqual(TOUR_STEPS.map((s) => s.id), IDS);
  assert.deepEqual(
    TOUR_STEPS.map((s) => s.target),
    [null, "solo", "list", "track", "diff", "live", "room", "lobby-players", "lobby-queue", "lobby-invite", null, "keys", "setkeys", "offset", "sound", null, null, null, "modifiers", "search", "report", null],
  );
});

test("steps without a target show the full-size pose, and only those", () => {
  const { TOUR_STEPS } = steps;
  const bare = ["welcome", "fork", "end", "after-sorry", "after-generator", "after-bye"];
  assert.deepEqual(TOUR_STEPS.filter((s) => s.pose).map((s) => s.id), bare);
  assert.deepEqual(["welcome", "fork", "end"].map((id) => byId(id).pose), ["reveal", "neutral", "go"]);
  for (const s of TOUR_STEPS) assert.equal(s.side == null, s.target == null, `${s.id}: side goes with the target`);
});

test("portraits: small pose in the popup, none on the step before the test map", () => {
  const { TOUR_STEPS } = steps;
  for (const s of TOUR_STEPS) {
    if (s.id === "end") assert.equal(s.portrait, null);
    else assert.ok(s.portrait, `${s.id} has a portrait`);
  }
});

test("the levels step spotlights the leaderboard too, the lobby steps their second parts", () => {
  const { TOUR_STEPS } = steps;
  assert.equal(byId("levels").target, "diff");
  assert.equal(byId("levels").also, "board");
  assert.equal(byId("lobby-players").also, "lobby-ready");
  assert.equal(byId("lobby-queue").also, "lobby-levels");
  assert.equal(TOUR_STEPS.filter((s) => s.also).length, 3);
});

test("each step runs on its screen: song select, the sample room, the play screen", () => {
  const { TOUR_STEPS } = steps;
  const views = Object.fromEntries(TOUR_STEPS.map((s) => [s.id, s.view]));
  for (const id of ["welcome", "solo", "list", "charting", "levels", "live", "room", "fork", "after-sorry", "after-generator", "after-modifiers", "after-links", "after-report", "after-bye"]) {
    assert.equal(views[id], "select", id);
  }
  for (const id of ["lobby-players", "lobby-queue", "lobby-invite"]) assert.equal(views[id], "lobby", id);
  for (const id of ["keys", "setkeys", "offset", "sound", "end"]) assert.equal(views[id], "play", id);
});

test("the song list step comes right after solo and says what the list is", () => {
  const { stepIndex } = steps;
  assert.equal(stepIndex("list"), stepIndex("solo") + 1);
  assert.match(byId("list").say, /stars/);
  assert.match(byId("list").say, /best grade/);
});

test("the room screen follows the room tab, with the sample room's three parts", () => {
  const { stepIndex } = steps;
  assert.equal(stepIndex("lobby-players"), stepIndex("room") + 1);
  assert.equal(stepIndex("fork"), stepIndex("lobby-invite") + 1);
  assert.equal(byId("lobby-players").target, "lobby-players");
  assert.equal(byId("lobby-invite").target, "lobby-invite");
});

test("only the settings steps open a Settings group", () => {
  const { TOUR_STEPS } = steps;
  assert.deepEqual(
    TOUR_STEPS.filter((s) => s.settings).map((s) => [s.id, s.settings]),
    [["setkeys", "gameplay"], ["offset", "sync"], ["sound", "sound"]],
  );
});

test("only the report step opens the game menu", () => {
  const { TOUR_STEPS } = steps;
  assert.deepEqual(TOUR_STEPS.filter((s) => s.menu).map((s) => s.id), ["after-report"]);
});

test("counts follow the two runs, with none on the fork, the end and the second part", () => {
  const { TOUR_STEPS } = steps;
  const counts = Object.fromEntries(TOUR_STEPS.map((s) => [s.id, s.count ?? null]));
  const main = ["welcome", "solo", "list", "charting", "levels", "live", "room", "lobby-players", "lobby-queue", "lobby-invite"];
  assert.deepEqual(main.map((id) => counts[id]), main.map((_, i) => `${i + 1}/10`));
  assert.deepEqual(["keys", "setkeys", "offset", "sound"].map((id) => counts[id]), ["1/4", "2/4", "3/4", "4/4"]);
  for (const id of ["fork", "end", "after-sorry", "after-generator", "after-modifiers", "after-links", "after-report", "after-bye"]) assert.equal(counts[id], null, id);
});

test("buttons default to Next and Skip, with the special steps", () => {
  const { TOUR_STEPS } = steps;
  const special = {
    welcome: ["Show me around", "Skip"],
    fork: ["Show me the controls", "Skip to the game"],
    end: ["Let's go", "Skip"],
    "after-report": ["Got it", null],
    "after-bye": ["Let's play", null],
  };
  for (const s of TOUR_STEPS) assert.deepEqual([s.primary, s.secondary], special[s.id] ?? ["Next", "Skip"], s.id);
});

test("the fork and the end are found by id", () => {
  const { AFTER_INDEX, END_INDEX, FORK_INDEX, stepIndex } = steps;
  assert.equal(FORK_INDEX, stepIndex("fork"));
  assert.equal(END_INDEX, stepIndex("end"));
  assert.equal(AFTER_INDEX, stepIndex("after-sorry"));
  assert.equal(byId("fork").target, null);
  assert.equal(byId("fork").primary, "Show me the controls");
  assert.match(byId("end").say, /Settings/);
  assert.ok(stepIndex("end") < stepIndex("after-sorry"));
});

test("tourNext walks each part and stops at its end: the second part never follows the first by itself", () => {
  const { AFTER_INDEX, AFTER_NO_TRAP_INDEX, END_INDEX, TOUR_STEPS, stepIndex, tourNext } = steps;
  assert.equal(tourNext(0), 1);
  assert.equal(tourNext(END_INDEX), null);
  assert.equal(AFTER_NO_TRAP_INDEX, stepIndex("after-generator"));
  assert.equal(tourNext(AFTER_INDEX), AFTER_NO_TRAP_INDEX);
  assert.equal(tourNext(stepIndex("after-generator")), stepIndex("after-modifiers"));
  assert.equal(tourNext(stepIndex("after-modifiers")), stepIndex("after-links"));
  assert.equal(tourNext(stepIndex("after-links")), stepIndex("after-report"));
  assert.equal(tourNext(stepIndex("after-report")), stepIndex("after-bye"));
  assert.equal(tourNext(TOUR_STEPS.length - 1), null);
  assert.equal(TOUR_STEPS.length - 1, stepIndex("after-bye"));
});

test("the second part says sorry, owns up to the generator and points at the report entry", () => {
  assert.match(byId("after-sorry").say, /sorry/);
  assert.match(byId("after-generator").say, /generator/);
  assert.match(byId("after-report").say, /Report/);
  assert.match(byId("after-report").say, /song/);
  assert.match(byId("after-report").say, /still growing/);
  assert.match(byId("after-bye").say, /Have fun/);
  assert.equal(byId("after-bye").pose, "wave");
});

test("the modifier and link steps sit in the second part, before the report entry, on song select", () => {
  const { stepIndex, END_INDEX } = steps;
  assert.ok(stepIndex("after-generator") < stepIndex("after-modifiers"));
  assert.equal(stepIndex("after-links"), stepIndex("after-modifiers") + 1);
  assert.equal(stepIndex("after-report"), stepIndex("after-links") + 1);
  assert.ok(stepIndex("after-modifiers") > END_INDEX, "not in the first part");
  for (const id of ["after-modifiers", "after-links"]) {
    assert.equal(byId(id).view, "select", id);
    assert.ok(byId(id).portrait, id);
    assert.ok(byId(id).side, id);
  }
});

test("the modifier step names what the picker offers and how a score changes", () => {
  const say = byId("after-modifiers").say;
  assert.match(say, /modifiers/i);
  assert.match(say, /multiplier/);
  assert.match(say, /solo only/);
  assert.match(say, /board/);
  for (const name of ["One Life", "Ghost Notes", "Strict Timing"]) assert.ok(say.includes(name), name);
});

test("the links step names the platforms the bot resolves and the two limits", () => {
  const say = byId("after-links").say;
  assert.match(say, /links/);
  for (const platform of ["YouTube", "Spotify", "SoundCloud"]) assert.ok(say.includes(platform), platform);
  assert.match(say, /20 minutes/);
  assert.match(say, /live streams/);
});

test("the new steps point at anchors that exist on the screen they run on", () => {
  const root = path.resolve(__dirname, "../../../activity/src/mewbeat");
  const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
  assert.ok(read("ModifierPicker.jsx").includes('data-tour="modifiers"'));
  assert.ok(read("SongSelect.jsx").includes('data-tour="search"'));
  assert.equal(byId("after-modifiers").target, "modifiers");
  assert.equal(byId("after-links").target, "search");
});

test("the tour song select shows the picker inert: a no-op handler and no picks", () => {
  const game = fs.readFileSync(path.resolve(__dirname, "../../../activity/src/mewbeat/MewbeatGame.jsx"), "utf8");
  assert.match(game, /modifiers=\{touring \? NO_MODIFIERS : playerModifiers\}/);
  assert.match(game, /onModifiers=\{touring \? NOOP : saveModifiers\}/);
});

test("the keys step names the player's own keys, the others are plain text", () => {
  const { tourText, TOUR_STEPS } = steps;
  assert.equal(tourText(byId("keys"), KEYS), "Notes fall to the line. Press D, F, J or K as they land.");
  assert.equal(tourText(byId("keys"), ["A", "S", "L", ";"]), "Notes fall to the line. Press A, S, L or ; as they land.");
  for (const s of TOUR_STEPS) {
    const text = tourText(s, KEYS);
    assert.equal(typeof text, "string");
    assert.ok(text.length > 10, `${s.id} has text`);
  }
  assert.equal(tourText(byId("solo"), KEYS), "Solo is just you. Pick any song and it plays right here.");
});

test("tourText falls back to the default keys when none are given", () => {
  const { tourText } = steps;
  assert.equal(tourText(byId("keys")), "Notes fall to the line. Press D, F, J or K as they land.");
  assert.equal(tourText(byId("keys"), []), "Notes fall to the line. Press D, F, J or K as they land.");
});
