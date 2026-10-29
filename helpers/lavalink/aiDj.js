const crypto = require("node:crypto");
const Log = require("../logs/log");
const { getTrackMetadata } = require("./sessionProfile");
const { getTrackIdentityKeys } = require("./trackIdentity");

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_REASONING_EFFORT = "low";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_PROPOSALS = 8;
const DEFAULT_MIN_CONFIDENCE = 0.55;
const DEFAULT_MIN_FIT = 55;
const CACHE_LIMIT = 300;
const REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);

const AI_DJ_DIRECTOR_SYSTEM_PROMPT = `You are MewBit AI DJ, the sole music director for a shared Discord listening room.

You choose the next songs yourself. The bot only verifies facts after you decide: provider availability, duplicates, cooldowns, and that each recording resolves to the exact artist/title you named. Nobody else judges taste - your fit scores and your ordering are the final musical intent, so commit to your judgement instead of hedging toward the safest, most obvious pick.

Context rules: the current song decides the immediate transition; the manual anchor and the manual listening history define the session's identity. The supplied manual memory is the room's durable taste map (music listeners deliberately chose earlier, plus recurring artists and albums) and outranks autoplay history. A transition must make musical and cultural sense to a listener, not merely share a genre label.

ADAPTIVE ARTIST RUNS - match rigidity to the artist's character:
- Some artists have a highly distinctive sonic identity: unmistakable voice, accent, delivery, production palette, worldbuilding. For them, a series of consecutive tracks - even many from one album - feels like an intentional chapter, not repetition. When such an artist genuinely fits the moment, keep the run alive while every next track still feels deliberate. Do not exit just because a streak counter grew; do not pad a weak cut into the run either - skip within the discography or leave gracefully.
- Most acts are vibe-carriers inside a broad, densely populated lane (street rap over common drill/trap production, mainstream pop, various-artists catalogs, film or brand playlists). Their tracks are interchangeable within the lane, so staying adds nothing distinctive. Default rule for a vibe-carrier: after two consecutive tracks, your top proposal should be a bridge from a peer artist; keep a third same-artist pick only when its fit beats the best bridge by 8+ points AND you can name what specifically stays fresh (new feature, different mood facet, clear era shift).
- Judge by musical fingerprint, not fame, language, or genre label - a famous artist can still be a vibe-carrier, and a niche one truly distinctive. The supplied sameArtistStreak and sameAlbumStreak numbers are situational context, never quotas or ceilings.

VIBE CONTINUITY:
- Give every proposal an honest energy value plus a compact mood tag (2-5 words). fit and energy are whole numbers on a 0-100 scale, never fractions: 94 means excellent, not 0.94.
- Read the recentSession energies and follow the arc: hold a working groove, then move it gradually. Shifts larger than about 15 points need a reason you can name (manual queue signals a change, listeners skipped the current direction, a natural set peak/climax arrives).
- Keep the genre flow: move at most one neighbouring genre per track (hip-hop -> r&b/pop/electronic, rock -> metal/pop/indie) and stay within reach of the listener's own anchor genres. Never jump across distant genres (hip-hop -> metal, pop -> death metal, rap -> classical) unless the two recordings share a specific scene or tag. Inside a genre, vary artists, eras and moods freely - flow does not mean the same sound every time.
- Skips are the loudest feedback you get: avoid repeating whatever was just skipped, including its specific failure mode (wrong energy, too similar, wrong mood). A recent skip marked "listener-rejected queued pick" is an immediate next-track veto: do not return that recording, a mirror of it, or a near-identical immediate direction unless the supplied manual history makes a different continuation overwhelmingly more natural.

PLAN SHAPE:
Return 3 to maximumProposals specific, real recordings in deliberate priority order, each marked with a route:
- "continuation": naturally stays with the current artist, the same album, or the immediate sonic scene.
- "bridge": a different artist that preserves the energy, mood, scene, and cultural context.
Every credible plan contains at least one strong continuation and at least one strong bridge; rank them by how natural each feels right now. Add at most one "explore" pick, normally only late in a session and only for a well-motivated deliberate shift. A direct surprise request may explicitly invite an explore pick earlier, but it must still be traceably connected to the supplied taste anchor. A continuation is not automatically better: some albums reward a run, others become repetitive - decide musically.

SURPRISE ME: when selectionIntent.mode is "popular", verifiedCatalog may include a small live chart pool marked source "deezer_chart". Treat that as a freshness bonus only: choose a charting recording when its fit is close to the best transition, never force a chart hit that breaks the room's energy or mood.

HARD RULES:
Never fabricate or force variety nobody asked for, and never clamp a great run to satisfy a number. Leaving an artist does not ban returning later. Never propose intros, outros, interludes, skits, spoken transitions, album acts/chapters, or short narrative breaks. No remixes, covers, live cuts, sped-up/slowed versions, karaoke, or duplicate recordings unless the current lane explicitly is that style. Avoid every supplied recent/blocked recording; within the supplied repeat cooldown choose another fitting cut instead. When web search is available, verify uncertain artist/title pairs (niche, regional, non-English). If no credible direction can be formed, return "no_match" instead of guessing.

The bot resolves every proposal against music providers and silently drops anything unavailable, misidentified, duplicated, skipped, or an unrequested alternate version. Keep reasons compact and about the transition itself.`;

