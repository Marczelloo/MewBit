package dev.mewbit.mewbeat.dsp;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Follows the bass and the lead of a track, and folds the spectrum into chroma.
 *
 * <p>Every {@link AnalysisTier#pitchHop()} samples a 4096-point spectrum is read. Candidate pitches at a fifth of a
 * semitone are scored by a harmonic sum (eight harmonics, each 0.8 times the weight of the one below). The bass is
 * the best candidate in MIDI 23..59. The lead is the best candidate in MIDI 55..96 on the spectrum that is left
 * after the bass's first harmonics are taken out, so a sustained bass does not read as a lead an octave above.
 *
 * <p>Frames become notes in {@link #finish}: a note runs while the line is voiced and its pitch stays put, is cut
 * by pitch changes and by the broadband onsets the caller supplies that are re-strikes of the line (its own level
 * rises across them; a drum hit over a held note does not cut it), has its edges trimmed to where its level
 * crosses half of its plateau (the 4096-sample window smears the edges by up to 85 ms), and starts on the
 * nearest onset when there is one within 50 ms. Only the per-frame results are kept, never the audio.
 *
 * <p>Frame {@code i} is centred on sample {@code i * hop}: the ring starts as silence, so the first frame is
 * centred on the start of the track and {@link #finish} flushes as many frames of silence as the window is
 * half long, so the last note is not cut short.
 */
final class PitchTracker {

    static final int FFT_SIZE = 4096;
    private static final int BINS = FFT_SIZE / 2 + 1;

    private static final int BASS_MIN_MIDI = 23;
    private static final int BASS_MAX_MIDI = 59;
    private static final int LEAD_MIN_MIDI = 55;
    private static final int LEAD_MAX_MIDI = 96;
    private static final int CANDIDATES_PER_SEMITONE = 5;
    private static final int HARMONICS = 8;
    private static final double HARMONIC_WEIGHT_DECAY = 0.8;

    /**
     * A candidate counts only when the spectrum at its own fundamental is at least this fraction of the strongest of
     * its eight harmonics. Without it the candidate an octave below a real pitch (which sees every second harmonic
     * as its own) scores almost as high as the pitch.
     */
    private static final double MIN_FUNDAMENTAL_SHARE = 0.25;

    /** A frame is voiced from this confidence (peak salience over the spectral peaks' magnitude sum) upwards. */
    static final double VOICED_CONFIDENCE = 0.35;

    /** Spectral peaks adding up to less than this (a full-scale sine reads 1) are silence, whatever their shape. */
    private static final double MIN_FRAME_ENERGY = 0.01;

    /** How many multiples of the bass pitch are taken out of the lead's spectrum and candidate list. */
    private static final int MASKED_BASS_HARMONICS = 3;
    private static final double MASKED_HARMONIC_SEMITONES = 0.5;
    private static final int MASKED_HARMONIC_BINS = 2;

    private static final double CHROMA_FROM_HZ = 80;
    private static final double CHROMA_TO_HZ = 4000;

    // Note building.
    private static final double PITCH_CHANGE_SEMITONES = 0.7;
    private static final int MIN_NOTE_MS = 60;
    private static final int SNAP_TO_ONSET_MS = 50;
    /** Same-pitch fragments closer than this, with no onset between, are one note (a glitch frame split them). */
    private static final int MERGE_GAP_MS = 80;
    /**
     * Same-pitch fragments that no re-strike separates are also one note across a gap of up to this long when a
     * broadband onset falls in it: a snare's noise buries a held bass for a window's length (about 130 ms), and
     * a note that was really struck again would have been cut by its own rise.
     */
    private static final int MASKED_MERGE_GAP_MS = 200;
    /**
     * A note followed by another within this many ms is stretched to meet it: the level edge only says where the
     * window stopped seeing the note, up to a frame early. Well under the 50 ms gaps a staccato line leaves, so those
     * stay gaps even on the light tier (43 ms hop).
     */
    private static final int JOIN_MAX_GAP_MS = 30;
    /** A note's edge is where its level crosses this fraction of the note's plateau level. */
    private static final double EDGE_LEVEL_SHARE = 0.5;
    private static final double PLATEAU_PERCENTILE = 0.8;
    /**
     * A broadband onset cuts a running note only when the line's own salience rises across it: the largest salience
     * in the onset frame and the two after it is at least this many times the smaller of the two frames before it.
     * The 4096-point window spreads a re-strike over several frames: a bass note plucked again at half its level
     * reads about 1.5 here, while a kick or snare over a held note stays within 1.05 (a lead that happens to sit on
     * a bass harmonic, 1.15).
     */
    private static final double RESTRIKE_RISE = 1.3;
    private static final double SALIENCE_REFERENCE_PERCENTILE = 0.95;

    /**
     * The notes of both lines, and one 12-value chroma frame per pitch frame (pitch class 0 is C, 9 is A) with its
     * centre time in {@code chromaMs}; each frame is scaled so its largest value is 1.
     */
    record Lines(List<Features.Note> bass, List<Features.Note> lead, int[] chromaMs, float[][] chroma) {}

    private final int sampleRate;
    private final int hop;
    private final double hopMs;
    private final Fft fft = new Fft(FFT_SIZE);
    private final float[] window = new float[FFT_SIZE];
    private final float magnitudeScale;
    private final float[] re = new float[FFT_SIZE];
    private final float[] im = new float[FFT_SIZE];
    private final float[] ring = new float[FFT_SIZE];
    private final float[] magnitude = new float[BINS + 1];
    private final float[] residual = new float[BINS + 1];

    // Candidate tables, built once: harmonic h of candidate k reads bins binLow[k*H+h] and binLow+1, mixed by
    // binFraction. Harmonics beyond Nyquist are -1 (and so are all that follow).
    private final int candidates;
    private final int[] binLow;
    private final float[] binFraction;
    private final float[] harmonicWeight = new float[HARMONICS];
    private final int bassCandidates;
    private final int leadFirstCandidate;

    private final int[] chromaClass = new int[BINS];

    private int ringPosition;
    private int sinceHop;
    private int frames;
    private int frameCounter;

    private final Track bass = new Track();
    private final Track lead = new Track();
    private int[] chromaMs = new int[1024];
    private float[][] chroma = new float[1024][];

    // Result of the last search.
    private double foundSalience;
    private double foundEnergy;

    PitchTracker(int sampleRate, AnalysisTier tier) {
        if (sampleRate < 8000) {
            throw new IllegalArgumentException("sample rate too low: " + sampleRate);
        }
        this.sampleRate = sampleRate;
        this.hop = tier.pitchHop();
        this.hopMs = hop * 1000.0 / sampleRate;

        double windowSum = 0;
        for (int k = 0; k < FFT_SIZE; k++) {
            window[k] = (float) (0.5 - 0.5 * Math.cos(2 * Math.PI * k / FFT_SIZE));
            windowSum += window[k];
        }
        magnitudeScale = (float) (2 / windowSum);
        for (int h = 0; h < HARMONICS; h++) {
            harmonicWeight[h] = (float) Math.pow(HARMONIC_WEIGHT_DECAY, h);
        }

        candidates = (LEAD_MAX_MIDI - BASS_MIN_MIDI) * CANDIDATES_PER_SEMITONE + 1;
        bassCandidates = (BASS_MAX_MIDI - BASS_MIN_MIDI) * CANDIDATES_PER_SEMITONE + 1;
        leadFirstCandidate = (LEAD_MIN_MIDI - BASS_MIN_MIDI) * CANDIDATES_PER_SEMITONE;
        binLow = new int[candidates * HARMONICS];
        binFraction = new float[candidates * HARMONICS];
        for (int k = 0; k < candidates; k++) {
            double hz = midiToHz(candidateMidi(k));
            for (int h = 0; h < HARMONICS; h++) {
                double position = hz * (h + 1) * FFT_SIZE / sampleRate;
                int low = (int) Math.floor(position);
                boolean inRange = low + 1 < BINS;
                binLow[k * HARMONICS + h] = inRange ? low : -1;
                binFraction[k * HARMONICS + h] = (float) (position - low);
            }
        }

        for (int bin = 0; bin < BINS; bin++) {
            double hz = (double) bin * sampleRate / FFT_SIZE;
            if (hz < CHROMA_FROM_HZ || hz > CHROMA_TO_HZ) {
                chromaClass[bin] = -1;
                continue;
            }
            long midi = Math.round(69 + 12 * Math.log(hz / 440) / Math.log(2));
            chromaClass[bin] = (int) Math.floorMod(midi, 12L);
        }
    }

    private static double candidateMidi(int k) {
        return BASS_MIN_MIDI + (double) k / CANDIDATES_PER_SEMITONE;
    }

    private static double midiToHz(double midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    /** Consumes the first {@code length} samples of {@code mono}; may be called any number of times. */
    void accept(float[] mono, int length) {
        for (int i = 0; i < length; i++) {
            push(mono[i]);
        }
    }

    private void push(float x) {
        ring[ringPosition] = x;
        ringPosition = (ringPosition + 1) & (FFT_SIZE - 1);
        if (++sinceHop == hop) {
            sinceHop = 0;
            processFrame();
        }
    }

    /** Completes the analysis. Call once, after the last {@link #accept}; {@code onsetMs} are broadband onsets. */
    Lines finish(int[] onsetMs) {
        for (int i = 0; i < FFT_SIZE / 2; i++) {
            push(0);
        }
        int[] onsets = onsetMs.clone();
        Arrays.sort(onsets);
        List<Features.Note> bassNotes = notes(bass, onsets);
        List<Features.Note> leadNotes = notes(lead, onsets);
        return new Lines(
                bassNotes,
                leadNotes,
                Arrays.copyOf(chromaMs, frames),
                Arrays.copyOf(chroma, frames));
    }

    // ---- Per-frame analysis -------------------------------------------------------------------------------

    /** Frame {@code f} ends on sample {@code (f + 1) * hop} counting the silence the ring started with. */
    private void processFrame() {
        long end = (long) (frameCounter + 1) * hop;
        frameCounter++;
        long centre = end - FFT_SIZE / 2;
        if (centre < 0) {
            return;
        }
        for (int k = 0; k < FFT_SIZE; k++) {
            re[k] = ring[(ringPosition + k) & (FFT_SIZE - 1)] * window[k];
            im[k] = 0;
        }
        fft.transform(re, im);
        for (int bin = 0; bin < BINS; bin++) {
            magnitude[bin] = (float) Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]) * magnitudeScale;
        }

        int bassCandidate = search(magnitude, 0, bassCandidates, Double.NaN);
        double bassConfidence = confidence(bassCandidate);
        double bassSalience = foundSalience;
        boolean bassVoiced = bassConfidence >= VOICED_CONFIDENCE;
        bass.add(bassCandidate < 0 ? 0 : candidateMidi(bassCandidate), (float) bassSalience,
                (float) (bassVoiced ? bassConfidence : 0));

        float[] leadSpectrum = magnitude;
        double bassMidi = Double.NaN;
        if (bassVoiced) {
            bassMidi = candidateMidi(bassCandidate);
            System.arraycopy(magnitude, 0, residual, 0, magnitude.length);
            double bassHz = midiToHz(bassMidi);
            for (int m = 1; m <= MASKED_BASS_HARMONICS; m++) {
                int centreBin = (int) Math.round(m * bassHz * FFT_SIZE / sampleRate);
                for (int bin = Math.max(0, centreBin - MASKED_HARMONIC_BINS);
                        bin <= Math.min(BINS - 1, centreBin + MASKED_HARMONIC_BINS); bin++) {
                    residual[bin] = 0;
                }
            }
            leadSpectrum = residual;
        }
        int leadCandidate = search(leadSpectrum, leadFirstCandidate, candidates, bassMidi);
        double leadConfidence = confidence(leadCandidate);
        lead.add(leadCandidate < 0 ? 0 : candidateMidi(leadCandidate), (float) foundSalience,
                (float) (leadConfidence >= VOICED_CONFIDENCE ? leadConfidence : 0));

        addChroma((int) Math.round(centre * 1000.0 / sampleRate));
    }

    /**
     * Best candidate in {@code [from, to)} by harmonic sum on {@code spectrum}, or -1. Leaves its salience and the
     * spectrum's peak energy in {@link #foundSalience} and {@link #foundEnergy}. Candidates within half a semitone
     * of one of the first bass harmonics of {@code bassMidi} (when it is a number) are skipped.
     */
    private int search(float[] spectrum, int from, int to, double bassMidi) {
        double energy = 0;
        for (int bin = 1; bin < BINS - 1; bin++) {
            if (spectrum[bin] > spectrum[bin - 1] && spectrum[bin] >= spectrum[bin + 1]) {
                energy += spectrum[bin];
            }
        }
        foundEnergy = energy;
        foundSalience = 0;
        if (energy < MIN_FRAME_ENERGY) {
            return -1;
        }
        int best = -1;
        double bestSalience = 0;
        for (int k = from; k < to; k++) {
            if (isBassHarmonic(candidateMidi(k), bassMidi)) {
                continue;
            }
            int base = k * HARMONICS;
            double sum = 0;
            double strongest = 0;
            double fundamental = 0;
            for (int h = 0; h < HARMONICS; h++) {
                int low = binLow[base + h];
                if (low < 0) {
                    break;
                }
                float fraction = binFraction[base + h];
                double m = spectrum[low] * (1 - fraction) + spectrum[low + 1] * fraction;
                if (h == 0) {
                    fundamental = m;
                }
                strongest = Math.max(strongest, m);
                sum += harmonicWeight[h] * m;
            }
            if (fundamental >= MIN_FUNDAMENTAL_SHARE * strongest && sum > bestSalience) {
                bestSalience = sum;
                best = k;
            }
        }
        foundSalience = bestSalience;
        return best;
    }

    /** {@code 12 * log2(m)}: the semitones from a pitch up to its m-th harmonic, indexed by m. */
    private static final double[] HARMONIC_SEMITONES = new double[MASKED_BASS_HARMONICS + 1];

    static {
        for (int m = 1; m <= MASKED_BASS_HARMONICS; m++) {
            HARMONIC_SEMITONES[m] = 12 * Math.log(m) / Math.log(2);
        }
    }

    private static boolean isBassHarmonic(double midi, double bassMidi) {
        if (Double.isNaN(bassMidi)) {
            return false;
        }
        for (int m = 1; m <= MASKED_BASS_HARMONICS; m++) {
            double harmonicMidi = bassMidi + HARMONIC_SEMITONES[m];
            if (Math.abs(midi - harmonicMidi) <= MASKED_HARMONIC_SEMITONES) {
                return true;
            }
        }
        return false;
    }

    private double confidence(int candidate) {
        if (candidate < 0 || foundEnergy <= 0) {
            return 0;
        }
        return Math.min(1.0, foundSalience / foundEnergy);
    }

    private void addChroma(int ms) {
        if (frames == chromaMs.length) {
            chromaMs = Arrays.copyOf(chromaMs, frames * 2);
            chroma = Arrays.copyOf(chroma, frames * 2);
        }
        float[] frame = new float[12];
        for (int bin = 1; bin < BINS; bin++) {
            int pitchClass = chromaClass[bin];
            if (pitchClass >= 0) {
                frame[pitchClass] += magnitude[bin];
            }
        }
        float peak = 0;
        for (float v : frame) {
            peak = Math.max(peak, v);
        }
        if (peak > 0) {
            for (int i = 0; i < 12; i++) {
                frame[i] /= peak;
            }
        }
        chromaMs[frames] = ms;
        chroma[frames] = frame;
        frames++;
    }

    // ---- Notes ---------------------------------------------------------------------------------------------

    /** The per-frame results of one line. */
    private static final class Track {
        double[] pitch = new double[1024];
        float[] salience = new float[1024];
        float[] confidence = new float[1024];
        int count;

        void add(double midi, float level, float voiced) {
            if (count == pitch.length) {
                pitch = Arrays.copyOf(pitch, count * 2);
                salience = Arrays.copyOf(salience, count * 2);
                confidence = Arrays.copyOf(confidence, count * 2);
            }
            pitch[count] = midi;
            salience[count] = level;
            confidence[count] = voiced;
            count++;
        }

        boolean voiced(int i) {
            return confidence[i] > 0;
        }
    }

    /** A note while it is being cleaned up: its frames {@code first..last} and its edges in ms. */
    private static final class Draft {
        int first;
        int last;
        double startMs;
        double endMs;

        Draft(int first, int last) {
            this.first = first;
            this.last = last;
        }
    }

    /** Time of the centre of pitch frame {@code i}. */
    private double frameMs(int i) {
        return chromaMs[i];
    }

    private List<Features.Note> notes(Track track, int[] onsets) {
        boolean[] struck = restrikes(track, onsets);
        List<Draft> drafts = new ArrayList<>();
        for (int[] range : segments(track, struck)) {
            Draft draft = new Draft(range[0], range[1]);
            trim(track, draft);
            if (draft.endMs - draft.startMs >= MIN_NOTE_MS) {
                drafts.add(draft);
            }
        }
        drafts = merge(drafts, struck, onsets, track);

        List<Draft> snapped = new ArrayList<>();
        for (Draft draft : drafts) {
            draft.startMs = snap(draft.startMs, onsets);
            if (draft.endMs - draft.startMs >= MIN_NOTE_MS) {
                snapped.add(draft);
            }
        }
        // A note that runs straight into the next one has no gap to speak of: the level edge only says where the
        // window stopped seeing it, which is up to a frame early.
        for (int i = 0; i + 1 < snapped.size(); i++) {
            double gap = snapped.get(i + 1).startMs - snapped.get(i).endMs;
            if (gap > 0 && gap <= JOIN_MAX_GAP_MS) {
                snapped.get(i).endMs = snapped.get(i + 1).startMs;
            }
        }

        double reference = salienceReference(track);
        List<Features.Note> notes = new ArrayList<>();
        for (Draft draft : snapped) {
            double[] pitches = new double[draft.last - draft.first + 1];
            int voiced = 0;
            double salience = 0;
            double confidence = 0;
            for (int i = draft.first; i <= draft.last; i++) {
                if (track.voiced(i)) {
                    pitches[voiced++] = track.pitch[i];
                    salience += track.salience[i];
                    confidence += track.confidence[i];
                }
            }
            Arrays.sort(pitches, 0, voiced);
            double pitch = voiced % 2 == 1
                    ? pitches[voiced / 2]
                    : (pitches[voiced / 2 - 1] + pitches[voiced / 2]) / 2;
            double s = reference > 0 ? Math.min(1.0, salience / voiced / reference) : 0;
            notes.add(new Features.Note(
                    (int) Math.round(draft.startMs),
                    (int) Math.round(draft.endMs - draft.startMs),
                    Highlight.round3(pitch),
                    Highlight.round3(s),
                    Highlight.round3(confidence / voiced)));
        }
        return notes;
    }

    /**
     * Marks the frames in which a broadband onset re-strikes this line: the onset falls inside the frame and the
     * line's salience rises by {@link #RESTRIKE_RISE} across it.
     */
    private boolean[] restrikes(Track track, int[] onsets) {
        boolean[] struck = new boolean[track.count];
        if (track.count < 2) {
            return struck;
        }
        double origin = frameMs(0) - hopMs / 2;
        for (int onset : onsets) {
            int f = (int) Math.floor((onset - origin) / hopMs);
            if (f < 1 || f >= track.count) {
                continue;
            }
            float before = Math.min(track.salience[f - 1], f >= 2 ? track.salience[f - 2] : Float.MAX_VALUE);
            float after = 0;
            for (int k = f; k <= Math.min(f + 2, track.count - 1); k++) {
                after = Math.max(after, track.salience[k]);
            }
            if (after >= RESTRIKE_RISE * before) {
                struck[f] = true;
            }
        }
        return struck;
    }

    /** Runs of voiced frames, cut where the pitch moves or the line is re-struck. */
    private List<int[]> segments(Track track, boolean[] struck) {
        List<int[]> ranges = new ArrayList<>();
        int start = -1;
        double sum = 0;
        int n = 0;
        for (int i = 0; i < track.count; i++) {
            if (!track.voiced(i)) {
                if (start >= 0) {
                    ranges.add(new int[] {start, i - 1});
                    start = -1;
                }
                continue;
            }
            if (start >= 0) {
                boolean moved = Math.abs(track.pitch[i] - sum / n) > PITCH_CHANGE_SEMITONES;
                if (moved || struck[i]) {
                    ranges.add(new int[] {start, i - 1});
                    start = -1;
                }
            }
            if (start < 0) {
                start = i;
                sum = 0;
                n = 0;
            }
            sum += track.pitch[i];
            n++;
        }
        if (start >= 0) {
            ranges.add(new int[] {start, track.count - 1});
        }
        return ranges;
    }

    /** True when an onset lies in {@code [from, to)}. */
    private static boolean hasOnset(int[] sorted, double from, double to) {
        int index = lowerBound(sorted, from);
        return index < sorted.length && sorted[index] < to;
    }

    /** Index of the first element that is at least {@code value}. */
    private static int lowerBound(int[] sorted, double value) {
        int lo = 0;
        int hi = sorted.length;
        while (lo < hi) {
            int mid = (lo + hi) >>> 1;
            if (sorted[mid] < value) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    /**
     * Sets the edges of the draft where the line's level crosses half its plateau, so the 85 ms the window leans out
     * over silence is not counted as note. Frames beyond the crossing are cut from the draft.
     */
    private void trim(Track track, Draft draft) {
        int count = draft.last - draft.first + 1;
        float[] levels = Arrays.copyOfRange(track.salience, draft.first, draft.last + 1);
        float plateau = OnsetPicker.percentile(levels, count, PLATEAU_PERCENTILE);
        float edge = (float) (EDGE_LEVEL_SHARE * plateau);

        int first = draft.first;
        while (first < draft.last && track.salience[first] < edge) {
            first++;
        }
        int last = draft.last;
        while (last > first && track.salience[last] < edge) {
            last--;
        }
        draft.startMs = first > draft.first
                ? crossing(frameMs(first - 1), track.salience[first - 1], frameMs(first), track.salience[first], edge)
                : frameMs(first) - hopMs / 2;
        draft.endMs = last < draft.last
                ? crossing(frameMs(last), track.salience[last], frameMs(last + 1), track.salience[last + 1], edge)
                : frameMs(last) + hopMs / 2;
        draft.first = first;
        draft.last = last;
    }

    private static double crossing(double t0, float level0, double t1, float level1, float edge) {
        if (level1 == level0) {
            return t1;
        }
        double fraction = (edge - level0) / (level1 - level0);
        return t0 + (t1 - t0) * Math.max(0, Math.min(1, fraction));
    }

    /** Joins neighbours of the same pitch that nothing struck between: a glitch frame had split them. */
    private List<Draft> merge(List<Draft> drafts, boolean[] struck, int[] onsets, Track track) {
        List<Draft> merged = new ArrayList<>();
        for (Draft draft : drafts) {
            Draft previous = merged.isEmpty() ? null : merged.get(merged.size() - 1);
            if (previous != null
                    && Math.abs(medianPitch(track, previous) - medianPitch(track, draft)) <= PITCH_CHANGE_SEMITONES
                    && !anyStruck(struck, previous.last + 1, draft.first)
                    && (draft.startMs - previous.endMs <= MERGE_GAP_MS
                            || draft.startMs - previous.endMs <= MASKED_MERGE_GAP_MS
                                    && hasOnset(onsets, previous.endMs - hopMs, draft.startMs + hopMs))) {
                previous.last = draft.last;
                previous.endMs = draft.endMs;
            } else {
                merged.add(draft);
            }
        }
        return merged;
    }

    /** True when a re-strike was marked in frames {@code from..to}. */
    private static boolean anyStruck(boolean[] struck, int from, int to) {
        for (int i = Math.max(0, from); i <= Math.min(to, struck.length - 1); i++) {
            if (struck[i]) {
                return true;
            }
        }
        return false;
    }

    private static double medianPitch(Track track, Draft draft) {
        double[] pitches = new double[draft.last - draft.first + 1];
        int voiced = 0;
        for (int i = draft.first; i <= draft.last; i++) {
            if (track.voiced(i)) {
                pitches[voiced++] = track.pitch[i];
            }
        }
        Arrays.sort(pitches, 0, voiced);
        return voiced == 0 ? 0 : pitches[voiced / 2];
    }

    /** The onset nearest to {@code ms} when it is within {@link #SNAP_TO_ONSET_MS}, else {@code ms}. */
    private static double snap(double ms, int[] onsets) {
        int index = lowerBound(onsets, ms);
        double best = ms;
        double bestDistance = SNAP_TO_ONSET_MS + 1;
        for (int i = Math.max(0, index - 1); i <= Math.min(onsets.length - 1, index); i++) {
            double distance = Math.abs(onsets[i] - ms);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = onsets[i];
            }
        }
        return bestDistance <= SNAP_TO_ONSET_MS ? best : ms;
    }

    /** The 95th percentile of the salience of the line's voiced frames, which maps to a note strength of 1. */
    private static float salienceReference(Track track) {
        float[] voiced = new float[track.count];
        int n = 0;
        for (int i = 0; i < track.count; i++) {
            if (track.voiced(i)) {
                voiced[n++] = track.salience[i];
            }
        }
        return OnsetPicker.percentile(voiced, n, SALIENCE_REFERENCE_PERCENTILE);
    }
}
