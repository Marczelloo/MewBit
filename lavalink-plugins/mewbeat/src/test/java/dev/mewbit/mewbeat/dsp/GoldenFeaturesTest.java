package dev.mewbit.mewbeat.dsp;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.RecordComponent;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Random;
import java.util.function.Supplier;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

/**
 * Bit-exactness guard for speed work. The analysis feeds a chart generator that players already like, so an
 * optimisation must return the very same numbers: this test hashes the raw bits of everything the extractor
 * produces (every field of the features, plus the internal per-frame arrays that the features are thresholded from)
 * for several deterministic signals at every {@link AnalysisTier}, and the raw output of {@link Fft} and
 * {@link Hpss} on their own, and compares them with the hashes in {@code golden-hashes.properties} that the unmodified
 * code produced.
 *
 * <p>The hashes depend on the platform's {@code Math} intrinsics (they were taken on x86-64 HotSpot 21); if the test
 * fails on another machine with the code unchanged, regenerate the file from {@code build/golden-actual/} there.
 * The actual hashes of every case are written to {@code build/golden-actual/<case>.txt}, ready to be concatenated into
 * the resource.
 */
class GoldenFeaturesTest {

    private static final int SR = GoldenSignals.SAMPLE_RATE;

    private static final Map<String, float[]> SIGNALS = new LinkedHashMap<>();

    /** Name, generator and the chunk size the extractor is fed in (0 = the whole signal in one call). */
    private record Case(String name, Supplier<float[]> signal, int chunk) {}

    private static final List<Case> CASES = List.of(
            new Case("song", GoldenSignals::song, 4096),
            new Case("tempoChange", GoldenSignals::tempoChange, 1000),
            new Case("ambient", GoldenSignals::ambient, 0),
            new Case("dense", GoldenSignals::dense, 4097),
            new Case("tiny", GoldenSignals::tiny, 300),
            new Case("silent", GoldenSignals::silent, 8192),
            new Case("noisy", GoldenSignals::noisy, 2048));

    // ---- Tests ----------------------------------------------------------------------------------------------

    @TestFactory
    Stream<DynamicTest> extractorMatchesGolden() {
        List<DynamicTest> tests = new ArrayList<>();
        for (Case c : CASES) {
            for (AnalysisTier tier : AnalysisTier.values()) {
                String name = c.name() + "." + tier.wireName();
                tests.add(dynamicTest(name, () -> check(name, extractorHashes(c, tier))));
            }
        }
        return tests.stream();
    }

    @Test
    void fftMatchesGolden() throws Exception {
        check("fft", fftHashes());
    }

    @Test
    void hpssMatchesGolden() throws Exception {
        check("hpss", hpssHashes());
    }

    // ---- Extractor ------------------------------------------------------------------------------------------

    private static synchronized float[] signal(Case c) {
        return SIGNALS.computeIfAbsent(c.name(), k -> c.signal().get());
    }

    private static Map<String, String> extractorHashes(Case c, AnalysisTier tier) throws Exception {
        float[] signal = signal(c);
        FeatureExtractor extractor = new FeatureExtractor(SR, tier);
        if (c.chunk() == 0) {
            extractor.accept(signal, signal.length);
        } else {
            float[] buffer = new float[c.chunk()];
            for (int offset = 0; offset < signal.length; offset += c.chunk()) {
                int length = Math.min(c.chunk(), signal.length - offset);
                System.arraycopy(signal, offset, buffer, 0, length);
                extractor.accept(buffer, length);
            }
        }
        Features features = extractor.finish();

        Map<String, String> hashes = new LinkedHashMap<>();
        Digest scalar = new Digest();
        scalar.put(features.featuresVersion());
        scalar.put(features.durationMs());
        scalar.put(features.hopMs());
        scalar.put(features.highlightMs());
        scalar.put(features.analysisTier());
        hashes.put("scalar", scalar.hex());
        for (RecordComponent component : Features.class.getRecordComponents()) {
            if (List.of("featuresVersion", "durationMs", "hopMs", "highlightMs", "analysisTier")
                    .contains(component.getName())) {
                continue;
            }
            Digest digest = new Digest();
            digest.put(component.getAccessor().invoke(features));
            hashes.put(component.getName(), digest.hex());
        }

        // The per-frame arrays that the features are thresholded from: a last-bit change in these might not move
        // a feature on these signals but could on another song.
        Digest flux = new Digest();
        int hops = (int) field(extractor, "hops");
        flux.put(hops);
        float[][] bandFlux = (float[][]) field(extractor, "flux");
        for (float[] band : bandFlux) {
            flux.put(band, hops);
        }
        hashes.put("internal.flux", flux.hex());

        Object drums = field(extractor, "drumDetector");
        Digest drumFlux = new Digest();
        int drumHops = (int) field(drums, "hops");
        drumFlux.put(drumHops);
        for (float[] band : (float[][]) field(drums, "flux")) {
            drumFlux.put(band, drumHops);
        }
        hashes.put("internal.drumFlux", drumFlux.hex());

        Object pitch = field(extractor, "pitchTracker");
        int frames = (int) field(pitch, "frames");
        Digest chroma = new Digest();
        chroma.put(frames);
        chroma.put((int[]) field(pitch, "chromaMs"), frames);
        float[][] chromaFrames = (float[][]) field(pitch, "chroma");
        for (int i = 0; i < frames; i++) {
            chroma.put(chromaFrames[i], chromaFrames[i].length);
        }
        hashes.put("internal.chroma", chroma.hex());
        for (String line : new String[] {"bass", "lead"}) {
            Object track = field(pitch, line);
            int count = (int) field(track, "count");
            Digest digest = new Digest();
            digest.put(count);
            digest.put((double[]) field(track, "pitch"), count);
            digest.put((float[]) field(track, "salience"), count);
            digest.put((float[]) field(track, "confidence"), count);
            hashes.put("internal." + line + "Track", digest.hex());
        }
        return hashes;
    }

