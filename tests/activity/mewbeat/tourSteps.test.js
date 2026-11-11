const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let steps;

test.before(async () => {
  steps = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/tour/steps.js")).href);
});

const SRC = path.resolve(__dirname, "../../../activity/src");
const KEYS = ["D", "F", "J", "K"];
const MAIN = [
  "welcome", "solo", "list", "links", "charting", "levels", "modifiers", "live", "room",
  "lobby-players", "lobby-queue", "lobby-invite", "report",
];
const CONTROLS = ["keys", "health", "fever", "pause", "setkeys", "offset", "sound"];
const IDS = [...MAIN, "fork", ...CONTROLS, "end", "after-sorry", "after-bye"];
const byId = (id) => steps.TOUR_STEPS[steps.stepIndex(id)];
const read = (...parts) => fs.readFileSync(path.join(SRC, ...parts), "utf8");

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(jsx?|tsx?)$/.test(entry.name) ? [full] : [];
  });
}

test("the tour has its steps in the agreed order, each with its own id", () => {
  const { TOUR_STEPS } = steps;
  assert.deepEqual(TOUR_STEPS.map((s) => s.id), IDS);
  assert.equal(new Set(IDS).size, IDS.length);
  assert.deepEqual(
    TOUR_STEPS.map((s) => s.target),
    [
      null, "solo", "list", "search", "track", "diff", "modifiers", "live", "room",
      "lobby-players", "lobby-queue", "lobby-invite", "report", null,
      "keys", "health", "fever", "pause", "setkeys", "offset", "sound", null,
      null, null,
    ],
  );
});

test("the first part runs from welcome to the fork, the controls from the fork to the end", () => {
  const { FORK_INDEX, END_INDEX, stepIndex } = steps;
  assert.equal(stepIndex("welcome"), 0);
  assert.equal(FORK_INDEX, stepIndex("report") + 1);
  assert.equal(stepIndex("keys"), FORK_INDEX + 1);
  assert.equal(END_INDEX, stepIndex("sound") + 1);
  assert.equal(stepIndex("after-sorry"), END_INDEX + 1);
  // What the second part used to carry is told before the first map.
  for (const id of ["links", "charting", "modifiers", "report"]) assert.ok(stepIndex(id) < FORK_INDEX, id);
});

test("steps without a target show the full-size pose, and only those", () => {
  const { TOUR_STEPS } = steps;
  assert.deepEqual(TOUR_STEPS.filter((s) => s.pose).map((s) => s.id), ["welcome", "fork", "end", "after-sorry", "after-bye"]);
  assert.deepEqual(["welcome", "fork", "end", "after-bye"].map((id) => byId(id).pose), ["reveal", "neutral", "go", "wave"]);
  for (const s of TOUR_STEPS) assert.equal(s.side == null, s.target == null, `${s.id}: side goes with the target`);
});

test("portraits: small pose in the popup, none on the step before the test map", () => {
  for (const s of steps.TOUR_STEPS) {
    if (s.id === "end") assert.equal(s.portrait, null);
    else assert.ok(s.portrait, `${s.id} has a portrait`);
  }
});

test("the levels step spotlights the leaderboard too, the lobby steps their second parts", () => {
  const { TOUR_STEPS } = steps;
  assert.equal(byId("levels").also, "board");
  assert.equal(byId("lobby-players").also, "lobby-ready");
  assert.equal(byId("lobby-queue").also, "lobby-levels");
  assert.equal(TOUR_STEPS.filter((s) => s.also).length, 3);
});

test("each step runs on its screen: song select, the sample room, the play screen", () => {
  const views = Object.fromEntries(steps.TOUR_STEPS.map((s) => [s.id, s.view]));
  for (const id of MAIN.filter((m) => !m.startsWith("lobby-"))) assert.equal(views[id], "select", id);
  for (const id of ["fork", "after-sorry", "after-bye"]) assert.equal(views[id], "select", id);
  for (const id of ["lobby-players", "lobby-queue", "lobby-invite"]) assert.equal(views[id], "lobby", id);
  for (const id of [...CONTROLS, "end"]) assert.equal(views[id], "play", id);
});

test("only the settings steps open a Settings group, only the report step the game menu", () => {
  const { TOUR_STEPS } = steps;
  assert.deepEqual(
    TOUR_STEPS.filter((s) => s.settings).map((s) => [s.id, s.settings]),
    [["setkeys", "gameplay"], ["offset", "sync"], ["sound", "sound"]],
  );
  assert.deepEqual(TOUR_STEPS.filter((s) => s.menu).map((s) => s.id), ["report"]);
});

