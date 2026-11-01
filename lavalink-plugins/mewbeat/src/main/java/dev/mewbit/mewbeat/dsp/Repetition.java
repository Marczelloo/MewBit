package dev.mewbit.mewbeat.dsp;

import java.util.ArrayList;
import java.util.List;

/**
 * Splits a track into phrases of 16 beats and finds which phrase repeats which.
 *
 * <p>Each beat is described by its chroma (what is played) and rhythm (when); two beats are similar by
 * {@code 0.6 * cos(chroma) + 0.4 * cos(rhythm)}. The chroma is centred on the song's mean first: every beat of a
 * song shares its key, so raw chroma vectors all point the same way and any two phrases would look alike.
 * A phrase is compared with every earlier one at beat shifts of
 * -4..+4, so a repeat that starts a bar late or early still matches; the shift shows up as the lag.
 */
final class Repetition {

    static final int BEATS_PER_PHRASE = 16;
    /** A phrase whose similarity to an earlier one reaches this repeats it. */
    static final double REPEAT_THRESHOLD = 0.85;

    private static final int MIN_BEATS = 2 * BEATS_PER_PHRASE;
    private static final int MAX_SHIFT = 4;
    private static final double CHROMA_WEIGHT = 0.6;
    private static final double RHYTHM_WEIGHT = 0.4;
    private static final double TRUST_TEMPO_CONFIDENCE = 0.5;
    private static final int GRID_OFFSETS = 4;
    /** A phrase of fewer beats than this at the end joins the one before it; a pickup of fewer is no source. */
    private static final int MIN_PHRASE_BEATS = BEATS_PER_PHRASE / 2;
    /** A shift compares only the beats that exist at both ends; with fewer than this it counts for nothing. */
    private static final int MIN_COMPARED_BEATS = BEATS_PER_PHRASE / 2;
    /** Among shifts this close in similarity the one nearer to zero wins, so a looping bar does not pick a far shift. */
    private static final double SHIFT_TIE = 1e-6;

    private Repetition() {}

    /**
     * @param beatMs start of every beat, ascending
     * @param downbeatMs the beats that open a bar (a subset of {@code beatMs})
     * @param beatChroma per beat the mean chroma up to the next beat, L2-normalised (all zero when silent)
     * @param beatRhythm per beat the onset flux summed into 4 sub-beat slots
     * @return the phrases tiling 0..durationMs with {@code activity} and {@code confidence} left at zero, or an empty
     *     list for under 32 beats
     */
    static List<Features.Phrase> phrases(
            int[] beatMs,
            int[] downbeatMs,
            double tempoConfidence,
            float[][] beatChroma,
            float[][] beatRhythm,
            int durationMs) {
        int n = beatMs.length;
        if (n < MIN_BEATS) {
            return List.of();
        }
        beatChroma = centred(beatChroma);
        int[] starts;
        if (tempoConfidence >= TRUST_TEMPO_CONFIDENCE && downbeatMs.length > 0) {
            starts = gridStarts(n, indexOf(beatMs, downbeatMs[0]));
        } else {
            starts = bestGrid(n, beatChroma, beatRhythm);
        }
        List<Features.Phrase> phrases = new ArrayList<>(starts.length);
        for (int j = 0; j < starts.length; j++) {
            int endBeat = j + 1 < starts.length ? starts[j + 1] : -1;
            int endMs = endBeat >= 0 ? beatMs[endBeat] : durationMs;
            int startMs = j == 0 ? 0 : beatMs[starts[j]];
            int lengthBeats = (endBeat >= 0 ? endBeat : n) - starts[j];
            phrases.add(compare(starts, j, lengthBeats, startMs, endMs, beatMs, beatChroma, beatRhythm));
        }
        return phrases;
    }

    /** Each sounding beat's chroma minus the mean over the sounding beats; silent beats stay all zero. */
    private static float[][] centred(float[][] beatChroma) {
        int dims = beatChroma[0].length;
        double[] mean = new double[dims];
        int sounding = 0;
        for (float[] chroma : beatChroma) {
            if (isSilent(chroma)) {
                continue;
            }
            for (int k = 0; k < dims; k++) {
                mean[k] += chroma[k];
            }
            sounding++;
        }
        float[][] out = new float[beatChroma.length][dims];
        if (sounding == 0) {
            return out;
        }
        for (int i = 0; i < beatChroma.length; i++) {
            if (isSilent(beatChroma[i])) {
                continue;
            }
            for (int k = 0; k < dims; k++) {
                out[i][k] = (float) (beatChroma[i][k] - mean[k] / sounding);
            }
        }
        return out;
    }

    private static boolean isSilent(float[] chroma) {
        for (float v : chroma) {
            if (v != 0) {
                return false;
            }
        }
        return true;
    }

    /** Phrase starts (beat indexes): a pickup before {@code first} when it is a beat or more, then every 16 beats. */
    private static int[] gridStarts(int n, int first) {
        List<Integer> starts = new ArrayList<>();
        if (first >= 1) {
            starts.add(0);
        }
        for (int s = first; n - s >= MIN_PHRASE_BEATS; s += BEATS_PER_PHRASE) {
            starts.add(s);
        }
        int[] result = new int[starts.size()];
        for (int i = 0; i < result.length; i++) {
            result[i] = starts.get(i);
        }
        return result;
    }

