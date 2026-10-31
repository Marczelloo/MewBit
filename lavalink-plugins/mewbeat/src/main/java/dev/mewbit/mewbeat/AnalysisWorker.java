package dev.mewbit.mewbeat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.mewbit.mewbeat.TrackDecoder.BadTrackException;
import dev.mewbit.mewbeat.TrackDecoder.DecodeException;
import dev.mewbit.mewbeat.TrackDecoder.TrackMeta;
import dev.mewbit.mewbeat.dsp.Downsampler;
import dev.mewbit.mewbeat.dsp.FeatureExtractor;
import dev.mewbit.mewbeat.dsp.Features;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Runs analysis jobs one at a time on a single minimum-priority thread, so a
 * Lavalink node that is also playing music is not starved. Callers (HTTP
 * threads) block on the job's future; at most {@code maxQueue} jobs wait behind
 * the running one and the rest are turned away as {@code busy}. A job that runs
 * longer than the timeout is interrupted, which cancels its decode.
 */
@Component
public final class AnalysisWorker implements AutoCloseable {

    /** A finished request: HTTP status, content type and body bytes. */
    public record Outcome(int status, String contentType, byte[] body) {}

    static final String JSON = "application/json";
    static final String WAV = "audio/wav";
    static final long DEFAULT_TIMEOUT_MS = 120_000;
    static final int WAV_SAMPLE_RATE = 24_000;

    private static final long HEAP_SAMPLE_MS = 250;
    private static final ObjectMapper JSON_MAPPER = new ObjectMapper(); // keeps null fields (highlightMs)

    /** Work done on the worker thread, with the audio duration it covered (0 if none). */
    private interface Job {
        JobResult run() throws Exception;
    }

    private record JobResult(Outcome outcome, long audioMs) {}

    private final TrackDecoder decoder;
    private final MetricsLog metrics;
    private final int maxQueue;
    private final long maxTrackMs;
    private final long timeoutMs;
    private final ThreadPoolExecutor executor;
    private final ScheduledExecutorService watchdog;

    @Autowired
    public AnalysisWorker(
            TrackDecoder decoder,
            @Value("${plugins.mewbeat.maxQueue:4}") int maxQueue,
            @Value("${plugins.mewbeat.maxTrackMs:1200000}") long maxTrackMs) {
        this(decoder, MetricsLog.toLavalinkLog(), maxQueue, maxTrackMs, DEFAULT_TIMEOUT_MS);
    }