const AI_DJ_DIRECTOR_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "direction", "confidence", "candidates", "reasons"],
  properties: {
    decision: { type: "string", enum: ["propose", "no_match"] },
    direction: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "energy", "mood"],
      properties: {
        summary: { type: "string" },
        energy: { type: "string" },
        mood: { type: "string" },
      },
    },
    confidence: { type: "number" },
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["artist", "title", "album", "lane", "fit", "energy", "mood", "reason"],
        properties: {
          artist: { type: "string" },
          title: { type: "string" },
          album: { type: "string" },
          lane: { type: "string", enum: ["continuation", "bridge", "explore"] },
          fit: { type: "number", minimum: 0, maximum: 100 },
          energy: { type: "number", minimum: 0, maximum: 100 },
          mood: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    reasons: { type: "array", items: { type: "string" } },
  },
};

const decisionCache = new Map();
let fetchForTests = null;

function readPositiveNumber(value, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function readReasoningEffort(value) {
  const normalized = String(value || DEFAULT_REASONING_EFFORT).trim().toLowerCase();
  return REASONING_EFFORTS.has(normalized) ? normalized : DEFAULT_REASONING_EFFORT;
}

function getConfig() {
  return {
    enabled: process.env.AI_DJ_ENABLED === "true",
    apiKey: String(process.env.OPENAI_API_KEY || "").trim(),
    model: String(process.env.AI_DJ_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    reasoningEffort: readReasoningEffort(process.env.AI_DJ_REASONING_EFFORT),
    timeoutMs: readPositiveNumber(process.env.AI_DJ_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, { min: 500, max: 15000 }),
    cacheTtlMs: readPositiveNumber(process.env.AI_DJ_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS, { min: 0, max: 60 * 60 * 1000 }),
    maxProposals: Math.floor(readPositiveNumber(process.env.AI_DJ_MAX_PROPOSALS, DEFAULT_MAX_PROPOSALS, { min: 2, max: 12 })),
    useWebSearch: process.env.AI_DJ_WEB_SEARCH === "true",
    minConfidence: readPositiveNumber(process.env.AI_DJ_MIN_CONFIDENCE, DEFAULT_MIN_CONFIDENCE, { min: 0, max: 1 }),
    // Applied per candidate during selection, not as a whole-plan gate: one
    // weak proposal must not throw away an otherwise excellent AI plan.
    minFit: readPositiveNumber(process.env.AI_DJ_MIN_FIT, DEFAULT_MIN_FIT, { min: 0, max: 100 }),
  };
}

function compactText(value, limit = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function describeTrack(track) {
  const metadata = getTrackMetadata(track);
  const declared = track?.userData?.aiDJ || {};
  const measuredEnergy = Number.isFinite(metadata.features?.energy) ? Math.round(metadata.features.energy * 100) : null;
  return {
    title: compactText(track?.userData?.autoplayReference?.title || track?.info?.title),
    artist: compactText(track?.userData?.autoplayReference?.artist || track?.info?.author),
    album: compactText(metadata.albumTitle),
    genres: metadata.genres.slice(0, 6),
    tempo: Number.isFinite(metadata.features?.tempo) ? Math.round(metadata.features.tempo) : null,
    // Prefer the director's own previous verdict so the energy arc stays on
    // one consistent scale across turns; fall back to measured features.
    energy: Number.isFinite(Number(declared.energy)) ? Number(declared.energy) : measuredEnergy,
    mood: compactText(declared.mood, 32) || null,
  };
}

function describeRecentTrack(track) {
  return {
    ...describeTrack(track),
    autoplay: Boolean(track?.userData?.autoplay || track?.info?.autoplayed),
  };
}

function describeVerifiedCandidate(candidate) {
  return {
    title: compactText(candidate?.title || candidate?.track?.info?.title),
    artist: compactText(candidate?.artist || candidate?.track?.info?.author),
    album: compactText(candidate?.albumTitle || candidate?.track?.userData?.albumTitle),
    source: compactText(candidate?.source || candidate?.track?.info?.sourceName, 40),
    genres: Array.isArray(candidate?.genres) ? candidate.genres.slice(0, 5) : [],
  };
}

function describeTimeOfDay(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 6 && hour < 12) return { hour, period: "morning" };
  if (hour >= 12 && hour < 18) return { hour, period: "afternoon" };
  if (hour >= 18 && hour < 22) return { hour, period: "evening" };
  return { hour, period: "night" };
}

function buildDirectorInput({ anchorTrack, referenceTrack, profile, context, maxProposals }) {
  return {
    task: "Program the next track in this shared listening session.",
    selectionIntent: context.selectionIntent || null,
    timeOfDay: describeTimeOfDay(),
    manualAnchor: describeTrack(anchorTrack),
    currentTrack: describeTrack(referenceTrack),
    manualTaste: {
      genres: (profile.manualTasteGenres || []).slice(0, 8),
      genreFamilies: (profile.manualTasteGenreFamilies || []).slice(0, 8),
      features: profile.manualTasteFeatures || null,
    },
    manualHistory: (profile.manualHistory || []).slice(-8).map(describeRecentTrack),
    manualMemory: {
      tracks: (profile.manualMemoryTracks || []).slice(-24).map(describeTrack),
      artists: (profile.manualArtistMemory || []).slice(0, 12),
      albums: (profile.manualAlbumMemory || []).slice(0, 12),
    },
    recentSession: (profile.recentTracks || []).slice(-10).map(describeRecentTrack),
    upcomingManualTracks: (profile.pendingManualTracks || []).slice(0, 4).map(describeTrack),
    recentSkips: (context.recentSkips || []).slice(0, 6),
    recentlyRejectedCandidates: (context.blockedTracks || []).slice(0, 6).map(describeTrack),
    verifiedCatalog: (profile.verifiedCatalogCandidates || []).slice(0, 20).map(describeVerifiedCandidate),
    constraints: {
      anchorGenreFamilies: context.anchorFamilies || [],
      currentGenreFamilies: context.referenceFamilies || [],
      skippedArtists: [...(context.skippedArtistCounts || [])].slice(0, 12),
      sameArtistStreak: context.artistStreak || 0,
      sameAlbumStreak: context.albumStreak || 0,
      repeatCooldownMinutes: Math.round((Number(context.repeatCooldownMs) || 0) / 60_000),
      maximumProposals: maxProposals,
      forbidden: "recent repeats, provider mirrors, listener-rejected queued picks and their immediate direction, unrequested alternate versions, generic algorithmic or playlist suggestions",
    },
  };
}

function getCacheKey(model, prompt) {
  return crypto.createHash("sha256").update(`${model}:${JSON.stringify(prompt)}`).digest("hex");
}

function getCachedDecision(key, now = Date.now()) {
  const cached = decisionCache.get(key);
  if (!cached || cached.expiresAt <= now) {
    decisionCache.delete(key);
    return null;
  }
  return cached.decision;
}

function cacheDecision(key, decision, ttlMs) {
  if (ttlMs <= 0) return;
  decisionCache.set(key, { decision, expiresAt: Date.now() + ttlMs });
  if (decisionCache.size > CACHE_LIMIT) decisionCache.delete(decisionCache.keys().next().value);
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const output of payload?.output || []) {
    for (const content of output?.content || []) {
      if (typeof content?.text === "string") return content.text;
    }
  }
  return "";
}

// Some models emit fit/energy as a 0-1 fraction despite the documented
// 0-100 scale, and OpenAI's strict mode does not enforce numeric bounds.
// Normalize fractions so an otherwise perfect plan never dies on units.
function normalizeScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return parsed > 0 && parsed < 1 ? Math.round(parsed * 100) : parsed;
}

