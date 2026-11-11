package dev.mewbit.mewbeat.dsp;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Streaming feature extraction for the mewbeat rhythm game: per-band onsets,
 * tempo and beats, loudness, sections and a highlight moment, plus drum hits
 * (HPSS), bass and lead notes (pitch tracking) and a map of repeating phrases.
 *
 * <p>Feed mono PCM (-1..1) through {@link #accept(float[], int)} in chunks of
 * any size, then call {@link #finish()}. The audio itself is never retained:
 * only the per-hop band flux (4 floats per 10.7 ms), the drum flux, the pitch
 * tracks and the 500 ms energy accumulators are kept, so memory stays a few MB
 * for a long track.
 */
public final class FeatureExtractor {

    static final int FFT_SIZE = 1024;
    static final int HOP = 256;

    /**
     * Frame {@code i} covers the 1024 samples ending at {@code (i + 1) * HOP}.
     * The flux of an onset peaks as it enters the tapered end of the window, so
     * the frame's end minus this many samples estimates when it happened.
     * Calibrated on synthetic bursts (30..180 BPM kicks and hats): the mean
     * error is under 1 ms and the worst case about one half-hop (5 ms).
     */
    private static final int FRAME_LATENCY_SAMPLES = HOP;

    private static final String[] BAND_NAMES = {"low", "lowmid", "highmid", "high"};
    private static final double[] BAND_EDGES_HZ = {20, 150, 800, 4000, 12000};
    private static final int LOW = 0;

    /** Magnitudes are log-compressed as log(1 + LOG_GAIN * magnitude). */
    private static final double LOG_GAIN = 1000;

    private static final double ONSET_WINDOW_SECONDS = 0.5;
    private static final double MIN_ONSET_GAP_SECONDS = 0.05;
    private static final double SNAP_TO_DOWNBEAT_CONFIDENCE = 0.5;
    private static final int BEAT_LOW_WINDOW_MS = 25;
    // The generator's strong onset and silence limits (busyness.js), which its density factor reads the same way.
    private static final double STRONG_ONSET = 0.5;
    private static final double AUDIBLE_ENERGY = 0.08;
    /** Loudness below this RMS (-60 dBFS) counts as silence when normalising energy. */
    private static final double MIN_REFERENCE_RMS = 0.001;

    private final int sampleRate;
    private final Fft fft = new Fft(FFT_SIZE);
    private final float[] window = new float[FFT_SIZE];
    private final float[] re = new float[FFT_SIZE];
    private final float[] im = new float[FFT_SIZE];
    private final float[] ring = new float[FFT_SIZE];
    private final float[] previousLog = new float[FFT_SIZE / 2 + 1];
    private final float magnitudeScale;
    private final int[] bandStart = new int[BAND_NAMES.length];
    private final int[] bandEnd = new int[BAND_NAMES.length];

    private int ringPosition;
    private int sinceHop;
    private long totalSamples;

    private float[][] flux = new float[BAND_NAMES.length][1024];
    private int hops;

    private final int energyBucketSamples;
    private double energySumSquares;
    private int energyCount;
    private double[] energyRms = new double[128];
    private int energyBuckets;

    private final AnalysisTier tier;
    private final float[] magnitude = new float[FFT_SIZE / 2 + 1];
    private final Hpss hpss;
    private final DrumDetector drumDetector;
    private final PitchTracker pitchTracker;
    /** Index of the next frame the HPSS hands over (it lags the newest frame by half its kernel). */
    private int drumFrame;

    private long hpssNanos;
    private long pitchNanos;
    private long repetitionNanos;

    public FeatureExtractor(int sampleRate) {
        this(sampleRate, AnalysisTier.FULL);
    }

    public FeatureExtractor(int sampleRate, AnalysisTier tier) {
        if (sampleRate < 8000) {
            throw new IllegalArgumentException("sample rate too low: " + sampleRate);
        }
        this.sampleRate = sampleRate;
        this.tier = tier;
        this.hpss = new Hpss(FFT_SIZE / 2 + 1, tier.hpssKernel());
        this.drumDetector = new DrumDetector(sampleRate, FFT_SIZE, HOP * 1000.0 / sampleRate);
        this.pitchTracker = new PitchTracker(sampleRate, tier);
        double windowSum = 0;
        for (int k = 0; k < FFT_SIZE; k++) {
            window[k] = (float) (0.5 - 0.5 * Math.cos(2 * Math.PI * k / FFT_SIZE));
            windowSum += window[k];
        }
        // A full-scale sine reads as magnitude 1.
        magnitudeScale = (float) (2 / windowSum);

        int nyquistBin = FFT_SIZE / 2;
        for (int b = 0; b < BAND_NAMES.length; b++) {
            bandStart[b] = Math.max(1, (int) Math.ceil(BAND_EDGES_HZ[b] * FFT_SIZE / sampleRate));
            int next = (int) Math.ceil(BAND_EDGES_HZ[b + 1] * FFT_SIZE / sampleRate) - 1;
            if (b == BAND_NAMES.length - 1) {
                next = (int) Math.floor(BAND_EDGES_HZ[b + 1] * FFT_SIZE / sampleRate);
            }
            bandEnd[b] = Math.min(nyquistBin, next);
        }
        energyBucketSamples = sampleRate * Highlight.ENERGY_HOP_MS / 1000;
    }

    /** Consumes the first {@code length} samples of {@code mono}; may be called any number of times. */
    public void accept(float[] mono, int length) {
        long pitchStart = System.nanoTime();
        pitchTracker.accept(mono, length);
        pitchNanos += System.nanoTime() - pitchStart;
        for (int i = 0; i < length; i++) {
            float x = mono[i];
            ring[ringPosition] = x;
            ringPosition = (ringPosition + 1) & (FFT_SIZE - 1);
            totalSamples++;

            energySumSquares += (double) x * x;
            if (++energyCount == energyBucketSamples) {
                closeEnergyBucket();
            }
            if (++sinceHop == HOP) {
                sinceHop = 0;
                processFrame();
            }
        }
    }

    private void closeEnergyBucket() {
        if (energyBuckets == energyRms.length) {
            energyRms = Arrays.copyOf(energyRms, energyBuckets * 2);
        }
        energyRms[energyBuckets++] = Math.sqrt(energySumSquares / energyCount);
        energySumSquares = 0;
        energyCount = 0;
    }

    private void processFrame() {
        // The oldest sample sits at ringPosition.
        for (int k = 0; k < FFT_SIZE; k++) {
            re[k] = ring[(ringPosition + k) & (FFT_SIZE - 1)] * window[k];
            im[k] = 0;
        }
        fft.transform(re, im);

        if (hops == flux[0].length) {
            for (int b = 0; b < flux.length; b++) {
                flux[b] = Arrays.copyOf(flux[b], hops * 2);
            }
        }
        for (int bin = 0; bin < magnitude.length; bin++) {
            magnitude[bin] = (float) Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]) * magnitudeScale;
        }
        for (int b = 0; b < BAND_NAMES.length; b++) {
            float rise = 0;
            for (int bin = bandStart[b]; bin <= bandEnd[b]; bin++) {
                float compressed = (float) Math.log1p(LOG_GAIN * magnitude[bin]);
                float delta = compressed - previousLog[bin];
                if (delta > 0) {
                    rise += delta;
                }
                previousLog[bin] = compressed;
            }
            flux[b][hops] = rise / (bandEnd[b] - bandStart[b] + 1);
        }
        hops++;

        long hpssStart = System.nanoTime();
        float[] percussive = hpss.pushPercussive(magnitude);
        if (percussive != null) {
            drumDetector.accept(percussive, drumFrame++);
        }
        hpssNanos += System.nanoTime() - hpssStart;
    }

    /** Completes the analysis. Call once, after the last {@link #accept}. */
    public Features finish() {
        int durationMs = (int) (totalSamples * 1000 / sampleRate);
        double hopMs = HOP * 1000.0 / sampleRate;

        List<Features.Band> bands = new ArrayList<>();
        int halfWindow = (int) Math.round(ONSET_WINDOW_SECONDS * 1000 / hopMs);
        int minGap = (int) Math.ceil(MIN_ONSET_GAP_SECONDS * 1000 / hopMs);
        for (int b = 0; b < BAND_NAMES.length; b++) {
            OnsetPicker.Picked picked = OnsetPicker.pick(flux[b], hops, halfWindow, minGap);
            List<Features.Onset> onsets = new ArrayList<>(picked.hops().length);
            for (int k = 0; k < picked.hops().length; k++) {
                double strength = Math.min(1.0, picked.flux()[k] / picked.reference());
                onsets.add(new Features.Onset(hopTimeMs(picked.hops()[k]), Highlight.round3(strength)));
            }
            bands.add(new Features.Band(BAND_NAMES[b], onsets));
        }

        double[] energy = normalisedEnergy();
        float[] combined = combinedFlux();
        TempoEstimator.Result tempo = TempoEstimator.estimate(
                combined, hops, HOP / (double) sampleRate, strongOnsetsPerSecond(bands, energy));
        List<Integer> beats = new ArrayList<>();
        for (int hop : tempo.beatHops()) {
            beats.add(hopTimeMs(hop));
        }

        long hpssStart = System.nanoTime();
        hpss.flushPercussive(percussive -> drumDetector.accept(percussive, drumFrame++));
        List<Features.Drum> drums = drumDetector.finish();
        hpssNanos += System.nanoTime() - hpssStart;

        long pitchStart = System.nanoTime();
        PitchTracker.Lines lines = pitchTracker.finish(onsetTimes(bands));
        pitchNanos += System.nanoTime() - pitchStart;

        int[] beatMs = beats.stream().mapToInt(Integer::intValue).toArray();
        int beatLength = beatLength(beatMs);
        float[][] beatChroma = beatChroma(beatMs, beatLength, lines, durationMs);
        List<Integer> downbeats = new ArrayList<>();
        for (int i : Downbeats.pick(beatLow(beatMs), beatChroma)) {
            downbeats.add(beats.get(i));
        }

        List<Double> energyValues = new ArrayList<>(energy.length);
        for (double e : energy) {
            energyValues.add(e);
        }
        List<Features.Section> sections = Highlight.sections(
                energy, durationMs, downbeats, tempo.confidence() >= SNAP_TO_DOWNBEAT_CONFIDENCE);
        Integer highlight = Highlight.find(energy, durationMs, sections);

        long repetitionStart = System.nanoTime();
        List<Features.Phrase> phrases =
                phrases(beatMs, beatLength, beatChroma, downbeats, tempo.confidence(), lines, durationMs, drums, combined);
        repetitionNanos += System.nanoTime() - repetitionStart;

        return new Features(
                Features.VERSION,
                durationMs,
                Highlight.round3(hopMs),
                bands,
                new Features.Tempo(
                        Math.round(tempo.bpm() * 100) / 100.0, Highlight.round3(tempo.confidence()), beats, downbeats),
                new Features.Energy(Highlight.ENERGY_HOP_MS, energyValues),
                sections,
                highlight,
                tier.wireName(),
                drums,
                lines.bass(),
                lines.lead(),
                new Features.Phrases(Repetition.BEATS_PER_PHRASE, phrases));
    }

    private static double strongOnsetsPerSecond(List<Features.Band> bands, double[] energy) {
        int audibleHops = 0;
        for (double e : energy) {
            if (e >= AUDIBLE_ENERGY) {
                audibleHops++;
            }
        }
        if (audibleHops == 0) {
            return 0;
        }
        int strong = 0;
        for (Features.Band band : bands) {
            for (Features.Onset onset : band.onsets()) {
                if (onset.s() >= STRONG_ONSET) {
                    strong++;
                }
            }
        }
        return strong / (audibleHops * Highlight.ENERGY_HOP_MS / 1000.0);
    }

    /** Milliseconds spent in {@code {HPSS and drums, pitch tracking, repetition and layer activity}} so far. */
    long[] stageMillis() {
        return new long[] {hpssNanos / 1_000_000, pitchNanos / 1_000_000, repetitionNanos / 1_000_000};
    }

    /** Every band's onset times, ascending and without repeats. */
    private static int[] onsetTimes(List<Features.Band> bands) {
        return bands.stream()
                .flatMap(band -> band.onsets().stream())
                .mapToInt(Features.Onset::t)
                .distinct()
                .sorted()
                .toArray();
    }

    /** The median beat interval; 0 with fewer than two beats. */
    private static int beatLength(int[] beatMs) {
        if (beatMs.length < 2) {
            return 0;
        }
        int[] intervals = new int[beatMs.length - 1];
        for (int i = 0; i < intervals.length; i++) {
            intervals[i] = beatMs[i + 1] - beatMs[i];
        }
        Arrays.sort(intervals);
        return intervals[intervals.length / 2];
    }

    /** The strongest low-band flux around each beat. */
    private float[] beatLow(int[] beatMs) {
        float[] low = new float[beatMs.length];
        int hop = 0;
        for (int i = 0; i < beatMs.length; i++) {
            while (hop < hops && hopTimeMs(hop) < beatMs[i] - BEAT_LOW_WINDOW_MS) {
                hop++;
            }
            for (int h = hop; h < hops && hopTimeMs(h) <= beatMs[i] + BEAT_LOW_WINDOW_MS; h++) {
                low[i] = Math.max(low[i], flux[LOW][h]);
            }
        }
        return low;
    }

    /** The L2-normalised chroma heard during each beat, all zero where there is none. */
    private static float[][] beatChroma(int[] beatMs, int beatLength, PitchTracker.Lines lines, int durationMs) {
        int n = beatMs.length;
        float[][] beatChroma = new float[n][];
        int chromaFrame = 0;
        for (int i = 0; i < n; i++) {
            int from = beatMs[i];
            int to = i + 1 < n ? beatMs[i + 1] : Math.min(durationMs, from + beatLength);
            float[] chroma = new float[12];
            int frames = 0;
            while (chromaFrame < lines.chromaMs().length && lines.chromaMs()[chromaFrame] < to) {
                if (lines.chromaMs()[chromaFrame] >= from) {
                    for (int pc = 0; pc < 12; pc++) {
                        chroma[pc] += lines.chroma()[chromaFrame][pc];
                    }
                    frames++;
                }
                chromaFrame++;
            }
            beatChroma[i] = frames == 0 ? chroma : l2Normalised(chroma);
        }
        return beatChroma;
    }

    private List<Features.Phrase> phrases(
            int[] beatMs,
            int beatLength,
            float[][] beatChroma,
            List<Integer> downbeats,
            double tempoConfidence,
            PitchTracker.Lines lines,
            int durationMs,
            List<Features.Drum> drums,
            float[] combined) {
        int n = beatMs.length;
        if (n < 2) {
            return List.of();
        }
        float[][] beatRhythm = new float[n][];
        int fluxHop = 0;
        for (int i = 0; i < n; i++) {
            int from = beatMs[i];
            int to = i + 1 < n ? beatMs[i + 1] : Math.min(durationMs, from + beatLength);
            float[] rhythm = new float[4];
            while (fluxHop < hops && hopTimeMs(fluxHop) < to) {
                int t = hopTimeMs(fluxHop);
                if (t >= from) {
                    int slot = Math.min(3, (int) ((long) (t - from) * 4 / Math.max(1, to - from)));
                    rhythm[slot] += combined[fluxHop];
                }
                fluxHop++;
            }
            beatRhythm[i] = rhythm;
        }

        List<Features.Phrase> phrases = Repetition.phrases(
                beatMs,
                downbeats.stream().mapToInt(Integer::intValue).toArray(),
                tempoConfidence,
                beatChroma,
                beatRhythm,
                durationMs);
        return LayerActivity.fill(phrases, drums, lines.bass(), lines.lead(), beatLength);
    }

    private static float[] l2Normalised(float[] v) {
        double sum = 0;
        for (float x : v) {
            sum += (double) x * x;
        }
        if (sum == 0) {
            return v;
        }
        float scale = (float) (1 / Math.sqrt(sum));
        for (int i = 0; i < v.length; i++) {
            v[i] *= scale;
        }
        return v;
    }

    private int hopTimeMs(int hop) {
        long samples = (long) (hop + 1) * HOP - FRAME_LATENCY_SAMPLES;
        return (int) Math.round(samples * 1000.0 / sampleRate);
    }

    /** Sum of the bands' flux, each scaled by its own 99th percentile so no band dominates; silent bands are skipped. */
    private float[] combinedFlux() {
        float[] combined = new float[hops];
        for (int b = 0; b < BAND_NAMES.length; b++) {
            float reference = OnsetPicker.percentile(flux[b], hops, 0.99);
            if (reference < OnsetPicker.ABSOLUTE_FLOOR) {
                continue;
            }
            for (int i = 0; i < hops; i++) {
                combined[i] += flux[b][i] / reference;
            }
        }
        return combined;
    }

    /** RMS per 500 ms (a trailing partial window included), scaled by the 95th percentile and clamped to 0..1. */
    private double[] normalisedEnergy() {
        int count = energyBuckets + (energyCount > 0 ? 1 : 0);
        double[] values = Arrays.copyOf(energyRms, count);
        if (energyCount > 0) {
            values[count - 1] = Math.sqrt(energySumSquares / energyCount);
        }
        double[] sorted = values.clone();
        Arrays.sort(sorted);
        double reference = count == 0 ? 0 : sorted[Math.max(0, (int) Math.ceil(0.95 * count) - 1)];
        reference = Math.max(reference, MIN_REFERENCE_RMS);
        for (int i = 0; i < count; i++) {
            values[i] = Highlight.round3(Math.min(1.0, values[i] / reference));
        }
        return values;
    }
}
