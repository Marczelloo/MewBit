package dev.mewbit.mewbeat.dsp;

import java.util.Arrays;

/**
 * Tempo from the autocorrelation of the onset envelope (with a log-Gaussian
 * prior around 120 BPM) with checks against picking 1.5 beats, 2.5 beats or two beats, then dynamic-programming beat
 * tracking (Ellis 2007).
 */
final class TempoEstimator {

    private static final double MIN_BPM = 60;
    private static final double MAX_BPM = 300;
    private static final double PRIOR_CENTRE_BPM = 120;
    private static final double PRIOR_SIGMA_OCTAVES = 1.4;
    private static final double TIGHTNESS = 100;
    private static final int MEAN_HALF_WINDOW_HOPS = 94; // ~1 s each side
    private static final int SNAP_HOPS = 2;
    /** How many multiples of a lag the 3:2 check compares. */
    private static final int COMB_MULTIPLES = 4;
    /** Below this share of the lag's own ACF its half is no subdivision, so the lag is not a whole number of beats. */
    private static final double WEAK_HALF_BEAT = 0.4;
    /** The 2/3 or 2/5 lag that replaces such a lag must correlate at least this well against it. */
    private static final double MIN_ODD_ALTERNATIVE = 0.7;
    /**
     * A lag is two beats when its half keeps the comb and a beat of it holds this many strong onsets. A faster tempo
     * needs more of them, since doubling it leaves the range people chart in; above the last limit a tempo stays.
     */
    private static final double HALF_TEMPO_BELOW_BPM = 115;
    private static final double HALF_TEMPO_ONSETS_PER_BEAT = 7.5;
    private static final double FAST_HALF_TEMPO_BELOW_BPM = 125;
    private static final double FAST_HALF_TEMPO_ONSETS_PER_BEAT = 12;
    private static final double MIN_HALF_COMB = 0.8;

    /** {@code beatHops} are hop indices; {@code downbeatPhase} is 0..3, the beat index mod 4 that starts a bar. */
    record Result(double bpm, double confidence, int[] beatHops, int downbeatPhase) {}

    static final Result NONE = new Result(0, 0, new int[0], 0);

    private TempoEstimator() {}

    /**
     * @param onsetFlux per-hop onset strength summed over the bands
     * @param lowFlux per-hop low-band flux, used to find the downbeat
     * @param count number of valid hops
     * @param hopSeconds hop duration in seconds
     * @param strongOnsetsPerSecond strong onsets over all bands per second of audible audio
     */
    static Result estimate(
            float[] onsetFlux, float[] lowFlux, int count, double hopSeconds, double strongOnsetsPerSecond) {
        int lagLo = (int) Math.floor(60 / (MAX_BPM * hopSeconds));
        int lagHi = (int) Math.ceil(60 / (MIN_BPM * hopSeconds));
        if (count < 4 * lagHi) {
            return NONE;
        }
        float[] envelope = envelope(onsetFlux, count);
        if (envelope == null) {
            return NONE;
        }

        double[] acf = new double[COMB_MULTIPLES * (lagHi + SNAP_HOPS + 1)];
        for (int lag = Math.max(1, lagLo / 2 - SNAP_HOPS); lag < acf.length; lag++) {
            double sum = 0;
            for (int t = 0; t + lag < count; t++) {
                sum += (double) envelope[t] * envelope[t + lag];
            }
            acf[lag] = sum / (count - lag);
        }

        int best = -1;
        double bestScore = 0;
        double meanAcf = 0;
        for (int lag = lagLo; lag <= lagHi; lag++) {
            meanAcf += acf[lag];
            double octaves = Math.log(60 / (lag * hopSeconds) / PRIOR_CENTRE_BPM) / Math.log(2);
            double prior = Math.exp(-0.5 * octaves * octaves / (PRIOR_SIGMA_OCTAVES * PRIOR_SIGMA_OCTAVES));
            double score = acf[lag] * prior;
            if (score > bestScore) {
                bestScore = score;
                best = lag;
            }
        }
        meanAcf /= lagHi - lagLo + 1;
        if (best < 0 || meanAcf <= 0) {
            return NONE;
        }
        best = correctThreeTwo(acf, best, lagLo);
        best = correctOddMultiple(acf, best, lagLo);

        double period = lobeCentre(acf, best);
        // Halving the slower lobe's centre keeps the finer resolution of its longer lag.
        if (isHalfTempo(acf, best, 60 / (period * hopSeconds), strongOnsetsPerSecond)) {
            best = strongestNear(acf, (int) Math.round(best / 2.0), 1);
            period /= 2;
        }
        double bpm = 60 / (period * hopSeconds);
        double ratio = acf[best] / meanAcf;
        double confidence = Math.max(0, Math.min(1, (ratio - 1) / 4));

        int[] beats = trackBeats(envelope, count, period);
        if (beats.length == 0) {
            return new Result(bpm, confidence, beats, 0);
        }
        return new Result(bpm, confidence, beats, downbeatPhase(beats, lowFlux, count));
    }

