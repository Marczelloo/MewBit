package dev.mewbit.mewbeat.dsp;

import java.util.Random;

/**
 * Deterministic synthetic tracks of a few minutes for {@link GoldenFeaturesTest}. Everything that is not exact
 * integer arithmetic goes through {@link StrictMath} and a seeded {@link Random}, so the samples are the same on
 * every JVM; the signals mix soft and hard attacks, chords, drum-like noise bursts in the low, middle and high
 * bands, a tempo change, silence and a sustained pad with noise.
 */
final class GoldenSignals {

    static final int SAMPLE_RATE = 24_000;

    private GoldenSignals() {}

    private static float[] silence(double seconds) {
        return new float[(int) Math.round(seconds * SAMPLE_RATE)];
    }

    private static double midiToHz(double midi) {
        return 440 * StrictMath.pow(2, (midi - 69) / 12);
    }

    // ---- Instruments ----------------------------------------------------------------------------------------

    /**
     * One pitched note: harmonics {@code 1/h^rolloff}-weighted, a linear attack of {@code attack} seconds, a linear
     * release over the last 10 ms and an optional exponential decay.
     */
    private static void tone(float[] buffer, double at, double duration, double midi, double amplitude,
            int harmonics, double rolloff, double attack, double decay, double vibratoCents) {
        int start = (int) Math.round(at * SAMPLE_RATE);
        int length = (int) Math.round(duration * SAMPLE_RATE);
        double baseHz = midiToHz(midi);
        double[] weights = new double[harmonics];
        for (int h = 0; h < harmonics; h++) {
            weights[h] = StrictMath.pow(h + 1, -rolloff);
        }
        double phase = 0;
        for (int i = 0; i < length && start + i < buffer.length; i++) {
            double t = (double) i / SAMPLE_RATE;
            double hz = baseHz;
            if (vibratoCents != 0) {
                hz *= StrictMath.pow(2, vibratoCents * StrictMath.sin(2 * StrictMath.PI * 5.5 * t) / 1200);
            }
            phase += 2 * StrictMath.PI * hz / SAMPLE_RATE;
            double envelope = StrictMath.min(1.0, StrictMath.min(t / attack, (duration - t) / 0.01));
            if (decay > 0) {
                envelope *= StrictMath.exp(-t / decay);
            }
            double value = 0;
            for (int h = 0; h < harmonics; h++) {
                value += weights[h] * StrictMath.sin((h + 1) * phase);
            }
            buffer[start + i] += (float) (amplitude * envelope * value);
        }
    }

    /** A kick: a falling sine from 120 to 50 Hz with a short click. */
    private static void kick(float[] buffer, double at, double amplitude) {
        int start = (int) Math.round(at * SAMPLE_RATE);
        int length = SAMPLE_RATE / 8;
        double phase = 0;
        for (int i = 0; i < length && start + i < buffer.length; i++) {
            double t = (double) i / SAMPLE_RATE;
            double hz = 50 + 70 * StrictMath.exp(-t / 0.02);
            phase += 2 * StrictMath.PI * hz / SAMPLE_RATE;
            double envelope = StrictMath.exp(-t / 0.045) * StrictMath.min(1.0, t / 0.0008);
            buffer[start + i] += (float) (amplitude * envelope * StrictMath.sin(phase));
        }
    }

    /** Noise with its low end taken out by a second difference: hats, shakers. */
    private static void hat(float[] buffer, double at, double amplitude, double decay, Random random) {
        int start = (int) Math.round(at * SAMPLE_RATE);
        int length = (int) (decay * 4 * SAMPLE_RATE);
        float previous = 0;
        float beforePrevious = 0;
        for (int i = 0; i < length && start + i < buffer.length; i++) {
            double t = (double) i / SAMPLE_RATE;
            float x = (float) ((random.nextDouble() * 2 - 1) * StrictMath.exp(-t / decay));
            buffer[start + i] += (float) (amplitude * 0.25 * (x - 2 * previous + beforePrevious));
            beforePrevious = previous;
            previous = x;
        }
    }