test("counters are computed from the list: one run before the fork, one in the controls, none elsewhere", () => {
  const { TOUR_STEPS } = steps;
  assert.deepEqual(MAIN.map((id) => byId(id).count), MAIN.map((_, i) => `${i + 1}/${MAIN.length}`));
  assert.deepEqual(CONTROLS.map((id) => byId(id).count), CONTROLS.map((_, i) => `${i + 1}/${CONTROLS.length}`));
  for (const id of ["fork", "end", "after-sorry", "after-bye"]) assert.equal(byId(id).count, null, id);
  assert.equal(TOUR_STEPS.filter((s) => s.count !== null).length, MAIN.length + CONTROLS.length);
  // The totals in the strings match the runs, so a new step cannot leave a stale "n/10".
  assert.equal(byId("welcome").count, "1/13");
  assert.equal(byId("report").count, "13/13");
  assert.equal(byId("keys").count, "1/7");
  assert.equal(byId("sound").count, "7/7");
});

test("buttons default to Next and Skip, with the special steps", () => {
  const special = {
    welcome: ["Show me around", "Skip"],
    fork: ["Show me the controls", "Skip to the game"],
    end: ["Let's go", "Skip"],
    "after-bye": ["Let's play", null],
  };
  for (const s of steps.TOUR_STEPS) assert.deepEqual([s.primary, s.secondary], special[s.id] ?? ["Next", "Skip"], s.id);
});

test("the fork and the end are found by id", () => {
  const { AFTER_INDEX, END_INDEX, FORK_INDEX, stepIndex } = steps;
  assert.equal(FORK_INDEX, stepIndex("fork"));
  assert.equal(END_INDEX, stepIndex("end"));
  assert.equal(AFTER_INDEX, stepIndex("after-sorry"));
  assert.equal(byId("fork").target, null);
  assert.equal(byId("fork").primary, "Show me the controls");
  assert.match(byId("end").say, /Settings/);
});

test("tourNext walks the first part to its end and stops there", () => {
  const { END_INDEX, FORK_INDEX, tourNext } = steps;
  for (let i = 0; i < END_INDEX; i += 1) assert.equal(tourNext(i), i + 1, `step ${i}`);
  assert.equal(tourNext(END_INDEX), null, "the first part ends at end");
  assert.equal(tourNext(FORK_INDEX), FORK_INDEX + 1, "Show me the controls goes on to the keys");
});

test("the second part is exactly sorry, then bye, and nothing else", () => {
  const { AFTER_INDEX, END_INDEX, TOUR_STEPS, stepIndex, tourNext } = steps;
  assert.deepEqual(TOUR_STEPS.slice(END_INDEX + 1).map((s) => s.id), ["after-sorry", "after-bye"]);
  assert.equal(AFTER_INDEX, stepIndex("after-sorry"));
  assert.equal(tourNext(AFTER_INDEX), stepIndex("after-bye"));
  assert.equal(tourNext(stepIndex("after-bye")), null);
  assert.equal(stepIndex("after-bye"), TOUR_STEPS.length - 1);
  assert.equal(steps.AFTER_NO_TRAP_INDEX, undefined, "no second part without the trap");
  assert.match(byId("after-sorry").say, /sorry/);
  assert.match(byId("after-bye").say, /Have fun/);
  for (const id of ["after-sorry", "after-bye"]) assert.equal(byId(id).target, null, id);
});

