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
