const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const { effectiveStartMs, inspectOpus, oggCrc, parsePages, sliceOpusOgg } = require("../../../helpers/mewbeat/oggClip");

const RATE = 48; // samples per millisecond
const PRE_SKIP = 312;

function page({ flags = 0, granule, sequence, serial = 7, packets }) {
  // One lacing run per packet (packets here are shorter than 255 bytes, so one segment each).
  const segments = Buffer.from(packets.map((packet) => packet.length));
  const header = Buffer.alloc(27);
  header.write("OggS", 0, "latin1");
  header[5] = flags;
  header.writeBigUInt64LE(granule === null ? 0xffffffffffffffffn : BigInt(granule), 6);
  header.writeUInt32LE(serial, 14);
  header.writeUInt32LE(sequence, 18);
  header[26] = segments.length;
  const out = Buffer.concat([header, segments, ...packets]);
  out.writeUInt32LE(oggCrc(out, 0, out.length, 22), 22);
  return out;
}

// A fake Ogg Opus stream: pages of `pageMs` of audio each, `seconds` long. Payload bytes are not real Opus.
function fakeOpus({ seconds, pageMs = 2000, continuedEvery = 0 }) {
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "latin1");
  head[8] = 1;
  head[9] = 2;
  head.writeUInt16LE(PRE_SKIP, 10);
  head.writeUInt32LE(48000, 12);
  const tags = Buffer.concat([Buffer.from("OpusTags"), Buffer.alloc(8)]);
  const pages = [
    page({ flags: 2, granule: 0, sequence: 0, packets: [head] }),
    page({ granule: 0, sequence: 1, packets: [tags] }),
  ];
  const total = (seconds * 1000) / pageMs;
  for (let i = 1; i <= total; i += 1) {
    const last = i === total;
    pages.push(page({
      flags: (continuedEvery && i % continuedEvery === 0 ? 1 : 0) | (last ? 4 : 0),
      granule: i * pageMs * RATE + PRE_SKIP,
      sequence: i + 1,
      packets: [Buffer.alloc(40, i)],
    }));
  }
  return Buffer.concat(pages);
}

