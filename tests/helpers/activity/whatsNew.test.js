const assert = require("node:assert/strict");
const test = require("node:test");

// In-memory preferences, so the test never writes the real userPreferences.json.
const stored = new Map();
const preferencesPath = require.resolve("../../../helpers/users/preferences");
const realPreferences = require(preferencesPath);
require.cache[preferencesPath] = {
  id: preferencesPath,
  filename: preferencesPath,
  loaded: true,
  exports: {
    ...realPreferences,
    getUserPreferences: (userId) => {
      if (!stored.has(userId)) stored.set(userId, {});
      return stored.get(userId);
    },
    setUserPreference: (userId, key, value) => {
      const record = { ...(stored.get(userId) || {}), [key]: value };
      stored.set(userId, record);
      return record;
    },
  },
};

const { init, getCurrentVersion } = require("../../../helpers/announcements/announcer");
const { buildActivityState, runActivityAction, serializeActivityActionResult } = require("../../../helpers/activity/server");

const client = { guilds: { cache: new Map() }, user: { presence: { activities: [] } } };
const identity = (id) => ({ id, username: "Listener", dev: true });

test.beforeEach(async () => {
  stored.clear();
  await init();
});

test("an account that has not seen the running release gets its What's new", () => {
  const { whatsNew } = buildActivityState(client, "g", "fresh");
  assert.equal(whatsNew.version, getCurrentVersion());
  assert.ok(whatsNew.title);
  assert.ok(whatsNew.summary.length > 0);
});

test("closing the window stores the release, and the state stops offering it", async () => {
  const result = await runActivityAction({ guildId: "g", identity: identity("u1"), action: "whats_new_seen", payload: { version: getCurrentVersion() } });
  assert.notEqual(serializeActivityActionResult("whats_new_seen", result)?.success, false);
  assert.equal(buildActivityState(client, "g", "u1").whatsNew, null);
});

test("a version other than the running one is not stored", async () => {
  await runActivityAction({ guildId: "g", identity: identity("u2"), action: "whats_new_seen", payload: { version: "0.0.1" } });
  assert.equal(buildActivityState(client, "g", "u2").whatsNew?.version, getCurrentVersion());
});

test("the window can be closed in a DM, where there is no server", async () => {
  await runActivityAction({ guildId: "dm:instance-1", identity: identity("u3"), action: "whats_new_seen", payload: { version: getCurrentVersion() } });
  assert.equal(buildActivityState(client, "g", "u3").whatsNew, null);
});