    /** With no trusted downbeat: the grid offset (0..3 beats) whose phrases repeat each other best. */
    private static int[] bestGrid(int n, float[][] beatChroma, float[][] beatRhythm) {
        int[] best = null;
        double bestScore = -1;
        for (int offset = 0; offset < GRID_OFFSETS; offset++) {
            int[] starts = gridStarts(n, offset);
            double score = gridScore(starts, n, beatChroma, beatRhythm);
            if (score > bestScore + SHIFT_TIE) {
                bestScore = score;
                best = starts;
            }
        }
        return best;
    }

    /** Mean over the phrases after the first of the best similarity to any earlier phrase. */
    private static double gridScore(int[] starts, int n, float[][] beatChroma, float[][] beatRhythm) {
        double sum = 0;
        int counted = 0;
        for (int j = 1; j < starts.length; j++) {
            int length = Math.min(BEATS_PER_PHRASE, (j + 1 < starts.length ? starts[j + 1] : n) - starts[j]);
            double top = 0;
            boolean scorable = false;
            for (int i = 0; i < j; i++) {
                Match match = bestShift(starts, i, j, length, n, beatChroma, beatRhythm);
                if (match != null) {
                    top = Math.max(top, match.similarity);
                    scorable = true;
                }
            }
            // A phrase with no usable source (e.g. the one after a pickup) says nothing about this grid.
            if (scorable) {
                sum += top;
                counted++;
            }
        }
        return counted == 0 ? 0 : sum / counted;
    }

    private record Match(double similarity, int shift) {}

    private static Features.Phrase compare(
            int[] starts,
            int j,
            int lengthBeats,
            int startMs,
            int endMs,
            int[] beatMs,
            float[][] beatChroma,
            float[][] beatRhythm) {
        int n = beatMs.length;
        int length = Math.min(BEATS_PER_PHRASE, lengthBeats);
        double bestSeen = 0;
        for (int i = 0; i < j; i++) {
            Match match = bestShift(starts, i, j, length, n, beatChroma, beatRhythm);
            if (match == null) {
                continue;
            }
            bestSeen = Math.max(bestSeen, match.similarity);
            if (match.similarity >= REPEAT_THRESHOLD) {
                int lag = beatMs[starts[j]] - beatTime(beatMs, starts[i] + match.shift);
                return new Features.Phrase(
                        startMs,
                        endMs,
                        i,
                        Highlight.round3(match.similarity),
                        lag,
                        Features.Layers.NONE,
                        Features.Layers.NONE);
            }
        }
        return new Features.Phrase(
                startMs, endMs, null, Highlight.round3(bestSeen), 0, Features.Layers.NONE, Features.Layers.NONE);
    }

    /**
     * The shift of phrase {@code i} that phrase {@code j} matches best over its first {@code length} beats;
     * {@code null} when phrase i is too short to serve as a source or no shift has enough beats to compare.
     */
    private static Match bestShift(
            int[] starts, int i, int j, int length, int n, float[][] beatChroma, float[][] beatRhythm) {
        int from = starts[i];
        int to = starts[j];
        int sourceLength = starts[i + 1] - from;
        if (sourceLength < MIN_PHRASE_BEATS) {
            return null;
        }
        Match best = null;
        for (int shift = -MAX_SHIFT; shift <= MAX_SHIFT; shift++) {
            double sum = 0;
            int compared = 0;
            for (int k = 0; k < length; k++) {
                int source = from + shift + k;
                if (source < 0 || source >= n || source >= to + k) {
                    continue;
                }
                sum += beatSimilarity(beatChroma[source], beatRhythm[source], beatChroma[to + k], beatRhythm[to + k]);
                compared++;
            }
            if (compared < Math.min(MIN_COMPARED_BEATS, length)) {
                continue;
            }
            double similarity = sum / compared;
            boolean better = best == null
                    || similarity > best.similarity + SHIFT_TIE
                    || (similarity > best.similarity - SHIFT_TIE && Math.abs(shift) < Math.abs(best.shift));
            if (better) {
                best = new Match(similarity, shift);
            }
        }
        return best;
    }

    private static double beatSimilarity(float[] chromaA, float[] rhythmA, float[] chromaB, float[] rhythmB) {
        return CHROMA_WEIGHT * cosine(chromaA, chromaB) + RHYTHM_WEIGHT * cosine(rhythmA, rhythmB);
    }

    /** Cosine similarity; two silent vectors count as identical, a silent and a sounding one as unrelated. */
    private static double cosine(float[] a, float[] b) {
        double dot = 0;
        double normA = 0;
        double normB = 0;
        for (int i = 0; i < a.length; i++) {
            dot += (double) a[i] * b[i];
            normA += (double) a[i] * a[i];
            normB += (double) b[i] * b[i];
        }
        if (normA == 0 || normB == 0) {
            return normA == normB ? 1 : 0;
        }
        return dot / Math.sqrt(normA * normB);
    }

    /** Start time of beat {@code index}, extended past either end at the first or last beat interval. */
    private static int beatTime(int[] beatMs, int index) {
        int n = beatMs.length;
        if (index < 0) {
            return beatMs[0] + index * (beatMs[1] - beatMs[0]);
        }
        if (index >= n) {
            return beatMs[n - 1] + (index - n + 1) * (beatMs[n - 1] - beatMs[n - 2]);
        }
        return beatMs[index];
    }

    private static int indexOf(int[] beatMs, int ms) {
        for (int i = 0; i < beatMs.length; i++) {
            if (beatMs[i] >= ms) {
                return i;
            }
        }
        return 0;
    }
}