test("the second part is scheduled only by the trap's calm map, never by a plain end of the tour", () => {
  const game = read("mewbeat", "MewbeatGame.jsx");
  const assigned = [...game.matchAll(/afterDueRef\.current = ([^;]+);/g)].map((m) => m[1].trim().split(" ")[0]);
  assert.deepEqual([...new Set(assigned)].sort(), ["AFTER_INDEX", "null"]);
  assert.equal(game.match(/afterDueRef\.current = AFTER_INDEX/g).length, 1);
  // That one assignment sits in playCalm, which the trap's "rude" calls.
  assert.match(game, /const playCalm = useCallback\(\(song\) => \{[^}]*afterDueRef\.current = AFTER_INDEX;/);
  assert.ok(!game.includes("AFTER_NO_TRAP_INDEX"));
  // "Let's go" without a trap still opens Solo, and schedules nothing.
  assert.match(game, /endTour\(\);\s*if \(tour === END_INDEX\) setMode\("solo"\);/);
});

test("every target and also id of a step is a data-tour anchor somewhere in the activity source", () => {
  const all = sourceFiles(SRC).map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const literal = new Set([...all.matchAll(/data-tour="([a-z-]+)"/g)].map((m) => m[1]));
  // Anchors set from a variable: the mode buttons (data-tour={id}) and the level board (its `tour` prop).
  assert.match(read("mewbeat", "MewbeatGame.jsx"), /data-tour=\{id\}/);
  for (const id of ["solo", "live", "room"]) assert.match(read("mewbeat", "MewbeatGame.jsx"), new RegExp(`id: "${id}"`), id);
  assert.match(read("mewbeat", "LevelBoard.jsx"), /data-tour=\{tour\}/);
  assert.match(read("mewbeat", "SongSelect.jsx"), /tour="board"/);
  for (const id of ["solo", "live", "room", "board"]) literal.add(id);
  for (const s of steps.TOUR_STEPS) {
    for (const id of [s.target, s.also]) {
      if (id) assert.ok(literal.has(id), `${s.id}: no data-tour="${id}" in activity/src`);
    }
  }
});

test("the tour song select shows the picker inert: a no-op handler and no picks", () => {
  const game = read("mewbeat", "MewbeatGame.jsx");
  assert.match(game, /modifiers=\{touring \? NO_MODIFIERS : playerModifiers\}/);
  assert.match(game, /onModifiers=\{touring \? NOOP : saveModifiers\}/);
});

test("the links step names only the platform whose links were seen to load, and the two limits", () => {
  const say = byId("links").say;
  assert.match(say, /links/);
  assert.ok(say.includes("YouTube"));
  // Spotify and SoundCloud links depend on provider keys the Lavalink node may not have.
  for (const platform of ["Spotify", "SoundCloud"]) assert.ok(!say.includes(platform), platform);
  assert.match(say, /20 minutes/);
  assert.match(say, /live streams/);
});

test("the charting step owns up to the generator and says the first time takes a moment", () => {
  const say = byId("charting").say;
  assert.match(say, /generator/);
  assert.match(say, /first time takes a moment/);
  assert.match(say, /not every map is perfect/i);
});

test("the modifier step names what the picker offers and how a score changes", () => {
  const say = byId("modifiers").say;
  assert.match(say, /multiplier/);
  assert.match(say, /solo only/);
  assert.match(say, /board/);
  for (const name of ["One Life", "Ghost Notes", "Strict Timing"]) assert.ok(say.includes(name), name);
});

test("the report step points at the menu entry", () => {
  const say = byId("report").say;
  assert.match(say, /Report/);
  assert.match(say, /song/);
  assert.match(say, /still growing/);
});

test("the controls steps tell what the code does: holds, health, fever, pause", () => {
  assert.match(steps.tourText(byId("keys"), KEYS), /holds: keep the key down/);
  assert.match(byId("health").say, /half full/);
  assert.match(byId("health").say, /run is over/);
  assert.match(byId("fever").say, /Space/);
  assert.match(byId("fever").say, /8 seconds of double points/);
  assert.match(byId("pause").say, /Esc/);
  assert.match(byId("pause").say, /Live and rooms/);
});

test("the numbers the controls steps quote are the game's", () => {
  const scoring = read("mewbeat", "scoring.js");
  assert.match(scoring, /FEVER_MS = 8000/);
  assert.match(scoring, /HEALTH_START/);
  // The tour shows the health bar on its own step only, as an empty run's half.
  assert.match(read("mewbeat", "MewbeatGame.jsx"), /tourStep\?\.id === "health"/);
  assert.match(read("mewbeat", "useMewbeatGame.js"), /health: 0\.5,/);
});

test("the keys step names the player's own keys, the others are plain text", () => {
  const { tourText, TOUR_STEPS } = steps;
  assert.match(tourText(byId("keys"), KEYS), /^Notes fall to the line\. Press D, F, J or K as they land\./);
  assert.match(tourText(byId("keys"), ["A", "S", "L", ";"]), /^Notes fall to the line\. Press A, S, L or ; as they land\./);
  for (const s of TOUR_STEPS) {
    const text = tourText(s, KEYS);
    assert.equal(typeof text, "string");
    assert.ok(text.length > 10, `${s.id} has text`);
  }
  assert.equal(tourText(byId("solo"), KEYS), "Solo is just you. Pick any song and it plays right here.");
});

test("tourText falls back to the default keys when none are given", () => {
  const { tourText } = steps;
  assert.match(tourText(byId("keys")), /^Notes fall to the line\. Press D, F, J or K as they land\./);
  assert.match(tourText(byId("keys"), []), /^Notes fall to the line\. Press D, F, J or K as they land\./);
});
