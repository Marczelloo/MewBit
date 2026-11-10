// A pure-JS slicer for Ogg Opus files: cuts a stretch of an already rendered song out as a smaller, valid Ogg Opus
// file, so a song-select preview downloads and decodes about 30 s instead of the whole song.
//
// How the cut stays valid (RFC 7845):
// - The two header pages (OpusHead, OpusTags) are kept as they are.
// - The audio pages are whole pages from the one that holds the wanted start, to the one that reaches the end of the
//   window. A page that continues a packet of the previous page is never a start.
// - A page's granule position counts the samples decoded up to its last whole packet, pre-skip included, from the
//   start of the stream. The clip is its own stream, so every kept granule has the granule of the page before the first
//   kept page (base) taken off. The decoder then drops the same pre-skip from the clip's start (a warm-up), and the
//   clip's first output sample is the song's sample at `base`: clipStartMs = base / 48.
// - Sequence numbers are renumbered, the last page is marked end-of-stream, and the CRC of each changed page is redone.

const OPUS_RATE = 48000;
const MS_SAMPLES = OPUS_RATE / 1000;
// The decoder needs a little audio before the wanted start to settle; the page chosen starts at least this early.
const PREROLL_SAMPLES = 3840;
const DEFAULT_WINDOW_MS = 30_000;
// A song with no known highlight is previewed from this share of it (the client's CLIP_DEFAULT_SHARE).
const DEFAULT_START_SHARE = 0.4;
const FLAG_CONTINUED = 0x01;
const FLAG_EOS = 0x04;
const NO_GRANULE = 0xffffffffffffffffn;

// Ogg's CRC-32: polynomial 0x04c11db7, MSB first, start 0, no final xor.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let r = i << 24;
    for (let bit = 0; bit < 8; bit += 1) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

function oggCrc(buf, start = 0, end = buf.length, skipFrom = -1) {
  let crc = 0;
  for (let i = start; i < end; i += 1) {
    const byte = i >= skipFrom && i < skipFrom + 4 ? 0 : buf[i];
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  }
  return crc;
}

// All pages of a buffer, or null when it is not a clean sequence of Ogg pages.
function parsePages(buf) {
  const pages = [];
  let offset = 0;
  while (offset < buf.length) {
    if (offset + 27 > buf.length || buf.toString("latin1", offset, offset + 4) !== "OggS" || buf[offset + 4] !== 0) return null;
    const segments = buf[offset + 26];
    const headerLength = 27 + segments;
    if (offset + headerLength > buf.length) return null;
    let bodyLength = 0;
    for (let i = 0; i < segments; i += 1) bodyLength += buf[offset + 27 + i];
    const length = headerLength + bodyLength;
    if (offset + length > buf.length) return null;
    const raw = buf.readBigUInt64LE(offset + 6);
    pages.push({
      offset,
      length,
      headerLength,
      flags: buf[offset + 5],
      granule: raw === NO_GRANULE ? null : Number(raw),
      serial: buf.readUInt32LE(offset + 14),
      continued: Boolean(buf[offset + 5] & FLAG_CONTINUED),
    });
    offset += length;
  }
  return pages;
}

// What the file is, without cutting it: { pages, headerPages, preSkip, endGranule, durationMs } or null when it is not
// an Ogg Opus stream this slicer understands (one logical stream).
function inspectOpus(buf) {
  const pages = parsePages(buf);
  if (!pages || pages.length < 3) return null;
  const first = pages[0];
  if (buf.toString("latin1", first.offset + first.headerLength, first.offset + first.headerLength + 8) !== "OpusHead") return null;
  if (pages.some((page) => page.serial !== first.serial)) return null;
  const preSkip = buf.readUInt16LE(first.offset + first.headerLength + 10);
  // Header pages: the OpusHead page and the pages up to the end of OpusTags, which all have granule 0 (or none).
  let headerPages = 1;
  while (headerPages < pages.length && (pages[headerPages].granule === 0 || pages[headerPages].granule === null)) headerPages += 1;
  if (headerPages >= pages.length) return null;
  let endGranule = 0;
  for (let i = pages.length - 1; i >= headerPages; i -= 1) {
    if (pages[i].granule !== null) { endGranule = pages[i].granule; break; }
  }
  if (!(endGranule > preSkip)) return null;
  return { pages, headerPages, preSkip, endGranule, durationMs: Math.round((endGranule - preSkip) / MS_SAMPLES) };
}