    /**
     * Straight eighths correlate at every half beat, so a lag of 1.5 beats can edge out the beat itself (a 126 BPM
     * track read as 84). The beat's own multiples all land on beats, while those of 1.5 beats land on half beats every
     * other time, so when the lag at 2/3 has the stronger comb of multiples it is the beat.
     */
    private static int correctThreeTwo(double[] acf, int best, int lagLo) {
        int guess = (int) Math.round(best * 2.0 / 3);
        int alternative = -1;
        for (int lag = Math.max(lagLo, guess - SNAP_HOPS); lag <= guess + SNAP_HOPS; lag++) {
            if (alternative < 0 || acf[lag] > acf[alternative]) {
                alternative = lag;
            }
        }
        return alternative >= 0 && comb(acf, alternative) > comb(acf, best) ? alternative : best;
    }

    /**
     * A beat subdivided in two correlates at its half, and a lag of 1.5 or 2.5 beats does not, its half falling between
     * eighths. Such a lag can have a weak comb too (a song at 220 BPM read as 88), so the check above misses it.
     */
    static int correctOddMultiple(double[] acf, int best, int lagLo) {
        if (acf[strongestNear(acf, (int) Math.round(best / 2.0), 1)] >= WEAK_HALF_BEAT * acf[best]) {
            return best;
        }
        int alternative = -1;
        for (double share : new double[] {2.0 / 3, 2.0 / 5}) {
            int lag = strongestNear(acf, (int) Math.round(best * share), lagLo);
            if (lag >= 0 && (alternative < 0 || acf[lag] > acf[alternative])) {
                alternative = lag;
            }
        }
        return alternative >= 0 && acf[alternative] >= MIN_ODD_ALTERNATIVE * acf[best] ? alternative : best;
    }

    private static boolean isHalfTempo(double[] acf, int lag, double bpm, double strongOnsetsPerSecond) {
        double onsetsPerBeat = strongOnsetsPerSecond * 60 / bpm;
        boolean busy = (bpm < HALF_TEMPO_BELOW_BPM && onsetsPerBeat >= HALF_TEMPO_ONSETS_PER_BEAT)
                || (bpm < FAST_HALF_TEMPO_BELOW_BPM && onsetsPerBeat >= FAST_HALF_TEMPO_ONSETS_PER_BEAT);
        return busy && comb(acf, strongestNear(acf, (int) Math.round(lag / 2.0), 1)) >= MIN_HALF_COMB * comb(acf, lag);
    }

    /** The strongest lag within {@link #SNAP_HOPS} of {@code guess}, not below {@code floor}; -1 when none is left. */
    private static int strongestNear(double[] acf, int guess, int floor) {
        int to = Math.min(acf.length - 1, guess + SNAP_HOPS);
        int strongest = -1;
        for (int lag = Math.max(floor, guess - SNAP_HOPS); lag <= to; lag++) {
            if (strongest < 0 || acf[lag] > acf[strongest]) {
                strongest = lag;
            }
        }
        return strongest;
    }

    /**
     * Peaks are about one hop wide, so the integer lag is too coarse for a
     * 1 BPM answer; the centroid of the lobe recovers the fractional lag.
     */
    private static double lobeCentre(double[] acf, int best) {
        double weighted = 0;
        double weights = 0;
        for (int lag = best - SNAP_HOPS; lag <= best + SNAP_HOPS; lag++) {
            if (lag < 1 || lag >= acf.length) {
                continue;
            }
            double w = Math.max(0, acf[lag] - 0.5 * acf[best]);
            weighted += lag * w;
            weights += w;
        }
        return weighted / weights;
    }

    /** Mean ACF over the first multiples of {@code lag}, each the best within m - 1 hops of m * lag. */
    private static double comb(double[] acf, int lag) {
        double sum = 0;
        for (int m = 1; m <= COMB_MULTIPLES; m++) {
            double peak = 0;
            for (int d = -(m - 1); d <= m - 1; d++) {
                int j = m * lag + d;
                if (j > 0 && j < acf.length) {
                    peak = Math.max(peak, acf[j]);
                }
            }
            sum += peak;
        }
        return sum / COMB_MULTIPLES;
    }

    /** Onset flux with its local mean removed, half-wave rectified, scaled to unit standard deviation; null if flat. */
    private static float[] envelope(float[] flux, int count) {
        double[] prefix = new double[count + 1];
        for (int i = 0; i < count; i++) {
            prefix[i + 1] = prefix[i] + flux[i];
        }
        float[] env = new float[count];
        double sum = 0;
        double sumSquares = 0;
        for (int i = 0; i < count; i++) {
            int from = Math.max(0, i - MEAN_HALF_WINDOW_HOPS);
            int to = Math.min(count, i + MEAN_HALF_WINDOW_HOPS + 1);
            double mean = (prefix[to] - prefix[from]) / (to - from);
            float v = (float) Math.max(0, flux[i] - mean);
            env[i] = v;
            sum += v;
            sumSquares += (double) v * v;
        }
        double mean = sum / count;
        double std = Math.sqrt(sumSquares / count - mean * mean);
        if (!(std > 1e-9)) {
            return null;
        }
        for (int i = 0; i < count; i++) {
            env[i] /= (float) std;
        }
        return env;
    }

