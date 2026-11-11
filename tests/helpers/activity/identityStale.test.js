const assert = require("node:assert/strict");
const test = require("node:test");
const { fetchDiscordUser } = require("../../../helpers/activity/server");

const MINUTE = 60_000;

// Discord as the test wants it: `answer()` is a Response-like object or throws like a dead network.
function withDiscord(run) {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  const world = { now: 1_000_000, answer: null, calls: 0 };
  Date.now = () => world.now;
  globalThis.fetch = async (url, options) => {
    if (String(url) !== "https://discord.com/api/v10/users/@me") return realFetch(url, options);
    world.calls += 1;
    return world.answer();
  };
  return run(world).finally(() => {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  });
}

const ok = (id) => () => ({ ok: true, status: 200, json: async () => ({ id, username: `user-${id}`, discriminator: "0" }) });
const status = (code) => () => ({ ok: false, status: code, json: async () => ({}) });
const dead = () => { throw new TypeError("fetch failed"); };

test("an identity Discord vouched for survives a short outage, and only an outage", () => withDiscord(async (world) => {
  world.answer = ok("1");
  assert.equal((await fetchDiscordUser("token-stale-a")).id, "1");

  // Within the cache time Discord is not asked at all.
  world.answer = dead;
  world.now += 2 * MINUTE;
  assert.equal((await fetchDiscordUser("token-stale-a")).id, "1");
  assert.equal(world.calls, 1);

  // Past it, with Discord unreachable, a timeout, 429 or 5xx: still the same person.
  world.now += 4 * MINUTE;
  assert.equal((await fetchDiscordUser("token-stale-a")).id, "1");
  world.answer = status(503);
  assert.equal((await fetchDiscordUser("token-stale-a")).id, "1");
  world.answer = status(429);
  assert.equal((await fetchDiscordUser("token-stale-a")).id, "1");

  // Discord saying no is not an outage: the token is refused.
  world.answer = status(401);
  await assert.rejects(fetchDiscordUser("token-stale-a"), /authentication expired/);

  // An hour after the last good answer the old identity is not trusted any more.
  world.answer = dead;
  world.now += 61 * MINUTE;
  await assert.rejects(fetchDiscordUser("token-stale-a"), /fetch failed/);
}));

test("a token Discord never vouched for gets nothing from an outage", () => withDiscord(async (world) => {
  world.answer = dead;
  await assert.rejects(fetchDiscordUser("token-stale-unknown"), /fetch failed/);
  world.answer = status(503);
  await assert.rejects(fetchDiscordUser("token-stale-unknown"), /authentication expired/);
}));
