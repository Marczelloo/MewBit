package dev.mewbit.mewbeat.dsp;

import java.util.function.Consumer;

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
 *
 * <p>The medians are kept in sorted windows that slide by one element instead of being
 * sorted again for every value: each bin's time window is updated once per pushed frame,
 * the frequency window once per bin. A median is the element at the middle of the sorted
 * window, so the values are exactly those a full sort would give.
 */
final class Hpss {

    /** Keeps the masks defined where both estimates are zero. */
    private static final float EPSILON = 1e-12f;

    private final int bins;
    private final int half;
    private final int kernel;
    private final float[][] ring;
    /** Per bin, {@code kernel} slots: the sorted values of that bin over the frames in the time window. */
    private final float[] timeSorted;
    private final float[] timeMedian;
    private final float[] freqMedian;
    /** The sorted frequency window around the bin being handled. */
    private final float[] freqSorted;

    /** Frames pushed so far, frames already returned, and the oldest frame still in the time windows. */
    private long pushed;
    private long emitted;
    private long windowFirst;

    /** Reused by {@link #pushPercussive} and {@link #flushPercussive}. */
    private final float[] percussiveOut;

    Hpss(int bins, int kernel) {
        if (kernel < 3 || kernel % 2 == 0) {
            throw new IllegalArgumentException("HPSS kernel must be odd and at least 3: " + kernel);
        }
        this.bins = bins;
        this.kernel = kernel;
        this.half = kernel / 2;
        this.ring = new float[kernel][bins];
        this.timeSorted = new float[bins * kernel];
        this.timeMedian = new float[bins];
        this.freqMedian = new float[bins];
        this.freqSorted = new float[kernel];
        this.percussiveOut = new float[bins];
    }

    /**
     * Adds one magnitude frame.
     *
     * @return {@code {percussive, harmonic}} for the frame {@code kernel / 2} pushes earlier,
     *     or {@code null} while that frame does not exist yet
     */
    float[][] push(float[] magnitude) {
        if (!add(magnitude)) {
            return null;
        }
        float[] percussive = new float[bins];
        float[] harmonic = new float[bins];
        emit(percussive, harmonic);
        return new float[][] {percussive, harmonic};
    }

    /**
     * Like {@link #push} for callers that only want the percussive half, without an allocation per frame.
     *
     * @return the percussive spectrum, valid until the next call, or {@code null} while there is none yet
     */
    float[] pushPercussive(float[] magnitude) {
        if (!add(magnitude)) {
            return null;
        }
        emit(percussiveOut, null);
        return percussiveOut;
    }

    /** Returns the pairs of the frames still waiting for their future, in order. */
    float[][][] flush() {
        float[][][] rest = new float[(int) (pushed - emitted)][][];
        for (int i = 0; i < rest.length; i++) {
            float[] percussive = new float[bins];
            float[] harmonic = new float[bins];
            emit(percussive, harmonic);
            rest[i] = new float[][] {percussive, harmonic};
        }
        return rest;
    }

    /** Like {@link #flush} for callers that only want the percussive halves; each array is valid during its call. */
    void flushPercussive(Consumer<float[]> consumer) {
        while (emitted < pushed) {
            emit(percussiveOut, null);
            consumer.accept(percussiveOut);
        }
    }

    /** Stores the frame and slides it into every bin's time window; true when a frame can now be emitted. */
    private boolean add(float[] magnitude) {
        float[] slot = ring[(int) (pushed % kernel)];
        if (pushed >= kernel) {
            // The slot still holds the frame that falls out of the window.
            for (int bin = 0; bin < bins; bin++) {
                replace(timeSorted, bin * kernel, kernel, slot[bin], magnitude[bin]);
            }
            windowFirst++;
        } else {
            int count = (int) pushed;
            for (int bin = 0; bin < bins; bin++) {
                insert(timeSorted, bin * kernel, count, magnitude[bin]);
            }
        }
        System.arraycopy(magnitude, 0, slot, 0, bins);
        pushed++;
        return pushed > half;
    }

