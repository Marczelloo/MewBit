package dev.mewbit.mewbeat;

import java.util.Locale;
import java.util.function.Consumer;

/**
 * One line per analysis job, in a stable {@code key=value} format that the
 * charts pipeline reads back:
 * {@code mewbeat-job identifier=... durationMs=... wallMs=... realtimeFactor=... peakHeapMb=... result=...}.
 * {@code durationMs} is the length of audio that was decoded (0 when nothing was),
 * {@code realtimeFactor} is {@code durationMs / wallMs}.
 */
public final class MetricsLog {

    public static final String PREFIX = "mewbeat-job";

    private final Consumer<String> sink;

    public MetricsLog(Consumer<String> sink) {
        this.sink = sink;
    }

    /** Writes to Lavalink's log (slf4j). */
    public static MetricsLog toLavalinkLog() {
        org.slf4j.Logger logger = org.slf4j.LoggerFactory.getLogger(MetricsLog.class);
        return new MetricsLog(logger::info);
    }

    public void job(String identifier, long durationMs, long wallMs, long peakHeapMb, String result) {
        sink.accept(line(identifier, durationMs, wallMs, peakHeapMb, result));
    }

    static String line(String identifier, long durationMs, long wallMs, long peakHeapMb, String result) {
        double realtimeFactor = wallMs > 0 ? (double) durationMs / wallMs : 0;
        return String.format(
                Locale.ROOT,
                "%s identifier=%s durationMs=%d wallMs=%d realtimeFactor=%.1f peakHeapMb=%d result=%s",
                PREFIX,
                identifier == null || identifier.isBlank() ? "-" : identifier.replaceAll("\\s+", "_"),
                durationMs,
                wallMs,
                realtimeFactor,
                peakHeapMb,
                result);
    }
}
