package dev.mewbit.mewbeat.dsp;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/** Deterministic synthetic audio for the DSP tests. Every random source takes an explicit seeded Random. */
final class Synth {

    static final int SAMPLE_RATE = 24_000;

    private Synth() {}

    static float[] silence(double seconds) {
        return new float[(int) Math.round(seconds * SAMPLE_RATE)];
    }

    /** A kick-like 60 Hz burst: 1 ms attack, 25 ms decay constant, 100 ms long. */
    static void addThump(float[] buffer, double atSeconds, double amplitude) {
        int start = (int) Math.round(atSeconds * SAMPLE_RATE);
        int length = SAMPLE_RATE / 10;
        for (int i = 0; i < length && start + i < buffer.length; i++) {
            double t = (double) i / SAMPLE_RATE;
            double envelope = Math.exp(-t / 0.025) * Math.min(1.0, t / 0.001);
            buffer[start + i] += (float) (amplitude * envelope * Math.sin(2 * Math.PI * 60 * t));
        }
    }

    /** A hi-hat: a short noise burst with its low end removed by a second difference (no energy below ~1 kHz). */
    static void addHat(float[] buffer, double atSeconds, double amplitude, Random random) {
        int start = (int) Math.round(atSeconds * SAMPLE_RATE);
        int length = SAMPLE_RATE / 25;
        float previous = 0;
        float beforePrevious = 0;
        for (int i = 0; i < length && start + i < buffer.length; i++) {
            double t = (double) i / SAMPLE_RATE;
            float x = (float) ((random.nextDouble() * 2 - 1) * Math.exp(-t / 0.01));
            buffer[start + i] += (float) (amplitude * 0.25 * (x - 2 * previous + beforePrevious));
            beforePrevious = previous;
            previous = x;
        }
    }

    static void addThumps(float[] buffer, double firstSeconds, double intervalSeconds, double untilSeconds,
            double amplitude) {
        for (double t = firstSeconds; t < untilSeconds; t += intervalSeconds) {
            addThump(buffer, t, amplitude);
        }
    }

    static void addNoise(float[] buffer, double fromSeconds, double toSeconds, double amplitude, Random random) {
        int from = (int) Math.round(fromSeconds * SAMPLE_RATE);
        int to = Math.min(buffer.length, (int) Math.round(toSeconds * SAMPLE_RATE));
        for (int i = from; i < to; i++) {
            buffer[i] += (float) (amplitude * (random.nextDouble() * 2 - 1));
        }
    }

    /**
     * A snare: a 180 Hz body (5 ms decay constant, 30 ms long) plus noise band-limited to roughly
     * 1..5 kHz (one-pole low-passes at 5 kHz minus 1 kHz) that decays over 120 ms.
     */
    static void addSnare(float[] buffer, double atSeconds, double amplitude, Random random) {
        int start = (int) Math.round(atSeconds * SAMPLE_RATE);
        int bodyLength = SAMPLE_RATE * 30 / 1000;
        int noiseLength = SAMPLE_RATE * 120 / 1000;
        double fast = 1 - Math.exp(-2 * Math.PI * 5000 / SAMPLE_RATE);
        double slow = 1 - Math.exp(-2 * Math.PI * 1000 / SAMPLE_RATE);
        double lowPassFast = 0;
        double lowPassSlow = 0;
        for (int i = 0; i < noiseLength && start + i < buffer.length; i++) {
            double t = (double) i / SAMPLE_RATE;
            double x = random.nextDouble() * 2 - 1;
            lowPassFast += fast * (x - lowPassFast);
            lowPassSlow += slow * (x - lowPassSlow);
            double value = 2.5 * (lowPassFast - lowPassSlow) * Math.exp(-t / 0.04) * Math.min(1.0, t / 0.001);
            if (i < bodyLength) {
                value += 0.5 * Math.exp(-t / 0.005) * Math.sin(2 * Math.PI * 180 * t);
            }
            buffer[start + i] += (float) (amplitude * value);
        }
    }

    /** Edge ramps of a pitched note, so its start and end do not click. */
    private static final double NOTE_RAMP_SECONDS = 0.005;

    private static double midiToHz(double midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    /** A bass note: a sine at {@code midi} plus harmonics 2 and 3 at half and a quarter of its amplitude. */
    static void addBassNote(float[] buffer, double atSeconds, double durationSeconds, double midi, double amplitude) {
        double[] harmonics = {1, 0.5, 0.25};
        addTone(buffer, atSeconds, durationSeconds, midi, amplitude, harmonics, 0);
    }

    /**
     * A lead note: six harmonics with amplitudes 1/h and a 5.5 Hz vibrato of {@code vibratoCents} either side of
     * {@code midi}.
     */
    static void addLeadNote(float[] buffer, double atSeconds, double durationSeconds, double midi, double amplitude,
            double vibratoCents) {
        double[] harmonics = {1, 1.0 / 2, 1.0 / 3, 1.0 / 4, 1.0 / 5, 1.0 / 6};
        addTone(buffer, atSeconds, durationSeconds, midi, amplitude, harmonics, vibratoCents);
    }

    private static void addTone(float[] buffer, double atSeconds, double durationSeconds, double midi,
            double amplitude, double[] harmonics, double vibratoCents) {
        int start = (int) Math.round(atSeconds * SAMPLE_RATE);
        int length = (int) Math.round(durationSeconds * SAMPLE_RATE);
        double baseHz = midiToHz(midi);
        double phase = 0;
        for (int i = 0; i < length && start + i < buffer.length; i++) {
            double t = (double) i / SAMPLE_RATE;
            double hz = baseHz * Math.pow(2, vibratoCents * Math.sin(2 * Math.PI * 5.5 * t) / 1200);
            phase += 2 * Math.PI * hz / SAMPLE_RATE;
            double envelope = Math.min(1.0, Math.min(t, durationSeconds - t) / NOTE_RAMP_SECONDS);
            double value = 0;
            for (int h = 0; h < harmonics.length; h++) {
                value += harmonics[h] * Math.sin((h + 1) * phase);
            }
            buffer[start + i] += (float) (amplitude * envelope * value);
        }
    }

    /**
     * Magnitude spectra the way {@link FeatureExtractor} reads them (before log compression): frame {@code i} is the
     * Hann-windowed 1024 samples ending at {@code (i + 1) * 256}, scaled so a full-scale sine reads 1.
     */
    static List<float[]> magnitudes(float[] signal) {
        int size = FeatureExtractor.FFT_SIZE;
        int hop = FeatureExtractor.HOP;
        Fft fft = new Fft(size);
        float[] window = new float[size];
        double windowSum = 0;
        for (int k = 0; k < size; k++) {
            window[k] = (float) (0.5 - 0.5 * Math.cos(2 * Math.PI * k / size));
            windowSum += window[k];
        }
        float scale = (float) (2 / windowSum);
        List<float[]> frames = new ArrayList<>();
        float[] re = new float[size];
        float[] im = new float[size];
        for (int end = hop; end <= signal.length; end += hop) {
            for (int k = 0; k < size; k++) {
                int index = end - size + k;
                re[k] = (index >= 0 ? signal[index] : 0) * window[k];
                im[k] = 0;
            }
            fft.transform(re, im);
            float[] magnitude = new float[size / 2 + 1];
            for (int bin = 0; bin < magnitude.length; bin++) {
                magnitude[bin] = (float) Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]) * scale;
            }
            frames.add(magnitude);
        }
        return frames;
    }
}
