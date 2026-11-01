package dev.mewbit.mewbeat.dsp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;

class FeatureExtractorTest {

    private static final int SR = Synth.SAMPLE_RATE;
    private static final int TOLERANCE_MS = 15;

    private static Features extract(float[] signal, int chunk) {
        return extract(signal, chunk, AnalysisTier.FULL);
    }

    private static Features extract(float[] signal, int chunk, AnalysisTier tier) {
        FeatureExtractor extractor = new FeatureExtractor(SR, tier);
        float[] buffer = new float[chunk];
        for (int offset = 0; offset < signal.length; offset += chunk) {
            int length = Math.min(chunk, signal.length - offset);
            System.arraycopy(signal, offset, buffer, 0, length);
            extractor.accept(buffer, length);
        }
        return extractor.finish();
    }

    private static Features extract(float[] signal) {
        return extract(signal, signal.length);
    }

    private static List<Features.Onset> onsets(Features features, String band) {
        return features.bands().stream()
                .filter(b -> b.name().equals(band))
                .findFirst()
                .orElseThrow()
                .onsets();
    }

    private static int distanceToNearestOnset(List<Features.Onset> onsets, double seconds) {
        int best = Integer.MAX_VALUE;
        for (Features.Onset onset : onsets) {
            best = Math.min(best, (int) Math.abs(onset.t() - Math.round(seconds * 1000)));
        }
        return best;
    }

    private static int distanceToNearest(List<Integer> times, double seconds) {
        int best = Integer.MAX_VALUE;
        for (int t : times) {
            best = Math.min(best, (int) Math.abs(t - Math.round(seconds * 1000)));
        }
        return best;
    }

    @Test
    void clickTrain120BpmGivesTempo120() {
        float[] signal = Synth.silence(60);
        Synth.addThumps(signal, 0.25, 0.5, 59.5, 0.8);

        Features features = extract(signal);

        assertEquals(120.0, features.tempo().bpm(), 1.0);
        assertTrue(features.tempo().confidence() >= 0.5, "confidence " + features.tempo().confidence());
        for (double click = 0.25; click < 59.5; click += 0.5) {
            int error = distanceToNearest(features.tempo().beats(), click);
            assertTrue(error <= TOLERANCE_MS, "click at " + click + " s has no beat within 15 ms (nearest " + error + " ms)");
        }
        assertTrue(features.tempo().downbeats().size() >= features.tempo().beats().size() / 4 - 1);
    }

    @Test
    void onsetsLandOnClicks() {
        float[] signal = Synth.silence(30);
        Random random = new Random(42);
        for (double t = 1.0; t < 29; t += 1.0) {
            Synth.addThump(signal, t, 0.8);
            Synth.addHat(signal, t + 0.5, 0.8, random);
        }

        Features features = extract(signal);
        List<Features.Onset> low = onsets(features, "low");
        List<Features.Onset> high = onsets(features, "high");

        for (double t = 1.0; t < 29; t += 1.0) {
            int lowError = distanceToNearestOnset(low, t);
            assertTrue(lowError <= TOLERANCE_MS, "thump at " + t + " s: nearest low onset " + lowError + " ms away");
            int highError = distanceToNearestOnset(high, t + 0.5);
            assertTrue(highError <= TOLERANCE_MS, "hat at " + (t + 0.5) + " s: nearest high onset " + highError + " ms away");
            int lowAtHat = distanceToNearestOnset(low, t + 0.5);
            assertTrue(lowAtHat > 100, "hat at " + (t + 0.5) + " s leaked into the low band (" + lowAtHat + " ms)");
        }
        assertEquals(28, low.size(), "low band onsets");
        for (Features.Onset onset : low) {
            assertTrue(onset.s() > 0 && onset.s() <= 1.0, "strength " + onset.s());
        }
    }

