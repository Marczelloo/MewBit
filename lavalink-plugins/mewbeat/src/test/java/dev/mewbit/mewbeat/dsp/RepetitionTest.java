package dev.mewbit.mewbeat.dsp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class RepetitionTest {

    private static final int SR = Synth.SAMPLE_RATE;
    private static final double REPEAT_SIMILARITY = 0.85;
    private static final int LAG_TOLERANCE_MS = 20;
    /** 120 BPM: a beat is 500 ms, a phrase of 16 beats 8 s. */
    private static final int BEAT_MS = 500;

    private static Features extract(float[] signal) {
        FeatureExtractor extractor = new FeatureExtractor(SR, AnalysisTier.FULL);
        float[] buffer = new float[4096];
        for (int offset = 0; offset < signal.length; offset += buffer.length) {
            int length = Math.min(buffer.length, signal.length - offset);
            System.arraycopy(signal, offset, buffer, 0, length);
            extractor.accept(buffer, length);
        }
        return extractor.finish();
    }

    @Test
    void ababStructure() {
        Features features = extract(Synth.song(120, "ABAB"));

        Features.Phrases phrases = features.phrases();
        assertEquals(16, phrases.beatsPerPhrase());
        List<Features.Phrase> list = phrases.list();
        assertEquals(4, list.size(), "phrases " + list);
        assertNull(list.get(0).repeatOf());
        assertNull(list.get(1).repeatOf(), "B must not repeat A: " + list.get(1));
        assertEquals(0, list.get(2).repeatOf(), "phrases " + list);
        assertEquals(1, list.get(3).repeatOf(), "phrases " + list);
        for (int j = 2; j < 4; j++) {
            assertTrue(list.get(j).similarity() >= REPEAT_SIMILARITY, "phrase " + j + ": " + list.get(j));
            assertEquals(32 * BEAT_MS, list.get(j).lagMs(), LAG_TOLERANCE_MS, "phrase " + j);
        }
        assertEquals(0, list.get(0).startMs(), 20);
        assertEquals(features.durationMs(), list.get(3).endMs());
        for (int j = 1; j < 4; j++) {
            assertEquals(list.get(j - 1).endMs(), list.get(j).startMs(), "phrases tile the track");
        }
    }

    @Test
    void slippedRepeatStillMatches() {
        // A B, one bar of drums, A B: the second A starts one bar (4 beats) after the phrase grid says.
        Features features = extract(Synth.song(120, "AB_AB"));

        List<Features.Phrase> list = features.phrases().list();
        assertTrue(list.size() >= 3, "phrases " + list);
        Features.Phrase slipped = list.get(2);
        assertEquals(0, slipped.repeatOf(), "phrase 2: " + slipped);
        assertTrue(slipped.similarity() >= REPEAT_SIMILARITY, "phrase 2: " + slipped);
        assertEquals((32 + 4) * BEAT_MS, slipped.lagMs(), LAG_TOLERANCE_MS, "phrase 2: " + slipped);
    }

    @Test
    void shortTrackHasNoPhrases() {
        int beats = 20;
        int[] beatMs = new int[beats];
        float[][] chroma = new float[beats][12];
        float[][] rhythm = new float[beats][4];
        for (int i = 0; i < beats; i++) {
            beatMs[i] = i * BEAT_MS;
            chroma[i][0] = 1;
            rhythm[i][0] = 1;
        }

        List<Features.Phrase> phrases =
                Repetition.phrases(beatMs, new int[] {0, 2000, 4000}, 0.9, chroma, rhythm, beats * BEAT_MS);

        assertEquals(List.of(), phrases);
    }
}
