const assert = require("node:assert");
const { describe, it } = require("node:test");

const { getEditDistance, getPhoneticKey, getTokenSimilarity, matchTokens } = require("../../../helpers/lavalink/searchMatching");

describe("Search token matching", () => {
  it("counts an adjacent transposition as one edit", () => {
    assert.strictEqual(getEditDistance("yourslef", "yourself"), 1);
    assert.strictEqual(getEditDistance("kill", "kill"), 0);
  });

  it("folds common sound-alike spellings", () => {
    assert.strictEqual(getPhoneticKey("tamagoczi"), getPhoneticKey("tamagotchi"));
    assert.strictEqual(getPhoneticKey("metalica"), getPhoneticKey("metallica"));
  });

  it("matches a prefix only for the word being typed", () => {
    assert.ok(getTokenSimilarity("bohem", "bohemian", { allowPrefix: true }) > 0.75);
    assert.strictEqual(getTokenSimilarity("bohem", "bohemian"), 0);
  });

  it("keeps two-letter words exact", () => {
    assert.strictEqual(getTokenSimilarity("em", "en"), 0);
  });

  it("rejects unrelated words of similar length", () => {
    assert.strictEqual(getTokenSimilarity("matters", "sandman"), 0);
  });

  it("matches glued and split words", () => {
    assert.strictEqual(matchTokens(["acdc"], ["ac", "dc"]).matched, 1);
    assert.ok(matchTokens(["linkin", "park"], ["linkinpark"]).credit > 0.9);
  });

  it("uses each candidate word once", () => {
    const result = matchTokens(["love", "love"], ["love"]);
    assert.strictEqual(result.matched, 1);
  });
});