function validateDirectorPlan(value, maxProposals) {
  if (!value || typeof value !== "object") return null;
  const decision = value.decision;
  // The model flips between 0-1 and 0-100 confidence scales between calls.
  let confidence = Number(value.confidence);
  if (Number.isFinite(confidence) && confidence > 1 && confidence <= 100) confidence = confidence / 100;
  const direction = value.direction && typeof value.direction === "object" ? {
    summary: compactText(value.direction.summary, 180),
    energy: compactText(value.direction.energy, 80),
    mood: compactText(value.direction.mood, 100),
  } : null;
  const reasons = Array.isArray(value.reasons)
    ? value.reasons.map((reason) => compactText(reason, 180)).filter(Boolean).slice(0, 3)
    : [];
  const seen = new Set();
  const candidates = Array.isArray(value.candidates) ? value.candidates.flatMap((candidate, index) => {
    const artist = compactText(candidate?.artist, 120);
    const title = compactText(candidate?.title, 160);
    const album = compactText(candidate?.album, 160);
    const lane = compactText(candidate?.lane, 32).toLowerCase();
    const reason = compactText(candidate?.reason, 180);
    const fit = normalizeScore(candidate?.fit);
    const energy = normalizeScore(candidate?.energy);
    const mood = compactText(candidate?.mood, 32);
    const key = `${artist.toLowerCase()}|${title.toLowerCase()}`;
    if (!artist || !title || !reason || !["continuation", "bridge", "explore"].includes(lane)) return [];
    if (!Number.isFinite(fit) || fit < 0 || fit > 100 || !Number.isFinite(energy) || energy < 0 || energy > 100 || !mood) return [];
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ artist, title, album, lane, fit, energy, mood, reason, rank: index }];
  }).slice(0, maxProposals) : [];

  if (!['propose', 'no_match'].includes(decision) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  if (!direction?.summary || !direction.energy || !direction.mood || !reasons.length) return null;
  if (decision === "propose" && !candidates.length) return null;
  if (decision === "no_match" && candidates.length) return null;
  return { decision, confidence, direction, candidates, reasons };
}

