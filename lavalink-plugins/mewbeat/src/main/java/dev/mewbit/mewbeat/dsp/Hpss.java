package dev.mewbit.mewbeat.dsp;

/**
 * Streaming harmonic/percussive separation (Fitzgerald median filtering).
 *
 * <p>Push magnitude frames one at a time. The harmonic estimate of a bin is its
 * median over time (a steady tone is flat along time), the percussive estimate
 * its median over frequency (a click is flat along frequency). Soft Wiener
 * masks with power 2 then split the original magnitude between the two.
 *
 * <p>A frame needs {@code kernel / 2} frames of future, so the result for frame
 * {@code n} comes out of push {@code n + kernel / 2}. Only the last
 * {@code kernel} frames are kept. Near the start and the end of the stream the
 * time window is clipped to the frames that exist.
 */
final class Hpss {

    /** Keeps the masks defined where both estimates are zero. */
    private static final float EPSILON = 1e-12f;

    private final int bins;
    private final int half;
    private final float[][] ring;
    private final float[] timeMedian;
    private final float[] freqMedian;
    private final float[] scratch;

    /** Frames pushed so far, and frames already returned. */
    private long pushed;
    private long emitted;

    Hpss(int bins, int kernel) {
        if (kernel < 3 || kernel % 2 == 0) {
            throw new IllegalArgumentException("HPSS kernel must be odd and at least 3: " + kernel);
        }
        this.bins = bins;
        this.half = kernel / 2;
        this.ring = new float[kernel][bins];
        this.timeMedian = new float[bins];
        this.freqMedian = new float[bins];
        this.scratch = new float[kernel];
    }

    /**
     * Adds one magnitude frame.
     *
     * @return {@code {percussive, harmonic}} for the frame {@code kernel / 2} pushes earlier,
     *     or {@code null} while that frame does not exist yet
     */
    float[][] push(float[] magnitude) {
        System.arraycopy(magnitude, 0, ring[(int) (pushed % ring.length)], 0, bins);
        pushed++;
        if (pushed <= half) {
            return null;
        }
        return emit();
    }

    /** Returns the pairs of the frames still waiting for their future, in order. */
    float[][][] flush() {
        float[][][] rest = new float[(int) (pushed - emitted)][][];
        for (int i = 0; i < rest.length; i++) {
            rest[i] = emit();
        }
        return rest;
    }

    private float[][] emit() {
        long frame = emitted++;
        long from = Math.max(0, frame - half);
        long to = Math.min(pushed - 1, frame + half);
        int span = (int) (to - from + 1);
        float[] centre = ring[(int) (frame % ring.length)];

        for (int bin = 0; bin < bins; bin++) {
            for (int k = 0; k < span; k++) {
                scratch[k] = ring[(int) ((from + k) % ring.length)][bin];
            }
            timeMedian[bin] = median(scratch, span);
        }
        for (int bin = 0; bin < bins; bin++) {
            int lo = Math.max(0, bin - half);
            int hi = Math.min(bins - 1, bin + half);
            System.arraycopy(centre, lo, scratch, 0, hi - lo + 1);
            freqMedian[bin] = median(scratch, hi - lo + 1);
        }

        float[] percussive = new float[bins];
        float[] harmonic = new float[bins];
        for (int bin = 0; bin < bins; bin++) {
            float h2 = timeMedian[bin] * timeMedian[bin];
            float p2 = freqMedian[bin] * freqMedian[bin];
            float denominator = h2 + p2 + EPSILON;
            percussive[bin] = centre[bin] * p2 / denominator;
            harmonic[bin] = centre[bin] * h2 / denominator;
        }
        return new float[][] {percussive, harmonic};
    }

    /** Median of the first {@code count} values by insertion sort; reorders them. */
    private static float median(float[] values, int count) {
        for (int i = 1; i < count; i++) {
            float v = values[i];
            int j = i - 1;
            while (j >= 0 && values[j] > v) {
                values[j + 1] = values[j];
                j--;
            }
            values[j + 1] = v;
        }
        return values[count / 2];
    }
}
