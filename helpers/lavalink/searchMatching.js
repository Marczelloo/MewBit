// Token-level matching for search relevance. Every comparison returns a
// credit between 0 and 1, so a typo lowers a candidate's score instead of
// removing it: "metalica", "weekend" or "yourslef" still describe the song
// the provider found, and the ranking decides how far it falls.

const EXACT_CREDIT = 1;
const JOINED_CREDIT = 0.96;
const PHONETIC_CREDIT = 0.92;
const MIN_PREFIX_LENGTH = 2;
const MIN_FUZZY_LENGTH = 3;
// Ranking compares the same handful of query words against a few hundred
// titles that share most of their vocabulary, so memoised word pairs turn
// most comparisons into a map lookup.
const MAX_MEMO_ENTRIES = 20_000;
const phoneticKeys = new Map();
const similarities = [new Map(), new Map()];

function remember(memo, key, value) {
  if (memo.size >= MAX_MEMO_ENTRIES) memo.clear();
  memo.set(key, value);
  return value;
}

/**
 * A rough sound-alike key. It folds spellings people commonly mix up while
 * typing a title from memory: doubled letters, ph/f, ck/k, Polish cz/ch and
 * the English tch, sz/sh, w/v and y/i.
 */
function getPhoneticKey(token) {
  const text = String(token || "");
  const cached = phoneticKeys.get(text);
  if (cached !== undefined) return cached;
  const key = text
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/tch|ch|cz/g, "c")
    .replace(/sh|sz/g, "s")
    .replace(/w/g, "v")
    .replace(/y/g, "i")
    .replace(/(.)\1+/g, "$1");
  return remember(phoneticKeys, text, key);
}

// Optimal string alignment distance: Levenshtein plus adjacent transposition,
// so "yourslef" is one edit away from "yourself" instead of two.
function getEditDistance(left, right) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  // Three rolling rows: the transposition step looks two rows back.
  const columns = right.length + 1;
  let beforePrevious = new Array(columns).fill(0);
  let previous = Array.from({ length: columns }, (_, column) => column);
  let current = new Array(columns).fill(0);

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      let distance = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost);
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        distance = Math.min(distance, beforePrevious[column - 2] + 1);
      }
      current[column] = distance;
    }
    [beforePrevious, previous, current] = [previous, current, beforePrevious];
  }

  return previous[columns - 1];
}

// Short words tolerate one typo, long words two or three. Two-letter words
// must match exactly (or as a prefix) because almost anything is one edit away.
function getAllowedEdits(length) {
  if (length < MIN_FUZZY_LENGTH) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  return 3;
}

function getPrefixCredit(needle, candidate) {
  if (needle.length < MIN_PREFIX_LENGTH || needle.length >= candidate.length) return 0;
  if (!candidate.startsWith(needle)) return 0;
  return Math.min(0.95, 0.6 + (0.35 * needle.length) / candidate.length);
}

/**
 * How well one query word describes one candidate word. `allowPrefix` is set
 * for the word the user is still typing, so "bohem" already finds "bohemian".
 */
function getTokenSimilarity(needle, candidate, { allowPrefix = false } = {}) {
  if (!needle || !candidate) return 0;
  if (needle === candidate) return EXACT_CREDIT;

  const byCandidate = similarities[allowPrefix ? 1 : 0].get(needle) || remember(similarities[allowPrefix ? 1 : 0], needle, new Map());
  const cached = byCandidate.get(candidate);
  if (cached !== undefined) return cached;
  return remember(byCandidate, candidate, compareTokens(needle, candidate, allowPrefix));
}