function isSameRecording(proposal, track) {
  const proposalKeys = new Set(getTrackIdentityKeys(proposal, { includeIdentifier: false }));
  if (!proposalKeys.size) return false;
  return getTrackIdentityKeys(track, { includeIdentifier: false }).some((key) => proposalKeys.has(key));
}

function filterPlanRepeats(plan, { referenceTrack, profile, context }, now = Date.now()) {
  if (!plan?.candidates?.length) return plan;
  const repeatCooldownMs = Math.max(Number(context?.repeatCooldownMs) || 0, 0);
  const rememberedTracks = [
    ...(profile?.cooldownTracks || []),
    ...(profile?.recentTracks || []),
    ...(profile?.manualHistory || []),
  ].filter(Boolean);
  const candidates = plan.candidates.filter((proposal) => {
    if (isSameRecording(proposal, referenceTrack)) return false;
    if (repeatCooldownMs <= 0) return true;
    return !rememberedTracks.some((track) => {
      if (!isSameRecording(proposal, track)) return false;
      const playedAt = Number(track?.userData?.autoplayPlayedAt);
      return !Number.isFinite(playedAt) || now - playedAt < repeatCooldownMs;
    });
  });
  return { ...plan, candidates };
}

async function requestDirectorPlan(config, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  timeout.unref?.();

  try {
    const response = await (fetchForTests || globalThis.fetch)(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        store: false,
        max_output_tokens: 1200,
        reasoning: { effort: config.reasoningEffort },
        tools: config.useWebSearch ? [{ type: "web_search", search_context_size: "low" }] : undefined,
        tool_choice: config.useWebSearch ? "required" : undefined,
        input: [
          { role: "system", content: [{ type: "input_text", text: AI_DJ_DIRECTOR_SYSTEM_PROMPT }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify(prompt) }] },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "mewbit_ai_dj_plan",
            strict: true,
            schema: AI_DJ_DIRECTOR_RESPONSE_SCHEMA,
          },
        },
      }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`OpenAI Responses API ${response.status}: ${compactText(payload?.error?.message, 180) || "request failed"}`);
    const outputText = extractOutputText(payload);
    if (!outputText) {
      const incompleteReason = compactText(payload?.incomplete_details?.reason, 80);
      throw new Error(`OpenAI returned no structured director plan${incompleteReason ? ` (${incompleteReason})` : ""}`);
    }
    return JSON.parse(outputText);
  } finally {
    clearTimeout(timeout);
  }
}

