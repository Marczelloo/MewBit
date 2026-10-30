const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const roomHistory = require("../../../helpers/history/roomHistory");
const { serializeTrack } = require("../../../helpers/activity/state");
const { getSerializedPlaybackHistory } = require("../../../helpers/activity/server");
const { pushTrackHistory, playbackState } = require("../../../helpers/lavalink/state");

const DAY = 24 * 60 * 60 * 1000;
const originalEnv = { days: process.env.ROOM_HISTORY_RETENTION_DAYS, limit: process.env.ROOM_HISTORY_LIMIT };

function makeTrack(id, extra = {}) {
  return {
    track: `encoded-${id}`,
    info: {
      identifier: id,
      title: `Title ${id}`,
      author: `Artist ${id}`,
      uri: `https://example.test/${id}`,
      length: 180000,
      sourceName: "deezer",
      artworkUrl: `https://cdn-images.dzcdn.net/${id}.jpg`,
      isStream: false,
      requesterId: "123456789012345678",
      requesterTag: "listener",
      ...(extra.info || {}),
    },
    userData: { autoplayPlayedAt: Date.now(), ...(extra.userData || {}) },
    ...(extra.pluginInfo ? { pluginInfo: extra.pluginInfo } : {}),
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function withStore(run) {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "room-history-"));
    const file = path.join(dir, "roomHistory.json");
    roomHistory.setRoomHistoryFileForTests(file);
    try {
      await run(file, dir);
    } finally {
      roomHistory.setRoomHistoryFileForTests(null);
      restoreEnv("ROOM_HISTORY_RETENTION_DAYS", originalEnv.days);
      restoreEnv("ROOM_HISTORY_LIMIT", originalEnv.limit);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

test.describe("room history store", () => {
  test("records tracks, persists them and reads them back oldest first after a reload", withStore((file) => {
    roomHistory.recordRoomTrack("guild-1", makeTrack("a", { userData: { autoplayPlayedAt: Date.now() - 2000 } }));
    roomHistory.recordRoomTrack("guild-1", makeTrack("b"));
    roomHistory.recordRoomTrack("guild-2", makeTrack("c"));
    roomHistory.flushRoomHistory();

    assert.ok(fs.existsSync(file));
    roomHistory.setRoomHistoryFileForTests(file); // drops the cache: simulates a restart
    assert.deepEqual(roomHistory.getRoomHistory("guild-1").map((entry) => entry.info.identifier), ["a", "b"]);
    assert.deepEqual(roomHistory.getRoomHistory("guild-2").map((entry) => entry.info.identifier), ["c"]);
    assert.deepEqual(roomHistory.getRoomHistory("unknown"), []);
  }));

  test("serializes persisted entries the same way as the in-memory track", withStore(() => {
    const original = makeTrack("rich", {
      info: { isrc: "USRC17607839", requesterAvatar: "abcdef0123456789", isExplicit: true },
      userData: {
        autoplay: true,
        autoplayAnchor: { artist: "Anchor", title: "Song" },
        autoplayReference: { title: "Canon", artist: "Canon Artist" },
        aiDJ: { lane: "deep", fit: 0.8, mood: "calm", energy: "low", proposalReason: "Fits", reasons: ["a", "b"], junk: { big: true } },
        activityQueueId: "queue-row",
        nested: { huge: true },
      },
    });
    original.info.autoplayed = true;
    roomHistory.recordRoomTrack("g", original);

    const [stored] = roomHistory.getRoomHistory("g");
    assert.equal(stored.userData.activityQueueId, undefined);
    assert.equal(stored.userData.nested, undefined);
    assert.equal(stored.userData.aiDJ.junk, undefined);
    assert.deepEqual(serializeTrack(stored), serializeTrack(original));
  }));

  test("drops entries older than the retention window", withStore((file) => {
    const now = Date.now();
    roomHistory.recordRoomTrack("g", makeTrack("old", { userData: { autoplayPlayedAt: now - 15 * DAY } }));
    roomHistory.recordRoomTrack("g", makeTrack("edge", { userData: { autoplayPlayedAt: now - 13 * DAY } }));
    roomHistory.recordRoomTrack("g", makeTrack("new"));
    assert.deepEqual(roomHistory.getRoomHistory("g").map((entry) => entry.info.identifier), ["edge", "new"]);

    // Expired entries already on disk are pruned on load, and the env override applies.
    fs.writeFileSync(file, JSON.stringify({
      g: [makeTrack("stale", { userData: { autoplayPlayedAt: now - 2 * DAY } }), makeTrack("fresh")],
      dead: [makeTrack("x", { userData: { autoplayPlayedAt: now - 30 * DAY } })],
    }));
    process.env.ROOM_HISTORY_RETENTION_DAYS = "1";
    roomHistory.setRoomHistoryFileForTests(file);
    assert.deepEqual(roomHistory.getRoomHistory("g").map((entry) => entry.info.identifier), ["fresh"]);
    assert.deepEqual(roomHistory.getRoomHistory("dead"), []);
  }));

  test("caps each guild independently and keeps the newest entries", withStore(() => {
    process.env.ROOM_HISTORY_LIMIT = "3";
    for (let i = 0; i < 5; i += 1) roomHistory.recordRoomTrack("g", makeTrack(`t${i}`));
    roomHistory.recordRoomTrack("other", makeTrack("solo"));

    assert.deepEqual(roomHistory.getRoomHistory("g").map((entry) => entry.info.identifier), ["t2", "t3", "t4"]);
    assert.equal(roomHistory.getRoomHistory("other").length, 1);
  }));

  test("recovers from a corrupt file by preserving it and starting empty", withStore((file, dir) => {
    fs.writeFileSync(file, "{ not json");
    roomHistory.setRoomHistoryFileForTests(file);
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(roomHistory.getRoomHistory("g"), []);
    } finally {
      console.error = originalError;
    }
    assert.ok(fs.readdirSync(dir).some((name) => name.startsWith("roomHistory.json.corrupt-")));

    roomHistory.recordRoomTrack("g", makeTrack("after"));
    roomHistory.flushRoomHistory();
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).g.length, 1);
  }));

  test("write failures are logged and never thrown into playback", withStore((file) => {
    // A non-empty directory where the file should be makes the atomic rename fail.
    fs.mkdirSync(file);
    fs.writeFileSync(path.join(file, "keep"), "x");
    roomHistory.setRoomHistoryFileForTests(file);
    const originalError = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args);
    try {
      assert.doesNotThrow(() => {
        roomHistory.recordRoomTrack("g", makeTrack("a"));
        roomHistory.flushRoomHistory();
      });
    } finally {
      console.error = originalError;
    }
    assert.ok(logged.length > 0);
    assert.equal(roomHistory.getRoomHistory("g").length, 1);
  }));

  test("ignores snapshots without an encoded track", withStore(() => {
    roomHistory.recordRoomTrack("g", { info: { title: "No encoded" } });
    roomHistory.recordRoomTrack("g", null);
    roomHistory.recordRoomTrack("", makeTrack("a"));
    assert.deepEqual(roomHistory.getRoomHistory("g"), []);
  }));

  test("pushTrackHistory records into the room history and the serialized output keeps working", withStore(() => {
    const guildId = "push-guild";
    pushTrackHistory(guildId, makeTrack("p1"));
    pushTrackHistory(guildId, makeTrack("p2", { userData: { autoplay: true } }));

    const serialized = getSerializedPlaybackHistory(roomHistory.getRoomHistory(guildId), { user: { username: "MewBit" } });
    assert.deepEqual(serialized.map((track) => track.id), ["p2", "p1"]);
    assert.equal(serialized[1].requester, "listener");
    assert.equal(serialized[0].requester, "MewBit");
    assert.equal(typeof serialized[0].playedAt, "number");
    assert.equal(serialized[1].uri, "https://example.test/p1");
    assert.equal(playbackState.get(guildId).history.length, 2);
    playbackState.delete(guildId);
  }));
});

