package dev.mewbit.mewbeat.dsp;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Song sections and the highlight moment, both derived from the 500 ms energy curve. */
final class Highlight {

    static final int ENERGY_HOP_MS = 500;

    private static final int SMOOTHING_BUCKETS = 8; // 4 s
    private static final double SECTION_MARGIN = 0.15;
    private static final int MIN_SECTION_MS = 4000;

    private static final int WINDOW_BUCKETS = 24; // 12 s
    private static final int SKIP_START_MS = 15_000;
    private static final int SKIP_END_MS = 10_000;
    private static final int MIN_TRACK_MS = 40_000;
    private static final double MIN_WINDOW_MEAN = 0.5;
    /** Windows within this of the best mean count as ties; the earliest wins. */
    private static final double TIE_TOLERANCE = 0.02;
    private static final int SNAP_BACK_MS = 4000;

    private Highlight() {}

    /**
     * Sections split where the 4 s smoothed energy crosses its median +/- 0.15.
     * Boundaries snap to the nearest downbeat when {@code snapToDownbeats}.
     */
    static List<Features.Section> sections(
            double[] energy, int durationMs, List<Integer> downbeats, boolean snapToDownbeats) {
        int m = energy.length;
        List<Features.Section> sections = new ArrayList<>();
        if (m == 0 || durationMs <= 0) {
            return sections;
        }
        double[] smoothed = new double[m];
        for (int i = 0; i < m; i++) {
            int from = Math.max(0, i - SMOOTHING_BUCKETS / 2);
            int to = Math.min(m, i + SMOOTHING_BUCKETS / 2);
            double sum = 0;
            for (int k = from; k < to; k++) {
                sum += energy[k];
            }
            smoothed[i] = sum / (to - from);
        }
        double[] sorted = smoothed.clone();
        Arrays.sort(sorted);
        double median = sorted[m / 2];

        List<Integer> boundaries = new ArrayList<>();
        int last = 0;
        for (int i = 1; i < m; i++) {
            if (level(smoothed[i], median) != level(smoothed[i - 1], median)) {
                int t = i * ENERGY_HOP_MS;
                if (t - last >= MIN_SECTION_MS && t < durationMs) {
                    boundaries.add(t);
                    last = t;
                }
            }
        }

        if (snapToDownbeats && !downbeats.isEmpty()) {
            List<Integer> snapped = new ArrayList<>();
            int previous = 0;
            for (int t : boundaries) {
                int nearest = nearest(downbeats, t);
                if (nearest > previous && nearest < durationMs) {
                    snapped.add(nearest);
                    previous = nearest;
                }
            }
            boundaries = snapped;
        }

        int start = 0;
        for (int i = 0; i <= boundaries.size(); i++) {
            int end = i < boundaries.size() ? boundaries.get(i) : durationMs;
            sections.add(new Features.Section(start, end, round3(meanEnergy(energy, start, end))));
            start = end;
        }
        return sections;
    }

    /**
     * Start of the loudest 12 s window outside the first 15 s and last 10 s,
     * pulled back to a section start within 4 s; null for short or quiet tracks.
     */
    static Integer find(double[] energy, int durationMs, List<Features.Section> sections) {
        if (durationMs < MIN_TRACK_MS) {
            return null;
        }
        int firstBucket = SKIP_START_MS / ENERGY_HOP_MS;
        int endLimit = Math.min(energy.length, (durationMs - SKIP_END_MS) / ENERGY_HOP_MS);
        int lastStart = endLimit - WINDOW_BUCKETS;
        if (lastStart < firstBucket) {
            return null;
        }

        double[] prefix = new double[energy.length + 1];
        for (int i = 0; i < energy.length; i++) {
            prefix[i + 1] = prefix[i] + energy[i];
        }
        double bestMean = -1;
        for (int i = firstBucket; i <= lastStart; i++) {
            bestMean = Math.max(bestMean, windowMean(prefix, i));
        }
        if (bestMean < MIN_WINDOW_MEAN) {
            return null;
        }
        int bestStart = firstBucket;
        while (windowMean(prefix, bestStart) < bestMean - TIE_TOLERANCE) {
            bestStart++;
        }

        int start = bestStart * ENERGY_HOP_MS;
        int result = start;
        for (Features.Section section : sections) {
            int sectionStart = section.startMs();
            if (sectionStart <= start && start - sectionStart <= SNAP_BACK_MS && sectionStart < result) {
                result = sectionStart;
            }
        }
        return result;
    }

    private static double windowMean(double[] prefix, int start) {
        return (prefix[start + WINDOW_BUCKETS] - prefix[start]) / WINDOW_BUCKETS;
    }

    private static int level(double value, double median) {
        if (value > median + SECTION_MARGIN) {
            return 1;
        }
        return value < median - SECTION_MARGIN ? -1 : 0;
    }

    private static int nearest(List<Integer> times, int t) {
        int best = times.get(0);
        for (int candidate : times) {
            if (Math.abs(candidate - t) < Math.abs(best - t)) {
                best = candidate;
            }
        }
        return best;
    }

    private static double meanEnergy(double[] energy, int startMs, int endMs) {
        int from = Math.min(energy.length - 1, startMs / ENERGY_HOP_MS);
        int to = Math.min(energy.length, Math.max(from + 1, (endMs + ENERGY_HOP_MS - 1) / ENERGY_HOP_MS));
        double sum = 0;
        for (int i = from; i < to; i++) {
            sum += energy[i];
        }
        return sum / (to - from);
    }

    static double round3(double value) {
        return Math.round(value * 1000) / 1000.0;
    }
}
