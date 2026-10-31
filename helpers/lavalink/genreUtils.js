const FAMILY_RULES = [
  ["hiphop", /\b(hip[ -]?hop|rap|trap|drill|grime|boom bap|cloud rap|emo rap)\b/i],
  ["metal", /\b(metal|metalcore|deathcore|nu metal|doom metal|black metal|thrash metal|power metal)\b/i],
  ["rock", /\b(rock|alternative|indie|punk|grunge|emo|post[ -]?rock|shoegaze|hard rock)\b/i],
  ["electronic", /\b(electronic|edm|house|techno|trance|dubstep|drum and bass|dnb|electro|synthwave|hyperpop)\b/i],
  ["pop", /\b(pop|dance pop|electropop|teen pop|art pop|bedroom pop)\b/i],
  ["rnb", /\b(r&b|rnb|soul|neo soul|funk|motown)\b/i],
  ["jazz", /\b(jazz|bebop|swing|blues|fusion)\b/i],
  ["classical", /\b(classical|baroque|orchestral|opera|piano)\b/i],
  ["country", /\b(country|bluegrass|americana|folk)\b/i],
  ["latin", /\b(latin|reggaeton|salsa|bachata|cumbia)\b/i],
  ["reggae", /\b(reggae|dancehall|dub|ska)\b/i],
  ["kpop", /\b(k[ -]?pop|korean pop)\b/i],
  ["jpop", /\b(j[ -]?pop|japanese pop|city pop)\b/i],
];

const COMPATIBLE_FAMILIES = new Set([
  "electronic:hiphop",
  "electronic:pop",
  "electronic:rock",
  "hiphop:rnb",
  "hiphop:pop",
  "jpop:pop",
  "kpop:pop",
  "metal:rock",
  "pop:rnb",
  "jazz:rnb",
  "rnb:funk",
  "latin:reggae",
]);

const GENRE_ALIASES = [
  [/\br\s*(?:and|n)\s*b\b|\brnb\b/gi, "rnb"],
  [/\bhip[\s-]?hop\b/gi, "hiphop"],
  [/\bsynth[\s-]?pop\b/gi, "synthpop"],
  [/\belectro[\s-]?pop\b/gi, "electropop"],
  [/\bdrum\s*(?:and|n)\s*bass\b/gi, "dnb"],
  [/\bk[\s-]?pop\b/gi, "kpop"],
  [/\bj[\s-]?pop\b/gi, "jpop"],
];

// These tags are useful to prevent a completely unrelated jump, but they are
// too broad to prove that two tracks belong in the same DJ transition.
const GENERIC_GENRE_TAGS = new Set([
  "alternative",
  "dance",
  "electronic",
  "hiphop",
  "indie",
  "metal",
  "pop",
  "rap",
  "rock",
]);

const NON_MUSIC_TAG_PATTERN = /^(?:\d{4}s?|\d{2}s|\d{4}\s+music|seen\s+live|want\s+to\s+see\s+live|favorite(?:s)?|favourites?|my\s+(?:favorites?|favourites?|music|shit)|female\s+vocalists?|male\s+vocalists?|under\s+\d+\s+listeners|awesome|love|loved|beautiful|cool|best|good|bad|garbage|spotify|last\s*fm|scrobble(?:d)?|heard\s+on|playlist|indie\s+playlist|english|polish|american|british|german|french|swedish|canadian|japanese|korean)$/i;
const LOW_SIGNAL_CONTEXT_TAG_PATTERN = /^(?:mortality|freedom\s+vs\s+conformity|jazz\s+elements?|rain|clipe|estudo|violao|official(?:\s+audio)?|music\s+video|pro\s+drums(?:\s+fc)?|clone\s+hero|cover|parody)$/i;

function isNoisyGenreTag(genre) {
  const tag = normalizeGenre(genre);
  if (!tag) return true;

  // Last.fm also returns listener-made sentences, radio names and playlist
  // fragments. They are useful for discovery, but too unstable to steer DJ
  // transitions or build a session profile.
  if (tag.length > 32 || tag.split(" ").length > 4) return true;
  if (/\b(?:fm|radio|listeners?|scrobble|playlist|station|channel)\b/i.test(tag)) return true;
  if (/\d/.test(tag) && !/^\d{4}s?$/.test(tag)) return true;
  if (/^(?:my|the)\s+(?:pussy|favorite|favourite|personal|own)\b/i.test(tag)) return true;
  if (LOW_SIGNAL_CONTEXT_TAG_PATTERN.test(tag)) return true;

  return false;
}

