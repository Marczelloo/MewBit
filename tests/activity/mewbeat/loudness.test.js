const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

let loudness;

test.before(async () => {
  loudness = await import(pathToFileURL(path.resolve(__dirname, "../../../activity/src/mewbeat/loudness.js")).href);
});

function sine({ seconds, amp, freq = 997, sampleRate = 48000, phase = 0 }) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i += 1) out[i] = amp * Math.sin(2 * Math.PI * freq * (i / sampleRate) + phase);
  return out;
}

const concat = (...parts) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label ?? ""} ${actual} is not within ${tolerance} of ${expected}`);

test("K-weighting at 48 kHz gives the coefficients BS.1770 publishes", () => {
  const { shelf, high } = loudness.kWeighting(48000);
  near(shelf.b0, 1.53512485958697, 1e-9);
  near(shelf.b1, -2.69169618940638, 1e-9);
  near(shelf.b2, 1.19839281085285, 1e-9);
  near(shelf.a1, -1.69065929318241, 1e-9);
  near(shelf.a2, 0.73248077421585, 1e-9);
  near(high.a1, -1.99004745483398, 1e-9);
  near(high.a2, 0.99007225036621, 1e-9);
});

test("a full-scale 997 Hz tone reads -3.01 LUFS on one channel, and 0 LUFS on two", () => {
  const tone = sine({ seconds: 10, amp: 1 });
  const mono = loudness.createLoudnessMeter(48000, 1);
  mono.add([tone]);
  near(mono.result(), -3.01, 0.05, "mono");
  const stereo = loudness.createLoudnessMeter(48000, 2);
  stereo.add([tone, tone]);
  near(stereo.result(), 0, 0.05, "stereo");
});

test("loudness follows the level in dB and does not depend on the sample rate", () => {
  for (const sampleRate of [48000, 44100]) {
    for (const amp of [0.1, 0.01]) {
      const tone = sine({ seconds: 8, amp, sampleRate });
      const meter = loudness.createLoudnessMeter(sampleRate, 2);
      meter.add([tone, tone]);
      near(meter.result(), 20 * Math.log10(amp), 0.06, `${sampleRate} Hz amp ${amp}`);
    }
  }
});

test("the K-weighting cuts a low rumble and lifts the highs", () => {
  const measure = (freq) => {
    const tone = sine({ seconds: 8, amp: 0.1, freq });
    const meter = loudness.createLoudnessMeter(48000, 1);
    meter.add([tone]);
    return meter.result() - (-0.691 + 10 * Math.log10(0.1 * 0.1 / 2));
  };
  assert.ok(measure(30) < -3, "30 Hz is cut");
  near(measure(1000), 0.69, 0.1, "1 kHz sits at +0.69 dB");
  assert.ok(measure(8000) > 3, "8 kHz is lifted by the shelf");
});

test("silence and a clip shorter than a block have no loudness", () => {
  const silent = loudness.createLoudnessMeter(48000, 2);
  silent.add([new Float32Array(48000 * 5), new Float32Array(48000 * 5)]);
  assert.equal(silent.result(), null);
  const short = loudness.createLoudnessMeter(48000, 1);
  short.add([sine({ seconds: 0.3, amp: 0.5 })]);
  assert.equal(short.result(), null);
});

test("quiet passages are gated out of the integrated loudness", () => {
  // 10 s at -20 dBFS, then 10 s at -60 dBFS: above the absolute gate, but 40 LU under the rest.
  const song = concat(sine({ seconds: 10, amp: 0.1 }), sine({ seconds: 10, amp: 0.001 }));
  const meter = loudness.createLoudnessMeter(48000, 2);
  meter.add([song, song]);
  near(meter.result(), -20, 0.1);
  // Below the absolute gate (-70 LUFS) is dropped too: a long near-silent tail changes nothing.
  const withTail = concat(sine({ seconds: 10, amp: 0.1 }), sine({ seconds: 30, amp: 0.00001 }));
  const tailed = loudness.createLoudnessMeter(48000, 2);
  tailed.add([withTail, withTail]);
  near(tailed.result(), -20, 0.1);
});

test("a song fed in pieces of any size measures like the whole song", () => {
  const left = concat(sine({ seconds: 6, amp: 0.2, freq: 220 }), sine({ seconds: 6, amp: 0.05, freq: 3000 }));
  const right = concat(sine({ seconds: 6, amp: 0.1, freq: 440 }), sine({ seconds: 6, amp: 0.08, freq: 90 }));
  const whole = loudness.createLoudnessMeter(48000, 2);
  whole.add([left, right]);
  for (const piece of [1, 4799, 4800, 12345, 100000]) {
    const meter = loudness.createLoudnessMeter(48000, 2);
    for (let at = 0; at < left.length; at += piece) meter.add([left, right], at, Math.min(left.length, at + piece));
    near(meter.result(), whole.result(), 1e-9, `piece ${piece}`);
  }
});

test("measurePeaks finds the peak between two samples", () => {
  // A tone at a quarter of the sample rate, phased so no sample lands on its crest: samples reach 0.707, the signal 1.
  const tone = sine({ seconds: 0.2, amp: 1, freq: 12000, phase: Math.PI / 4 });
  const { samplePeak, truePeak } = loudness.measurePeaks([tone]);
  near(samplePeak, Math.SQRT1_2, 0.001);
  near(truePeak, 1, 0.03);
  assert.deepEqual(loudness.measurePeaks([new Float32Array(100)]), { samplePeak: 0, truePeak: 0 });
});

test("measureSong reports loudness and peak, and gives the page a turn between slices", async () => {
  const tone = sine({ seconds: 20, amp: 0.1 });
  let turns = 0;
  const result = await loudness.measureSong([tone, tone], 48000, { sliceSeconds: 5, yieldToUi: async () => { turns += 1; } });
  near(result.lufs, -20, 0.06);
  near(result.peakDb, -20, 0.1);
  assert.ok(turns >= 4, `yielded ${turns} times`);
  const silent = await loudness.measureSong([new Float32Array(48000 * 2)], 48000);
  assert.equal(silent.lufs, null);
});

test("loudnessGain steers to the target within the cut and boost limits", () => {
  const { TARGET_LUFS, MAX_BOOST_DB, MAX_CUT_DB, loudnessGain } = loudness;
  const quiet = loudnessGain({ lufs: TARGET_LUFS - 4, peakDb: -30 });
  near(quiet.db, 4, 1e-9);
  near(quiet.gain, 10 ** (4 / 20), 1e-9);
  const loud = loudnessGain({ lufs: TARGET_LUFS + 5, peakDb: 0 });
  near(loud.db, -5, 1e-9);
  const tooQuiet = loudnessGain({ lufs: TARGET_LUFS - 40, peakDb: -60 });
  assert.equal(tooQuiet.db, MAX_BOOST_DB);
  assert.equal(tooQuiet.limitedBy, "boost");
  const tooLoud = loudnessGain({ lufs: TARGET_LUFS + 40, peakDb: 0 });
  assert.equal(tooLoud.db, -MAX_CUT_DB);
  assert.equal(tooLoud.limitedBy, "cut");
  const onTarget = loudnessGain({ lufs: TARGET_LUFS, peakDb: -3 });
  assert.equal(onTarget.gain, 1);
});

test("a boost stops where the peak would pass the ceiling, a cut never does", () => {
  const { loudnessGain, PEAK_CEILING_DB, TARGET_LUFS } = loudness;
  // A quiet song with a high peak: 6 dB wanted, room for 2 under the ceiling.
  const peaky = loudnessGain({ lufs: TARGET_LUFS - 6, peakDb: PEAK_CEILING_DB - 2 });
  near(peaky.db, 2, 1e-9);
  assert.equal(peaky.limitedBy, "peak");
  // No room at all: no boost, but never a cut by this rule.
  const full = loudnessGain({ lufs: TARGET_LUFS - 6, peakDb: 3 });
  assert.equal(full.db, 0);
  assert.equal(full.gain, 1);
  // The room the playback chain leaves (headroomDb) lets a hot file be lifted.
  const hot = loudnessGain({ lufs: TARGET_LUFS - 6, peakDb: 3 }, { headroomDb: 8 });
  near(hot.db, PEAK_CEILING_DB - 3 + 8, 1e-9);
  // A loud song is cut however high its peak is.
  assert.equal(loudnessGain({ lufs: TARGET_LUFS + 3, peakDb: 6 }).db, -3);
});

test("a song with no loudness, or garbage, is left as it is", () => {
  const { loudnessGain } = loudness;
  for (const bad of [null, undefined, {}, { lufs: null, peakDb: 0 }, { lufs: NaN, peakDb: 0 }, { lufs: -Infinity, peakDb: 0 }]) {
    const level = loudnessGain(bad);
    assert.equal(level.gain, 1);
    assert.equal(level.db, 0);
    assert.equal(level.limitedBy, "unmeasured");
  }
  // A missing peak does not block the loudness part.
  near(loudnessGain({ lufs: loudness.TARGET_LUFS - 2 }).db, 2, 1e-9);
});

test("a song measured in slices has the same peaks as one measured whole, and the page is given turns in both passes", async () => {
  // A crest between samples, a quiet stretch, then louder: the peak sits in a late slice.
  const tone = concat(sine({ seconds: 3, amp: 0.2 }), sine({ seconds: 3, amp: 0.9, freq: 12000, phase: Math.PI / 4 }));
  const whole = loudness.measurePeaks([tone, tone]);
  let turns = 0;
  const sliced = await loudness.measureSong([tone, tone], 48000, { sliceSeconds: 1, yieldToUi: async () => { turns += 1; } });
  near(sliced.peakDb, 20 * Math.log10(whole.truePeak), 1e-9);
  near(sliced.samplePeakDb, 20 * Math.log10(whole.samplePeak), 1e-9);
  assert.ok(sliced.peakDb > sliced.samplePeakDb + 2, "the crest between samples is found");
  assert.ok(turns >= 6, `yielded ${turns} times`);
});
