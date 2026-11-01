package dev.mewbit.mewbeat.dsp;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Finds drum hits in the percussive half of an HPSS split and names them.
 *
 * <p>Three band fluxes (low, mid, high) of the percussive magnitude are summed
 * and picked for onsets; each onset is then classified by how its flux splits
 * across the bands. Only three floats per hop are kept.
 *
 * <p>{@link #accept} takes the index of the frame the percussive spectrum
 * belongs to, not of the frame that was just pushed into {@link Hpss}: the
 * caller subtracts the HPSS delay ({@code kernel / 2} hops), so the reported
 * times are song times. Hops must arrive consecutively.
 */
final class DrumDetector {

    private static final double LOW_FROM_HZ = 30;
    private static final double LOW_TO_HZ = 150;
    private static final double MID_TO_HZ = 4000;
    private static final double HIGH_FROM_HZ = 5000;
    private static final double HIGH_TO_HZ = 12000;

    /** Same log compression as the band flux in {@link FeatureExtractor}. */
    private static final double LOG_GAIN = 1000;

    private static final double ONSET_WINDOW_SECONDS = 0.5;
    private static final double MIN_ONSET_GAP_SECONDS = 0.04;

    /** The flux of an onset is read over the peak hop and this many hops either side. */
    private static final int SHARE_NEIGHBOURHOOD = 1;

    // Classification, in order: the first matching row wins.
    private static final double KICK_MIN_LOW_SHARE = 0.5;
    private static final double HAT_MIN_HIGH_SHARE = 0.5;
    private static final double HAT_MAX_LOW_SHARE = 0.15;
    private static final double SNARE_MIN_MID_HIGH_SHARE = 0.6;
    /**
     * Higher than a snare's body alone suggests: the low band is five bins wide and the flux is a per-bin mean,
     * so a 180 Hz body leaking into it still reads about 0.37 of the flux. Kicks read about 0.9.
     */
    private static final double SNARE_MAX_LOW_SHARE = 0.45;

    private final double hopMs;
    private final int lowStart;
    private final int lowEnd;
    private final int midStart;
    private final int midEnd;
    private final int highStart;
    private final int highEnd;
    private final float[] previousLog;

    private float[][] flux = new float[3][1024];
    private int hops;
    private long firstHop = -1;

    DrumDetector(int sampleRate, int fftSize, double hopMs) {
        this.hopMs = hopMs;
        int nyquistBin = fftSize / 2;
        lowStart = Math.max(1, bin(LOW_FROM_HZ, sampleRate, fftSize));
        lowEnd = Math.min(nyquistBin, bin(LOW_TO_HZ, sampleRate, fftSize) - 1);
        midStart = lowEnd + 1;
        midEnd = Math.min(nyquistBin, bin(MID_TO_HZ, sampleRate, fftSize) - 1);
        highStart = bin(HIGH_FROM_HZ, sampleRate, fftSize);
        highEnd = Math.min(nyquistBin, (int) Math.floor(HIGH_TO_HZ * fftSize / sampleRate));
        previousLog = new float[nyquistBin + 1];
    }

    private static int bin(double hz, int sampleRate, int fftSize) {
        return (int) Math.ceil(hz * fftSize / sampleRate);
    }

    /** Consumes the percussive magnitude spectrum of frame {@code hop} (a full-scale sine reads 1). */
    void accept(float[] percussive, int hop) {
        if (firstHop < 0) {
            firstHop = hop;
        }
        if (hops == flux[0].length) {
            for (int b = 0; b < flux.length; b++) {
                flux[b] = Arrays.copyOf(flux[b], hops * 2);
            }
        }
        flux[0][hops] = bandRise(percussive, lowStart, lowEnd);
        flux[1][hops] = bandRise(percussive, midStart, midEnd);
        flux[2][hops] = bandRise(percussive, highStart, highEnd);
        hops++;
    }

    /** Mean rise of the log-compressed magnitude over the bins; also advances the previous frame for them. */
    private float bandRise(float[] magnitude, int from, int to) {
        float rise = 0;
        for (int bin = from; bin <= to; bin++) {
            float compressed = (float) Math.log1p(LOG_GAIN * magnitude[bin]);
            float delta = compressed - previousLog[bin];
            if (delta > 0) {
                rise += delta;
            }
            previousLog[bin] = compressed;
        }
        return rise / (to - from + 1);
    }

    /** Time-ordered drum hits; call once, after the last {@link #accept}. */
    List<Features.Drum> finish() {
        List<Features.Drum> drums = new ArrayList<>();
        if (hops == 0) {
            return drums;
        }
        float[] total = new float[hops];
        for (int i = 0; i < hops; i++) {
            total[i] = flux[0][i] + flux[1][i] + flux[2][i];
        }
        int halfWindow = (int) Math.round(ONSET_WINDOW_SECONDS * 1000 / hopMs);
        int minGap = (int) Math.ceil(MIN_ONSET_GAP_SECONDS * 1000 / hopMs);
        OnsetPicker.Picked picked = OnsetPicker.pick(total, hops, halfWindow, minGap);

        for (int k = 0; k < picked.hops().length; k++) {
            int hop = picked.hops()[k];
            double strength = Math.min(1.0, picked.flux()[k] / picked.reference());
            int t = (int) Math.round((firstHop + hop) * hopMs);
            drums.add(new Features.Drum(t, Highlight.round3(strength), classify(hop)));
        }
        return drums;
    }

    private String classify(int hop) {
        int from = Math.max(0, hop - SHARE_NEIGHBOURHOOD);
        int to = Math.min(hops - 1, hop + SHARE_NEIGHBOURHOOD);
        double low = 0;
        double mid = 0;
        double high = 0;
        for (int i = from; i <= to; i++) {
            low += flux[0][i];
            mid += flux[1][i];
            high += flux[2][i];
        }
        double sum = low + mid + high;
        if (sum <= 0) {
            return "perc";
        }
        double lowShare = low / sum;
        double highShare = high / sum;
        double midHighShare = (mid + high) / sum;
        if (lowShare >= KICK_MIN_LOW_SHARE) {
            return "kick";
        }
        if (highShare >= HAT_MIN_HIGH_SHARE && lowShare < HAT_MAX_LOW_SHARE) {
            return "hat";
        }
        if (midHighShare >= SNARE_MIN_MID_HIGH_SHARE && lowShare < SNARE_MAX_LOW_SHARE) {
            return "snare";
        }
        return "perc";
    }
}
