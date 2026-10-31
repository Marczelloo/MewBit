const PRESENTATION_LABEL_PATTERN = /^(?:official(?:\s+(?:music\s+)?(?:video|audio|mv|lyric\s+video))?|lyrics?|lyric\s+video|audio|video|visuali[sz]er|hq|hd|4k|8k)$/i;
const NEUTRAL_TITLE_LABEL_PATTERN = /^(?:original|original\s+version|single(?:\s+version)?|album(?:\s+version)?|explicit)\s*$/i;
const UPLOADER_CHANNEL_PATTERN = /\b(?:clean\s+songs?|que\s+quality|topic|vevo|official(?:\s+artist)?\s+channel|lyrics?(?:\s+channel)?|music\s+lyrics)\b/i;
const TRAILING_VARIANT_LABEL_PATTERN = /^(.*?)(?:\s+)(?:remix|remixed|rework|bootleg|acoustic|unplugged|stripped|demo|rehearsal|cover|tribute|instrumental|karaoke|nightcore|slowed|sped\s*up|speed\s*up|chopped\s*(?:and\s*)?(?:screwed|slopped)|choppednotslopped|radio\s*edit|extended(?:\s+(?:mix|version))?|club\s+mix|dj\s+mix|remaster(?:ed)?|anniversary\s+edition|\d{3}\s?hz|8d(?:\s+audio)?|bass\s*boost(?:ed)?)(?:\s+(?:version|mix))?\s*$/i;

const VARIANT_DEFINITIONS = [
  ["remix", /\b(?:remix|remixed|rework|bootleg)\b/i],
  ["live", /\b(?:live(?:\s+(?:version|performance|session|at|from))?|concert\s+version|concert)\b/i],
  ["acoustic", /\b(?:acoustic|unplugged|stripped|piano\s+version|orchestral\s+version)\b/i],
  ["demo", /\b(?:demo|rehearsal|rough\s+mix|early\s+version|(?:work|writing)\s+in\s+progress)\b/i],
  ["cover", /\b(?:cover|tribute)\b/i],
  ["instrumental", /\b(?:instrumental|karaoke|backing\s+track)\b/i],
  ["tempo", /\b(?:nightcore|slowed(?:\s*(?:\+|and)\s*reverb)?|sped\s*up|speed\s*up)\b/i],
  ["chopped", /\b(?:chopped\s*(?:and\s*)?(?:screwed|slopped)|choppednotslopped)\b/i],
  ["edit", /\b(?:radio\s*edit|extended(?:\s+(?:mix|version))?|club\s+mix|dj\s+mix|edit)\b/i],
  ["clean", /\b(?:clean|censored|radio\s+version)\b/i],
  ["remaster", /\b(?:remaster(?:ed)?|anniversary\s+edition)\b/i],
  // Retuned or processed re-uploads (432 Hz, 8D, bass boosted) of a recording.
  ["pitch", /\b(?:\d{3}\s?hz|8d(?:\s+audio)?|bass\s*boost(?:ed)?)\b/i],
  ["novelty", /\b(?:(?:8|16)[\s-]?bit|chiptune|emulation|parody|type\s+beat|lullaby|music\s+box|game\s*boy\s+sound)\b/i],
];

function normalizeComparableText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[łŁ]/g, "l")
    .toLowerCase()
    .replace(/^(?:dzsearch|ytsearch|spsearch|scsearch|ytmsearch):\s*/i, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanArtistName(value) {
  return String(value || "")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/(?:\s|-)*(?:official\s+artist\s+channel|topic|vevo|records?)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// YouTube's auto-generated "Artist - Topic" channels carry the real artist
// name. Only that suffix goes: unlike cleanArtistName, the rest of the name
// is shown and sent exactly as the platform has it.
function stripTopicSuffix(value) {
  return String(value || "").replace(/\s*-\s*Topic\s*$/i, "").trim();
}

function getDecoratedSegments(value) {
  const title = String(value || "").trim();
  const segments = [];

  for (const match of title.matchAll(/(?:\[([^\]]+)\]|\(([^)]+)\))/g)) {
    const segment = (match[1] || match[2] || "").trim();
    if (segment) segments.push({ value: segment, start: match.index, end: match.index + match[0].length });
  }

  const suffix = title.match(/\s[-–—|]\s([^–—|]+)$/);
  if (suffix?.[1]?.trim()) {
    const start = title.length - suffix[0].length;
    segments.push({ value: suffix[1].trim(), start, end: title.length, suffix: true });
  }

  return segments;
}

