package dev.mewbit.mewbeat.dsp;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.util.Arrays;
import org.junit.jupiter.api.Test;

/** The time budget of the full tier on a PC. Slow, so it only runs with {@code -Dmewbeat.bench=true}. */
class AnalysisBudgetTest {

    private static final int BUDGET_MS = 9000;
    private static final int TRACK_SECONDS = 180;

    @Test
    void fullTierMeetsPcGate() {
        assumeTrue("true".equals(System.getProperty("mewbeat.bench")), "set -Dmewbeat.bench=true to run");
        String layout = "AB".repeat(12);
        float[] song = Arrays.copyOf(Synth.song(120, layout), TRACK_SECONDS * Synth.SAMPLE_RATE);
        FeatureExtractor extractor = new FeatureExtractor(Synth.SAMPLE_RATE, AnalysisTier.FULL);
        float[] buffer = new float[4096];

        long start = System.nanoTime();
        for (int offset = 0; offset < song.length; offset += buffer.length) {
            int length = Math.min(buffer.length, song.length - offset);
            System.arraycopy(song, offset, buffer, 0, length);
            extractor.accept(buffer, length);
        }
        Features features = extractor.finish();
        long wallMs = (System.nanoTime() - start) / 1_000_000;

        long[] stages = extractor.stageMillis();
        System.out.printf(
                "BENCH full tier %d s: wall %d ms (hpss+drums %d, pitch %d, repetition+layers %d, v1 and rest %d)%n",
                TRACK_SECONDS, wallMs, stages[0], stages[1], stages[2], wallMs - stages[0] - stages[1] - stages[2]);
        assertTrue(features.phrases().list().size() > 10, "phrases " + features.phrases().list().size());
        assertTrue(wallMs <= BUDGET_MS, "full tier took " + wallMs + " ms, budget " + BUDGET_MS);
    }
}