    /** A snare: a 190 Hz body and noise band-limited by two one-pole low-passes. */
    private static void snare(float[] buffer, double at, double amplitude, Random random) {
        int start = (int) Math.round(at * SAMPLE_RATE);
        int length = SAMPLE_RATE * 140 / 1000;
        double fast = 1 - StrictMath.exp(-2 * StrictMath.PI * 6000 / SAMPLE_RATE);
        double slow = 1 - StrictMath.exp(-2 * StrictMath.PI * 900 / SAMPLE_RATE);
        double lowFast = 0;
        double lowSlow = 0;
        for (int i = 0; i < length && start + i < buffer.length; i++) {
            double t = (double) i / SAMPLE_RATE;
            double x = random.nextDouble() * 2 - 1;
            lowFast += fast * (x - lowFast);
            lowSlow += slow * (x - lowSlow);
            double value = 2.5 * (lowFast - lowSlow) * StrictMath.exp(-t / 0.04) * StrictMath.min(1.0, t / 0.001);
            if (i < SAMPLE_RATE * 30 / 1000) {
                value += 0.5 * StrictMath.exp(-t / 0.006) * StrictMath.sin(2 * StrictMath.PI * 190 * t);
            }
            buffer[start + i] += (float) (amplitude * value);
        }
    }

    /** A tom or conga: a mid-band sine burst, 150..400 Hz. */
    private static void tom(float[] buffer, double at, double hz, double amplitude) {
        int start = (int) Math.round(at * SAMPLE_RATE);
        int length = SAMPLE_RATE / 5;
        for (int i = 0; i < length && start + i < buffer.length; i++) {
            double t = (double) i / SAMPLE_RATE;
            double envelope = StrictMath.exp(-t / 0.05) * StrictMath.min(1.0, t / 0.001);
            buffer[start + i] += (float) (amplitude * envelope * StrictMath.sin(2 * StrictMath.PI * hz * t));
        }
    }

    /** A plain noise burst of {@code seconds}, hard on and hard off. */
    private static void burst(float[] buffer, double at, double seconds, double amplitude, Random random) {
        int from = (int) Math.round(at * SAMPLE_RATE);
        int to = Math.min(buffer.length, (int) Math.round((at + seconds) * SAMPLE_RATE));
        for (int i = from; i < to; i++) {
            buffer[i] += (float) (amplitude * (random.nextDouble() * 2 - 1));
        }
    }

    /** A sustained pad: three slightly detuned sines per chord note, a slow level swell and a little noise. */
    private static void pad(float[] buffer, double from, double to, int[] midis, double amplitude, double noise,
            Random random) {
        int start = (int) Math.round(from * SAMPLE_RATE);
        int end = Math.min(buffer.length, (int) Math.round(to * SAMPLE_RATE));
        double[] phases = new double[midis.length * 3];
        double[] steps = new double[midis.length * 3];
        for (int n = 0; n < midis.length; n++) {
            double hz = midiToHz(midis[n]);
            for (int d = 0; d < 3; d++) {
                steps[n * 3 + d] = 2 * StrictMath.PI * hz * (1 + (d - 1) * 0.003) / SAMPLE_RATE;
            }
        }
        for (int i = start; i < end; i++) {
            double t = (double) (i - start) / SAMPLE_RATE;
            double swell = 0.6 + 0.4 * StrictMath.sin(2 * StrictMath.PI * 0.2 * t);
            double fade = StrictMath.min(1.0, StrictMath.min(t / 1.5, (to - from - t) / 1.5));
            double value = 0;
            for (int p = 0; p < phases.length; p++) {
                phases[p] += steps[p];
                value += StrictMath.sin(phases[p]);
            }
            double sample = amplitude * swell * fade * value / phases.length * 3
                    + noise * (random.nextDouble() * 2 - 1);
            buffer[i] += (float) sample;
        }
    }

    // ---- Signals --------------------------------------------------------------------------------------------

    private static final int[] ROOTS = {36, 41, 43, 38};
    private static final int[] MELODY = {76, 79, 72, 79, 77, 81, 77, 72, 79, 83, 74, 83, 81, 76, 81, 69};