    @Test
    void silenceHasNoOnsetsAndZeroEnergy() {
        Features features = extract(Synth.silence(30));

        assertEquals(4, features.bands().size());
        for (Features.Band band : features.bands()) {
            assertTrue(band.onsets().isEmpty(), band.name() + " has onsets");
        }
        assertEquals(60, features.energy().values().size());
        assertTrue(features.energy().values().stream().allMatch(v -> v == 0.0));
        assertEquals(0.0, features.tempo().bpm());
        assertTrue(features.tempo().beats().isEmpty());
        assertEquals(30_000, features.durationMs());
    }

    @Test
    void highlightFindsLoudSection() {
        float[] signal = Synth.silence(120);
        Random random = new Random(7);
        Synth.addThumps(signal, 0.25, 0.5, 60, 0.05);
        Synth.addThumps(signal, 80.25, 0.5, 119.5, 0.05);
        Synth.addNoise(signal, 60, 80, 0.4, random);
        Synth.addThumps(signal, 60.25, 0.25, 80, 0.9);

        Features features = extract(signal);

        assertNotNull(features.highlightMs());
        assertEquals(60_000, features.highlightMs(), 4000);
        assertTrue(features.sections().size() >= 3, "sections " + features.sections());
        assertEquals(0, features.sections().get(0).startMs());
        assertEquals(features.durationMs(), features.sections().get(features.sections().size() - 1).endMs());
    }

    @Test
    void shortTrackHasNoHighlight() {
        float[] signal = Synth.silence(30);
        Synth.addNoise(signal, 0, 30, 0.5, new Random(3));

        Features features = extract(signal);

        assertNull(features.highlightMs());
    }

    @Test
    void streamingEqualsOneShot() {
        float[] signal = Synth.silence(45);
        Random random = new Random(11);
        Synth.addThumps(signal, 0.2, 0.5, 45, 0.7);
        for (double t = 0.45; t < 45; t += 0.5) {
            Synth.addHat(signal, t, 0.6, random);
        }

        Features oneShot = extract(signal);
        Features streamed = extract(signal, 997);

        assertEquals(oneShot, streamed);
        assertTrue(oneShot.tempo().beats().size() > 50, "analysis found nothing to compare");
        assertFalse(oneShot.drums().isEmpty(), "no drums to compare");
    }

    @Test
    void serialisesToFeaturesJsonV2() throws Exception {
        float[] signal = Synth.silence(20);
        Synth.addThumps(signal, 0.25, 0.5, 19.5, 0.8);

        JsonNode json = new ObjectMapper().readTree(new ObjectMapper().writeValueAsString(extract(signal)));

        assertEquals(2, json.get("featuresVersion").asInt());
        assertEquals("full", json.get("analysisTier").asText());
        assertEquals(20_000, json.get("durationMs").asInt());
        assertEquals(10.667, json.get("hopMs").asDouble(), 1e-9);
        assertEquals("low", json.get("bands").get(0).get("name").asText());
        assertTrue(json.get("bands").get(0).get("onsets").get(0).has("t"));
        assertTrue(json.get("bands").get(0).get("onsets").get(0).has("s"));
        assertTrue(json.get("tempo").has("beats") && json.get("tempo").has("downbeats"));
        assertEquals(500, json.get("energy").get("hopMs").asInt());
        assertTrue(json.get("sections").isArray());
        assertTrue(json.has("highlightMs") && json.get("highlightMs").isNull());
        assertTrue(json.get("drums").isArray() && json.get("drums").size() > 0);
        assertTrue(json.get("drums").get(0).has("t") && json.get("drums").get(0).has("kind"));
        assertTrue(json.get("bass").isArray());
        assertTrue(json.get("lead").isArray());
        assertEquals(16, json.get("phrases").get("beatsPerPhrase").asInt());
        assertTrue(json.get("phrases").get("list").isArray());
    }

    @Test
    void lightTierIsLabelled() {
        float[] signal = Synth.silence(20);
        Synth.addThumps(signal, 0.25, 0.5, 19.5, 0.8);

        Features features = extract(signal, signal.length, AnalysisTier.LIGHT);

        assertEquals("light", features.analysisTier());
        assertFalse(features.drums().isEmpty());
    }
}
