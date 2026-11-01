package dev.mewbit.mewbeat.dsp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;

class PitchTrackerTest {

    private static final int SR = Synth.SAMPLE_RATE;
    private static final double PITCH_TOLERANCE = 0.5;
    private static final int START_TOLERANCE_MS = 10;
    private static final int LENGTH_TOLERANCE_MS = 50;

    /** A note the test played: start and length in seconds. */
    private record Played(double start, double length, double midi) {}

    /** Feeds the signal in uneven chunks, the way the decoder does. */
    private static PitchTracker.Lines track(float[] signal, int[] onsetMs, AnalysisTier tier) {
        PitchTracker tracker = new PitchTracker(SR, tier);
        int chunk = 3000;
        for (int from = 0; from < signal.length; from += chunk) {
            float[] part = new float[Math.min(chunk, signal.length - from)];
            System.arraycopy(signal, from, part, 0, part.length);
            tracker.accept(part, part.length);
        }
        return tracker.finish(onsetMs);
    }

    private static int[] onsetsOf(List<Played> notes) {
        return notes.stream().mapToInt(n -> (int) Math.round(n.start() * 1000)).toArray();
    }

    private static void assertLine(List<Features.Note> line, List<Played> expected) {
        for (Played p : expected) {
            boolean found = line.stream().anyMatch(n -> Math.abs(n.pitch() - p.midi()) <= PITCH_TOLERANCE
                    && Math.abs(n.t() - p.start() * 1000) <= START_TOLERANCE_MS
                    && Math.abs(n.len() - p.length() * 1000) <= LENGTH_TOLERANCE_MS);
            assertTrue(found, "no note for " + p + " in " + line);
        }
        assertEquals(expected.size(), line.size(), "note count in " + line);
        for (Features.Note n : line) {
            assertTrue(n.s() > 0 && n.s() <= 1, "salience " + n);
            assertTrue(n.conf() >= 0.35 && n.conf() <= 1, "confidence " + n);
        }
    }

    @Test
    void bassLineDetected() {
        float[] signal = Synth.silence(3.5);
        List<Played> played = new ArrayList<>();
        double[] midis = {36, 38, 41, 43};
        for (int i = 0; i < midis.length; i++) {
            double start = 0.5 + i * 0.55;
            Synth.addBassNote(signal, start, 0.5, midis[i], 0.4);
            played.add(new Played(start, 0.5, midis[i]));
        }

        PitchTracker.Lines lines = track(signal, onsetsOf(played), AnalysisTier.FULL);

        assertLine(lines.bass(), played);
        for (Features.Note n : lines.lead()) {
            assertTrue(n.len() <= 100, "lead note in a bass-only signal: " + n);
        }
    }

    @Test
    void vibratoLeadIsOneNote() {
        float[] signal = Synth.silence(2.5);
        Synth.addLeadNote(signal, 0.5, 1.2, 69, 0.3, 40);
        List<Played> played = List.of(new Played(0.5, 1.2, 69));

        PitchTracker.Lines lines = track(signal, onsetsOf(played), AnalysisTier.FULL);

        assertLine(lines.lead(), played);
        assertEquals(List.of(), lines.bass().stream().filter(n -> n.len() > 100).toList(), "bass notes");
    }

    @Test
    void leadOverBass() {
        float[] signal = Synth.silence(2.5);
        List<Played> bass = new ArrayList<>();
        List<Played> lead = new ArrayList<>();
        double[] melody = {64, 67, 71, 67};
        for (int i = 0; i < melody.length; i++) {
            double start = 0.5 + i * 0.4;
            Synth.addBassNote(signal, start, 0.4, 40, 0.4);
            Synth.addLeadNote(signal, start, 0.4, melody[i], 0.3, 0);
            bass.add(new Played(start, 0.4, 40));
            lead.add(new Played(start, 0.4, melody[i]));
        }

        PitchTracker.Lines lines = track(signal, onsetsOf(lead), AnalysisTier.FULL);

        assertLine(lines.bass(), bass);
        assertLine(lines.lead(), lead);
    }

    @Test
    void noiseIsUnvoiced() {
        float[] signal = Synth.silence(4);
        Synth.addNoise(signal, 0, 4, 0.3, new Random(11));

        PitchTracker.Lines lines = track(signal, new int[0], AnalysisTier.FULL);

        assertEquals(List.of(), lines.bass());
        assertEquals(List.of(), lines.lead());
    }

    @Test
    void chromaPeaksAtPitchClass() {
        float[] signal = Synth.silence(2);
        Synth.addLeadNote(signal, 0.5, 1.0, 69, 0.3, 0);

        PitchTracker.Lines lines = track(signal, new int[] {500}, AnalysisTier.FULL);

        assertEquals(lines.chromaMs().length, lines.chroma().length);
        int checked = 0;
        for (int i = 0; i < lines.chroma().length; i++) {
            int ms = lines.chromaMs()[i];
            if (ms < 700 || ms > 1300) {
                continue;
            }
            float[] frame = lines.chroma()[i];
            assertEquals(12, frame.length);
            int best = 0;
            for (int pc = 1; pc < 12; pc++) {
                if (frame[pc] > frame[best]) {
                    best = pc;
                }
            }
            assertEquals(9, best, "chroma peak at " + ms + " ms: " + java.util.Arrays.toString(frame));
            checked++;
        }
        assertTrue(checked > 10, "frames checked: " + checked);
        for (int i = 1; i < lines.chromaMs().length; i++) {
            assertEquals(AnalysisTier.FULL.pitchHop() * 1000.0 / SR,
                    lines.chromaMs()[i] - lines.chromaMs()[i - 1], 1.0);
        }
    }
}
