package dev.mewbit.mewbeat.dsp;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class LayerActivityTest {

    private static final double BEAT_MS = 500;

    private static Features.Phrase phrase(int startMs, int endMs) {
        return new Features.Phrase(startMs, endMs, null, 0, 0, Features.Layers.NONE, Features.Layers.NONE);
    }

    @Test
    void fillsTheLayersOfEachPhrase() {
        // Phrase 0 is 8 s (16 beats): a kick on every beat at strength 0.8 and a bass note over its first half.
        List<Features.Drum> drums = new ArrayList<>();
        for (int beat = 0; beat < 16; beat++) {
            drums.add(new Features.Drum(beat * 500, 0.8, "kick"));
        }
        List<Features.Note> bass = List.of(new Features.Note(0, 4000, 36, 0.7, 0.6));

        List<Features.Phrase> filled =
                LayerActivity.fill(List.of(phrase(0, 8000), phrase(8000, 16000)), drums, bass, List.of(), BEAT_MS);

        // 1 event per beat is half of the 2 per beat that count as full, times the mean strength 0.8.
        assertEquals(0.4, filled.get(0).activity().drums(), 1e-9);
        assertEquals(0.8, filled.get(0).confidence().drums(), 1e-9);
        assertEquals(0.5, filled.get(0).activity().bass(), 1e-9);
        assertEquals(0.6, filled.get(0).confidence().bass(), 1e-9);
        assertEquals(0.0, filled.get(0).activity().lead(), 1e-9);
        assertEquals(0.0, filled.get(0).confidence().lead(), 1e-9);
        assertEquals(Features.Layers.NONE, filled.get(1).activity());
        assertEquals(Features.Layers.NONE, filled.get(1).confidence());
    }

    @Test
    void hatsCountAsActivityButNotAsConfidence() {
        List<Features.Drum> drums = List.of(new Features.Drum(100, 0.5, "hat"), new Features.Drum(600, 0.5, "hat"));

        List<Features.Phrase> filled =
                LayerActivity.fill(List.of(phrase(0, 1000)), drums, List.of(), List.of(), BEAT_MS);

        // 2 events in 2 beats = 1 per beat, half of full, times 0.5.
        assertEquals(0.25, filled.get(0).activity().drums(), 1e-9);
        assertEquals(0.0, filled.get(0).confidence().drums(), 1e-9);
    }
}