    // ---- Fft ------------------------------------------------------------------------------------------------

    private static Map<String, String> fftHashes() {
        Map<String, String> hashes = new LinkedHashMap<>();
        for (int size : new int[] {2, 8, 1024, 4096}) {
            Fft fft = new Fft(size);
            Random random = new Random(100 + size);
            // Real input, as the extractor uses it.
            float[] re = new float[size];
            float[] im = new float[size];
            for (int i = 0; i < size; i++) {
                re[i] = (random.nextFloat() - 0.5f) * (i % 7 == 0 ? 0 : 1) + (float) StrictMath.sin(i * 0.37);
            }
            fft.transform(re, im);
            Digest real = new Digest();
            real.put(re, size);
            real.put(im, size);
            hashes.put("size" + size + ".real", real.hex());
            // Complex input.
            re = new float[size];
            im = new float[size];
            for (int i = 0; i < size; i++) {
                re[i] = random.nextFloat() * 2 - 1;
                im[i] = random.nextFloat() * 2 - 1;
            }
            fft.transform(re, im);
            Digest complex = new Digest();
            complex.put(re, size);
            complex.put(im, size);
            hashes.put("size" + size + ".complex", complex.hex());
            // An impulse and a constant: exact values and signed zeros.
            re = new float[size];
            im = new float[size];
            re[1] = 1;
            fft.transform(re, im);
            Digest impulse = new Digest();
            impulse.put(re, size);
            impulse.put(im, size);
            re = new float[size];
            im = new float[size];
            java.util.Arrays.fill(re, 0.25f);
            fft.transform(re, im);
            impulse.put(re, size);
            impulse.put(im, size);
            hashes.put("size" + size + ".exact", impulse.hex());
        }
        return hashes;
    }

    // ---- Hpss -----------------------------------------------------------------------------------------------

    /** Magnitude-like frames: smooth tones, bursts, ties from a coarse grid, runs of exact zeros, one loud bin. */
    private static float[][] magnitudes(int frames, int bins, long seed) {
        Random random = new Random(seed);
        float[][] out = new float[frames][bins];
        for (int f = 0; f < frames; f++) {
            boolean burst = f % 23 == 5;
            boolean gap = (f / 40) % 5 == 3;
            for (int b = 0; b < bins; b++) {
                float v;
                if (gap) {
                    v = 0;
                } else {
                    v = random.nextFloat() * 0.05f;
                    if (b % 41 == 3 || b % 41 == 4) {
                        v += 0.4f + 0.1f * random.nextFloat();
                    }
                    if (burst) {
                        v += random.nextFloat() * 0.5f;
                    }
                    if (random.nextInt(6) == 0) {
                        v = StrictMath.round(v * 64) / 64f; // exact ties
                    }
                    if (random.nextInt(50) == 0) {
                        v = 0;
                    }
                }
                out[f][b] = v;
            }
        }
        return out;
    }

