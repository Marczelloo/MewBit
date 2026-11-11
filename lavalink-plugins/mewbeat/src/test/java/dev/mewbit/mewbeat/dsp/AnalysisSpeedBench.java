package dev.mewbit.mewbeat.dsp;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.util.Arrays;
import org.junit.jupiter.api.Test;

/**
 * Timing harness for speed work, not part of the normal run: {@code ./gradlew test -Dmewbeat.bench=true --tests
 * '*AnalysisSpeedBench*'}. Times the extractor on a 4-minute and a 20-minute track made of the golden signals
 * (after a warm-up run), per run and per stage, and prints the medians. Asserts nothing.
 */
class AnalysisSpeedBench {

    private static final int SR = GoldenSignals.SAMPLE_RATE;

    /** The golden signals laid end to end, repeated, cut to {@code seconds}. */
    private static float[] track(int seconds) {
        float[][] parts = {GoldenSignals.song(), GoldenSignals.dense(), GoldenSignals.tempoChange(), GoldenSignals.ambient()};
        float[] out = new float[seconds * SR];
        int at = 0;
        for (int p = 0; at < out.length; p++) {
            float[] part = parts[p % parts.length];
            int n = Math.min(part.length, out.length - at);
            System.arraycopy(part, 0, out, at, n);
            at += n;
        }
        return out;
    }

    private record Run(long wallMs, long[] stages) {}

    private static Run run(float[] signal, AnalysisTier tier) {
        FeatureExtractor extractor = new FeatureExtractor(SR, tier);
        float[] buffer = new float[4096];
        long start = System.nanoTime();
        for (int offset = 0; offset < signal.length; offset += buffer.length) {
            int length = Math.min(buffer.length, signal.length - offset);
            System.arraycopy(signal, offset, buffer, 0, length);
            extractor.accept(buffer, length);
        }
        extractor.finish();
        return new Run((System.nanoTime() - start) / 1_000_000, extractor.stageMillis());
    }

    private static void bench(String label, float[] signal, AnalysisTier tier, int runs) {
        run(Arrays.copyOf(signal, Math.min(signal.length, 60 * SR)), tier); // warm-up
        run(signal, tier);
        long[] walls = new long[runs];
        long[][] stages = new long[3][runs];
        for (int r = 0; r < runs; r++) {
            Run result = run(signal, tier);
            walls[r] = result.wallMs();
            for (int s = 0; s < 3; s++) {
                stages[s][r] = result.stages()[s];
            }
            System.out.printf("BENCH %s %s run %d: wall %d ms (hpss+drums %d, pitch %d, repetition+layers %d)%n",
                    label, tier.wireName(), r, result.wallMs(), result.stages()[0], result.stages()[1],
                    result.stages()[2]);
        }
        long wall = median(walls);
        long hpss = median(stages[0]);
        long pitch = median(stages[1]);
        long repetition = median(stages[2]);
        System.out.printf("BENCH %s %s MEDIAN: wall %d ms (hpss+drums %d, pitch %d, repetition+layers %d, rest %d)%n",
                label, tier.wireName(), wall, hpss, pitch, repetition, wall - hpss - pitch - repetition);
    }

    private static long median(long[] values) {
        long[] sorted = values.clone();
        Arrays.sort(sorted);
        return sorted[sorted.length / 2];
    }

    /** The transform as it was before the per-stage twiddle tables, kept as the reference to time and compare against. */
    private static void referenceTransform(int size, float[] cos, float[] sin, int[] reversed, float[] re, float[] im) {
        for (int i = 0; i < size; i++) {
            int j = reversed[i];
            if (j > i) {
                float t = re[i];
                re[i] = re[j];
                re[j] = t;
                t = im[i];
                im[i] = im[j];
                im[j] = t;
            }
        }
        for (int span = 2; span <= size; span <<= 1) {
            int half = span >> 1;
            int step = size / span;
            for (int start = 0; start < size; start += span) {
                for (int j = 0, k = 0; j < half; j++, k += step) {
                    float wr = cos[k];
                    float wi = -sin[k];
                    int a = start + j;
                    int b = a + half;
                    float tr = re[b] * wr - im[b] * wi;
                    float ti = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
            }
        }
    }

    @Test
    void fftAgainstReference() {
        assumeTrue("true".equals(System.getProperty("mewbeat.bench")), "set -Dmewbeat.bench=true to run");
        for (int size : new int[] {1024, 4096}) {
            float[] cos = new float[size / 2];
            float[] sin = new float[size / 2];
            for (int k = 0; k < size / 2; k++) {
                double angle = 2 * Math.PI * k / size;
                cos[k] = (float) Math.cos(angle);
                sin[k] = (float) Math.sin(angle);
            }
            int[] reversed = new int[size];
            int bits = Integer.numberOfTrailingZeros(size);
            for (int i = 0; i < size; i++) {
                reversed[i] = Integer.reverse(i) >>> (32 - bits);
            }
            Fft fft = new Fft(size);
            java.util.Random random = new java.util.Random(7);
            float[] source = new float[size];
            for (int i = 0; i < size; i++) {
                source[i] = random.nextFloat() - 0.5f;
            }
            float[] re = new float[size];
            float[] im = new float[size];
            int rounds = 40_000;
            long reference = 0;
            long current = 0;
            for (int repeat = 0; repeat < 5; repeat++) {
                long start = System.nanoTime();
                for (int r = 0; r < rounds; r++) {
                    System.arraycopy(source, 0, re, 0, size);
                    Arrays.fill(im, 0);
                    referenceTransform(size, cos, sin, reversed, re, im);
                }
                reference = System.nanoTime() - start;
                float[] referenceRe = re.clone();
                float[] referenceIm = im.clone();
                start = System.nanoTime();
                for (int r = 0; r < rounds; r++) {
                    System.arraycopy(source, 0, re, 0, size);
                    Arrays.fill(im, 0);
                    fft.transform(re, im);
                }
                current = System.nanoTime() - start;
                if (!Arrays.equals(referenceRe, re) || !Arrays.equals(referenceIm, im)) {
                    throw new AssertionError("transform differs from the reference at size " + size);
                }
            }
            System.out.printf("BENCH fft %d: reference %.2f us, current %.2f us per transform%n", size,
                    reference / 1000.0 / rounds, current / 1000.0 / rounds);
        }
    }

    @Test
    void fourMinutesAndTwentyMinutes() {
        assumeTrue("true".equals(System.getProperty("mewbeat.bench")), "set -Dmewbeat.bench=true to run");
        float[] four = track(240);
        bench("4min", four, AnalysisTier.FULL, 7);
        bench("4min", four, AnalysisTier.LIGHT, 5);
        four = null;
        float[] twenty = track(1200);
        bench("20min", twenty, AnalysisTier.FULL, 3);
    }
}
