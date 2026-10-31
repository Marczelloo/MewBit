package dev.mewbit.mewbeat.dsp;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import org.junit.jupiter.api.Test;

class DownsamplerTest {

    private static final int INPUT_RATE = 48_000;

    /** Interleaved stereo s16 sine; the right channel is a copy of the left. */
    private static short[] stereoSine(double frequency, double amplitude, int frames) {
        short[] samples = new short[frames * 2];
        for (int i = 0; i < frames; i++) {
            short v = (short) Math.round(amplitude * 32767 * Math.sin(2 * Math.PI * frequency * i / INPUT_RATE));
            samples[2 * i] = v;
            samples[2 * i + 1] = v;
        }
        return samples;
    }

    private static float[] convert(short[] stereo, int chunkFrames) {
        Downsampler downsampler = new Downsampler();
        int frames = stereo.length / 2;
        float[] result = new float[Downsampler.maxOutput(frames)];
        int written = 0;
        short[] chunk = new short[chunkFrames * 2];
        float[] out = new float[Downsampler.maxOutput(chunkFrames)];
        for (int offset = 0; offset < frames; offset += chunkFrames) {
            int length = Math.min(chunkFrames, frames - offset);
            System.arraycopy(stereo, offset * 2, chunk, 0, length * 2);
            int n = downsampler.process(chunk, length, out);
            System.arraycopy(out, 0, result, written, n);
            written += n;
        }
        return Arrays.copyOf(result, written);
    }

    /** Peak amplitude after the filter's start-up transient. */
    private static double steadyPeak(float[] samples) {
        double peak = 0;
        for (int i = 200; i < samples.length - 200; i++) {
            peak = Math.max(peak, Math.abs(samples[i]));
        }
        return peak;
    }

    @Test
    void halvesTheSampleRate() {
        float[] out = convert(stereoSine(1000, 0.5, INPUT_RATE), 4096);

        assertEquals(24_000, out.length);
    }

    @Test
    void keepsAmplitudeOfAMidBandTone() {
        float[] out = convert(stereoSine(1000, 0.5, INPUT_RATE), 4096);

        assertEquals(0.5, steadyPeak(out), 0.01);
    }

    @Test
    void attenuatesTonesAboveTheNewNyquist() {
        // 14 kHz would alias to 10 kHz at 24 kHz if it were not filtered out first.
        float[] out = convert(stereoSine(14_000, 0.5, INPUT_RATE), 4096);

        assertTrue(steadyPeak(out) < 0.01, "aliased peak " + steadyPeak(out));
    }

    @Test
    void chunkedEqualsOneShot() {
        short[] input = stereoSine(3000, 0.7, INPUT_RATE / 2);

        assertArrayEquals(convert(input, input.length / 2), convert(input, 997));
    }
}
