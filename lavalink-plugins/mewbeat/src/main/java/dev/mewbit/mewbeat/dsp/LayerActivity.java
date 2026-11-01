package dev.mewbit.mewbeat.dsp;

import java.util.ArrayList;
import java.util.List;

/** How busy each layer (drums, bass, lead) is in every phrase, and how sure the analysis is of it. All values 0..1. */
final class LayerActivity {

    /** Drum events per beat at which the drum layer counts as fully busy. */
    private static final double FULL_DRUM_EVENTS_PER_BEAT = 2;

    private LayerActivity() {}

    /** The phrases again, with {@code activity} and {@code confidence} filled in. */
    static List<Features.Phrase> fill(
            List<Features.Phrase> phrases,
            List<Features.Drum> drums,
            List<Features.Note> bass,
            List<Features.Note> lead,
            double beatMs) {
        List<Features.Phrase> filled = new ArrayList<>(phrases.size());
        for (Features.Phrase p : phrases) {
            double beats = Math.max(1e-9, (p.endMs() - p.startMs()) / beatMs);
            double drumCount = 0;
            double drumStrength = 0;
            double hitCount = 0;
            double hitStrength = 0;
            for (Features.Drum d : drums) {
                if (d.t() < p.startMs() || d.t() >= p.endMs()) {
                    continue;
                }
                drumCount++;
                drumStrength += d.s();
                if (d.kind().equals("kick") || d.kind().equals("snare")) {
                    hitCount++;
                    hitStrength += d.s();
                }
            }
            double drumActivity = drumCount == 0
                    ? 0
                    : Math.min(1, drumCount / beats / FULL_DRUM_EVENTS_PER_BEAT) * (drumStrength / drumCount);
            double drumConfidence = hitCount == 0 ? 0 : hitStrength / hitCount;

            double[] bassCover = cover(bass, p);
            double[] leadCover = cover(lead, p);
            double span = Math.max(1, p.endMs() - p.startMs());
            filled.add(new Features.Phrase(
                    p.startMs(),
                    p.endMs(),
                    p.repeatOf(),
                    p.similarity(),
                    p.lagMs(),
                    new Features.Layers(
                            Highlight.round3(clamp(drumActivity)),
                            Highlight.round3(clamp(bassCover[0] / span)),
                            Highlight.round3(clamp(leadCover[0] / span))),
                    new Features.Layers(
                            Highlight.round3(clamp(drumConfidence)),
                            Highlight.round3(clamp(bassCover[1])),
                            Highlight.round3(clamp(leadCover[1])))));
        }
        return filled;
    }

    /** {@code {ms of the phrase the notes cover, length-weighted mean confidence of that part}}. */
    private static double[] cover(List<Features.Note> notes, Features.Phrase phrase) {
        double covered = 0;
        double weighted = 0;
        for (Features.Note n : notes) {
            int from = Math.max(n.t(), phrase.startMs());
            int to = Math.min(n.t() + n.len(), phrase.endMs());
            if (to > from) {
                covered += to - from;
                weighted += (to - from) * n.conf();
            }
        }
        return new double[] {covered, covered == 0 ? 0 : weighted / covered};
    }

    private static double clamp(double v) {
        return Math.max(0, Math.min(1, v));
    }
}
