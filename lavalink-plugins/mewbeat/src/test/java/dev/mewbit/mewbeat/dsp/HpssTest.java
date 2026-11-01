package dev.mewbit.mewbeat.dsp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class HpssTest {

    private static final int SR = Synth.SAMPLE_RATE;
    private static final int BINS = FeatureExtractor.FFT_SIZE / 2 + 1;
    private static final int KERNEL = AnalysisTier.FULL.hpssKernel();

    /** Pushes every frame and returns the {percussive, harmonic} pairs; the list index is the frame index. */
    private static List<float[][]> separate(List<float[]> frames, int kernel) {
        Hpss hpss = new Hpss(BINS, kernel);
        List<float[][]> pairs = new ArrayList<>();
        for (float[] frame : frames) {
            float[][] pair = hpss.push(frame);
            if (pair != null) {
                pairs.add(pair);
            }
        }
        for (float[][] pair : hpss.flush()) {
            pairs.add(pair);
        }
        return pairs;
    }

    @Test
    void toneGoesHarmonicClickGoesPercussive() {
        float[] signal = Synth.silence(4);
        for (int i = 0; i < signal.length; i++) {
            signal[i] = (float) (0.3 * Math.sin(2 * Math.PI * 440 * i / SR));
        }
        for (double t = 0.5; t < 3.9; t += 0.5) {
            signal[(int) Math.round(t * SR)] += 0.8f;
        }
        List<float[]> frames = Synth.magnitudes(signal);
        List<float[][]> pairs = separate(frames, KERNEL);
        assertEquals(frames.size(), pairs.size());

        int toneBin = Math.round(440f * FeatureExtractor.FFT_SIZE / SR);
        double harmonic = 0;
        double toneTotal = 0;
        for (float[][] pair : pairs) {
            harmonic += square(pair[1][toneBin]);
            toneTotal += square(pair[0][toneBin]) + square(pair[1][toneBin]);
        }
        assertTrue(harmonic / toneTotal > 0.8, "harmonic share at 440 Hz: " + harmonic / toneTotal);

        int from = (int) Math.ceil(4000.0 * FeatureExtractor.FFT_SIZE / SR);
        int to = (int) Math.floor(8000.0 * FeatureExtractor.FFT_SIZE / SR);
        // Frame i ends at (i + 1) * HOP, so a click at sample c is inside frames c / HOP .. c / HOP + 3.
        for (double t = 1.0; t < 3.4; t += 0.5) {
            int frame = (int) Math.round(t * SR) / FeatureExtractor.HOP;
            double percussive = 0;
            double total = 0;
            for (int f = frame; f <= frame + 3; f++) {
                for (int bin = from; bin <= to; bin++) {
                    percussive += square(pairs.get(f)[0][bin]);
                    total += square(pairs.get(f)[0][bin]) + square(pairs.get(f)[1][bin]);
                }
            }
            assertTrue(percussive / total > 0.8, "percussive share at click " + t + " s: " + percussive / total);
        }
    }

    @Test
    void boundedDelay() {
        for (int kernel : new int[] {AnalysisTier.FULL.hpssKernel(), AnalysisTier.LIGHT.hpssKernel()}) {
            Hpss hpss = new Hpss(BINS, kernel);
            float[] frame = new float[BINS];
            for (int push = 1; push <= kernel / 2; push++) {
                assertNull(hpss.push(frame), "push " + push + " of kernel " + kernel);
            }
            assertNotNull(hpss.push(frame), "push " + (kernel / 2 + 1) + " of kernel " + kernel);
        }
    }

    @Test
    void flushReturnsTheFramesStillWaiting() {
        float[] frame = new float[BINS];
        Hpss hpss = new Hpss(BINS, KERNEL);
        int outputs = 0;
        for (int i = 0; i < 40; i++) {
            if (hpss.push(frame) != null) {
                outputs++;
            }
        }
        outputs += hpss.flush().length;
        assertEquals(40, outputs);

        Hpss shortStream = new Hpss(BINS, KERNEL);
        shortStream.push(frame);
        shortStream.push(frame);
        assertEquals(2, shortStream.flush().length);
    }

    private static double square(float v) {
        return (double) v * v;
    }
}
