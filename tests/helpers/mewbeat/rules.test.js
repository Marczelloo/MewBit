const assert = require("node:assert");
const path = require("node:path");
const { describe, it } = require("node:test");
const { pathToFileURL } = require("node:url");

const { RULES_VERSION, boardKeyOf, loadClientModifiers } = require("../../../helpers/mewbeat/rules");

describe("mewbeat board rules", () => {
  it("reads the same rules version as the client module, which the bot cannot import synchronously", async () => {
    const client = await import(pathToFileURL(path.join(__dirname, "../../../activity/src/mewbeat/modifiers.js")).href);
    assert.strictEqual(RULES_VERSION, client.RULES_VERSION);
    const loaded = await loadClientModifiers();
    assert.strictEqual(loaded.RULES_VERSION, RULES_VERSION);
  });

  it("builds the board key from the song, the level, the chart version and the rules version", () => {
    assert.strictEqual(boardKeyOf("youtube:abc:200000", "hard", 5), `youtube:abc:200000|hard|5|r${RULES_VERSION}`);
    assert.strictEqual(boardKeyOf("a", "easy", "31-holds"), `a|easy|31-holds|r${RULES_VERSION}`);
  });
});
