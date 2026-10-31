const assert = require("node:assert");
const { describe, it } = require("node:test");

const {
  MAX_CONSECUTIVE_ALBUM_TRACKS,
  MAX_CONSECUTIVE_ARTIST_TRACKS,
  buildAIDJCandidates,
  filterAICandidates,
  getRecentTracks,
  hasRecentExposure,
  orderAIDirectorCandidates,
  selectFallbackCandidates,
} = require("../../../helpers/lavalink/autoplayV3");

function candidate(title, artist, source, options = {}) {
  return {
    title,
    artist,
    identifier: options.identifier || `${artist}-${title}`,
    source,
    genres: options.genres || ["hip hop"],
    similarity: options.similarity || 0,
    albumId: options.albumId || null,
    albumTitle: options.albumTitle || null,
  };
}

function aiCandidate(title, artist, options = {}) {
  const base = candidate(title, artist, "ai_dj", options);
  base.aiDjFit = options.fit ?? 90;
  base.aiDjLane = options.lane ?? "continuation";
  base.aiDjRank = options.rank ?? 0;
  base.aiDjEnergy = options.energy ?? 60;
  base.aiDjMood = options.mood ?? "late-night reflective";
  base.aiDJ = { lane: base.aiDjLane, fit: base.aiDjFit, energy: base.aiDjEnergy, mood: base.aiDjMood };
  return base;
}

function context(overrides = {}) {
  return {
    profile: { cooldownTracks: [] },
    exposure: { tracks: [] },
    referenceTrack: { info: { title: "Nostalgia", author: "Taco Hemingway", identifier: "ref" } },
    referenceArtist: "taco hemingway",
    referenceAlbum: "id:frascati",
    referenceFamilies: ["hiphop"],
    anchorFamilies: ["hiphop"],
    artistStreak: 0,
    albumStreak: 0,
    skippedArtists: new Set(),
    skippedArtistCounts: [],
    recentSkips: [],
    repeatCooldownMs: 60 * 60 * 1000,
    ...overrides,
  };
}