function normalizeGenre(genre) {
  let normalized = String(genre || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[łŁ]/g, "l")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[._/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [pattern, replacement] of GENRE_ALIASES) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized.replace(/\s+/g, " ").trim();
}

function isContextTag(genre, context = {}) {
  const tag = normalizeGenre(genre);
  if (!tag) return false;

  const contextValues = [context.artist, context.title]
    .map(normalizeGenre)
    .filter((value) => value.length >= 4);

  return contextValues.some((value) => tag === value || (tag.length >= 6 && value.includes(tag)) || (value.length >= 6 && tag.includes(value)));
}

function normalizeGenreTags(genres = [], context = {}) {
  const unique = new Set();

  for (const genre of Array.isArray(genres) ? genres : []) {
    const normalized = normalizeGenre(genre);
    if (
      !normalized ||
      NON_MUSIC_TAG_PATTERN.test(normalized) ||
      isNoisyGenreTag(normalized) ||
      isContextTag(normalized, context)
    )
      continue;
    unique.add(normalized);
  }

  return [...unique];
}

function isGenericGenreTag(genre) {
  return GENERIC_GENRE_TAGS.has(normalizeGenre(genre));
}

function getGenreFamilies(genres = []) {
  const families = new Set();

  for (const genre of normalizeGenreTags(genres)) {
    const normalized = genre;
    for (const [family, pattern] of FAMILY_RULES) {
      if (pattern.test(normalized)) families.add(family);
    }
  }

  return [...families];
}

function areGenreFamiliesCompatible(left = [], right = []) {
  if (!left.length || !right.length) return null;

  if (left.some((family) => right.includes(family))) return true;

  return left.some((leftFamily) =>
    right.some((rightFamily) => {
      const pair = [leftFamily, rightFamily].sort().join(":");
      return COMPATIBLE_FAMILIES.has(pair);
    })
  );
}

function findGenreOverlap(left = [], right = []) {
  const normalizedLeft = normalizeGenreTags(left);
  const normalizedRight = normalizeGenreTags(right);

  return normalizedLeft.filter((genre) =>
    normalizedRight.some((other) => genre === other || genre.includes(other) || other.includes(genre))
  );
}

function findSpecificGenreOverlap(left = [], right = []) {
  const normalizedLeft = normalizeGenreTags(left).filter((genre) => !GENERIC_GENRE_TAGS.has(genre));
  const normalizedRight = normalizeGenreTags(right).filter((genre) => !GENERIC_GENRE_TAGS.has(genre));

  return normalizedLeft.filter((genre) =>
    normalizedRight.some((other) => genre === other || genre.includes(other) || other.includes(genre))
  );
}

function getGenreBridgeStrength(left = [], right = []) {
  const specificOverlap = findSpecificGenreOverlap(left, right);
  if (specificOverlap.length > 0) return { strength: 3, specificOverlap };

  const overlap = findGenreOverlap(left, right);
  if (overlap.length > 0) return { strength: 2, specificOverlap: [] };

  const compatible = areGenreFamiliesCompatible(getGenreFamilies(left), getGenreFamilies(right));
  return { strength: compatible === true ? 1 : 0, specificOverlap: [] };
}


// Neighbouring genre families on the autoplay "map". One step (rap -> r&b,
// rock -> metal) is a natural DJ move; two steps need the session to already
// lean that way; three steps (rap -> metal) is the jarring jump listeners
// complain about.
const FAMILY_NEIGHBOURS = [
  ["hiphop", "rnb"],
  ["hiphop", "pop"],
  ["hiphop", "electronic"],
  ["hiphop", "reggae"],
  ["hiphop", "latin"],
  ["rnb", "pop"],
  ["rnb", "jazz"],
  ["pop", "electronic"],
  ["pop", "rock"],
  ["pop", "kpop"],
  ["pop", "jpop"],
  ["pop", "latin"],
  ["pop", "country"],
  ["electronic", "rock"],
  ["rock", "metal"],
  ["rock", "country"],
  ["jazz", "classical"],
  ["latin", "reggae"],
  ["kpop", "jpop"],
];