function compareTokens(needle, candidate, allowPrefix) {
  let best = allowPrefix ? getPrefixCredit(needle, candidate) : 0;

  if (needle.length >= MIN_PREFIX_LENGTH && candidate.length >= MIN_PREFIX_LENGTH) {
    const needleKey = getPhoneticKey(needle);
    const candidateKey = getPhoneticKey(candidate);
    if (needleKey === candidateKey) return Math.max(best, PHONETIC_CREDIT);

    const shortest = Math.min(needle.length, candidate.length);
    const allowed = getAllowedEdits(shortest);
    if (allowed > 0 && Math.abs(needle.length - candidate.length) <= allowed) {
      const distance = Math.min(getEditDistance(needle, candidate), getEditDistance(needleKey, candidateKey));
      if (distance <= allowed) {
        best = Math.max(best, 1 - distance / Math.max(needle.length, candidate.length));
      }
    }
  }

  return best;
}

// Candidate words plus each adjacent pair glued together, so "acdc" and
// "linkinpark" match metadata spelled "AC/DC" or "Linkin Park".
function getCandidateEntries(candidateTokens) {
  const entries = candidateTokens.map((text, index) => ({ text, span: [index] }));
  for (let index = 0; index < candidateTokens.length - 1; index += 1) {
    entries.push({ text: `${candidateTokens[index]}${candidateTokens[index + 1]}`, span: [index, index + 1], joined: true });
  }
  return entries;
}

/**
 * Aligns query words with candidate words, each candidate word used at most
 * once. `credit` is the average per-word credit, `exact` the share of words
 * matched letter for letter, and `strong` how many words scored at least 0.85.
 */
function matchTokens(needleTokens, candidateTokens, { prefixToken = null } = {}) {
  const needles = Array.isArray(needleTokens) ? needleTokens : [];
  const candidates = Array.isArray(candidateTokens) ? candidateTokens : [];
  if (!needles.length) return { credit: 0, exact: 0, strong: 0, matched: 0, credits: [] };

  const entries = getCandidateEntries(candidates);
  const used = new Set();
  const credits = new Array(needles.length).fill(0);

  // Exact words first: a lookup instead of a scan, and a typo elsewhere in
  // the query can no longer take the word another query word spelled right.
  const positions = new Map();
  candidates.forEach((text, position) => positions.set(text, [...(positions.get(text) || []), position]));
  needles.forEach((needle, index) => {
    const position = (positions.get(needle) || []).find((candidate) => !used.has(candidate));
    if (position === undefined) return;
    used.add(position);
    credits[index] = EXACT_CREDIT;
  });

  // Glued query words: "linkin park" typed against an uploader "LinkinPark".
  for (let index = 0; index < needles.length - 1; index += 1) {
    if (credits[index] > 0 || credits[index + 1] > 0) continue;
    const joined = `${needles[index]}${needles[index + 1]}`;
    const target = entries.find((entry) => !entry.joined && entry.text === joined && !used.has(entry.span[0]));
    if (!target) continue;
    used.add(target.span[0]);
    credits[index] = JOINED_CREDIT;
    credits[index + 1] = JOINED_CREDIT;
    index += 1;
  }

  for (let index = 0; index < needles.length; index += 1) {
    if (credits[index] > 0) continue;
    const needle = needles[index];
    let bestEntry = null;
    let bestCredit = 0;

    for (const entry of entries) {
      if (entry.span.some((position) => used.has(position))) continue;
      let credit = getTokenSimilarity(needle, entry.text, { allowPrefix: needle === prefixToken });
      if (entry.joined) credit = Math.min(credit, JOINED_CREDIT);
      if (credit > bestCredit) {
        bestCredit = credit;
        bestEntry = entry;
      }
    }

    if (!bestEntry) continue;
    for (const position of bestEntry.span) used.add(position);
    credits[index] = bestCredit;
  }

  const total = credits.reduce((sum, credit) => sum + credit, 0);
  return {
    credit: total / needles.length,
    exact: credits.filter((credit) => credit === EXACT_CREDIT).length / needles.length,
    strong: credits.filter((credit) => credit >= 0.85).length,
    matched: credits.filter((credit) => credit > 0).length,
    credits,
  };
}

module.exports = {
  getAllowedEdits,
  getEditDistance,
  getPhoneticKey,
  getTokenSimilarity,
  matchTokens,
};