    /**
     * About 3 minutes of a song in 4/4 at 120 BPM: A and B sections of 16 beats (B with off-beat hats, extra kicks
     * and chords), drum-only bars, four seconds of silence in the middle, and a closing pad with noise.
     */
    static float[] song() {
        double beat = 0.5;
        float[] buffer = silence(185);
        Random random = new Random(11);
        String layout = "AABB_ABAB_AABB_ABBA_AABA";
        double t0 = 0;
        int section = 0;
        for (char c : layout.toCharArray()) {
            int beats = c == '_' ? 4 : 16;
            if (section == 8) {
                t0 += 4; // silence in the middle
            }
            for (int b = 0; b < beats; b++) {
                double t = t0 + b * beat;
                int inBar = b % 4;
                if (inBar == 0 || inBar == 2) {
                    kick(buffer, t, inBar == 0 ? 0.9 : 0.55);
                } else {
                    snare(buffer, t, 0.5, random);
                }
                if (c == 'B') {
                    hat(buffer, t + beat / 2, 0.5, 0.01, random);
                    if (inBar == 2) {
                        kick(buffer, t + beat / 2, 0.4);
                    }
                    if (inBar == 3) {
                        tom(buffer, t + beat / 2, 220 + 40 * (b / 4), 0.35);
                    }
                }
                if (c != '_') {
                    int root = ROOTS[(b / 4 + (c == 'B' ? 1 : 0)) % 4];
                    boolean hard = b % 3 == 0;
                    // Bass: hard-attack plucks in A, soft swells in B.
                    tone(buffer, t, beat * 0.8, root + new int[] {0, 7, 12, 7}[inBar], 0.3, 3, 1,
                            c == 'A' ? 0.002 : 0.08, c == 'A' ? 0.4 : 0, 0);
                    // Lead: alternating hard and soft attacks.
                    tone(buffer, t, beat * 0.9, MELODY[b] + (c == 'B' ? 2 : 0), 0.18, 6, 1,
                            hard ? 0.003 : 0.06, 0, hard ? 0 : 20);
                    if (c == 'B' && inBar == 0) {
                        for (int third : new int[] {0, 4, 7}) {
                            tone(buffer, t, beat * 3.8, root + 24 + third, 0.07, 4, 1.5, 0.05, 0, 0);
                        }
                    }
                }
            }
            t0 += beats * beat;
            section++;
        }
        pad(buffer, t0, t0 + 6, new int[] {48, 55, 64}, 0.15, 0.02, random);
        return buffer;
    }

    /**
     * 2:35: 100 BPM for the first 70 s, then 140 BPM. Low, middle and high noise-band hits on changing patterns,
     * chord stabs, a bass line and silent stretches.
     */
    static float[] tempoChange() {
        float[] buffer = silence(155);
        Random random = new Random(23);
        double t = 2; // two seconds of silence first
        double beat = 60.0 / 100;
        int index = 0;
        while (t < 150) {
            if (t > 72 && beat > 0.5) {
                beat = 60.0 / 140;
                t += 1.5; // a short break at the tempo change
                index = 0;
            }
            boolean quiet = (t > 100 && t < 108) || (t > 125 && t < 129);
            if (!quiet) {
                int inBar = index % 4;
                if (inBar == 0) {
                    kick(buffer, t, 0.85);
                } else if (inBar == 2) {
                    snare(buffer, t, 0.6, random);
                }
                hat(buffer, t, 0.3, 0.008, random);
                hat(buffer, t + beat / 2, 0.22, 0.015, random);
                if (index % 8 == 5) {
                    burst(buffer, t + beat / 4, 0.03, 0.4, random);
                }
                if (index % 16 == 7) {
                    tom(buffer, t, 150 + 25 * (index % 5), 0.4);
                }
                tone(buffer, t, beat * 0.9, 33 + new int[] {0, 0, 5, 7}[(index / 4) % 4] + 12 * (index % 2),
                        0.3, 3, 1, 0.004, 0.3, 0);
                if (inBar == 1) {
                    for (int third : new int[] {0, 3, 7, 10}) {
                        tone(buffer, t, beat * 0.4, 60 + third + (index / 8 % 2) * 5, 0.08, 4, 1, 0.01, 0, 0);
                    }
                }
            }
            t += beat;
            index++;
        }
        return buffer;
    }

