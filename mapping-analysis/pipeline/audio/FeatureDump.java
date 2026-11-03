import dev.mewbit.mewbeat.dsp.AnalysisTier;
import dev.mewbit.mewbeat.dsp.Downsampler;
import dev.mewbit.mewbeat.dsp.FeatureExtractor;
import dev.mewbit.mewbeat.dsp.Features;
import java.io.BufferedInputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.lang.reflect.RecordComponent;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * Offline copy of AnalysisWorker.analyze (lavalink-plugins/mewbeat) for mapping-analysis.
 *
 * <p>Input: raw PCM, signed 16-bit little-endian, 48 kHz, 2 channels (what lavaplayer hands the plugin).
 * The samples go through the plugin's own Downsampler (48 kHz stereo -> 24 kHz mono) into the plugin's own
 * FeatureExtractor in 960-frame chunks (20 ms, the lavaplayer frame size), exactly as in the plugin. Output: the
 * features JSON v2 the plugin returns, without its "audio" block. The plugin code is compiled from source and
 * not modified.
 *
 * <pre>java -cp build FeatureDump input.s16le output.json [full|light]</pre>
 */
public final class FeatureDump {

    private static final int SAMPLE_RATE = 24_000; // AnalysisWorker.WAV_SAMPLE_RATE
    private static final int CHUNK_FRAMES = 960;

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("usage: FeatureDump <input.s16le> <output.json> [full|light]");
            System.exit(2);
        }
        AnalysisTier tier = AnalysisTier.parse(args.length > 2 ? args[2] : "full");
        FeatureExtractor extractor = new FeatureExtractor(SAMPLE_RATE, tier);
        Downsampler downsampler = new Downsampler();
        byte[] bytes = new byte[CHUNK_FRAMES * 4];
        short[] interleaved = new short[CHUNK_FRAMES * 2];
        float[] mono = new float[Downsampler.maxOutput(CHUNK_FRAMES)];
        long started = System.nanoTime();
        try (InputStream in = new BufferedInputStream(new FileInputStream(args[0]), 1 << 16)) {
            int filled = 0;
            while (true) {
                int read = in.read(bytes, filled, bytes.length - filled);
                if (read < 0) {
                    break;
                }
                filled += read;
                if (filled == bytes.length) {
                    feed(bytes, filled, interleaved, mono, downsampler, extractor);
                    filled = 0;
                }
            }
            if (filled >= 4) {
                feed(bytes, filled - filled % 4, interleaved, mono, downsampler, extractor);
            }
        }
        Features features = extractor.finish();
        long wallMs = (System.nanoTime() - started) / 1_000_000;
        StringBuilder json = new StringBuilder(1 << 20);
        write(json, features);
        Files.writeString(Path.of(args[1]), json, StandardCharsets.UTF_8);
        System.err.println("features: " + features.durationMs() + " ms of audio in " + wallMs + " ms (" + tier + ")");
    }

    private static void feed(
            byte[] bytes, int length, short[] interleaved, float[] mono, Downsampler downsampler, FeatureExtractor extractor) {
        int frames = length / 4;
        for (int i = 0; i < frames * 2; i++) {
            interleaved[i] = (short) ((bytes[2 * i] & 0xff) | (bytes[2 * i + 1] << 8));
        }
        int produced = downsampler.process(interleaved, frames, mono);
        extractor.accept(mono, produced);
    }

    /** Minimal JSON writer for records, lists, strings, numbers and null, in record component order (as Jackson). */
    private static void write(StringBuilder out, Object value) throws ReflectiveOperationException {
        if (value == null) {
            out.append("null");
        } else if (value instanceof String s) {
            out.append('"');
            for (char c : s.toCharArray()) {
                if (c == '"' || c == '\\') {
                    out.append('\\').append(c);
                } else if (c < 0x20) {
                    out.append(String.format("\\u%04x", (int) c));
                } else {
                    out.append(c);
                }
            }
            out.append('"');
        } else if (value instanceof Double d) {
            out.append(Double.isFinite(d) ? d.toString() : "null");
        } else if (value instanceof Float f) {
            out.append(Float.isFinite(f) ? f.toString() : "null");
        } else if (value instanceof Number || value instanceof Boolean) {
            out.append(value);
        } else if (value instanceof List<?> list) {
            out.append('[');
            for (int i = 0; i < list.size(); i++) {
                if (i > 0) {
                    out.append(',');
                }
                write(out, list.get(i));
            }
            out.append(']');
        } else if (value.getClass().isRecord()) {
            out.append('{');
            RecordComponent[] components = value.getClass().getRecordComponents();
            for (int i = 0; i < components.length; i++) {
                if (i > 0) {
                    out.append(',');
                }
                write(out, components[i].getName());
                out.append(':');
                write(out, components[i].getAccessor().invoke(value));
            }
            out.append('}');
        } else {
            throw new IllegalArgumentException("cannot serialise " + value.getClass());
        }
    }
}