describe("Autoplay V3 AI-first selection", () => {
  it("uses durable autoplay history when player history misses provider-shaped tracks", () => {
    const taco = (title, identifier) => ({
      info: { title, author: "Taco Hemingway", identifier },
      userData: { autoplay: true },
    });
    const seed = { info: { title: "Tamagotchi", author: "Taco Hemingway", identifier: "seed" } };
    const recent = getRecentTracks({
      recentTracks: [seed, taco("Następna stacja", "one")],
      recentAutoplayTracks: [taco("Następna stacja", "one"), taco("A mówiłem Ci", "two"), taco("Od zera", "three")],
    }, taco("Od zera", "three"));

    assert.deepStrictEqual(recent.map((track) => track.info.identifier), ["seed", "one", "two", "three"]);
  });

  it("allows a recording to return after the short-session repeat cooldown", () => {
    const now = Date.now();
    const proposal = { artist: "Taco Hemingway", title: "Nostalgia" };
    const played = {
      info: { identifier: "nostalgia", author: "Taco Hemingway", title: "Nostalgia" },
      userData: { autoplayPlayedAt: now - (61 * 60 * 1000) },
    };

    assert.strictEqual(hasRecentExposure(proposal, { cooldownTracks: [played] }, { tracks: [] }, null, now), false);
    played.userData.autoplayPlayedAt = now - 1000;
    assert.strictEqual(hasRecentExposure(proposal, { cooldownTracks: [played] }, { tracks: [] }, null, now), true);
  });

  it("keeps an AI bridge that crosses the anchor genre family when the director rates it high", () => {
    // The old hard guard rejected this outright ("anchor-genre-drift"). The
    // director owns taste now: a well-rated lane change is its decision.
    const dancehallBridge = aiCandidate("Dancehall Detour", "Other Artist", {
      genres: ["reggae", "dancehall"],
      lane: "explore",
      fit: 88,
    });

    const filtered = filterAICandidates([dancehallBridge], context());
    assert.strictEqual(filtered.ranked.length, 1);
    assert.deepStrictEqual(filtered.rejected, {});
  });

  it("drops only the weak proposals from a plan instead of discarding the whole plan", () => {
    const strong = aiCandidate("Strong Cut", "Taco Hemingway", { fit: 92 });
    const weak = aiCandidate("Weak Cut", "Quebonafide", { fit: 30, rank: 1, lane: "bridge" });

    const filtered = filterAICandidates([strong, weak], context());
    assert.deepStrictEqual(filtered.ranked.map((entry) => entry.candidate.title), ["Strong Cut"]);
    assert.strictEqual(filtered.rejected["low-fit"], 1);
  });

  it("still rejects an AI proposal that is on cooldown or already queued as reference", () => {
    const repeated = {
      info: { identifier: "wosk", author: "Taco Hemingway", title: "Wosk" },
      userData: { autoplayPlayedAt: Date.now() - 1000 },
    };
    const proposal = aiCandidate("Wosk", "Taco Hemingway", { fit: 96, identifier: "wosk" });
    const selectionContext = context({
      profile: { cooldownTracks: [repeated] },
    });

    const filtered = filterAICandidates([proposal], selectionContext);
    assert.deepStrictEqual(filtered.ranked, []);
    assert.strictEqual(filtered.rejected["recent-duplicate"], 1);

    const sameAsReference = filterAICandidates(
      [aiCandidate("Nostalgia", "Taco Hemingway", { fit: 96, identifier: "ref-nostalgia" })],
      context({ referenceTrack: { info: { title: "Nostalgia", author: "Taco Hemingway", identifier: "nostalgia" } } })
    );
    assert.deepStrictEqual(sameAsReference.ranked, []);
    assert.strictEqual(sameAsReference.rejected["recent-duplicate"], 1);
  });

  it("rejects a listener-replaced autoplay pick even when another provider supplies it", () => {
    const rejectedPick = {
      info: { title: "Save Your Tears", author: "The Weeknd", identifier: "spotify-save-your-tears" },
      userData: { autoplay: true },
    };
    const providerMirror = aiCandidate("Save Your Tears (Official Video)", "The Weeknd", {
      identifier: "youtube-save-your-tears",
      fit: 96,
    });

    const aiResult = filterAICandidates([providerMirror], context({ blockedTracks: [rejectedPick] }));
    assert.deepStrictEqual(aiResult.ranked, []);
    assert.strictEqual(aiResult.rejected["listener-rejected"], 1);

    const fallbackResult = selectFallbackCandidates([
      candidate("Save Your Tears", "The Weeknd", "youtube_mix", { identifier: "deezer-save-your-tears" }),
    ], context({ blockedTracks: [rejectedPick] }));
    assert.deepStrictEqual(fallbackResult.ranked, []);
    assert.strictEqual(fallbackResult.rejected["listener-rejected"], 1);
  });

  it("does not ban a recently skipped artist on the AI path (demotion happens at ordering)", () => {
    const skippedArtistPick = aiCandidate("Comeback Track", "Mata", { fit: 91, lane: "bridge" });
    const selectionContext = context({
      skippedArtists: new Set(["mata"]),
      skippedArtistCounts: [{ artist: "Mata", skips: 2 }],
    });

    const filtered = filterAICandidates([skippedArtistPick], selectionContext);
    assert.strictEqual(filtered.ranked.length, 1);
    assert.deepStrictEqual(filtered.rejected, {});
  });

  it("lets a distinctive-artist run continue without any streak ceiling", () => {
    // Taco Hemingway's flow/worldbuilding makes long runs feel like chapters:
    // no code-level cap may interrupt them; the director decides musically.
    const runContinuation = aiCandidate("Chapter Five", "Taco Hemingway", { fit: 93, albumId: "frascati" });
    const selectionContext = context({ artistStreak: 8, albumStreak: 6 });

    const filtered = filterAICandidates([runContinuation], selectionContext);
    assert.strictEqual(filtered.ranked.length, 1);

    const ordered = orderAIDirectorCandidates(filtered.ranked, selectionContext, () => 0);
    assert.strictEqual(ordered.ranked[0].candidate.title, "Chapter Five");
    assert.strictEqual(ordered.deferred, null);
  });

  it("rotates inside the top fit band instead of always taking number one", () => {
    const best = aiCandidate("Best Continuation", "Taco Hemingway", { fit: 94 });
    const closeAlternative = aiCandidate("Close Bridge", "Quebonafide", { fit: 86, lane: "bridge", rank: 1 });

    const filtered = filterAICandidates([best, closeAlternative], context());
    // floor=84: weights are best=11, close=3, total=14. roll=12/14 lands on
    // the second entry even though it did not have the top fit.
    const rotated = orderAIDirectorCandidates(filtered.ranked, context(), () => 12 / 14);
    assert.strictEqual(rotated.ranked[0].candidate.title, "Close Bridge");
    assert.strictEqual(rotated.deferred.title, "Best Continuation");

    const stable = orderAIDirectorCandidates(filtered.ranked, context(), () => 0);
    assert.strictEqual(stable.ranked[0].candidate.title, "Best Continuation");
    assert.strictEqual(stable.deferred, null);
  });

  it("lets a surprise discovery intent favor a close explore proposal", () => {
    const continuation = aiCandidate("Safe Continuation", "Taco Hemingway", { fit: 94 });
    const hiddenGem = aiCandidate("Hidden Gem", "Fresh Artist", { fit: 90, lane: "explore", rank: 1 });
    const selectionContext = context({
      selectionIntent: { mode: "discovery", preferredLanes: ["explore", "bridge"] },
    });
    const filtered = filterAICandidates([continuation, hiddenGem], selectionContext);
    const ordered = orderAIDirectorCandidates(filtered.ranked, selectionContext, () => 0.62);

    assert.strictEqual(ordered.ranked[0].candidate.title, "Hidden Gem");
    assert.strictEqual(ordered.deferred.route, "explore");
  });

  it("prefers the director's bridge after a long run, but never outside the band", () => {
    const continuation = aiCandidate("Deep Cut", "Guzior", { fit: 94 });
    const bridge = aiCandidate("Scene Bridge", "Szpaku", { fit: 85, lane: "bridge", rank: 1 });

    const filtered = filterAICandidates([continuation, bridge], context({ referenceArtist: "guzior", artistStreak: 5 }));
    // streak 5 -> exitDepth 1: band widens to 14 (floor 80) and the bridge
    // multiplier is x2. Weights: continuation 15, bridge 12, total 27.
    const exitTaken = orderAIDirectorCandidates(filtered.ranked, context({ referenceArtist: "guzior", artistStreak: 5 }), () => 24 / 27);
    assert.strictEqual(exitTaken.ranked[0].candidate.title, "Scene Bridge");
    assert.strictEqual(exitTaken.deferred.title, "Deep Cut");

    const runHeld = orderAIDirectorCandidates(filtered.ranked, context({ referenceArtist: "guzior", artistStreak: 5 }), () => 3 / 27);
    assert.strictEqual(runHeld.ranked[0].candidate.title, "Deep Cut");

    // A materially weaker bridge passes the factual filter but sits outside
    // the top-fit band, so no random roll can ever rotate into it.
    const farBridge = aiCandidate("Far Bridge", "Bialas", { fit: 70, lane: "bridge", rank: 1 });
    const farFiltered = filterAICandidates([continuation, farBridge], context({ referenceArtist: "guzior", artistStreak: 9 }));
    assert.strictEqual(farFiltered.ranked.length, 2);
    const maxRollOrder = orderAIDirectorCandidates(
      farFiltered.ranked,
      context({ referenceArtist: "guzior", artistStreak: 9 }),
      () => 0.999999
    );
    assert.strictEqual(maxRollOrder.ranked[0].candidate.title, "Deep Cut");
    assert.strictEqual(maxRollOrder.deferred, null);
  });

  it("draws proposals that jump far from the current energy less often", () => {
    const jump = aiCandidate("Rager", "Quebonafide", { fit: 94, energy: 92 });
    const smooth = aiCandidate("Same Groove", "Taco Hemingway", { fit: 90, energy: 55, lane: "bridge", rank: 1 });
    const filtered = filterAICandidates([jump, smooth], context());

    // Without a reference energy, floor=84: weights 11 and 7, so a roll of
    // 0.5 stays on the higher fit.
    const unrated = orderAIDirectorCandidates(filtered.ranked, context(), () => 0.5);
    assert.strictEqual(unrated.ranked[0].candidate.title, "Rager");

    // At energy 50 the 42-point jump divides its weight by 3 (11 -> 3.67),
    // the 5-point step keeps 7, so the same roll lands on the smooth pick.
    const rated = orderAIDirectorCandidates(filtered.ranked, context({ referenceEnergy: 50 }), () => 0.5);
    assert.strictEqual(rated.ranked[0].candidate.title, "Same Groove");
  });

  it("demotes but keeps candidates by artists listeners just skipped", () => {
    const fresh = aiCandidate("Fresh Pick", "Quebonafide", { fit: 90, rank: 0 });
    const skipped = aiCandidate("Skipped Artist Pick", "Mata", { fit: 90, rank: 1, lane: "bridge" });

    const filtered = filterAICandidates([fresh, skipped], context({
      skippedArtists: new Set(["mata"]),
      skippedArtistCounts: [{ artist: "Mata", skips: 2 }],
    }));
    // Equal fits: fresh weight 11 vs skipped ≈8.87 (12% demotion per skip).
    // A mid roll keeps the clean pick first, while a near-max roll proves
    // the skip is a demotion, not a ban.
    const midRoll = orderAIDirectorCandidates(filtered.ranked, context({
      skippedArtists: new Set(["mata"]),
      skippedArtistCounts: [{ artist: "Mata", skips: 2 }],
    }), () => 0.5);
    assert.strictEqual(midRoll.ranked[0].candidate.title, "Fresh Pick");

    const maxRoll = orderAIDirectorCandidates(filtered.ranked, context({
      skippedArtists: new Set(["mata"]),
      skippedArtistCounts: [{ artist: "Mata", skips: 2 }],
    }), () => 0.97);
    assert.ok(maxRoll.ranked.some((entry) => entry.candidate.artist === "Mata"));
  });

  it("merges verified catalog recordings into AI proposals with their vibe verdicts", () => {
    const directTrack = { info: { title: "Wosk", author: "Taco Hemingway", identifier: "wosk-direct" }, userData: { albumTitle: "Frascati" } };
    const aiCandidates = buildAIDJCandidates({
      status: "planned",
      model: "gpt-5.6-luna",
      plan: {
        confidence: 0.9,
        direction: { summary: "Polish rap", energy: "mid", mood: "night" },
        reasons: ["Fit"],
        candidates: [
          { artist: "Taco Hemingway", title: "Wosk", album: "Frascati", lane: "continuation", fit: 96, energy: 58, mood: "late-night reflective", reason: "Verified continuation." },
        ],
      },
    }, [{ artist: "Taco Hemingway", title: "Wosk", albumTitle: "Frascati", source: "youtube_mix", track: directTrack }]);

    assert.strictEqual(aiCandidates[0].track, directTrack);
    assert.strictEqual(aiCandidates[0].aiDjVerifiedCatalog, true);
    assert.strictEqual(aiCandidates[0].aiDjFit, 96);
    assert.strictEqual(aiCandidates[0].aiDjEnergy, 58);
    assert.strictEqual(aiCandidates[0].aiDjMood, "late-night reflective");
    assert.strictEqual(aiCandidates[0].source, "ai_dj");
  });

  it("ranks trusted fallback relations ahead of broad mixes in the emergency ladder", () => {
    const similar = candidate("Related Track", "Quebonafide", "lastfm_similar", { similarity: 0.93 });
    const mix = candidate("Mix Result", "Fresh Artist", "youtube_mix");

    const { ranked } = selectFallbackCandidates([mix, similar], context());
    assert.strictEqual(ranked[0].candidate.title, "Related Track");
    assert.ok(ranked[0].score > ranked[1].score);
  });

  it("accepts Deezer recommendations as a related fallback source", () => {
    const deezer = candidate("Deezer Pick", "Malik Montana", "deezer_recommendations");
    const { ranked, rejected } = selectFallbackCandidates([deezer], context());
    assert.strictEqual(ranked.length, 1);
    assert.deepStrictEqual(rejected, {});
  });

  it("uses a verified chart pick only as the Surprise me fallback", () => {
    const chartPick = candidate("Current Chart Pick", "Popular Artist", "deezer_chart", {
      identifier: "chart-pick",
    });
    chartPick.popularity = 92;
    chartPick.chartPosition = 2;

    const normal = selectFallbackCandidates([chartPick], context());
    assert.deepStrictEqual(normal.ranked, []);
    assert.strictEqual(normal.rejected["unrelated-source"], 1);

    const surprise = selectFallbackCandidates([chartPick], context({ allowChartFallback: true }));
    assert.strictEqual(surprise.ranked.length, 1);
    assert.ok(surprise.ranked[0].score > 0);
  });

  it("keeps factual guards on the fallback ladder: skips, duplicates and streak caps", () => {
    const skipped = candidate("Skipped Artist Track", "Mata", "lastfm_similar", { similarity: 0.95 });
    const skipContext = context({ skippedArtists: new Set(["mata"]) });
    const skipResult = selectFallbackCandidates([skipped], skipContext);
    assert.deepStrictEqual(skipResult.ranked, []);
    assert.strictEqual(skipResult.rejected["skipped-artist"], 1);

    const mirrorOne = candidate("Mirror Song", "Same Artist", "lastfm_similar", { similarity: 0.7, identifier: "lastfm-id" });
    const mirrorTwo = candidate("Mirror Song (Official Audio)", "Same Artist", "youtube_mix", { identifier: "youtube-id" });
    const dedupeResult = selectFallbackCandidates([mirrorOne, mirrorTwo], context());
    assert.strictEqual(dedupeResult.ranked.length, 1);
    assert.strictEqual(dedupeResult.rejected["duplicate-candidate"], 1);

    const genericFollowUp = candidate("Generic Follow-up", "Taco Hemingway", "youtube_mix");
    const capped = selectFallbackCandidates(
      [genericFollowUp],
      context({ artistStreak: MAX_CONSECUTIVE_ARTIST_TRACKS })
    );
    assert.deepStrictEqual(capped.ranked, []);
    assert.strictEqual(capped.rejected["artist-streak"], 1);
  });

  it("lets a strong compatible continuation survive the soft caps on the ladder", () => {
    const albumCut = candidate("Another Album Cut", "Taco Hemingway", "same_album", { albumId: "frascati" });
    const kept = selectFallbackCandidates(
      [albumCut],
      context({ albumStreak: MAX_CONSECUTIVE_ALBUM_TRACKS, artistStreak: MAX_CONSECUTIVE_ARTIST_TRACKS })
    );
    assert.strictEqual(kept.ranked.length, 1);

    const tooFar = selectFallbackCandidates(
      [albumCut],
      context({
        albumStreak: Number(process.env.AUTOPLAY_V3_MAX_ALBUM_CONTINUITY_STREAK ?? 3),
        artistStreak: Number(process.env.AUTOPLAY_V3_MAX_ARTIST_CONTINUITY_STREAK ?? 6),
      })
    );
    assert.deepStrictEqual(tooFar.ranked, []);
  });
});

