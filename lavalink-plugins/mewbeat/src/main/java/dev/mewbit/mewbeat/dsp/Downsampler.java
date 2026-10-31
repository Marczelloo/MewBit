package dev.mewbit.mewbeat.dsp;

/**
 * Streaming 48 kHz stereo to 24 kHz mono converter: averages the channels,
 * low-passes with a half-band FIR (-6 dB at 12 kHz) and keeps every second
 * sample. State carries across calls, so chunk boundaries do not matter.
 *
 * <p>The filter is linear phase with a group delay of {@value #DELAY_SAMPLES}
 * input samples (about 0.8 ms at 48 kHz).
 */
public final class Downsampler {

    private static final int TAPS = 79;
    private static final double KAISER_BETA = 8.0;
    private static final int HISTORY = 128; // power of two, >= TAPS
    private static final int HISTORY_MASK = HISTORY - 1;

    /** Group delay of the anti-alias filter, in 48 kHz input samples. */
    public static final int DELAY_SAMPLES = (TAPS - 1) / 2;

    // Half-band kernel: every even-offset tap but the centre is zero, so only
    // the non-zero taps are kept and multiplied.
    private static final float[] COEFFICIENTS;
    private static final int[] DELAYS;

    static {
        int centre = DELAY_SAMPLES;
        double[] kernel = new double[TAPS];
        double sum = 0;
        double besselBeta = besselI0(KAISER_BETA);
        for (int i = 0; i < TAPS; i++) {
            int k = i - centre;
            double ideal = k == 0 ? 0.5 : Math.sin(Math.PI * k / 2) / (Math.PI * k);
            double ratio = (double) k / centre;
            double window = besselI0(KAISER_BETA * Math.sqrt(1 - ratio * ratio)) / besselBeta;
            kernel[i] = ideal * window;
            sum += kernel[i];
        }
        int count = 0;
        for (double c : kernel) {
            if (Math.abs(c) > 1e-12) {
                count++;
            }
        }
        COEFFICIENTS = new float[count];
        DELAYS = new int[count];
        int n = 0;
        for (int i = 0; i < TAPS; i++) {
            if (Math.abs(kernel[i]) > 1e-12) {
                COEFFICIENTS[n] = (float) (kernel[i] / sum);
                DELAYS[n] = i;
                n++;
            }
        }
    }

    private final float[] history = new float[HISTORY];
    private int position;
    private boolean emitNext = true;

    /** Largest number of output samples {@code frames} input frames can produce. */
    public static int maxOutput(int frames) {
        return frames / 2 + 1;
    }

    /**
     * @param interleaved interleaved stereo 16-bit samples (left, right, ...)
     * @param frames number of stereo frames to read from {@code interleaved}
     * @param out receives mono samples in -1..1; needs room for {@link #maxOutput(int)}
     * @return the number of samples written to {@code out}
     */
    public int process(short[] interleaved, int frames, float[] out) {
        int written = 0;
        for (int i = 0; i < frames; i++) {
            float mono = (interleaved[2 * i] + interleaved[2 * i + 1]) * (0.5f / 32768f);
            written = push(mono, out, written);
        }
        return written;
    }

    /** As {@link #process(short[], int, float[])} for float samples already scaled to -1..1. */
    public int process(float[] interleaved, int frames, float[] out) {
        int written = 0;
        for (int i = 0; i < frames; i++) {
            float mono = (interleaved[2 * i] + interleaved[2 * i + 1]) * 0.5f;
            written = push(mono, out, written);
        }
        return written;
    }

    private int push(float mono, float[] out, int written) {
        history[position] = mono;
        if (emitNext) {
            float acc = 0;
            for (int j = 0; j < COEFFICIENTS.length; j++) {
                acc += COEFFICIENTS[j] * history[(position - DELAYS[j]) & HISTORY_MASK];
            }
            out[written++] = acc;
        }
        emitNext = !emitNext;
        position = (position + 1) & HISTORY_MASK;
        return written;
    }

    private static double besselI0(double x) {
        double term = 1;
        double sum = 1;
        double quarter = x * x / 4;
        for (int k = 1; k < 60; k++) {
            term *= quarter / ((double) k * k);
            sum += term;
            if (term < sum * 1e-16) {
                break;
            }
        }
        return sum;
    }
}