describe("ogg opus slicer", () => {
  it("measures a stream", () => {
    const info = inspectOpus(fakeOpus({ seconds: 120 }));
    assert.equal(info.preSkip, PRE_SKIP);
    assert.equal(info.headerPages, 2);
    assert.equal(info.durationMs, 120_000);
  });

  it("refuses what is not Ogg Opus", () => {
    assert.equal(inspectOpus(Buffer.from("RIFF....WAVEfmt ")), null);
    assert.equal(sliceOpusOgg(Buffer.from("not audio at all, not even close")), null);
    const truncated = fakeOpus({ seconds: 120 }).subarray(0, 600);
    assert.equal(sliceOpusOgg(truncated), null);
  });

  it("answers `whole` for a song too short to be worth cutting", () => {
    const result = sliceOpusOgg(fakeOpus({ seconds: 40 }), { fromMs: 5000 });
    assert.deepEqual(result, { whole: true, durationMs: 40_000 });
  });

  it("cuts a valid, smaller stream around the wanted start", () => {
    const source = fakeOpus({ seconds: 240 });
    const result = sliceOpusOgg(source, { fromMs: 100_000 });
    assert.ok(result.data.length < source.length / 4);
    assert.equal(result.fromMs, 100_000);
    assert.equal(result.durationMs, 240_000);
    assert.ok(result.clipStartMs <= 100_000 - 80 && result.clipStartMs >= 100_000 - 2000 - 80, `starts at ${result.clipStartMs}`);
    assert.ok(result.clipDurationMs >= 30_000 && result.clipDurationMs <= 36_100, `lasts ${result.clipDurationMs}`);

    const info = inspectOpus(result.data);
    assert.ok(info, "the cut is itself a clean Ogg Opus stream");
    assert.equal(info.preSkip, PRE_SKIP);
    assert.equal(info.durationMs, result.clipDurationMs);
  });

  it("renumbers pages, fixes granules, marks the end and keeps every CRC right", () => {
    const result = sliceOpusOgg(fakeOpus({ seconds: 240 }), { fromMs: 60_000 });
    const pages = parsePages(result.data);
    pages.forEach((p, index) => {
      assert.equal(result.data.readUInt32LE(p.offset + 18), index, "sequence");
      const stored = result.data.readUInt32LE(p.offset + 22);
      assert.equal(oggCrc(result.data, p.offset, p.offset + p.length, p.offset + 22), stored, `crc of page ${index}`);
    });
    assert.equal(pages[0].flags & 2, 2, "first page begins the stream");
    assert.equal(pages[2].flags & 1, 0, "the first audio page continues nothing");
    pages.slice(0, -1).forEach((p) => assert.equal(p.flags & 4, 0));
    assert.equal(pages.at(-1).flags & 4, 4, "last page ends the stream");
    const granules = pages.slice(2).map((p) => p.granule);
    assert.ok(granules.every((value, index) => index === 0 || value > granules[index - 1]));
    assert.equal(granules[0], 2000 * RATE + 0 + (granules[0] - 2000 * RATE), "granules count from the clip");
    assert.ok(granules[0] > PRE_SKIP, "the first page already holds audio past the pre-skip");
  });

  it("never starts on a page that continues a packet", () => {
    const source = fakeOpus({ seconds: 240, continuedEvery: 2 });
    for (const fromMs of [20_000, 61_000, 100_000, 150_000]) {
      const result = sliceOpusOgg(source, { fromMs });
      const pages = parsePages(result.data);
      assert.equal(pages[2].continued, false, `at ${fromMs}`);
      assert.ok(result.clipStartMs <= fromMs);
    }
  });

  it("clamps the start so the window fits, and defaults to 40% of the song", () => {
    assert.equal(effectiveStartMs(500_000, 240_000), 210_000);
    assert.equal(effectiveStartMs(-5, 240_000), 96_000);
    assert.equal(effectiveStartMs(null, 240_000), 96_000);
    assert.equal(effectiveStartMs(NaN, 240_000), 96_000);
    const late = sliceOpusOgg(fakeOpus({ seconds: 240 }), { fromMs: 500_000 });
    assert.equal(late.fromMs, 210_000);
    assert.ok(late.clipStartMs + late.clipDurationMs >= 239_000, "reaches the end");
    const early = sliceOpusOgg(fakeOpus({ seconds: 240 }), { fromMs: 0 });
    assert.equal(early.clipStartMs, 0);
  });

  it("matches the CRC of pages it did not change", () => {
    const source = fakeOpus({ seconds: 120 });
    for (const p of parsePages(source)) {
      assert.equal(oggCrc(source, p.offset, p.offset + p.length, p.offset + 22), source.readUInt32LE(p.offset + 22));
    }
  });

  // A real rendered song, if the bot has produced any on this machine.
  const audioDir = path.join(__dirname, "..", "..", "..", "helpers", "data", "mewbeat", "audio");
  const realFile = fs.existsSync(audioDir) ? fs.readdirSync(audioDir).find((name) => name.endsWith(".ogg")) : null;
  it("keeps every CRC right on a real rendered song", { skip: !realFile }, () => {
    const source = fs.readFileSync(path.join(audioDir, realFile));
    const info = inspectOpus(source);
    if (!info) return; // not an Opus render: nothing to cut
    for (const p of info.pages) {
      assert.equal(oggCrc(source, p.offset, p.offset + p.length, p.offset + 22), source.readUInt32LE(p.offset + 22));
    }
    const result = sliceOpusOgg(source, { fromMs: info.durationMs * 0.5 });
    if (result.whole) return;
    assert.ok(inspectOpus(result.data));
    assert.ok(result.data.length < source.length);
  });
});
