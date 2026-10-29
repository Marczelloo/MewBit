const assert = require("node:assert");
const { describe, it, beforeEach } = require("node:test");

const {
  clearSuggestionCache,
  findSearchCorrection,
  getSearchSuggestions,
  searchWithCorrection,
} = require("../../../helpers/lavalink/searchSuggestions");

describe("Search suggestions and corrections", () => {
  beforeEach(() => clearSuggestionCache());

  describe("findSearchCorrection", () => {
    it("corrects a misspelt artist with the most popular suggestion", () => {
      const suggestions = ["metallica nothing else matters", "metallica nothing else matters live"];
      assert.strictEqual(findSearchCorrection("metalica nothing els", suggestions), "metallica nothing else matters");
    });

    it("splits glued words", () => {
      assert.strictEqual(findSearchCorrection("linkinpark numb", ["linkin park numb", "linkin park numb live"]), "linkin park numb");
    });

    it("leaves a correct query alone, even when it is still being typed", () => {
      assert.strictEqual(findSearchCorrection("queen bohem", ["queen bohemian rhapsody", "queen bohemian"]), null);
    });

    it("treats a query without Polish diacritics as already right", () => {
      const suggestions = ["dawid podsiadło małomiasteczkowy", "dawid podsiadlo malomiasteczkowy cala plyta"];
      assert.strictEqual(findSearchCorrection("dawid podsiadlo malomiasteczk", suggestions), null);
    });

    it("does not force a fuzzier suggestion on a query another suggestion confirms", () => {
      const suggestions = ["lil pump gucci gang", "lil peep star shopping"];
      assert.strictEqual(findSearchCorrection("lil peep", suggestions), null);
    });

    it("ignores suggestions that drop or replace a typed word", () => {
      assert.strictEqual(findSearchCorrection("hit em up", ["hit the road jack", "em up remix"]), null);
    });
  });

  describe("getSearchSuggestions", () => {
    it("caches suggestions and coalesces identical lookups", async () => {
      let calls = 0;
      const request = async () => {
        calls += 1;
        return ["a song", "a song", " a  song live "];
      };

      const [first, second] = await Promise.all([
        getSearchSuggestions("A Song", { request }),
        getSearchSuggestions("a song", { request }),
      ]);
      const third = await getSearchSuggestions("a song", { request });

      assert.strictEqual(calls, 1);
      assert.deepStrictEqual(first, ["a song", "a song live"]);
      assert.deepStrictEqual(second, first);
      assert.deepStrictEqual(third, first);
    });

    it("returns no suggestions when the lookup fails", async () => {
      const suggestions = await getSearchSuggestions("broken", {
        request: async () => {
          throw new Error("offline");
        },
      });
      assert.deepStrictEqual(suggestions, []);
    });

    it("skips the lookup for one-letter queries", async () => {
      let calls = 0;
      await getSearchSuggestions("a", { request: async () => (calls += 1) && [] });
      assert.strictEqual(calls, 0);
    });
  });

  describe("searchWithCorrection", () => {
    const getSuggestions = async () => ["metallica nothing else matters", "metallica nothing else matters live"];

    it("searches the corrected query too and puts its tracks first", async () => {
      const searched = [];
      const search = async (query) => {
        searched.push(query);
        return [{ query }];
      };

      const result = await searchWithCorrection("metalica nothing els", search, { getSuggestions });

      assert.deepStrictEqual(searched.sort(), ["metalica nothing els", "metallica nothing else matters"]);
      assert.deepStrictEqual(
        result.tracks.map((track) => track.query),
        ["metallica nothing else matters", "metalica nothing els"]
      );
      assert.strictEqual(result.rankQuery, "metallica nothing else matters");
      assert.strictEqual(result.correction, "metallica nothing else matters");
      assert.deepStrictEqual(result.suggestions, ["metallica nothing else matters live"]);
    });

    it("keeps the query as typed when asked to search exactly", async () => {
      const searched = [];
      const result = await searchWithCorrection(
        "metalica nothing els",
        async (query) => {
          searched.push(query);
          return [];
        },
        { exact: true, getSuggestions }
      );

      assert.deepStrictEqual(searched, ["metalica nothing els"]);
      assert.strictEqual(result.correction, null);
      assert.strictEqual(result.rankQuery, "metalica nothing els");
    });
  });
});
