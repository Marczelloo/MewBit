package dev.mewbit.mewbeat.dsp;

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
}
