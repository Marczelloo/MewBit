const assert = require("node:assert/strict");
const test = require("node:test");

const { Collection, Status } = require("discord.js");
const { updateBotStatus } = require("../../../helpers/announcements/announcer");

function fakeClient(shardStatus) {
  const activities = [];
  return {
    activities,
    guilds: { cache: new Collection() },
    users: { cache: new Collection() },
    ws: { shards: new Collection([[0, { id: 0, status: shardStatus }]]) },
    user: { setActivity: (line) => activities.push(line) },
  };
}

test("presence rotation sends a line while the shard is ready", () => {
  const client = fakeClient(Status.Ready);
  updateBotStatus(client);
  assert.equal(client.activities.length, 1);
});

test("presence rotation queues nothing while the shard is reconnecting", () => {
  const client = fakeClient(Status.Reconnecting);
  updateBotStatus(client);
  assert.equal(client.activities.length, 0);
});