describe("Autoplay V3 genre flow", () => {
  const { enrichAIProposalGenres } = require("../../../helpers/lavalink/autoplayV3");
  const rapSession = (overrides = {}) => context({ referenceGenres: ["hip hop", "rap"], anchorGenres: ["hip hop"], ...overrides });

  it("rejects a distant jump from the AI plan but keeps a neighbouring genre", () => {
    const metal = aiCandidate("Riff", "Metal Band", { genres: ["metal"], fit: 95 });
    const rnb = aiCandidate("Slow Jam", "Singer", { genres: ["rnb"], fit: 85 });

    const filtered = filterAICandidates([metal, rnb], rapSession());

    assert.deepStrictEqual(filtered.ranked.map((entry) => entry.candidate.title), ["Slow Jam"]);
    assert.strictEqual(filtered.rejected["genre-jump"], 1);
    assert.deepStrictEqual(filtered.genreRejected.map((entry) => entry.candidate.title), ["Riff"]);
  });

  it("treats the current artist as a continuation whatever its tags say", () => {
    const sameArtist = aiCandidate("Rock Experiment", "Taco Hemingway", { genres: ["metal"] });
    const filtered = filterAICandidates([sameArtist], rapSession());
    assert.strictEqual(filtered.ranked.length, 1);
    assert.strictEqual(filtered.ranked[0].details.genreFlow.reason, "continuation");
  });

  it("lets Surprise Me cross genres when the gate is off", () => {
    const metal = aiCandidate("Riff", "Metal Band", { genres: ["metal"] });
    const filtered = filterAICandidates([metal], rapSession({ genreFlowGate: false }));
    assert.strictEqual(filtered.ranked.length, 1);
    assert.strictEqual(filtered.ranked[0].details.genreFlow.reason, "gate-off");
  });

  it("keeps untagged candidates and penalises neighbours in the fallback ladder", () => {
    const sameGenre = candidate("Same", "Rapper", "lastfm_similar", { genres: ["hip hop"], similarity: 0.5 });
    const neighbour = candidate("Near", "Singer", "lastfm_similar", { genres: ["rnb"], similarity: 0.5 });
    const unknown = candidate("Unknown", "Mystery", "lastfm_similar", { genres: [], similarity: 0.5 });
    const metal = candidate("Far", "Metal Band", "lastfm_similar", { genres: ["metal"], similarity: 0.9 });

    const result = selectFallbackCandidates([sameGenre, neighbour, unknown, metal], rapSession());
    const titles = result.ranked.map((entry) => entry.candidate.title);

    assert.ok(titles.includes("Unknown"));
    assert.ok(!titles.includes("Far"));
    assert.ok(titles.indexOf("Same") < titles.indexOf("Near"));
    assert.deepStrictEqual(result.genreRejected.map((entry) => entry.candidate.title), ["Far"]);
  });

  it("orders genre-rejected candidates by the size of the jump", () => {
    const metal = candidate("Metal", "Metal Band", "lastfm_similar", { genres: ["metal"] });
    const rock = candidate("Rock", "Rock Band", "lastfm_similar", { genres: ["rock"] });
    const result = selectFallbackCandidates([metal, rock], rapSession());
    assert.deepStrictEqual(result.genreRejected.map((entry) => entry.candidate.title), ["Rock", "Metal"]);
  });

  it("fills missing AI proposal tags from the lookup and gives up at the deadline", async () => {
    const tagged = aiCandidate("Tagged", "Artist", { genres: ["hip hop"] });
    const missing = aiCandidate("Missing", "Artist", { genres: [] });
    const slow = aiCandidate("Slow", "Artist", { genres: [] });
    const lookup = async ({ title }) => {
      if (title === "Slow") await new Promise((resolve) => setTimeout(resolve, 200));
      return { tags: ["rnb"], source: "lastfm" };
    };

    const filled = await enrichAIProposalGenres([tagged, missing, slow], { timeoutMs: 50, lookup });

    assert.strictEqual(filled, 1);
    assert.deepStrictEqual(missing.genres, ["rnb"]);
    assert.deepStrictEqual(tagged.genres, ["hip hop"]);
    assert.deepStrictEqual(slow.genres, []);
  });
});