function getVariantKinds(value) {
  const title = String(value || "").trim();
  const segments = getDecoratedSegments(title).map((segment) => segment.value);
  const trailing = title.match(/\b(?:remix|remixed|rework|bootleg|acoustic|unplugged|stripped|demo|rehearsal|cover|tribute|instrumental|karaoke|nightcore|slowed|sped\s*up|speed\s*up|chopped\s*(?:and\s*)?(?:screwed|slopped)|choppednotslopped|radio\s*edit|extended(?:\s+(?:mix|version))?|club\s+mix|dj\s+mix|clean|censored|radio\s+version|remaster(?:ed)?|anniversary\s+edition|type\s+beat|parody|\d{3}\s?hz|8d(?:\s+audio)?|bass\s*boost(?:ed)?)(?:\s+(?:version|mix))?\s*$/i);
  if (trailing) segments.push(trailing[0]);

  const kinds = new Set();
  for (const segment of segments) {
    for (const [kind, pattern] of VARIANT_DEFINITIONS) {
      if (pattern.test(segment)) kinds.add(kind);
    }
  }

  return [...kinds];
}

// A bracket or " - " label read as a whole: "Live" and "8-Bit Emulation"
// carry no inner label for getVariantKinds to find, yet are the variant.
function isVariantLabel(label) {
  return VARIANT_DEFINITIONS.some(([, pattern]) => pattern.test(label));
}

// Kinds that uploads append to the song name itself ("Artist - Song 432hz"),
// so a " - " suffix ending in one is still the song, not a credit.
const APPENDED_VARIANT_KINDS = new Set(["pitch", "tempo", "novelty"]);

// A " - " suffix is the variant when it opens with the label ("Live at
// Wembley", "Bass Boosted") or ends in a credit ("Mark Ronson Remix").
function isVariantSuffix(label) {
  const text = String(label || "").replace(/^\d{4}\s+/, "");
  if (VARIANT_DEFINITIONS.some(([, pattern]) => pattern.exec(text)?.index === 0)) return true;
  return getVariantKinds(text).some((kind) => !APPENDED_VARIANT_KINDS.has(kind));
}

function stripPresentationNoise(value) {
  let title = String(value || "").trim();
  let previous;

  do {
    previous = title;
    title = title
      .replace(/\s*(?:\[([^\]]+)\]|\(([^)]+)\))/g, (match, squareLabel, roundLabel) => {
        const label = (squareLabel || roundLabel || "").trim();
        return PRESENTATION_LABEL_PATTERN.test(label) ? "" : match;
      })
      .replace(/\s[-–—|]\s*(official(?:\s+(?:music\s+)?(?:video|audio|mv|lyric\s+video))?|lyrics?|lyric\s+video|audio|video|visuali[sz]er|hq|hd|4k|8k)\s*$/i, "")
      .replace(/\s{2,}/g, " ")
      .replace(/[\s-–—|]+$/g, "")
      .trim();
  } while (title !== previous);

  return title;
}

function stripVariantDecorators(value) {
  let title = stripPresentationNoise(value);
  const removable = getDecoratedSegments(title)
    .filter((segment) => (segment.suffix ? isVariantSuffix(segment.value) : isVariantLabel(segment.value))
      || NEUTRAL_TITLE_LABEL_PATTERN.test(segment.value.trim()))
    .sort((left, right) => right.start - left.start);

  for (const segment of removable) {
    title = `${title.slice(0, segment.start)}${title.slice(segment.end)}`.replace(/\s{2,}/g, " ").trim();
  }

  const trailingVariant = title.match(TRAILING_VARIANT_LABEL_PATTERN);
  if (trailingVariant?.[1]?.trim()) title = trailingVariant[1].trim();

  return title.replace(/[\s-–—|]+$/g, "").trim();
}