const FAMILY_GRAPH = FAMILY_NEIGHBOURS.reduce((graph, [left, right]) => {
  if (!graph.has(left)) graph.set(left, new Set());
  if (!graph.has(right)) graph.set(right, new Set());
  graph.get(left).add(right);
  graph.get(right).add(left);
  return graph;
}, new Map());

function getFamilyDistance(from, to) {
  if (from === to) return 0;
  if (!FAMILY_GRAPH.has(from) || !FAMILY_GRAPH.has(to)) return Infinity;
  const visited = new Set([from]);
  let frontier = [from];
  for (let distance = 1; frontier.length; distance += 1) {
    const next = [];
    for (const family of frontier) {
      for (const neighbour of FAMILY_GRAPH.get(family)) {
        if (neighbour === to) return distance;
        if (visited.has(neighbour)) continue;
        visited.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return Infinity;
}

function getGenreFamilyDistance(left = [], right = []) {
  if (!left.length || !right.length) return null;
  let best = Infinity;
  for (const leftFamily of left) {
    for (const rightFamily of right) best = Math.min(best, getFamilyDistance(leftFamily, rightFamily));
  }
  return best;
}

/**
 * Families of the leading genre tags only. Tag lists are ordered by weight,
 * so a rap track tagged "...rock" far down the list is still a rap track.
 */
function getCoreGenreFamilies(genres = [], tagLimit = 2) {
  const families = new Set();
  let tagsUsed = 0;
  for (const genre of normalizeGenreTags(genres)) {
    const tagFamilies = FAMILY_RULES.filter(([, pattern]) => pattern.test(genre)).map(([family]) => family);
    if (!tagFamilies.length) continue;
    tagFamilies.forEach((family) => families.add(family));
    tagsUsed += 1;
    if (tagsUsed >= tagLimit) break;
  }
  return [...families];
}

/**
 * Decides whether a candidate keeps the session's genre flow. The reference
 * is the track playing now; the anchor is what the listener chose themselves,
 * which stops a slow drift (pop -> rock -> metal) from walking away from it.
 *
 * Returns { allowed, distance, anchorDistance, reason } where distance is null
 * when the candidate or the session has no usable genre data.
 */
function evaluateGenreFlow(candidateGenres = [], referenceGenres = [], anchorGenres = []) {
  const candidateCore = getCoreGenreFamilies(candidateGenres, 1);
  const referenceCore = getCoreGenreFamilies(referenceGenres, 2);
  const anchorCore = getCoreGenreFamilies(anchorGenres, 2);
  const sessionCore = referenceCore.length ? referenceCore : anchorCore;

  if (!candidateCore.length) return { allowed: true, distance: null, anchorDistance: null, reason: "unknown-candidate" };
  if (!sessionCore.length) return { allowed: true, distance: null, anchorDistance: null, reason: "unknown-session" };

  // A shared specific tag ("polish hip hop", "shoegaze") is a real bridge even
  // when the leading families differ.
  if (findSpecificGenreOverlap(candidateGenres, referenceGenres.length ? referenceGenres : anchorGenres).length) {
    return { allowed: true, distance: 0, anchorDistance: 0, reason: "shared-tag" };
  }

  const distance = getGenreFamilyDistance(candidateCore, sessionCore);
  const anchorDistance = anchorCore.length ? getGenreFamilyDistance(candidateCore, anchorCore) : distance;

  if (distance <= 1 && anchorDistance <= 2) return { allowed: true, distance, anchorDistance, reason: "near" };
  if (distance === 2 && anchorDistance <= 1) return { allowed: true, distance, anchorDistance, reason: "bridge" };
  return {
    allowed: false,
    distance: Number.isFinite(distance) ? distance : null,
    anchorDistance: Number.isFinite(anchorDistance) ? anchorDistance : null,
    reason: distance > 1 ? "genre-jump" : "anchor-drift",
  };
}

module.exports = {
  normalizeGenre,
  normalizeGenreTags,
  isNoisyGenreTag,
  isGenericGenreTag,
  getGenreFamilies,
  areGenreFamiliesCompatible,
  findGenreOverlap,
  findSpecificGenreOverlap,
  getGenreBridgeStrength,
  getCoreGenreFamilies,
  getGenreFamilyDistance,
  evaluateGenreFlow,
};
