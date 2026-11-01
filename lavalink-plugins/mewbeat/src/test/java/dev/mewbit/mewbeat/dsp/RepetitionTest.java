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

    /** Hand-built beats for {@code pickup} silent beats, then the sections of {@code layout} (A or B, 16 beats each). */
    private static final class Beats {
        final int[] beatMs;
        final float[][] chroma;
        final float[][] rhythm;
        final int durationMs;

        Beats(int pickup, String layout, int tail) {
            int n = pickup + layout.length() * 16 + tail;
            beatMs = new int[n];
            chroma = new float[n][12];
            rhythm = new float[n][4];
            for (int i = 0; i < n; i++) {
                beatMs[i] = 250 + i * BEAT_MS;
            }
            durationMs = beatMs[n - 1] + BEAT_MS;
            for (int s = 0; s < layout.length(); s++) {
                int type = layout.charAt(s) == 'A' ? 0 : 1;
                for (int k = 0; k < 16; k++) {
                    int i = pickup + s * 16 + k;
                    // Other pitch class and sub-beat slot per beat, and other ones again in B, so no shift of
                    // up to a bar lets A match B.
                    chroma[i][(k * 7 + type) % 12] = 1;
                    rhythm[i][(k + type) % 4] = 1;
                }
            }
            for (int i = pickup + layout.length() * 16; i < n; i++) {
                chroma[i][i % 12] = 1;
                rhythm[i][i % 4] = 1;
            }
        }

        int[] downbeatsFrom(int first) {
            int count = (beatMs.length - first + 3) / 4;
            int[] downbeats = new int[count];
            for (int i = 0; i < count; i++) {
                downbeats[i] = beatMs[first + i * 4];
            }
            return downbeats;
        }
    }

    private static List<Integer> repeatsOf(List<Features.Phrase> phrases) {
        return phrases.stream().map(Features.Phrase::repeatOf).toList();
    }

    @Test
    void untrustedTempoFindsShiftedGrid() {
        Beats song = new Beats(2, "ABAB", 0);

        List<Features.Phrase> phrases =
                Repetition.phrases(song.beatMs, song.downbeatsFrom(0), 0.3, song.chroma, song.rhythm, song.durationMs);

        int[] expectedStarts = {0, song.beatMs[2], song.beatMs[18], song.beatMs[34], song.beatMs[50]};
        assertEquals(5, phrases.size(), "phrases " + phrases);
        for (int j = 0; j < 5; j++) {
            assertEquals(expectedStarts[j], phrases.get(j).startMs(), "start of phrase " + j);
        }
        assertEquals(song.beatMs[2], phrases.get(0).endMs(), "a 2-beat pickup is phrase 0");
        assertEquals(song.durationMs, phrases.get(4).endMs());
        assertEquals(java.util.Arrays.asList(null, null, null, 1, 2), repeatsOf(phrases), "phrases " + phrases);
        assertEquals(32 * BEAT_MS, phrases.get(3).lagMs());
        assertEquals(32 * BEAT_MS, phrases.get(4).lagMs());
    }

    @Test
    void trustedDowngradeUsesFirstDownbeat() {
        Beats song = new Beats(2, "ABAB", 0);

        List<Features.Phrase> phrases =
                Repetition.phrases(song.beatMs, song.downbeatsFrom(2), 0.8, song.chroma, song.rhythm, song.durationMs);

        assertEquals(5, phrases.size(), "phrases " + phrases);
        assertEquals(0, phrases.get(0).startMs());
        assertEquals(song.beatMs[2], phrases.get(0).endMs(), "a 2-beat pickup is phrase 0");
        assertEquals(song.beatMs[2], phrases.get(1).startMs());
        assertEquals(java.util.Arrays.asList(null, null, null, 1, 2), repeatsOf(phrases), "phrases " + phrases);
    }

    @Test
    void sharedKeyDoesNotMakePhrasesRepeat() {
        // Every beat rings the tonic loudly on the same sub-beat, as real songs do; only a quieter pitch class
        // tells A from B. Raw chroma would call B a repeat of A, the song-centred chroma must not.
        Beats song = new Beats(0, "ABA", 0);
        for (int i = 0; i < song.beatMs.length; i++) {
            for (int k = 0; k < 12; k++) {
                song.chroma[i][k] *= 0.3f;
            }
            song.chroma[i][0] += 1;
            java.util.Arrays.fill(song.rhythm[i], 0);
            song.rhythm[i][0] = 1;
        }

        List<Features.Phrase> phrases =
                Repetition.phrases(song.beatMs, song.downbeatsFrom(0), 0.9, song.chroma, song.rhythm, song.durationMs);

        assertEquals(java.util.Arrays.asList(null, null, 0), repeatsOf(phrases), "phrases " + phrases);
        assertTrue(phrases.get(1).similarity() < REPEAT_SIMILARITY, "B vs A: " + phrases.get(1));
    }

    @Test
    void shortTailJoinsPreviousPhrase() {
        Beats song = new Beats(0, "AB", 5);

        List<Features.Phrase> phrases =
                Repetition.phrases(song.beatMs, song.downbeatsFrom(0), 0.9, song.chroma, song.rhythm, song.durationMs);

        assertEquals(2, phrases.size(), "phrases " + phrases);
        assertEquals(song.beatMs[16], phrases.get(1).startMs());
        assertEquals(song.durationMs, phrases.get(1).endMs(), "the 5-beat tail belongs to the last phrase");

        Beats longer = new Beats(0, "AB", 8);
        List<Features.Phrase> withTail = Repetition.phrases(
                longer.beatMs, longer.downbeatsFrom(0), 0.9, longer.chroma, longer.rhythm, longer.durationMs);
        assertEquals(3, withTail.size(), "an 8-beat tail is a phrase of its own");
    }
}
