package dev.mewbit.mewbeat.dsp;

import java.util.Arrays;

/** Picks onsets from one band's spectral flux with an adaptive threshold. */
final class OnsetPicker {

    /** Flux below this (mean log-magnitude rise per bin) is treated as silence. */
    static final float ABSOLUTE_FLOOR = 0.1f;

    /** Onsets weaker than this fraction of the band's typical onset are dropped. */
    private static final double RELATIVE_FLOOR = 0.1;

    private static final double MAD_FACTOR = 1.5;
    private static final int PEAK_NEIGHBOURHOOD = 2;

    /** Picked onsets: hop indices, their raw flux, and the band's reference (95th percentile) flux. */
    record Picked(int[] hops, float[] flux, float reference) {}

    private OnsetPicker() {}

    /**
     * @param flux per-hop flux of one band
     * @param count number of valid hops in {@code flux}
     * @param halfWindowHops half width of the adaptive threshold window (0.5 s)
     * @param minGapHops minimum distance between two onsets
     */
    static Picked pick(float[] flux, int count, int halfWindowHops, int minGapHops) {
        float[] window = new float[2 * halfWindowHops + 1];
        float[] deviations = new float[window.length];
        int[] hops = new int[16];
        float[] values = new float[16];
        int picked = 0;

        for (int i = 0; i < count; i++) {
            float v = flux[i];
            if (v < ABSOLUTE_FLOOR || !isPeak(flux, count, i)) {
                continue;
            }
            int from = Math.max(0, i - halfWindowHops);
            int to = Math.min(count, i + halfWindowHops + 1);
            int m = to - from;
            System.arraycopy(flux, from, window, 0, m);
            Arrays.sort(window, 0, m);
            float median = window[m / 2];
            for (int k = 0; k < m; k++) {
                deviations[k] = Math.abs(window[k] - median);
            }
            Arrays.sort(deviations, 0, m);
            float mad = deviations[m / 2];
            if (v <= median + MAD_FACTOR * mad) {
                continue;
            }
            if (picked > 0 && i - hops[picked - 1] < minGapHops) {
                if (v > values[picked - 1]) {
                    hops[picked - 1] = i;
                    values[picked - 1] = v;
                }
                continue;
            }
            if (picked == hops.length) {
                hops = Arrays.copyOf(hops, picked * 2);
                values = Arrays.copyOf(values, picked * 2);
            }
            hops[picked] = i;
            values[picked] = v;
            picked++;
        }

        float reference = percentile(values, picked, 0.95);
        int kept = 0;
        for (int k = 0; k < picked; k++) {
            if (values[k] >= RELATIVE_FLOOR * reference) {
                hops[kept] = hops[k];
                values[kept] = values[k];
                kept++;
            }
        }
        return new Picked(Arrays.copyOf(hops, kept), Arrays.copyOf(values, kept), reference);
    }

    private static boolean isPeak(float[] flux, int count, int i) {
        float v = flux[i];
        for (int d = 1; d <= PEAK_NEIGHBOURHOOD; d++) {
            if (i - d >= 0 && flux[i - d] > v) {
                return false;
            }
            if (i + d < count && flux[i + d] > v) {
                return false;
            }
        }
        return true;
    }

    static float percentile(float[] values, int count, double fraction) {
        if (count == 0) {
            return 0;
        }
        float[] sorted = Arrays.copyOf(values, count);
        Arrays.sort(sorted);
        int index = (int) Math.ceil(fraction * count) - 1;
        return sorted[Math.max(0, Math.min(count - 1, index))];
    }
}
