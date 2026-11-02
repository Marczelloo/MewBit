package dev.mewbit.mewbeat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.mewbit.mewbeat.AnalysisWorker.Outcome;
import dev.mewbit.mewbeat.TrackDecoder.BadTrackException;
import dev.mewbit.mewbeat.TrackDecoder.DecodeException;
import dev.mewbit.mewbeat.TrackDecoder.TrackMeta;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Encodes a whole track to Ogg Opus for the Activity's solo play. Like
 * {@link AnalysisWorker} it runs one job at a time on a minimum-priority
 * thread; at most {@code maxQueue} requests wait behind the running one and the
 * rest get 503 {@code busy}.
 */
@Component
public final class AudioEncodeWorker implements AutoCloseable {

    static final String OGG = "audio/ogg";
    static final long DEFAULT_TIMEOUT_MS = 600_000;

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private final TrackDecoder decoder;
    private final MetricsLog metrics;
    private final long maxTrackMs;
    private final long timeoutMs;
    private final int maxQueue;
    private final ThreadPoolExecutor executor;
    private final ScheduledExecutorService watchdog;

    @Autowired
    public AudioEncodeWorker(
            TrackDecoder decoder,
            @Value("${plugins.mewbeat.audioMaxQueue:2}") int maxQueue,
            @Value("${plugins.mewbeat.maxTrackMs:1200000}") long maxTrackMs) {
        this(decoder, MetricsLog.toLavalinkLog(), maxQueue, maxTrackMs, DEFAULT_TIMEOUT_MS);
    }

    AudioEncodeWorker(TrackDecoder decoder, MetricsLog metrics, int maxQueue, long maxTrackMs, long timeoutMs) {
        this.decoder = decoder;
        this.metrics = metrics;
        this.maxQueue = maxQueue;
        this.maxTrackMs = maxTrackMs;
        this.timeoutMs = timeoutMs;
        this.executor = new ThreadPoolExecutor(
                1,
                1,
                0,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(maxQueue),
                AnalysisWorker.minPriorityThreads("mewbeat-audio"));
        this.watchdog = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
            Thread thread = new Thread(r, "mewbeat-audio-watchdog");
            thread.setDaemon(true);
            return thread;
        });
    }

    /** Returns the track as an Ogg Opus file, or an error outcome (422 not loadable, 503 busy, 502 timeout). */
    public Outcome encode(String encodedTrack) {
        TrackMeta meta;
        try {
            meta = decoder.describe(encodedTrack);
        } catch (BadTrackException e) {
            return error(422, describe(e));
        }
        if (meta.stream()) {
            return error(422, "streams cannot be played in the Activity");
        }
        if (meta.lengthMs() > maxTrackMs) {
            return error(422, "track is too long");
        }

        Future<Outcome> future;
        try {
            future = executor.submit(() -> run(meta, encodedTrack));
        } catch (RejectedExecutionException e) {
            metrics.job(meta.identifier(), 0, 0, 0, "audio_busy");
            return error(503, "busy");
        }
        long waitBoundMs = (maxQueue + 2L) * timeoutMs + 10_000;
        try {
            return future.get(waitBoundMs, TimeUnit.MILLISECONDS);
        } catch (ExecutionException e) {
            return error(502, describe(e.getCause() == null ? e : e.getCause()));
        } catch (TimeoutException e) {
            future.cancel(true);
            return error(502, "encoding did not finish");
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            return error(503, "busy");
        }
    }

    /** Runs on the worker thread. */
    private Outcome run(TrackMeta meta, String encodedTrack) {
        Thread worker = Thread.currentThread();
        AtomicBoolean timedOut = new AtomicBoolean();
        ScheduledFuture<?> killer = watchdog.schedule(
                () -> {
                    timedOut.set(true);
                    worker.interrupt();
                },
                timeoutMs,
                TimeUnit.MILLISECONDS);
        long started = System.nanoTime();
        OggOpusWriter writer = new OggOpusWriter(0x6d657762); // "mewb"
        long[] packets = {0};
        Outcome outcome;
        String result;
        try {
            decoder.decodeOpus(encodedTrack, packet -> {
                writer.addPacket(packet);
                packets[0]++;
            });
            if (packets[0] == 0) {
                outcome = error(422, "track produced no audio");
                result = "audio_empty";
            } else {
                outcome = new Outcome(200, OGG, writer.finish());
                result = "audio_ok";
            }
        } catch (InterruptedException e) {
            outcome = timedOut.get() ? error(502, "timed out") : error(502, "cancelled");
            result = timedOut.get() ? "audio_timeout" : "audio_cancelled";
        } catch (DecodeException e) {
            outcome = error(422, describe(e));
            result = "audio_load_failed";
        } catch (RuntimeException e) {
            outcome = error(502, describe(e));
            result = "audio_failed";
        } finally {
            killer.cancel(false);
            Thread.interrupted(); // a late timeout must not leak into the next job
        }
        long wallMs = (System.nanoTime() - started) / 1_000_000;
        metrics.job(meta.identifier(), packets[0] * 20, wallMs, 0, result);
        return outcome;
    }

    private static String describe(Throwable e) {
        String message = e.getMessage();
        return message == null || message.isBlank() ? e.getClass().getSimpleName() : message;
    }

    private static Outcome error(int status, String message) {
        ObjectNode json = JSON_MAPPER.createObjectNode();
        json.put("error", message);
        return new Outcome(status, AnalysisWorker.JSON, json.toString().getBytes(StandardCharsets.UTF_8));
    }

    @Override
    public void close() {
        executor.shutdownNow();
        watchdog.shutdownNow();
    }
}