    /**
     * 2:50 with hardly any drums: a long soft pad with noise under slow notes, a 12 s silence, a very quiet
     * stretch, and a few isolated loud clicks.
     */
    static float[] ambient() {
        float[] buffer = silence(170);
        Random random = new Random(37);
        pad(buffer, 3, 55, new int[] {45, 52, 57, 64}, 0.12, 0.01, random);
        pad(buffer, 50, 100, new int[] {43, 50, 55, 62}, 0.1, 0.03, random);
        for (int n = 0; n < 20; n++) {
            tone(buffer, 8 + n * 2.3, 2.0, 69 + new int[] {0, 3, 7, 10, 5}[n % 5], 0.12, 5, 1, 0.5, 0, 0.1 * n);
        }
        // Silence from 100 s to 112 s, then something very quiet.
        pad(buffer, 112, 130, new int[] {50, 57, 62}, 0.004, 0.0008, random);
        pad(buffer, 130, 165, new int[] {47, 54, 59, 66}, 0.1, 0.02, random);
        for (double t = 20; t < 165; t += 11.7) {
            burst(buffer, t, 0.004, 0.5, random);
        }
        return buffer;
    }

    /**
     * 2:20 of dense, loud material: sixteenth-note drums with swing and random ghost hits, a fast lead run over
     * a shifting chord bed and a bass that doubles the kick; some peaks reach full scale.
     */
    static float[] dense() {
        float[] buffer = silence(140);
        Random random = new Random(53);
        double beat = 60.0 / 132;
        double sixteenth = beat / 4;
        int step = 0;
        for (double t = 0.5; t < 138; t += sixteenth, step++) {
            double swung = t + (step % 2 == 1 ? sixteenth * 0.12 : 0);
            int inBar = step % 16;
            if (inBar % 8 == 0 || inBar == 10) {
                kick(buffer, swung, 0.9);
            }
            if (inBar == 4 || inBar == 12) {
                snare(buffer, swung, 0.8, random);
            }
            if (step % 2 == 0) {
                hat(buffer, swung, 0.35, 0.01, random);
            } else if (random.nextInt(4) == 0) {
                hat(buffer, swung, 0.15, 0.02, random);
            }
            if (random.nextInt(11) == 0) {
                tom(buffer, swung, 120 + random.nextInt(280), 0.3);
            }
            int scale = new int[] {0, 2, 3, 5, 7, 8, 10, 12}[(step * 5 + (step / 16) * 3) % 8];
            double lead = 72 + scale + (step / 32 % 2) * 7;
            tone(buffer, swung, sixteenth * (step % 4 == 3 ? 1.9 : 0.95), lead, 0.2, 5, 1,
                    step % 3 == 0 ? 0.002 : 0.02, 0, 0);
            if (inBar % 4 == 0) {
                int root = 36 + new int[] {0, 5, 3, 7}[step / 16 % 4];
                tone(buffer, swung, beat * 0.95, root, 0.35, 3, 1, 0.003, 0.2, 0);
                for (int third : new int[] {0, 3, 7}) {
                    tone(buffer, swung, beat * 3.8, root + 24 + third, 0.05, 4, 1.2, 0.03, 0, 0);
                }
            }
        }
        for (int i = 0; i < buffer.length; i++) {
            // Drive some peaks to the rails, as a loud master does.
            buffer[i] = StrictMath.max(-1f, StrictMath.min(1f, buffer[i] * 1.6f));
        }
        return buffer;
    }

    /** Shorter than the HPSS window and ending mid-hop: 0.37 s with one kick and a tone. */
    static float[] tiny() {
        float[] buffer = silence(0.37);
        kick(buffer, 0.05, 0.8);
        tone(buffer, 0.1, 0.2, 60, 0.3, 3, 1, 0.01, 0, 0);
        return buffer;
    }

    /** Not a sample of sound: 20 s of digital silence. */
    static float[] silent() {
        return silence(20);
    }

    /** 12 s of white noise with a slow level change and kicks on it, to push every band at once. */
    static float[] noisy() {
        float[] buffer = silence(12.3);
        Random random = new Random(71);
        for (int i = 0; i < buffer.length; i++) {
            double t = (double) i / SAMPLE_RATE;
            buffer[i] = (float) ((0.25 + 0.2 * StrictMath.sin(2 * StrictMath.PI * 0.4 * t)) * (random.nextDouble() * 2 - 1));
        }
        for (double t = 0.4; t < 12; t += 0.43) {
            kick(buffer, t, 0.6);
        }
        return buffer;
    }
}
