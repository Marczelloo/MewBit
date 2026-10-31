package dev.mewbit.mewbeat.dsp;

import java.util.List;

/**
 * The analysis result, serialised as features JSON v1. Field names are the JSON
 * names; every time value is an integer number of milliseconds.
 */
public record Features(
        int featuresVersion,
        int durationMs,
        double hopMs,
        List<Band> bands,
        Tempo tempo,
        Energy energy,
        List<Section> sections,
        Integer highlightMs) {

    public static final int VERSION = 1;

    /** Onsets of one frequency band: low, lowmid, highmid or high. */
    public record Band(String name, List<Onset> onsets) {}

    /** An onset at {@code t} ms with strength {@code s} normalised to 0..1 for its band. */
    public record Onset(int t, double s) {}

    /** {@code bpm} and {@code confidence} are 0 and the lists empty when no tempo was found. */
    public record Tempo(double bpm, double confidence, List<Integer> beats, List<Integer> downbeats) {}

    /** Loudness per {@code hopMs} (500 ms) window, normalised to 0..1. */
    public record Energy(int hopMs, List<Double> values) {}

    public record Section(int startMs, int endMs, double energy) {}
}