    AnalysisWorker(TrackDecoder decoder, MetricsLog metrics, int maxQueue, long maxTrackMs, long timeoutMs) {
        this.decoder = decoder;
        this.metrics = metrics;
        this.maxQueue = maxQueue;
        this.maxTrackMs = maxTrackMs;
        this.timeoutMs = timeoutMs;
        this.executor = new ThreadPoolExecutor(
                1, 1, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(maxQueue), minPriorityThreads("mewbeat-analysis"));
        this.watchdog = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
            Thread thread = new Thread(r, "mewbeat-watchdog");
            thread.setDaemon(true);
            return thread;
        });
    }

    static java.util.concurrent.ThreadFactory minPriorityThreads(String name) {
        return runnable -> {
            Thread thread = new Thread(runnable, name);
            thread.setPriority(Thread.MIN_PRIORITY);
            thread.setDaemon(true);
            return thread;
        };
    }

    /** Decodes and analyses a track; the outcome's body is the features JSON plus an {@code audio} block. */
    public Outcome analyze(String encodedTrack) {
        TrackMeta meta;
        try {
            meta = decoder.describe(encodedTrack);
        } catch (BadTrackException e) {
            return error(400, "bad_track", e.getMessage());
        }
        Outcome refused = refuse(meta);
        if (refused != null) {
            return refused;
        }
        return submit(meta, () -> {
            FeatureExtractor extractor = new FeatureExtractor(WAV_SAMPLE_RATE);
            MonoStream mono = new MonoStream();
            decoder.decode(encodedTrack, (pcm, frames) -> extractor.accept(mono.convert(pcm, frames), mono.length));
            Features features = extractor.finish();
            ObjectNode json = JSON_MAPPER.valueToTree(features);
            ObjectNode audio = json.putObject("audio");
            audio.put("sourceName", meta.sourceName());
            audio.put("identifier", meta.identifier());
            audio.put("length", meta.lengthMs());
            return new JobResult(new Outcome(200, JSON, bytes(json.toString())), features.durationMs());
        });
    }

    /** Debug only: the decode as a 24 kHz mono 16-bit WAV, as the analysis sees it. */
    public Outcome pcmWav(String encodedTrack) {
        TrackMeta meta;
        try {
            meta = decoder.describe(encodedTrack);
        } catch (BadTrackException e) {
            return error(400, "bad_track", e.getMessage());
        }
        Outcome refused = refuse(meta);
        if (refused != null) {
            return refused;
        }
        return submit(meta, () -> {
            MonoStream mono = new MonoStream();
            ByteSink pcm = new ByteSink();
            decoder.decode(encodedTrack, (interleaved, frames) -> {
                float[] samples = mono.convert(interleaved, frames);
                for (int i = 0; i < mono.length; i++) {
                    int value = Math.round(Math.max(-1f, Math.min(1f, samples[i])) * 32767f);
                    pcm.write(value & 0xff);
                    pcm.write((value >> 8) & 0xff);
                }
            });
            long audioMs = pcm.size / 2 * 1000L / WAV_SAMPLE_RATE;
            return new JobResult(
                    new Outcome(200, WAV, Wav.mono16(pcm.bytes, pcm.size, WAV_SAMPLE_RATE)), audioMs);
        });
    }

    private Outcome refuse(TrackMeta meta) {
        String reason = null;
        if (meta.stream()) {
            reason = "stream";
        } else if (meta.lengthMs() > maxTrackMs) {
            reason = "too_long";
        }
        if (reason == null) {
            return null;
        }
        metrics.job(meta.identifier(), 0, 0, 0, reason);
        return new Outcome(422, JSON, bytes("{\"error\":\"uncharted\",\"reason\":\"" + reason + "\"}"));
    }

    private Outcome submit(TrackMeta meta, Job job) {
        Future<JobResult> future;
        try {
            future = executor.submit(() -> runGuarded(meta, job));
        } catch (RejectedExecutionException e) {
            metrics.job(meta.identifier(), 0, 0, 0, "busy");
            return new Outcome(503, JSON, bytes("{\"error\":\"busy\"}"));
        }
        // The job times itself out, so this bound only matters if the worker is lost.
        long waitBoundMs = (maxQueue + 2L) * timeoutMs + 10_000;
        try {
            return future.get(waitBoundMs, TimeUnit.MILLISECONDS).outcome();
        } catch (ExecutionException e) {
            Throwable cause = e.getCause() == null ? e : e.getCause();
            return error(502, "decode_failed", describe(cause));
        } catch (TimeoutException e) {
            future.cancel(true);
            return error(502, "decode_failed", "analysis did not finish");
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            return error(503, "busy", "request interrupted");
        }
    }

    /** Runs on the worker thread: arms the timeout, samples the heap, logs the metrics line. */
    private JobResult runGuarded(TrackMeta meta, Job job) {
        Thread worker = Thread.currentThread();
        Object lock = new Object();
        boolean[] finished = {false};
        boolean[] timedOut = {false};
        AtomicLong peakHeap = new AtomicLong();
        Runnable sampleHeap = () -> {
            Runtime runtime = Runtime.getRuntime();
            peakHeap.accumulateAndGet(runtime.totalMemory() - runtime.freeMemory(), Math::max);
        };
        ScheduledFuture<?> sampler =
                watchdog.scheduleAtFixedRate(sampleHeap, 0, HEAP_SAMPLE_MS, TimeUnit.MILLISECONDS);
        ScheduledFuture<?> killer = watchdog.schedule(
                () -> {
                    synchronized (lock) {
                        if (!finished[0]) {
                            timedOut[0] = true;
                            worker.interrupt();
                        }
                    }
                },
                timeoutMs,
                TimeUnit.MILLISECONDS);

        long started = System.nanoTime();
        JobResult result;
        String resultName;
        long audioMs = 0;
        try {
            result = job.run();
            audioMs = result.audioMs();
            resultName = "ok";
        } catch (InterruptedException e) {
            result = new JobResult(timeoutOutcome(timedOut[0]), 0);
            resultName = timedOut[0] ? "timeout" : "decode_failed";
        } catch (Exception e) {
            result = new JobResult(error(502, "decode_failed", describe(e)), 0);
            resultName = "decode_failed";
        } finally {
            synchronized (lock) {
                finished[0] = true;
            }
            killer.cancel(false);
            sampler.cancel(false);
            Thread.interrupted(); // a late timeout must not leak into the next job
            sampleHeap.run();
        }
        long wallMs = (System.nanoTime() - started) / 1_000_000;
        metrics.job(meta.identifier(), audioMs, wallMs, peakHeap.get() / (1024 * 1024), resultName);
        return result;
    }

    private Outcome timeoutOutcome(boolean timedOut) {
        return timedOut
                ? error(502, "decode_failed", "timed out after " + timeoutMs / 1000.0 + " s")
                : error(502, "decode_failed", "cancelled");
    }

    private static String describe(Throwable e) {
        String message = e.getMessage();
        return message == null || message.isBlank() ? e.getClass().getSimpleName() : message;
    }

    private static Outcome error(int status, String error, String message) {
        ObjectNode json = JSON_MAPPER.createObjectNode();
        json.put("error", error);
        json.put("message", message);
        return new Outcome(status, JSON, bytes(json.toString()));
    }

    private static byte[] bytes(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    /** Jobs waiting behind the running one. */
    int queued() {
        return executor.getQueue().size();
    }

    @Override
    public void close() {
        executor.shutdownNow();
        watchdog.shutdownNow();
    }

    /** Reusable 48 kHz stereo to 24 kHz mono conversion. */
    private static final class MonoStream {
        private final Downsampler downsampler = new Downsampler();
        private float[] buffer = new float[0];
        int length;

        float[] convert(short[] interleaved, int frames) {
            int needed = Downsampler.maxOutput(frames);
            if (buffer.length < needed) {
                buffer = new float[needed];
            }
            length = downsampler.process(interleaved, frames, buffer);
            return buffer;
        }
    }

    private static final class ByteSink {
        byte[] bytes = new byte[1 << 20];
        int size;

        void write(int b) {
            if (size == bytes.length) {
                bytes = Arrays.copyOf(bytes, size * 2);
            }
            bytes[size++] = (byte) b;
        }
    }
}