function getBaseTitle(value) {
  return normalizeComparableText(stripVariantDecorators(value));
}

// Brackets that tell one song from another: "(Part 2)", "[Vol. 3]", "(2)".
const DISTINGUISHING_BRACKET_PATTERN = /\d|\b(?:part|pt|vol|chapter|reprise|interlude|intro|outro|skit)\b/i;

/**
 * The base title with every remaining bracket dropped too: soundtrack and
 * credit tags ("[Cyberpunk: Edgerunners II] (Talia Yang)") that uploads add
 * around the same song. Brackets that can tell songs apart stay.
 */
function getCoreTitle(value) {
  const title = stripVariantDecorators(value).replace(/\s*(?:\[([^\]]*)\]|\(([^)]*)\))/g, (match, square, round) =>
    DISTINGUISHING_BRACKET_PATTERN.test(square || round || "") ? match : " "
  );
  return normalizeComparableText(title);
}

function queryRequestsVariant(query, candidateTitle) {
  const requested = getVariantKinds(query);
  const candidate = getVariantKinds(candidateTitle);
  if (!candidate.length) return false;
  if (!requested.length) return false;
  return candidate.every((kind) => requested.includes(kind));
}

function isUnrequestedAlternateVersion(candidateTitle, query) {
  const candidateKinds = getVariantKinds(candidateTitle);
  if (!candidateKinds.length) return false;
  return !queryRequestsVariant(query, candidateTitle);
}

/**
 * Autoplay has a different version policy than an explicit user search.
 *
 * Tempo styles (nightcore, slowed, sped-up) are valid listening lanes and
 * should be allowed to form their own radio session. Other alternate versions
 * are only carried forward when the current reference is already in the same
 * lane; this prevents an original recording from silently turning into a
 * random remix/cover while preserving remix and live sessions.
 */
function getAutoplayVersionCompatibility(candidateTitle, referenceTitle = "") {
  const candidateKinds = getVariantKinds(candidateTitle);
  if (!candidateKinds.length) return { allowed: true, mode: "original", candidateKinds, referenceKinds: [] };

  const referenceKinds = getVariantKinds(referenceTitle);
  const tempoOnly = candidateKinds.every((kind) => kind === "tempo");
  if (tempoOnly) {
    return {
      allowed: true,
      mode: referenceKinds.includes("tempo") ? "tempo-consistent" : "tempo-style",
      candidateKinds,
      referenceKinds,
    };
  }

  const matchesReference = candidateKinds.every((kind) => referenceKinds.includes(kind));
  return {
    allowed: matchesReference,
    mode: matchesReference ? "reference-consistent" : "unmatched-alternate",
    candidateKinds,
    referenceKinds,
  };
}

function cleanTrackMetadata(title, author) {
  const rawTitle = String(title || "").trim();
  const suppliedArtist = cleanArtistName(author);
  const parts = rawTitle.split(/\s[-–—]\s/);
  let searchArtist = suppliedArtist;
  let cleanTitle = rawTitle;

  if (parts.length >= 2) {
    const prefix = cleanArtistName(parts[0]);
    const normalizedPrefix = normalizeComparableText(prefix).replace(/\s/g, "");
    const normalizedArtist = normalizeComparableText(suppliedArtist).replace(/\s/g, "");
    if (!normalizedArtist || normalizedPrefix === normalizedArtist || UPLOADER_CHANNEL_PATTERN.test(suppliedArtist)) {
      searchArtist = prefix || suppliedArtist;
      cleanTitle = parts.slice(1).join(" - ").trim();
    }
  }

  return {
    cleanTitle: stripVariantDecorators(cleanTitle),
    searchArtist: cleanArtistName(searchArtist),
  };
}

module.exports = {
  cleanArtistName,
  cleanTrackMetadata,
  getBaseTitle,
  getCoreTitle,
  getAutoplayVersionCompatibility,
  getVariantKinds,
  isUnrequestedAlternateVersion,
  normalizeComparableText,
  queryRequestsVariant,
  stripPresentationNoise,
  stripTopicSuffix,
  stripVariantDecorators,
};