    private static Map<String, String> hpssHashes() {
        Map<String, String> hashes = new LinkedHashMap<>();
        int[][] setups = {{513, 17, 900}, {513, 9, 900}, {12, 9, 60}, {5, 9, 30}, {513, 17, 0}, {513, 17, 5},
            {513, 17, 8}, {513, 17, 9}, {513, 17, 17}, {513, 9, 3}, {513, 9, 4}, {513, 9, 5}};
        for (int[] setup : setups) {
            int bins = setup[0];
            int kernel = setup[1];
            int frames = setup[2];
            float[][] input = magnitudes(frames, bins, 7L * bins + kernel + frames);
            Hpss hpss = new Hpss(bins, kernel);
            Digest percussive = new Digest();
            Digest harmonic = new Digest();
            int emitted = 0;
            for (float[] frame : input) {
                float[][] pair = hpss.push(frame);
                if (pair != null) {
                    percussive.put(pair[0], bins);
                    harmonic.put(pair[1], bins);
                    emitted++;
                }
            }
            for (float[][] pair : hpss.flush()) {
                percussive.put(pair[0], bins);
                harmonic.put(pair[1], bins);
                emitted++;
            }
            assertTrue(emitted == frames, "every pushed frame comes out once: " + emitted + " of " + frames);
            String key = "bins" + bins + ".kernel" + kernel + ".frames" + frames;
            hashes.put(key + ".percussive", percussive.hex());
            hashes.put(key + ".harmonic", harmonic.hex());
        }
        return hashes;
    }

    // ---- Plumbing -------------------------------------------------------------------------------------------

    private static Object field(Object target, String name) throws ReflectiveOperationException {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(target);
    }

    private static Properties expected() throws IOException {
        Properties properties = new Properties();
        try (InputStream in = GoldenFeaturesTest.class.getResourceAsStream("/golden-hashes.properties")) {
            if (in != null) {
                properties.load(in);
            }
        }
        return properties;
    }

    /** Writes the actual hashes of a case for regenerating the resource, then compares them with the golden ones. */
    private static void check(String name, Map<String, String> actual) throws IOException {
        Path dir = Path.of("build", "golden-actual");
        Files.createDirectories(dir);
        StringBuilder lines = new StringBuilder();
        for (Map.Entry<String, String> e : actual.entrySet()) {
            lines.append(name).append('.').append(e.getKey()).append('=').append(e.getValue()).append('\n');
        }
        Files.writeString(dir.resolve(name + ".txt"), lines.toString(), StandardCharsets.UTF_8);

        Properties golden = expected();
        List<String> wrong = new ArrayList<>();
        for (Map.Entry<String, String> e : actual.entrySet()) {
            String key = name + "." + e.getKey();
            String want = golden.getProperty(key);
            if (want == null) {
                wrong.add(key + ": no golden hash recorded (actual " + e.getValue() + ")");
            } else if (!want.equals(e.getValue())) {
                wrong.add(key + ": golden " + want + " but got " + e.getValue());
            }
        }
        assertTrue(wrong.isEmpty(),"output changed:\n" + String.join("\n", wrong));
    }

    /** SHA-256 over the raw bits of everything fed in, in order; records, lists and arrays are walked. */
    private static final class Digest {
        private final MessageDigest md;

        Digest() {
            try {
                md = MessageDigest.getInstance("SHA-256");
            } catch (NoSuchAlgorithmException e) {
                throw new IllegalStateException(e);
            }
        }

        void put(int v) {
            for (int s = 24; s >= 0; s -= 8) {
                md.update((byte) (v >>> s));
            }
        }

        void put(long v) {
            put((int) (v >>> 32));
            put((int) v);
        }

        void put(double v) {
            put(Double.doubleToRawLongBits(v));
        }

        void put(float v) {
            put(Float.floatToRawIntBits(v));
        }

        void put(float[] values, int count) {
            for (int i = 0; i < count; i++) {
                put(values[i]);
            }
        }

        void put(double[] values, int count) {
            for (int i = 0; i < count; i++) {
                put(values[i]);
            }
        }

        void put(int[] values, int count) {
            for (int i = 0; i < count; i++) {
                put(values[i]);
            }
        }

        /** Null, boxed numbers, strings, lists and records (every component, in order). */
        void put(Object o) {
            try {
                if (o == null) {
                    md.update((byte) 0);
                } else if (o instanceof Integer i) {
                    md.update((byte) 1);
                    put(i.intValue());
                } else if (o instanceof Double d) {
                    md.update((byte) 2);
                    put(d.doubleValue());
                } else if (o instanceof String s) {
                    md.update((byte) 3);
                    byte[] bytes = s.getBytes(StandardCharsets.UTF_8);
                    put(bytes.length);
                    md.update(bytes);
                } else if (o instanceof List<?> list) {
                    md.update((byte) 4);
                    put(list.size());
                    for (Object e : list) {
                        put(e);
                    }
                } else if (o.getClass().isRecord()) {
                    md.update((byte) 5);
                    for (RecordComponent component : o.getClass().getRecordComponents()) {
                        put(component.getAccessor().invoke(o));
                    }
                } else {
                    throw new IllegalArgumentException("cannot hash " + o.getClass());
                }
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
        }

        String hex() {
            byte[] hash = md.digest();
            StringBuilder out = new StringBuilder();
            for (int i = 0; i < 8; i++) {
                out.append(String.format("%02x", hash[i]));
            }
            return out.toString();
        }
    }
}
