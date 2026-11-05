// The whole way from a player's run to a spectator's stage: the real sender, the bot's board and the client's
// store on one clock, with the messages passing through JSON as they do on the socket.
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const { createLiveBoard } = require("../../../helpers/mewbeat/liveBoard");

let createLiveSender;
let createLiveBoardStore;
let watchedStage;

test.before(async () => {
  const load = (file) => import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat", file)).href);
  ({ createLiveSender } = await load("liveSender.js"));
  ({ createLiveBoardStore, watchedStage } = await load("liveBoard.js"));
});

// The spectator's own autoplay: vibe full, never in FEVER.
const AUTOPLAY_HUD = { vibe: 1, feverActive: false, feverLeftMs: 0 };

function setup() {
  let time = 0;
  let nextId = 1;
  const timers = new Map();
  const clock = {
    now: () => time,
    setTimer(run, ms) {
      const id = nextId++;
      timers.set(id, { at: time + ms, run });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      const target = time + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].run();
      }
      time = target;
    },
  };
  const store = createLiveBoardStore(clock);
  store.setSession("room");
  const board = createLiveBoard({
    ...clock,
    membersOf: () => [{ userId: "ann", spectator: false }, { userId: "bo", spectator: true }],
    broadcast: (guildId, userIds, payload) => {
      if (userIds.includes("bo")) store.handle(JSON.parse(JSON.stringify(payload)));
    },
  });
  const wire = (message) => board.update("g1", "ann", { username: "Ann" }, JSON.parse(JSON.stringify(message)));
  const sender = createLiveSender({ ...clock, send: wire, session: "room", audioKey: "k", difficulty: "normal" });
  const stage = () => watchedStage(AUTOPLAY_HUD, store.entries()?.find((entry) => entry.userId === "ann") ?? null);
  return { clock, sender, stage, wire };
}

const sample = (score, vibe, fever) => ({ score, combo: score, accuracy: 100, vibe, fever });

test("the stage follows the player's vibe up and through FEVER, and not the full autoplay", () => {
  const { clock, sender, stage } = setup();
  sender.update(sample(0, 0.2, false));
  clock.advance(1000);
  assert.deepEqual([stage().vibe, stage().feverActive], [0.2, false]);
  sender.update(sample(10, 1, true));
  clock.advance(500);
  assert.deepEqual([stage().vibe, stage().feverActive], [1, true]);
  sender.update(sample(10, 0, false));
  clock.advance(500);
  assert.deepEqual([stage().vibe, stage().feverActive], [0, false]);
});

test("under a constant stream of notes FEVER reaches the stage within half a second", () => {
  const { clock, sender, stage } = setup();
  let fever = false;
  let flippedAt = 0;
  let worst = 0;
  let waiting = false;
  // A flip every 1.37 s lands at a different point of both 250 ms throttles each time.
  for (let t = 0, score = 0; t < 30_000; t += 10, score += 1) {
    if (t % 1370 === 0) {
      fever = !fever;
      flippedAt = t;
      waiting = true;
    }
    sender.update(sample(score, fever ? 0.9 : 0.5, fever));
    clock.advance(10);
    if (waiting && stage().feverActive === fever) {
      worst = Math.max(worst, t + 10 - flippedAt);
      waiting = false;
    }
  }
  assert.ok(worst > 0, "no flip was measured");
  assert.ok(worst <= 500, `worst delay ${worst} ms`);
});

test("FEVER ending in a quiet stretch still reaches the stage, and a long quiet FEVER is not expired", () => {
  const { clock, sender, stage } = setup();
  sender.update(sample(50, 1, true));
  clock.advance(7000); // no notes: only the keep-alive runs, past the board's 5 s expiry
  assert.equal(stage().feverActive, true);
  sender.update(sample(50, 0, false));
  clock.advance(500);
  assert.deepEqual([stage().vibe, stage().feverActive], [0, false]);
});

test("a run that ends during FEVER leaves the spectator's stage out of FEVER", () => {
  const { clock, sender, stage } = setup();
  sender.update(sample(50, 0.5, true));
  clock.advance(500);
  sender.end(sample(60, 0.4, true));
  clock.advance(500);
  assert.equal(stage().feverActive, false);
});

test("a player on an older client leaves the spectator's stage as it was", () => {
  const { clock, wire, stage } = setup();
  assert.deepEqual(wire({ session: "room", audioKey: "k", difficulty: "normal", score: 10, combo: 1, accuracy: 100, ended: false }), { ok: true });
  clock.advance(500);
  assert.equal(stage(), AUTOPLAY_HUD);
});
