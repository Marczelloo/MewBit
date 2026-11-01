package dev.mewbit.mewbeat.dsp;

import java.util.List;

/**
 * The analysis result, serialised as features JSON v2. Field names are the JSON
 * names; every time value is an integer number of milliseconds. Version 2 keeps
 * every v1 field and adds {@code analysisTier}, {@code drums}, {@code bass},
 * {@code lead} and {@code phrases} after them.
 */
public record Features(
        int featuresVersion,
        int durationMs,
        double hopMs,
        List<Band> bands,
        Tempo tempo,
        Energy energy,
        List<Section> sections,
        Integer highlightMs,
        String analysisTier,
        List<Drum> drums,
        List<Note> bass,
        List<Note> lead,
        Phrases phrases) {

    public static final int VERSION = 2;

    /** Onsets of one frequency band: low, lowmid, highmid or high. */
    public record Band(String name, List<Onset> onsets) {}

    /** An onset at {@code t} ms with strength {@code s} normalised to 0..1 for its band. */
    public record Onset(int t, double s) {}

    /** {@code bpm} and {@code confidence} are 0 and the lists empty when no tempo was found. */
    public record Tempo(double bpm, double confidence, List<Integer> beats, List<Integer> downbeats) {}

    /** Loudness per {@code hopMs} (500 ms) window, normalised to 0..1. */
    public record Energy(int hopMs, List<Double> values) {}

    public record Section(int startMs, int endMs, double energy) {}

    /** A drum hit at {@code t} ms, strength {@code s} 0..1; {@code kind} is kick, snare, hat or perc. */
    public record Drum(int t, double s, String kind) {}

    /**
     * A pitched note of the bass or lead line: starts at {@code t} ms, lasts {@code len} ms, and sits at the MIDI
     * float {@code pitch} (69 is A4 = 440 Hz). {@code s} is its salience 0..1 relative to the line, {@code conf}
     * the mean voicing confidence 0..1.
     */
    public record Note(int t, int len, double pitch, double s, double conf) {}

    /** Phrases of {@code beatsPerPhrase} beats that tile the track from 0 to its end; empty when no tempo was found. */
    public record Phrases(int beatsPerPhrase, List<Phrase> list) {}

    /**
     * One phrase. {@code repeatOf} is the index of the earliest earlier phrase it repeats ({@code null} for none): the
     * content at time t of this phrase matches the content at {@code t - lagMs}, with the mean similarity
     * {@code similarity} 0..1 (the best seen when it repeats nothing). {@code activity} is how busy each layer is in
     * the phrase and {@code confidence} how sure the analysis is of it, both 0..1.
     */
    public record Phrase(
            int startMs,
            int endMs,
            Integer repeatOf,
            double similarity,
            int lagMs,
            Layers activity,
            Layers confidence) {}

    /** A value per layer. */
    public record Layers(double drums, double bass, double lead) {

        public static final Layers NONE = new Layers(0, 0, 0);
    }
}