async function planNextTrackWithAIDJ(input) {
  const config = getConfig();
  if (!config.enabled) return { status: "disabled", plan: null };
  if (!config.apiKey) return { status: "missing-api-key", plan: null };
  if (typeof (fetchForTests || globalThis.fetch) !== "function") return { status: "fetch-unavailable", plan: null };

  const prompt = buildDirectorInput({ ...input, maxProposals: config.maxProposals });
  const cacheKey = getCacheKey(`${config.model}:director:${config.useWebSearch}`, prompt);
  let plan = getCachedDecision(cacheKey);
  const cached = Boolean(plan);

  try {
    if (!plan) {
      plan = validateDirectorPlan(await requestDirectorPlan(config, prompt), config.maxProposals);
      if (!plan) throw new Error("OpenAI returned an invalid AI DJ director plan");
      plan = filterPlanRepeats(plan, input);
      cacheDecision(cacheKey, plan, config.cacheTtlMs);
    }
  } catch (error) {
    Log.warning("AI DJ director unavailable; using deterministic fallback ladder", "", `error=${compactText(error.message, 180)}`);
    return { status: "fallback-error", plan: null };
  }

  if (plan.decision !== "propose" || !plan.candidates.length) return { status: "no-match", plan, cached, model: config.model };
  if (plan.confidence < config.minConfidence) return { status: "low-confidence", plan, cached, model: config.model };
  return { status: "planned", plan, cached, model: config.model };
}

function clearAIDJCacheForTests() {
  decisionCache.clear();
}

function setAIDJFetchForTests(value) {
  fetchForTests = value;
}

module.exports = {
  AI_DJ_DIRECTOR_RESPONSE_SCHEMA,
  AI_DJ_DIRECTOR_SYSTEM_PROMPT,
  buildDirectorInput,
  clearAIDJCacheForTests,
  filterPlanRepeats,
  planNextTrackWithAIDJ,
  setAIDJFetchForTests,
};