test.describe("requesterAvatarUrl", () => {
  const base = (info, userData) => serializeTrack({ track: "t", info: { identifier: "x", title: "T", author: "A", ...info }, userData });

  test("keeps Discord CDN URLs", () => {
    const url = "https://cdn.discordapp.com/avatars/123456789012345678/abc123.webp?size=256";
    assert.equal(base({ requesterAvatar: url, requesterId: "123456789012345678" }).requesterAvatarUrl, url);
    assert.equal(
      base({ requesterAvatar: "https://media.discordapp.net/avatars/1/x.png" }).requesterAvatarUrl,
      "https://media.discordapp.net/avatars/1/x.png"
    );
  });

  test("builds a CDN URL from a bare hash", () => {
    assert.equal(
      base({ requesterAvatar: "0123456789abcdef", requesterId: "123456789012345678" }).requesterAvatarUrl,
      "https://cdn.discordapp.com/avatars/123456789012345678/0123456789abcdef.png?size=64"
    );
  });

  test("uses gif for animated hashes", () => {
    assert.equal(
      base({ requesterAvatar: "a_0123456789abcdef", requesterId: "123456789012345678" }).requesterAvatarUrl,
      "https://cdn.discordapp.com/avatars/123456789012345678/a_0123456789abcdef.gif?size=64"
    );
  });

  test("is null for a hash without a requester id, for autoplay and when missing", () => {
    assert.equal(base({ requesterAvatar: "0123456789abcdef" }).requesterAvatarUrl, null);
    assert.equal(base({}).requesterAvatarUrl, null);
    assert.equal(
      base({ requesterAvatar: "0123456789abcdef", requesterId: "123456789012345678" }, { autoplay: true }).requesterAvatarUrl,
      null
    );
    assert.equal(
      base({ requesterAvatar: "https://cdn.discordapp.com/avatars/1/x.png", autoplayed: true }).requesterAvatarUrl,
      null
    );
  });

  test("rejects disallowed hosts, schemes and malformed values", () => {
    for (const requesterAvatar of [
      "https://evil.example/avatar.png",
      "https://cdn.discordapp.com.evil.example/a.png",
      "https://notdiscordapp.com/a.png",
      "http://cdn.discordapp.com/avatars/1/x.png",
      "https://user:pw@cdn.discordapp.com/a.png",
      "https://",
      "../../etc/passwd",
    ]) {
      assert.equal(base({ requesterAvatar, requesterId: "123456789012345678" }).requesterAvatarUrl, null, requesterAvatar);
    }
  });
});
