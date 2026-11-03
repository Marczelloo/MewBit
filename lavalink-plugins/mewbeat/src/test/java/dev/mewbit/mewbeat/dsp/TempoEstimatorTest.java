package dev.mewbit.mewbeat.dsp;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Random;
import org.junit.jupiter.api.Test;

class TempoEstimatorTest {

    private static final double HOP_SECONDS = 256 / 24_000.0;
    private static final int HOPS = (int) (90 / HOP_SECONDS);
    /** A whole number of hops, so that the lags of its beat and its bar correlate fully. */
    private static final double FAST_BEAT = 32 * HOP_SECONDS;
    private static final double FAST_BPM = 60 / FAST_BEAT;

    /** Hits every {@code beatSeconds}, accented on every second one, with the given drift in hops per beat. */
    private static float[] pulses(double beatSeconds, double accent, double driftHops) {
        float[] flux = new float[HOPS];
        Random random = new Random(11);
        double beatHops = beatSeconds / HOP_SECONDS;
        double position = 50;
        for (int beat = 0; position < HOPS - 1; beat++) {
            flux[(int) Math.round(position)] += beat % 2 == 0 ? 1 : (float) accent;
            position += beatHops + driftHops * random.nextGaussian();
        }
        return flux;
    }

    private static double bpmOf(float[] flux, double strongOnsetsPerSecond) {
        return TempoEstimator.estimate(flux, flux, HOPS, HOP_SECONDS, strongOnsetsPerSecond).bpm();
    }

    @Test
    void readsAFastTempoAboveTheOldLimit() {
        // A played tempo drifts, so its comb fades with the lag and the prior no longer lifts 110 BPM over 220.
        assertEquals(220, bpmOf(pulses(60 / 220.0, 1, 1.2), 3), 3);
    }

    @Test
    void doublesASlowLagUnderADenseStream() {
        // 12 strong onsets a second are 8 a beat at 88 BPM, more than a real 88 BPM song holds.
        assertEquals(FAST_BPM, bpmOf(pulses(FAST_BEAT, 0.8, 0), 12), 1);
    }

    @Test
    void keepsASparseSlowSongSlow() {
        assertEquals(FAST_BPM / 2, bpmOf(pulses(FAST_BEAT, 0.8, 0), 3), 1);
    }

    @Test
    void keepsADenseSlowSongWhoseHalfLagIsEmpty() {
        assertEquals(FAST_BPM / 2, bpmOf(pulses(2 * FAST_BEAT, 1, 0), 12), 1);
    }

    @Test
    void replacesTwoAndAHalfBeatsWhoseHalfIsSilent() {
        double[] acf = new double[240];
        acf[64] = 1; // 88 BPM, the half at 32 is empty
        acf[26] = 0.9; // 2/5 of it: 220 BPM
        acf[43] = 0.1;

        assertEquals(26, TempoEstimator.correctOddMultiple(acf, 64, 18));
    }

    @Test
    void keepsALagWhoseHalfIsASubdivision() {
        double[] acf = new double[240];
        acf[64] = 1;
        acf[32] = 0.5;
        acf[26] = 0.9;

        assertEquals(64, TempoEstimator.correctOddMultiple(acf, 64, 18));
    }

    @Test
    void ignoresCandidatesBelowTheFastestLag() {
        double[] acf = new double[240];
        acf[20] = 1; // both 2/3 and 2/5 of this lag are faster than the range

        assertEquals(20, TempoEstimator.correctOddMultiple(acf, 20, 18));
    }
}