    private static int[] trackBeats(float[] envelope, int count, double period) {
        double sigma = Math.max(0.8, period / 32);
        int radius = (int) Math.ceil(3 * sigma);
        float[] kernel = new float[2 * radius + 1];
        for (int k = -radius; k <= radius; k++) {
            kernel[k + radius] = (float) Math.exp(-0.5 * k * k / (sigma * sigma));
        }
        float[] local = new float[count];
        for (int t = 0; t < count; t++) {
            double acc = 0;
            for (int k = -radius; k <= radius; k++) {
                int j = t + k;
                if (j >= 0 && j < count) {
                    acc += envelope[j] * kernel[k + radius];
                }
            }
            local[t] = (float) acc;
        }

        int minGap = Math.max(1, (int) Math.ceil(period / 2));
        int maxGap = (int) Math.floor(period * 2);
        double[] penalty = new double[maxGap + 1];
        for (int gap = minGap; gap <= maxGap; gap++) {
            double l = Math.log(gap / period);
            penalty[gap] = TIGHTNESS * l * l;
        }

        double[] cumulative = new double[count];
        int[] back = new int[count];
        for (int t = 0; t < count; t++) {
            double bestPrev = 0;
            int bestIndex = -1;
            for (int gap = minGap; gap <= maxGap && gap <= t; gap++) {
                double candidate = cumulative[t - gap] - penalty[gap];
                if (candidate > bestPrev) {
                    bestPrev = candidate;
                    bestIndex = t - gap;
                }
            }
            cumulative[t] = local[t] + bestPrev;
            back[t] = bestIndex;
        }

        // The last beat is the final local maximum that is not negligible.
        double[] maxima = new double[count];
        int maximaCount = 0;
        for (int t = 0; t < count; t++) {
            if (isLocalMaximum(cumulative, count, t)) {
                maxima[maximaCount++] = cumulative[t];
            }
        }
        if (maximaCount == 0) {
            return new int[0];
        }
        Arrays.sort(maxima, 0, maximaCount);
        double threshold = 0.5 * maxima[maximaCount / 2];
        int tail = -1;
        for (int t = count - 1; t >= 0; t--) {
            if (cumulative[t] >= threshold && isLocalMaximum(cumulative, count, t)) {
                tail = t;
                break;
            }
        }
        if (tail < 0) {
            return new int[0];
        }

        int[] reversed = new int[count];
        int n = 0;
        for (int t = tail; t >= 0; t = back[t]) {
            reversed[n++] = t;
        }
        int[] beats = new int[n];
        for (int i = 0; i < n; i++) {
            beats[i] = reversed[n - 1 - i];
        }
        return snapAndTrim(beats, envelope, local, count);
    }

    private static boolean isLocalMaximum(double[] values, int count, int t) {
        boolean rising = t == 0 || values[t] > values[t - 1];
        boolean notFalling = t == count - 1 || values[t] >= values[t + 1];
        return rising && notFalling;
    }

    /** Moves each beat to the strongest raw envelope hop nearby, then drops silent leading/trailing beats. */
    private static int[] snapAndTrim(int[] beats, float[] envelope, float[] local, int count) {
        int[] snapped = new int[beats.length];
        int n = 0;
        for (int beat : beats) {
            int bestHop = beat;
            for (int d = -SNAP_HOPS; d <= SNAP_HOPS; d++) {
                int j = beat + d;
                if (j >= 0 && j < count && envelope[j] > envelope[bestHop]) {
                    bestHop = j;
                }
            }
            if (n == 0 || bestHop > snapped[n - 1]) {
                snapped[n++] = bestHop;
            }
        }

        double squares = 0;
        for (int i = 0; i < n; i++) {
            squares += (double) local[snapped[i]] * local[snapped[i]];
        }
        double threshold = 0.1 * Math.sqrt(squares / Math.max(1, n));
        int from = 0;
        int to = n;
        while (from < to && local[snapped[from]] < threshold) {
            from++;
        }
        while (to > from && local[snapped[to - 1]] < threshold) {
            to--;
        }
        return Arrays.copyOfRange(snapped, from, to);
    }

    /** The beat index mod 4 whose beats carry the most low-band (kick) energy. */
    private static int downbeatPhase(int[] beats, float[] lowFlux, int count) {
        double[] sums = new double[4];
        int[] counts = new int[4];
        for (int i = 0; i < beats.length; i++) {
            float strongest = 0;
            for (int d = -SNAP_HOPS; d <= SNAP_HOPS; d++) {
                int j = beats[i] + d;
                if (j >= 0 && j < count) {
                    strongest = Math.max(strongest, lowFlux[j]);
                }
            }
            sums[i & 3] += strongest;
            counts[i & 3]++;
        }
        int best = 0;
        double bestMean = -1;
        for (int phase = 0; phase < 4; phase++) {
            double mean = counts[phase] == 0 ? 0 : sums[phase] / counts[phase];
            if (mean > bestMean) {
                bestMean = mean;
                best = phase;
            }
        }
        return best;
    }
}