// Where a preview of the song starts, in the same terms as the client: the wanted time, or a share of the song when
// there is none, then early enough to leave the window to hear.
function effectiveStartMs(fromMs, durationMs, windowMs = DEFAULT_WINDOW_MS) {
  const wanted = Number.isFinite(fromMs) && fromMs >= 0 ? fromMs : durationMs * DEFAULT_START_SHARE;
  return Math.max(0, Math.min(wanted, durationMs - windowMs));
}

function writePage(source, page, { granule, sequence, flags }) {
  const out = Buffer.from(source.subarray(page.offset, page.offset + page.length));
  out[5] = flags;
  out.writeBigUInt64LE(granule === null ? NO_GRANULE : BigInt(granule), 6);
  out.writeUInt32LE(sequence, 18);
  out.writeUInt32LE(oggCrc(out, 0, out.length, 22), 22);
  return out;
}

// Cuts about windowMs of the song from fromMs on. Returns { data, clipStartMs, fromMs, durationMs, clipDurationMs }:
// data is a complete Ogg Opus file whose first output sample is the song's sample at clipStartMs, fromMs is the start
// the preview should play from (song time, after clamping), durationMs the whole song's. Returns null when the file
// can't be cut (not Ogg Opus), and { whole: true, durationMs } when the song is too short to be worth cutting.
function sliceOpusOgg(buf, { fromMs = null, windowMs = DEFAULT_WINDOW_MS } = {}) {
  const info = inspectOpus(buf);
  if (!info) return null;
  const { pages, headerPages, preSkip, endGranule, durationMs } = info;
  // Pages are seconds long (a few hundred KB of the file at most), so a cut near the whole song would save nothing.
  if (durationMs <= windowMs * 1.5) return { whole: true, durationMs };

  const startMs = effectiveStartMs(fromMs, durationMs, windowMs);
  const wantedStart = startMs * MS_SAMPLES + preSkip; // granule coordinates: preSkip samples sit before song time 0
  const windowSamples = windowMs * MS_SAMPLES;

  // The last page that starts, with pre-roll to spare, at or before the wanted start and does not continue a packet.
  let startIndex = headerPages;
  let base = 0;
  let previousGranule = 0;
  for (let i = headerPages; i < pages.length; i += 1) {
    if (!pages[i].continued && previousGranule <= wantedStart - PREROLL_SAMPLES) {
      startIndex = i;
      base = previousGranule;
    }
    if (previousGranule > wantedStart - PREROLL_SAMPLES) break;
    if (pages[i].granule !== null) previousGranule = pages[i].granule;
  }

  let endIndex = pages.length - 1;
  for (let i = startIndex; i < pages.length; i += 1) {
    if (pages[i].granule !== null && pages[i].granule - base >= wantedStart - base + windowSamples) { endIndex = i; break; }
  }
  // A page ending on a partial packet can't close the stream: go on to the page that completes it.
  while (endIndex < pages.length - 1 && pages[endIndex].granule === null) endIndex += 1;

  const parts = [];
  for (let i = 0; i < headerPages; i += 1) parts.push(buf.subarray(pages[i].offset, pages[i].offset + pages[i].length));
  let sequence = headerPages;
  let lastGranule = 0;
  for (let i = startIndex; i <= endIndex; i += 1) {
    const page = pages[i];
    const granule = page.granule === null ? null : page.granule - base;
    if (granule !== null) lastGranule = granule;
    const last = i === endIndex;
    parts.push(writePage(buf, page, {
      granule,
      sequence,
      flags: (page.flags & ~FLAG_CONTINUED) | (last ? FLAG_EOS : 0),
    }));
    sequence += 1;
  }
  return {
    data: Buffer.concat(parts),
    clipStartMs: base / MS_SAMPLES,
    fromMs: startMs,
    durationMs,
    clipDurationMs: Math.round((lastGranule - preSkip) / MS_SAMPLES),
  };
}

module.exports = { OPUS_RATE, DEFAULT_WINDOW_MS, effectiveStartMs, inspectOpus, oggCrc, parsePages, sliceOpusOgg };
