package dev.mewbit.mewbeat.dsp;

import java.util.ArrayList;
import java.util.List;

/**
 * Which beats open a bar. Harmony tends to change on the one and the kick to land on the one and three, so both vote
 * for one of the four possible bar phases at each beat. The best path through the phases may switch, at a cost, since
 * the beat tracker can slip a beat and a song can start a new section off the old bar. Weights and cost were chosen on
 * the analysis songs (mapping-analysis): a snare vote on two and four only made it worse.
 */
final class Downbeats {

    private static final int BEATS_PER_BAR = 4;
    /** A beat is judged against the 16 beats on each side, so a quiet verse and a loud chorus count alike. */
    private static final int NORMALISE_HALF_WINDOW = 16;
    /** Vote of each beat of the bar, from its first beat on. */
    private static final double[] LOW_VOTE = {0.5, 0, 0.25, 0};
    private static final double[] HARMONY_VOTE = {1, 0, 0.3, 0};
    /** In votes: a switch needs clearly more than a bar or two of evidence. */
    private static final double SWITCH_COST = 16;
    /** A switch cannot leave a bar shorter than this; the new phase wins over the downbeat before it. */
    private static final int MIN_BAR_BEATS = 3;

    private Downbeats() {}

    /**
     * @param beatLow low-band flux at each beat
     * @param beatChroma L2-normalised chroma of each beat (all zero where nothing was heard)
     * @return the indices of the beats that open a bar, ascending
     */
    static int[] pick(float[] beatLow, float[][] beatChroma) {
        int n = beatLow.length;
        if (n == 0) {
            return new int[0];
        }
        double[] low = new double[n];
        for (int i = 0; i < n; i++) {
            low[i] = beatLow[i];
        }
        double[][] votes = votes(normalised(low), normalised(harmonyChange(beatChroma)));
        int[] path = bestPath(votes);

        List<Integer> kept = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            if (Math.floorMod(i - path[i], BEATS_PER_BAR) != 0) {
                continue;
            }
            if (!kept.isEmpty() && i - kept.get(kept.size() - 1) < MIN_BAR_BEATS) {
                kept.set(kept.size() - 1, i);
            } else {
                kept.add(i);
            }
        }
        return kept.stream().mapToInt(Integer::intValue).toArray();
    }

    /** At each beat: how far the harmony of the two beats from it lies from that of the two beats before it. */
    private static double[] harmonyChange(float[][] chroma) {
        int n = chroma.length;
        double[] change = new double[n];
        for (int i = 0; i < n; i++) {
            double dot = 0;
            double before = 0;
            double after = 0;
            for (int pc = 0; pc < chroma[i].length; pc++) {
                double b = (i >= 1 ? chroma[i - 1][pc] : 0) + (i >= 2 ? chroma[i - 2][pc] : 0);
                double a = chroma[i][pc] + (i + 1 < n ? chroma[i + 1][pc] : 0);
                dot += a * b;
                before += b * b;
                after += a * a;
            }
            change[i] = 1 - dot / (Math.sqrt(before * after) + 1e-6);
        }
        return change;
    }

    /** Each value as standard deviations from the mean of the window around it. */
    private static double[] normalised(double[] x) {
        int n = x.length;
        double[] sum = new double[n + 1];
        double[] squares = new double[n + 1];
        for (int i = 0; i < n; i++) {
            sum[i + 1] = sum[i] + x[i];
            squares[i + 1] = squares[i] + x[i] * x[i];
        }
        double[] out = new double[n];
        for (int i = 0; i < n; i++) {
            int from = Math.max(0, i - NORMALISE_HALF_WINDOW);
            int to = Math.min(n, i + NORMALISE_HALF_WINDOW + 1);
            double mean = (sum[to] - sum[from]) / (to - from);
            double variance = Math.max(0, (squares[to] - squares[from]) / (to - from) - mean * mean);
            out[i] = (x[i] - mean) / (Math.sqrt(variance) + 1e-6);
        }
        return out;
    }

    /** {@code votes[i][phase]}: how well beat i fits a bar that starts on the beats with index mod 4 == phase. */
    private static double[][] votes(double[] low, double[] harmony) {
        double[][] votes = new double[low.length][BEATS_PER_BAR];
        for (int i = 0; i < low.length; i++) {
            for (int phase = 0; phase < BEATS_PER_BAR; phase++) {
                int position = Math.floorMod(i - phase, BEATS_PER_BAR);
                votes[i][phase] = low[i] * LOW_VOTE[position] + harmony[i] * HARMONY_VOTE[position];
            }
        }
        return votes;
    }

    /** Viterbi over the four phases. Ties keep the earlier phase, so silence stays on phase 0. */
    private static int[] bestPath(double[][] votes) {
        int n = votes.length;
        int[][] from = new int[n][BEATS_PER_BAR];
        double[] score = votes[0].clone();
        for (int i = 1; i < n; i++) {
            int best = 0;
            for (int phase = 1; phase < BEATS_PER_BAR; phase++) {
                if (score[phase] > score[best]) {
                    best = phase;
                }
            }
            double switched = score[best] - SWITCH_COST;
            double[] next = new double[BEATS_PER_BAR];
            for (int phase = 0; phase < BEATS_PER_BAR; phase++) {
                boolean stay = score[phase] >= switched;
                from[i][phase] = stay ? phase : best;
                next[phase] = (stay ? score[phase] : switched) + votes[i][phase];
            }
            score = next;
        }
        int last = 0;
        for (int phase = 1; phase < BEATS_PER_BAR; phase++) {
            if (score[phase] > score[last]) {
                last = phase;
            }
        }
        int[] path = new int[n];
        path[n - 1] = last;
        for (int i = n - 1; i > 0; i--) {
            path[i - 1] = from[i][path[i]];
        }
        return path;
    }
}
