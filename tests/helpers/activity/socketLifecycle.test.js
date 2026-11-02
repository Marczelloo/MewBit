const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { HEARTBEAT_MS, markAlive, releaseSession, startHeartbeat } = require("../../../helpers/activity/socketLifecycle");

function fakeSocket(extra) {
  const socket = {
    pings: 0, terminated: 0, isAlive: true, authorized: true, ...extra,
    ping() { this.pings += 1; },
    terminate() { this.terminated += 1; },
  };
  return socket;
}

// An interval that only fires when the test says so.
function fakeInterval() {
  const state = { run: null, ms: null, cleared: false, unref: false };
  return {
    state,
    setIntervalFn: (run, ms) => {
      state.run = run;
      state.ms = ms;
      return { unref() { state.unref = true; } };
    },
    clearIntervalFn: () => { state.cleared = true; },
  };
}

describe("activity socket heartbeat", () => {
  it("pings every 25 s, unref'd, and stops when asked", () => {
    const timer = fakeInterval();
    const socket = fakeSocket();
    const heartbeat = startHeartbeat({ sockets: new Set([socket]), ...timer });
    assert.equal(timer.state.ms, 25_000);
    assert.equal(HEARTBEAT_MS, 25_000);
    assert.equal(timer.state.unref, true);
    timer.state.run();
    assert.equal(socket.pings, 1);
    heartbeat.stop();
    assert.equal(timer.state.cleared, true);
  });

  it("terminates a socket that did not pong since the previous ping", () => {
    const timer = fakeInterval();
    const alive = fakeSocket();
    const dead = fakeSocket();
    startHeartbeat({ sockets: new Set([alive, dead]), ...timer });

    timer.state.run(); // both pinged, both marked as waiting
    assert.equal(alive.isAlive, false);
    markAlive(alive); // the pong
    timer.state.run();
    assert.equal(alive.terminated, 0);
    assert.equal(alive.pings, 2);
    assert.equal(dead.terminated, 1);
    assert.equal(dead.pings, 1);
  });

  it("survives a socket that throws on ping or terminate", () => {
    const timer = fakeInterval();
    const broken = fakeSocket({ ping() { throw new Error("closed"); }, terminate() { throw new Error("closed"); } });
    const fine = fakeSocket();
    startHeartbeat({ sockets: new Set([broken, fine]), ...timer });
    timer.state.run();
    timer.state.run();
    assert.equal(fine.pings, 1);
    assert.equal(fine.terminated, 1);
  });
});

describe("activity socket release", () => {
  const ann = { id: "ann" };

  it("disconnects the user when the released socket was their last window in the guild", () => {
    const socket = fakeSocket({ guildId: "g1", identity: ann });
    const calls = [];
    const released = releaseSession({
      sockets: new Set([socket]), socket, guildId: "g1", identity: ann, disconnect: (...args) => calls.push(args),
    });
    assert.equal(released, true);
    assert.deepEqual(calls, [["g1", "ann"]]);
  });

  it("keeps the user while another window of theirs is open in that guild", () => {
    const socket = fakeSocket({ guildId: "g1", identity: ann });
    const other = fakeSocket({ guildId: "g1", identity: { id: "ann" } });
    const elsewhere = fakeSocket({ guildId: "g2", identity: ann });
    const calls = [];
    assert.equal(releaseSession({
      sockets: new Set([socket, other]), socket, guildId: "g1", identity: ann, disconnect: (...args) => calls.push(args),
    }), false);
    assert.deepEqual(calls, []);
    // A window in another guild doesn't hold the seat.
    assert.equal(releaseSession({
      sockets: new Set([socket, elsewhere]), socket, guildId: "g1", identity: ann, disconnect: (...args) => calls.push(args),
    }), true);
    assert.deepEqual(calls, [["g1", "ann"]]);
  });

  it("releases the old seat of a socket that signs in again as someone else or for another guild", () => {
    // The socket already carries its new identity and guild when the old pair is released.
    const socket = fakeSocket({ guildId: "g2", identity: { id: "bo" } });
    const calls = [];
    const sockets = new Set([socket]);
    assert.equal(releaseSession({ sockets, socket, guildId: "g1", identity: ann, disconnect: (...args) => calls.push(args) }), true);
    assert.deepEqual(calls, [["g1", "ann"]]);
    // Nothing to release for a socket that was never signed in.
    assert.equal(releaseSession({ sockets, socket, guildId: undefined, identity: undefined, disconnect: () => assert.fail() }), false);
  });
});
