// Map suggestions for the results screen and the song select ("Suggested next", "For you", "Rhythm game classics").
// Four kinds of row, each with a reason it can show:
//   similar  new songs that sound like what the player played or did well on (autoplay's candidate search, see
//            recommendDiscover.js); found in the background, so the first answer may not have them yet (`pending`)
//   again    songs the player already knows: a level up after a good run, one more go after a close or lost one
//   here     songs other players on this server played and this player has not
//   classic  a curated list of rhythm game staples (classics.js)
//
// Nothing here starts work for a song: no analysis, no charting. A row says which level to try from the stars of the
// charts that already exist (starsOf only looks them up); a song nobody has charted yet has no level suggestion and no
// stars, and is charted the first time somebody plays it, like any search result.
//
// The factory takes everything it reads as a function, so the stores (local files or AtlasHub) are not its business:
//   historyStore  recent(userId, limit) and played({ guildId, userId, limit }) (historyStore.js)
//   starsReader() -> (audioKey) -> { easy, normal, hard, hell } | null: stars of the charts that are stored, never
//            generates (a reader looks up many songs at the cost of one read of the generator flags)
//   discover({ title, artist }, { anchor }) -> Promise of [{ title, artist, uri, source, audioKey, durationMs, artworkUrl, score }]
//            (anchor: a song of the player's taste in general, or null; recommendDiscover.js moves what fits it up)
//   taste(userId, guildId) -> { tracks, artists } what the player listens to through the music bot (listeningTaste.js),
//            or null: seeds for "similar" next to the game history

const { isCalibrationTrack } = require("./calibrationTrack");
const { trackFromAudioKey } = require("./audioKey");
const { CLASSICS } = require("./classics");
const { anchorOf, listeningSeedsOf } = require("./listeningTaste");
const { artistKeyOf, identityOf } = require("./songIdentity");

const LEVELS = ["easy", "normal", "hard", "hell"];
const LEVEL_NAMES = { easy: "Easy", normal: "Normal", hard: "Hard", hell: "Hell" };
// Mirrors songSearch.MAX_PLAY_MS (a test keeps them equal): the plugin refuses a longer track.
const MAX_PLAY_MS = 1_200_000;
const MIN_PLAY_MS = 20_000;

const DAY_MS = 86_400_000;
// How much history is read for one player.
const OWN_SONGS = 500;
const OWN_ROUNDS = 300;
const HERE_SONGS = 500;
// Rows per kind in a reply.
const SIMILAR_ROWS = 8;
const AGAIN_ROWS = 6;
const HERE_ROWS = 8;
const STRIP_ROWS = 4;
// A good run: from this accuracy up a song is "done well on", and one more level is worth a try.
const GOOD_ACCURACY = 90;
const SOLID_ACCURACY = 92;
const CLOSE_ACCURACY = 60;
// The level to suggest is a little above the player's comfortable stars, so a suggestion stretches a bit.
const STRETCH = 1.08;
const STEP_UP_MAX = 1.3;
// A discovery runs for at most this many seeds per refresh: two from the game, three once the music bot's listening is
// among them (a game seed and two listening ones, say).
const SEEDS_PER_REFRESH = 2;
const SEEDS_WITH_LISTENING = 3;
// The game history leads the seeds when the player played this lately; otherwise what they listen to does.
const RECENT_GAME_DAYS = 7;
const MIN_SIMILAR_SCORE = 45;

function lengthOfKey(audioKey) {
  return Number(trackFromAudioKey(audioKey)?.info?.length);
}

// Whether a song can be offered at all: a real key, a way to play it, a length the plugin accepts, not the
// calibration track. (A stream has no audio key, so it is out with the first test.)
function isOfferable(row) {
  if (!row || typeof row.audioKey !== "string" || !row.title || typeof row.uri !== "string" || !row.uri) return false;
  const length = lengthOfKey(row.audioKey);
  if (!Number.isFinite(length) || length < MIN_PLAY_MS || length > MAX_PLAY_MS) return false;
  if (Number.isFinite(row.durationMs) && row.durationMs > MAX_PLAY_MS) return false;
  return !isCalibrationTrack(trackFromAudioKey(row.audioKey));
}

