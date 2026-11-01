package dev.mewbit.mewbeat.dsp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;

class DrumDetectorTest {

    private static final int SR = Synth.SAMPLE_RATE;
    private static final double HOP_MS = FeatureExtractor.HOP * 1000.0 / SR;
    private static final int TOLERANCE_MS = 10;

    private record Expected(double seconds, String kind) {}

    /** The full path: spectra, then HPSS, then the detector, whose hop is the frame the percussive output belongs to. */
    private static List<Features.Drum> detect(float[] signal, AnalysisTier tier) {
        Hpss hpss = new Hpss(FeatureExtractor.FFT_SIZE / 2 + 1, tier.hpssKernel());
        DrumDetector detector = new DrumDetector(SR, FeatureExtractor.FFT_SIZE, HOP_MS);
        int hop = 0;
        for (float[] frame : Synth.magnitudes(signal)) {
            float[][] pair = hpss.push(frame);
            if (pair != null) {
                detector.accept(pair[0], hop++);
            }
        }
        for (float[][] pair : hpss.flush()) {
            detector.accept(pair[0], hop++);
        }
        return detector.finish();
    }

    @Test
    void kickSnareHatPattern() {
        Random random = new Random(7);
        float[] signal = Synth.silence(8);
        List<Expected> expected = new ArrayList<>();
        // 120 BPM: a beat every 0.5 s starting at 0.5 s. Kicks on beats 1 and 3, snares on 2 and 4 of each bar,
        // hats on the off-beat eighths (the on-beat eighths are taken by the kick or snare).
        for (int beat = 0; beat < 14; beat++) {
            double t = 0.5 + beat * 0.5;
            if (beat % 4 == 0 || beat % 4 == 2) {
                Synth.addThump(signal, t, 0.6);
                expected.add(new Expected(t, "kick"));
            } else {
                Synth.addSnare(signal, t, 0.5, random);
                expected.add(new Expected(t, "snare"));
            }
            Synth.addHat(signal, t + 0.25, 0.4, random);
            expected.add(new Expected(t + 0.25, "hat"));
        }

        List<Features.Drum> drums = detect(signal, AnalysisTier.FULL);

        int matched = 0;
        List<String> misses = new ArrayList<>();
        for (Expected e : expected) {
            boolean found = drums.stream().anyMatch(d -> d.kind().equals(e.kind())
                    && Math.abs(d.t() - e.seconds() * 1000) <= TOLERANCE_MS);
            if (found) {
                matched++;
            } else {
                misses.add(e.kind() + "@" + e.seconds());
            }
        }
        int falsePositives = 0;
        for (Features.Drum d : drums) {
            boolean near = expected.stream().anyMatch(e -> Math.abs(d.t() - e.seconds() * 1000) <= TOLERANCE_MS);
            if (!near) {
                falsePositives++;
            }
        }
        assertTrue(matched >= 0.9 * expected.size(),
                "matched " + matched + " of " + expected.size() + ", missed " + misses + ", detected " + drums);
        assertTrue(falsePositives <= 0.1 * expected.size(),
                "false positives " + falsePositives + " of " + drums.size() + ": " + drums);
        for (Features.Drum d : drums) {
            assertTrue(d.s() >= 0 && d.s() <= 1, "strength " + d);
        }
        for (int i = 1; i < drums.size(); i++) {
            assertTrue(drums.get(i).t() > drums.get(i - 1).t(), "time-ordered");
        }
    }

    @Test
    void lightTierStillFindsTheKicks() {
        float[] signal = Synth.silence(6);
        Synth.addThumps(signal, 0.5, 0.5, 5.5, 0.6);
        List<Features.Drum> drums = detect(signal, AnalysisTier.LIGHT);
        int found = 0;
        for (int i = 0; i < 10; i++) {
            double at = 0.5 + i * 0.5;
            if (drums.stream().anyMatch(d -> d.kind().equals("kick") && Math.abs(d.t() - at * 1000) <= TOLERANCE_MS)) {
                found++;
            }
        }
        assertTrue(found >= 9, "kicks found: " + found + " of 10, detected " + drums);
    }

    @Test
    void silenceHasNoDrums() {
        assertEquals(List.of(), detect(Synth.silence(5), AnalysisTier.FULL));
    }
}
