package dev.mewbit.mewbeat.dsp;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Streaming feature extraction for the mewbeat rhythm game: per-band onsets,
 * tempo and beats, loudness, sections and a highlight moment.
 *
 * <p>Feed mono PCM (-1..1) through {@link #accept(float[], int)} in chunks of
 * any size, then call {@link #finish()}. The audio itself is never retained:
 * only the per-hop band flux (4 floats per 10.7 ms) and the 500 ms energy
 * accumulators are kept, so memory is a few hundred KB for a long track.
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

    public FeatureExtractor(int sampleRate) {
        if (sampleRate < 8000) {
            throw new IllegalArgumentException("sample rate too low: " + sampleRate);
        }
        this.sampleRate = sampleRate;
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
        for (int b = 0; b < BAND_NAMES.length; b++) {
            float rise = 0;
            for (int bin = bandStart[b]; bin <= bandEnd[b]; bin++) {
                float magnitude = (float) Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]) * magnitudeScale;
                float compressed = (float) Math.log1p(LOG_GAIN * magnitude);
                float delta = compressed - previousLog[bin];
                if (delta > 0) {
                    rise += delta;
                }
                previousLog[bin] = compressed;
            }
            flux[b][hops] = rise / (bandEnd[b] - bandStart[b] + 1);
        }
        hops++;
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

        TempoEstimator.Result tempo = TempoEstimator.estimate(
                combinedFlux(), flux[LOW], hops, HOP / (double) sampleRate);
        List<Integer> beats = new ArrayList<>();
        for (int hop : tempo.beatHops()) {
            beats.add(hopTimeMs(hop));
        }
        List<Integer> downbeats = new ArrayList<>();
        for (int i = tempo.downbeatPhase(); i < beats.size(); i += 4) {
            downbeats.add(beats.get(i));
        }

        double[] energy = normalisedEnergy();
        List<Double> energyValues = new ArrayList<>(energy.length);
        for (double e : energy) {
            energyValues.add(e);
        }
        List<Features.Section> sections = Highlight.sections(
                energy, durationMs, downbeats, tempo.confidence() >= SNAP_TO_DOWNBEAT_CONFIDENCE);
        Integer highlight = Highlight.find(energy, durationMs, sections);

        return new Features(
                Features.VERSION,
                durationMs,
                Highlight.round3(hopMs),
                bands,
                new Features.Tempo(
                        Math.round(tempo.bpm() * 100) / 100.0, Highlight.round3(tempo.confidence()), beats, downbeats),
                new Features.Energy(Highlight.ENERGY_HOP_MS, energyValues),
                sections,
                highlight);
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