// The player's best finished run per song and level, with the stars of the chart that is stored now. Read from the play
// history rather than the ranking: the ranking counts a score only while its chart is unchanged, and the history does not
// forget a run because the generator moved on. An autoplay or restarted run is not a play (ranked is false).
function playsOf(rounds, starsOf) {
  const best = new Map();
  for (const round of rounds ?? []) {
    if (!round?.audioKey || round.failed || round.ranked === false || !LEVELS.includes(round.difficulty) || !Number.isFinite(round.accuracy)) continue;
    const key = `${round.audioKey}|${round.difficulty}`;
    if (!best.has(key) || round.accuracy > best.get(key).accuracy) best.set(key, round);
  }
  return [...best.values()].map((round) => ({
    audioKey: round.audioKey,
    difficulty: round.difficulty,
    accuracy: round.accuracy,
    grade: round.grade,
    stars: starsOf(round.audioKey)?.[round.difficulty] ?? null,
  }));
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// The stars the player plays comfortably: the middle of the five hardest charts they got 90% or more on. With no such run
// it is a discounted middle of everything they played. Null while they have no rated play.
function skillOf(plays) {
  const rated = (plays ?? []).filter((play) => Number.isFinite(play?.stars) && Number.isFinite(play?.accuracy));
  if (rated.length === 0) return null;
  const good = rated.filter((play) => play.accuracy >= GOOD_ACCURACY).map((play) => play.stars).sort((a, b) => b - a);
  if (good.length > 0) return { stars: median(good.slice(0, 5)), plays: rated.length, basis: "good" };
  return { stars: median(rated.map((play) => play.stars)) * 0.85, plays: rated.length, basis: "all" };
}

// The level of a song whose stars are known that suits the player: the closest to a little above their comfortable
// stars (the lower one on a tie). Null without any charted level; without a skill it is Normal, or what there is.
function levelFor(stars, skill) {
  const charted = LEVELS.filter((level) => Number.isFinite(stars?.[level]));
  if (charted.length === 0) return null;
  if (!skill) {
    const level = charted.includes("normal") ? "normal" : charted[0];
    return { level, stars: stars[level] };
  }
  const target = skill.stars * STRETCH;
  let best = charted[0];
  for (const level of charted) {
    if (Math.abs(stars[level] - target) < Math.abs(stars[best] - target)) best = level;
  }
  return { level: best, stars: stars[best] };
}

const recency = (at, now, halfLifeDays) => (Number.isFinite(at) ? 0.5 ** (Math.max(0, now - at) / (halfLifeDays * DAY_MS)) : 0);

// The songs to ask "what is like this?" about, best first: what the player played lately and did well on, one per
// artist. `justPlayed` (an audio key) comes first when it is among the rounds.
function seedsOf(rounds, { now, justPlayed = null, limit = SEEDS_PER_REFRESH } = {}) {
  const byKey = new Map();
  for (const round of rounds ?? []) {
    if (!round?.audioKey || !round.title || !round.artist) continue;
    const quality = round.failed ? 0.2 : round.accuracy >= GOOD_ACCURACY ? 1 : round.accuracy >= 80 ? 0.7 : 0.35;
    const weight = recency(round.at, now, 10) * quality;
    const known = byKey.get(round.audioKey) ?? { audioKey: round.audioKey, title: round.title, artist: round.artist, weight: 0, best: 0 };
    known.weight += weight;
    if (!round.failed) known.best = Math.max(known.best, Number(round.accuracy) || 0);
    byKey.set(round.audioKey, known);
  }
  const ordered = [...byKey.values()].sort((a, b) => (b.audioKey === justPlayed) - (a.audioKey === justPlayed) || b.weight - a.weight);
  const seeds = [];
  const artists = new Set();
  for (const seed of ordered) {
    const artist = identityOf(seed.artist, seed.artist)?.split("|")[1] || seed.artist.toLowerCase();
    if (artists.has(artist)) continue;
    artists.add(artist);
    seeds.push({
      audioKey: seed.audioKey,
      title: seed.title,
      artist: seed.artist,
      role: seed.audioKey === justPlayed ? "just" : seed.best >= GOOD_ACCURACY ? "well" : "played",
    });
    if (seeds.length >= limit) break;
  }
  return seeds;
}

// Game seeds name the song; a listening seed names what the player listens to (an artist or a song, see listeningTaste.js).
const seedReason = (seed) => (seed.role === "just" ? `Because you just played ${seed.title}`
  : seed.role === "well" ? `Because you did well on ${seed.title}`
    : seed.role === "artist" || seed.role === "listen" ? `Because you listen to ${seed.label}`
      : seed.role === "liked" ? `Because you liked ${seed.label}`
        : `Because you played ${seed.title}`);

// The seeds of a refresh: the game's and the listening ones taken turns, so one kind never crowds the other out. The
// game goes first when the player just played (the song asked for) or played within a week, the listening first when
// not. A listening seed by an artist a game seed has is left out (the game seed already asks about that artist).
function mixSeeds(game, listening, { now, rounds, justPlayed }) {
  const taken = new Set(game.map((seed) => artistKeyOf(seed.artist)));
  const listen = listening.filter((seed) => !taken.has(artistKeyOf(seed.artist)));
  const newest = Math.max(0, ...(rounds ?? []).map((round) => Number(round?.at) || 0));
  const gameFirst = game.some((seed) => seed.audioKey === justPlayed) || now - newest < RECENT_GAME_DAYS * DAY_MS;
  const first = gameFirst ? game : listen;
  const second = gameFirst ? listen : game;
  const mixed = [];
  for (let at = 0; at < Math.max(first.length, second.length); at += 1) {
    if (first[at]) mixed.push(first[at]);
    if (second[at]) mixed.push(second[at]);
  }
  return mixed.slice(0, listen.length ? SEEDS_WITH_LISTENING : SEEDS_PER_REFRESH);
}

// Songs other players played that this one has not, the ones played most and most lately first, and those with a level
// near the player's own a little ahead.
function hereRows({ played, ownKeys, ownIdentities, skill, starsOf, now, exclude }) {
  const rows = [];
  for (const track of played) {
    if (ownKeys.has(track.audioKey) || exclude.has(track.audioKey) || !isOfferable(track)) continue;
    const identity = identityOf(track.title, track.artist);
    if (identity && ownIdentities.has(identity)) continue;
    const stars = starsOf(track.audioKey);
    const pick = levelFor(stars, skill);
    const fit = pick && skill ? 1 - Math.min(1, Math.abs(pick.stars - skill.stars * STRETCH) / 3) : 0.4;
    const score = Math.log2(1 + track.plays) * 2 + recency(track.lastAt, now, 14) * 2 + fit * 1.5;
    const reason = track.plays >= 3 ? `Played ${track.plays} times by others here` : "Played by others here";
    rows.push({ ...rowOf(track), kind: "here", reason, level: pick?.level ?? null, levelStars: pick?.stars ?? null, score });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, HERE_ROWS);
}

// Songs the player knows and could do something with: a level up after a solid run, another go after a close one, a
// retry of a lost run. A song is offered once, for the first reason that applies.
function againRows({ plays, rounds, ownTracks, skill, starsOf, now, exclude }) {
  const byKey = new Map();
  for (const play of plays ?? []) {
    const level = LEVELS.indexOf(play.difficulty);
    if (level < 0 || !Number.isFinite(play.accuracy)) continue;
    const group = byKey.get(play.audioKey) ?? [];
    group[level] = play;
    byKey.set(play.audioKey, group);
  }
  const lostAt = new Map(); // `${audioKey}|${level}` -> the newest lost round of the level, when no later run was finished
  const finished = new Set();
  for (const round of rounds ?? []) { // newest first, so the first sight of a pair is its latest round
    const pair = `${round.audioKey}|${round.difficulty}`;
    if (!round.failed) finished.add(pair);
    else if (!finished.has(pair) && !lostAt.has(pair) && now - round.at < 14 * DAY_MS) lostAt.set(pair, round);
  }

  const rows = [];
  const seen = new Set();
  const offer = (audioKey, extra) => {
    const track = ownTracks.get(audioKey);
    if (seen.has(audioKey) || exclude.has(audioKey) || !isOfferable(track)) return;
    if (now - track.lastAt < 20 * 60_000) return; // just played: leave it alone for a while
    seen.add(audioKey);
    rows.push({ ...rowOf(track), kind: "again", ...extra });
  };

  for (const [audioKey, group] of byKey) {
    const stars = starsOf(audioKey);
    let top = -1;
    group.forEach((play, level) => { if (play) top = level; });
    if (top < 0) continue;
    const play = group[top];
    const nextLevel = LEVELS[top + 1];
    const nextStars = nextLevel ? stars?.[nextLevel] : null;
    if (play.accuracy >= SOLID_ACCURACY && Number.isFinite(nextStars) && (!skill || nextStars <= skill.stars * STEP_UP_MAX + 0.5)) {
      offer(audioKey, {
        reason: `${play.grade ?? "A"} on ${LEVEL_NAMES[LEVELS[top]]}, try ${LEVEL_NAMES[nextLevel]}`,
        level: nextLevel, levelStars: nextStars, score: 3 + play.accuracy / 100,
      });
    } else if (play.accuracy >= CLOSE_ACCURACY && play.accuracy < GOOD_ACCURACY) {
      const own = Number.isFinite(stars?.[LEVELS[top]]) ? stars[LEVELS[top]] : null;
      offer(audioKey, {
        reason: `${Math.round(play.accuracy)}% on ${LEVEL_NAMES[LEVELS[top]]}, one more go`,
        level: LEVELS[top], levelStars: own, score: 2 + (play.accuracy - CLOSE_ACCURACY) / 60,
      });
    }
  }
  for (const [pair, round] of lostAt) {
    const level = pair.slice(pair.lastIndexOf("|") + 1);
    if (!LEVELS.includes(level)) continue;
    offer(round.audioKey, {
      reason: `Not finished yet on ${LEVEL_NAMES[level]}`,
      level, levelStars: starsOf(round.audioKey)?.[level] ?? null, score: 2.2,
    });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, AGAIN_ROWS);
}

// The classics in an order of the player's own (so everybody does not start with the same ones), those they have not
// played first. Every entry is kept; a played one says so.
function classicRows({ classics, userId, ownKeys, ownIdentities, skill, starsOf, exclude }) {
  let hash = 0;
  for (const char of String(userId ?? "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const offset = classics.length ? hash % classics.length : 0;
  const rotated = [...classics.slice(offset), ...classics.slice(0, offset)];
  const rows = rotated
    .filter((entry) => !exclude.has(entry.audioKey) && isOfferable(entry))
    .map((entry) => {
      const pick = levelFor(starsOf(entry.audioKey), skill);
      const played = ownKeys.has(entry.audioKey) || ownIdentities.has(identityOf(entry.title, entry.artist));
      return { ...rowOf(entry), kind: "classic", reason: `From ${entry.game}`, game: entry.game, level: pick?.level ?? null, levelStars: pick?.stars ?? null, played, score: 0 };
    });
  return [...rows.filter((row) => !row.played), ...rows.filter((row) => row.played)];
}

function rowOf(track) {
  return {
    audioKey: track.audioKey,
    uri: track.uri,
    source: track.source ?? "",
    title: track.title,
    artist: track.artist ?? "",
    artworkUrl: track.artworkUrl ?? null,
    durationMs: Number.isFinite(track.durationMs) && track.durationMs > 0 ? track.durationMs : lengthOfKey(track.audioKey),
  };
}

// A few rows for the results screen, mixed: what is like the song just played first, then a retry or a level up, then
// what the server plays, then a classic. A kind with nothing to show leaves its place to the next one.
function stripOf(sections, size = STRIP_ROWS) {
  const rowsOf = (kind) => sections.find((section) => section.kind === kind)?.rows.filter((row) => !row.played) ?? [];
  const lanes = [rowsOf("similar"), rowsOf("again"), rowsOf("here"), rowsOf("classic")];
  const strip = [];
  const taken = new Set();
  for (let round = 0; round < size && strip.length < size; round += 1) {
    for (const lane of lanes) {
      const row = lane.find((candidate) => !taken.has(candidate.audioKey) && !taken.has(identityOf(candidate.title, candidate.artist)));
      if (!row || strip.length >= size) continue;
      taken.add(row.audioKey);
      taken.add(identityOf(row.title, row.artist));
      strip.push(row);
    }
  }
  return strip;
}

// How many discoveries may run: `perMinute` for everybody together, `perPlayer` for one player in `playerWindowMs`.
// Every discovery is one seed song, which costs one Last.fm lookup and a dozen Lavalink searches (autoplay's own
// candidate search), so this is what keeps the suggestions from crowding out the searches a player is waiting for.
function createSearchBudget({ now = Date.now, perMinute = 3, perPlayer = 6, playerWindowMs = 60 * 60_000 } = {}) {
  const all = [];
  const byPlayer = new Map();
  const recent = (list, since) => {
    while (list.length > 0 && list[0] <= since) list.shift();
    return list;
  };
  return {
    take(userId) {
      const at = now();
      const mine = recent(byPlayer.get(userId) ?? [], at - playerWindowMs);
      if (mine.length > 0) byPlayer.set(userId, mine);
      else byPlayer.delete(userId);
      if (recent(all, at - 60_000).length >= perMinute || mine.length >= perPlayer) return false;
      all.push(at);
      byPlayer.set(userId, [...mine, at]);
      return true;
    },
  };
}

function createRecommender({
  historyStore,
  starsReader = () => () => null,
  discover = null,
  taste = null,
  classics = CLASSICS,
  now = Date.now,
  budget = createSearchBudget({ now }),
  // How long a player's own rows are kept before they are worked out again (a new run makes them stale at once, see forget).
  baseTtlMs = 30_000,
  // Discovered songs of one seed are the same for everybody; a failure is not asked again for a while.
  seedTtlMs = 6 * 60 * 60_000,
  failedTtlMs = 5 * 60_000,
  discoverTimeoutMs = 25_000,
  maxEntries = 400,
  log = { debug() {}, warning() {} },
} = {}) {
  const bases = new Map(); // userId|guildId -> { at, value }
  const seedStates = new Map(); // seed id -> { at, rows, failed, promise }
  const running = new Set();
  const cap = (map) => {
    while (map.size > maxEntries) map.delete(map.keys().next().value);
  };

  // What the player listens to through the bot; a store that fails leaves the game's seeds alone.
  function readTasteOf(userId, guildId) {
    try {
      const read = taste?.(userId, guildId);
      return read && Array.isArray(read.tracks) && read.tracks.length > 0 ? read : null;
    } catch (error) {
      log.debug("mewbeat suggestions: listening taste failed", error?.message);
      return null;
    }
  }

  // What the player's own plays and the server's say, without any search. Shared by every kind but "similar".
  function baseOf(userId, guildId) {
    const key = `${userId}|${guildId ?? ""}`;
    const cached = bases.get(key);
    if (cached && now() - cached.at < baseTtlMs) return cached.value;

    const ownList = historyStore?.played({ userId, limit: OWN_SONGS }) ?? [];
    const ownTracks = new Map(ownList.map((track) => [track.audioKey, track]));
    const ownIdentities = new Set(ownList.map((track) => identityOf(track.title, track.artist)).filter(Boolean));
    const value = {
      ownList,
      ownTracks,
      ownKeys: new Set(ownTracks.keys()),
      ownIdentities,
      rounds: historyStore?.recent(userId, OWN_ROUNDS) ?? [],
      taste: readTasteOf(userId, guildId),
      played: historyStore?.played({ guildId: guildId ?? null, limit: HERE_SONGS }) ?? [],
    };
    bases.set(key, { at: now(), value });
    cap(bases);
    return value;
  }

  function startSeed(seed, anchor, id) {
    const state = { at: now(), rows: null, failed: false, promise: null };
    const timer = new Promise((resolve) => setTimeout(() => resolve("timeout"), discoverTimeoutMs).unref?.());
    state.promise = Promise.race([Promise.resolve().then(() => discover({ title: seed.title, artist: seed.artist }, { anchor: anchor ?? null })), timer])
      .then((found) => {
        state.rows = Array.isArray(found) ? found : null;
        state.failed = !state.rows;
      })
      .catch((error) => {
        state.failed = true;
        log.debug("mewbeat suggestions: discovery failed", error?.message);
      })
      .finally(() => {
        state.at = now();
        state.promise = null;
        running.delete(state);
      });
    running.add(state);
    seedStates.set(id, state);
    cap(seedStates);
    return state;
  }

  // The "similar" rows from what is already found, and whether more is on the way. Starts the missing searches
  // (within the budget) and returns at once.
  // `anchorFor(seed)` is the song of the player's taste that the seed's rows are also measured against, or null. A discovery
  // is the same for everybody asking with the same seed and anchor; a player with no listening has no anchor and shares
  // the plain seed's.
  function similarOf(userId, seeds, anchorFor) {
    let pending = false;
    const lists = [];
    for (const seed of seeds) {
      if (!discover) break;
      const anchor = anchorFor(seed);
      const id = `${identityOf(seed.title, seed.artist) ?? seed.audioKey ?? seed.title}${anchor ? `~${identityOf(anchor.title, anchor.artist)}` : ""}`;
      let state = seedStates.get(id);
      if (state && !state.promise && now() - state.at > (state.failed ? failedTtlMs : seedTtlMs)) state = null;
      if (!state && budget.take(userId)) state = startSeed(seed, anchor, id);
      if (state?.promise) pending = true;
      if (state?.rows) lists.push({ seed, rows: state.rows });
    }
    return { lists, pending };
  }

  // One seed says its own reason; game seeds alone are "what you play", anything with listening in it is "for you".
  const similarTitle = (seeds) => (seeds.length === 1 ? seedReason(seeds[0])
    : seeds.every((seed) => ["just", "well", "played"].includes(seed.role)) ? "Like what you play" : "Picked for you");

  function sectionsFor({ userId, guildId, seedKey = null }) {
    const base = baseOf(userId, guildId);
    const starsOf = starsReader(); // one read of the chart flags for every song looked at below
    const at = now();
    const plays = playsOf(base.rounds, starsOf);
    const skill = skillOf(plays);
    const exclude = new Set(seedKey ? [seedKey] : []);
    const gameSeeds = seedsOf(base.rounds, { now: at, justPlayed: seedKey });
    const listenSeeds = listeningSeedsOf(base.taste, { now: at, limit: SEEDS_WITH_LISTENING, skip: new Set(gameSeeds.map((seed) => artistKeyOf(seed.artist))) });
    const seeds = mixSeeds(gameSeeds, listenSeeds, { now: at, rounds: base.rounds, justPlayed: seedKey });

    const { lists, pending } = similarOf(userId, seeds, (seed) => anchorOf(base.taste, { now: at, artist: seed.artist }));
    // New songs are new to the player in the game and in what they listen to.
    const seen = new Set([...exclude, ...base.ownKeys, ...(base.taste?.tracks ?? []).map((song) => identityOf(song.title, song.artist))]);
    const similar = [];
    const queues = lists.map(({ seed, rows }) => rows
      .filter((row) => Number(row.score) >= MIN_SIMILAR_SCORE)
      .sort((a, b) => b.score - a.score)
      .map((row) => ({ seed, row })));
    for (let depth = 0; similar.length < SIMILAR_ROWS && queues.some((queue) => queue.length > depth); depth += 1) {
      for (const queue of queues) {
        const entry = queue[depth];
        if (!entry || similar.length >= SIMILAR_ROWS) continue;
        const { row, seed } = entry;
        const identity = identityOf(row.title, row.artist);
        if (seen.has(row.audioKey) || !isOfferable(row) || (identity && (base.ownIdentities.has(identity) || seen.has(identity)))) continue;
        seen.add(row.audioKey);
        if (identity) seen.add(identity);
        const pick = levelFor(starsOf(row.audioKey), skill);
        similar.push({ ...rowOf(row), kind: "similar", reason: seedReason(seed), seed: { title: seed.title, role: seed.role }, level: pick?.level ?? null, levelStars: pick?.stars ?? null, score: row.score });
      }
    }

    const again = againRows({ plays, rounds: base.rounds, ownTracks: base.ownTracks, skill, starsOf, now: at, exclude });
    const here = hereRows({ played: base.played, ownKeys: base.ownKeys, ownIdentities: base.ownIdentities, skill, starsOf, now: at, exclude });
    const classic = classicRows({ classics, userId, ownKeys: base.ownKeys, ownIdentities: base.ownIdentities, skill, starsOf, exclude });

    const sections = [
      { kind: "similar", title: similarTitle(seeds), rows: similar },
      { kind: "again", title: "Worth another go", rows: again },
      { kind: "here", title: "Played here", rows: here },
      { kind: "classic", title: "Rhythm game classics", rows: classic },
    ];
    return { sections, pending, skill };
  }

  return {
    // { sections, strip, pending, skill }: answers at once from what is known; `pending` says a search is still running
    // (ask again in a few seconds). seedKey is the song just played, which is never offered back.
    forPlayer(request) {
      const { sections, pending, skill } = sectionsFor(request);
      return { sections, strip: stripOf(sections), pending, skill: skill && { stars: Math.round(skill.stars * 10) / 10, basis: skill.basis } };
    },
    // The player's rows are worked out again at the next ask (a run was just saved).
    forget(userId) {
      for (const key of [...bases.keys()]) if (key.startsWith(`${userId}|`)) bases.delete(key);
    },
    // Resolves once every search that is running has finished (tests; nothing else waits on it).
    async idle() {
      while (running.size > 0) await Promise.all([...running].map((state) => state.promise));
    },
  };
}

module.exports = {
  MAX_PLAY_MS,
  createRecommender,
  createSearchBudget,
  identityOf,
  isOfferable,
  levelFor,
  mixSeeds,
  playsOf,
  seedsOf,
  skillOf,
  stripOf,
};