    /** Writes the next frame's percussive spectrum, and its harmonic one when {@code harmonic} is not null. */
    private void emit(float[] percussive, float[] harmonic) {
        long frame = emitted++;
        long from = Math.max(0, frame - half);
        // Past the end of the stream the oldest frames leave the windows without new ones coming in.
        while (windowFirst < from) {
            float[] old = ring[(int) (windowFirst % kernel)];
            int count = (int) (pushed - windowFirst);
            for (int bin = 0; bin < bins; bin++) {
                remove(timeSorted, bin * kernel, count, old[bin]);
            }
            windowFirst++;
        }
        float[] centre = ring[(int) (frame % kernel)];
        int span = (int) (pushed - windowFirst);
        int middle = span / 2;

        for (int bin = 0; bin < bins; bin++) {
            timeMedian[bin] = timeSorted[bin * kernel + middle];
        }

        // Sliding window along frequency: bins lo..hi of the centre frame, clipped to the spectrum.
        int count = Math.min(bins - 1, half) + 1;
        System.arraycopy(centre, 0, freqSorted, 0, count);
        for (int i = 1; i < count; i++) {
            float v = freqSorted[i];
            int j = i - 1;
            while (j >= 0 && freqSorted[j] > v) {
                freqSorted[j + 1] = freqSorted[j];
                j--;
            }
            freqSorted[j + 1] = v;
        }
        freqMedian[0] = freqSorted[count / 2];
        for (int bin = 1; bin < bins; bin++) {
            int entering = bin + half;
            int leaving = bin - half - 1;
            if (entering < bins && leaving >= 0) {
                replace(freqSorted, 0, count, centre[leaving], centre[entering]);
            } else if (entering < bins) {
                insert(freqSorted, 0, count, centre[entering]);
                count++;
            } else if (leaving >= 0) {
                remove(freqSorted, 0, count, centre[leaving]);
                count--;
            }
            freqMedian[bin] = freqSorted[count / 2];
        }

        if (harmonic == null) {
            for (int bin = 0; bin < bins; bin++) {
                float h2 = timeMedian[bin] * timeMedian[bin];
                float p2 = freqMedian[bin] * freqMedian[bin];
                float denominator = h2 + p2 + EPSILON;
                percussive[bin] = centre[bin] * p2 / denominator;
            }
        } else {
            for (int bin = 0; bin < bins; bin++) {
                float h2 = timeMedian[bin] * timeMedian[bin];
                float p2 = freqMedian[bin] * freqMedian[bin];
                float denominator = h2 + p2 + EPSILON;
                percussive[bin] = centre[bin] * p2 / denominator;
                harmonic[bin] = centre[bin] * h2 / denominator;
            }
        }
    }

    // ---- Sorted windows: {@code count} ascending values at {@code values[from..from + count)} ------------------

    /** Index in the window of the first value that is not below {@code v}, clamped to the last slot. */
    private static int find(float[] values, int from, int count, float v) {
        int lo = 0;
        int hi = count - 1;
        while (lo < hi) {
            int mid = (lo + hi) >>> 1;
            if (values[from + mid] < v) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    /** Adds {@code v} to a window of {@code count} values (the slot after them must exist). */
    private static void insert(float[] values, int from, int count, float v) {
        int i = count;
        while (i > 0 && values[from + i - 1] > v) {
            values[from + i] = values[from + i - 1];
            i--;
        }
        values[from + i] = v;
    }

    /** Takes one value equal to {@code v} out of a window of {@code count} values. */
    private static void remove(float[] values, int from, int count, float v) {
        int i = find(values, from, count, v);
        for (; i + 1 < count; i++) {
            values[from + i] = values[from + i + 1];
        }
    }

    /** Takes one value equal to {@code out} out of the window and puts {@code in} in, in one pass. */
    private static void replace(float[] values, int from, int count, float out, float in) {
        int i = find(values, from, count, out);
        if (in > out) {
            while (i + 1 < count && values[from + i + 1] < in) {
                values[from + i] = values[from + i + 1];
                i++;
            }
        } else {
            while (i > 0 && values[from + i - 1] > in) {
                values[from + i] = values[from + i - 1];
                i--;
            }
        }
        values[from + i] = in;
    }
}
