package dev.mewbit.mewbeat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mewbit.mewbeat.TrackDecoder.DecodeException;
import dev.mewbit.mewbeat.TrackDecoder.PcmSink;
import dev.mewbit.mewbeat.TrackDecoder.TrackMeta;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class AnalysisWorkerTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final long LONG_TIMEOUT_MS = 30_000;

    /** Decoder double: metadata is fixed, the decode behaviour is supplied per test. */
    private static final class FakeDecoder implements TrackDecoder {
        TrackMeta meta = new TrackMeta("abc123", "youtube", 180_000, false);
        Decode decode = sink -> {};

        interface Decode {
            void run(PcmSink sink) throws DecodeException, InterruptedException;
        }

        @Override
        public TrackMeta describe(String encodedTrack) {
            return meta;
        }

        @Override
        public void decode(String encodedTrack, PcmSink sink) throws DecodeException, InterruptedException {
            decode.run(sink);
        }
    }

    private final FakeDecoder decoder = new FakeDecoder();
    private final List<String> metricLines = new CopyOnWriteArrayList<>();
    private final List<AnalysisWorker> workers = new ArrayList<>();
    private final ExecutorService callers = Executors.newCachedThreadPool();

    private AnalysisWorker worker(int maxQueue, long timeoutMs) {
        AnalysisWorker worker =
                new AnalysisWorker(decoder, new MetricsLog(metricLines::add), maxQueue, 1_200_000, timeoutMs);
        workers.add(worker);
        return worker;
    }

    @AfterEach
    void shutDown() {
        callers.shutdownNow();
        workers.forEach(AnalysisWorker::close);
    }

    private static JsonNode json(AnalysisWorker.Outcome outcome) throws Exception {
        return JSON.readTree(outcome.body());
    }

    @Test
    void rejectsStreams() throws Exception {
        decoder.meta = new TrackMeta("live1", "twitch", Long.MAX_VALUE, true);
        AnalysisWorker.Outcome outcome = worker(2, LONG_TIMEOUT_MS).analyze("x");

        assertEquals(422, outcome.status());
        JsonNode body = json(outcome);
        assertEquals("uncharted", body.get("error").asText());
        assertEquals("stream", body.get("reason").asText());
        assertTrue(metricLines.get(0).contains("identifier=live1") && metricLines.get(0).contains("result=stream"));
    }

    @Test
    void rejectsTooLongTracks() throws Exception {
        decoder.meta = new TrackMeta("long1", "youtube", 1_200_001, false);
        AnalysisWorker.Outcome outcome = worker(2, LONG_TIMEOUT_MS).analyze("x");

        assertEquals(422, outcome.status());
        assertEquals("too_long", json(outcome).get("reason").asText());
    }

    @Test
    void queueFullReturns503() throws Exception {
        int maxQueue = 2;
        CountDownLatch running = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        decoder.decode = sink -> {
            running.countDown();
            release.await();
        };
        AnalysisWorker worker = worker(maxQueue, LONG_TIMEOUT_MS);

        // One job occupies the worker, maxQueue more wait behind it.
        List<Future<AnalysisWorker.Outcome>> accepted = new ArrayList<>();
        accepted.add(callers.submit(() -> worker.analyze("x")));
        assertTrue(running.await(5, TimeUnit.SECONDS));
        for (int i = 0; i < maxQueue; i++) {
            accepted.add(callers.submit(() -> worker.analyze("x")));
        }
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (worker.queued() < maxQueue && System.nanoTime() < deadline) {
            Thread.sleep(5);
        }
        assertEquals(maxQueue, worker.queued());

        long started = System.nanoTime();
        AnalysisWorker.Outcome overflow = worker.analyze("x");
        long tookMs = (System.nanoTime() - started) / 1_000_000;

        assertEquals(503, overflow.status());
        assertEquals("busy", json(overflow).get("error").asText());
        assertTrue(tookMs < 100, "rejection took " + tookMs + " ms");

        release.countDown();
        for (Future<AnalysisWorker.Outcome> job : accepted) {
            assertEquals(200, job.get(10, TimeUnit.SECONDS).status());
        }
    }

    @Test
    void timeoutCancelsJob() throws Exception {
        AtomicInteger interrupted = new AtomicInteger();
        decoder.decode = sink -> {
            try {
                Thread.sleep(60_000); // never ends on its own
            } catch (InterruptedException e) {
                interrupted.incrementAndGet();
                throw e;
            }
        };
        AnalysisWorker worker = worker(2, 200);

        long started = System.nanoTime();
        AnalysisWorker.Outcome outcome = worker.analyze("x");
        long tookMs = (System.nanoTime() - started) / 1_000_000;

        assertEquals(502, outcome.status());
        assertEquals("decode_failed", json(outcome).get("error").asText());
        assertTrue(tookMs >= 150 && tookMs < 5_000, "timeout took " + tookMs + " ms");
        assertEquals(1, interrupted.get());
        assertTrue(metricLines.get(0).contains("result=timeout"), metricLines.get(0));

        // The worker is free again.
        decoder.decode = sink -> {};
        assertEquals(200, worker.analyze("x").status());
    }

    @Test
    void workerThreadIsMinPriority() throws Exception {
        AtomicReference<Thread> seen = new AtomicReference<>();
        decoder.decode = sink -> seen.set(Thread.currentThread());
        worker(2, LONG_TIMEOUT_MS).analyze("x");

        assertEquals(Thread.MIN_PRIORITY, seen.get().getPriority());
        assertEquals("mewbeat-analysis", seen.get().getName());
    }

    @Test
    void decodeFailureReturns502WithTheMessage() throws Exception {
        decoder.decode = sink -> {
            throw new DecodeException("403 from the source");
        };
        AnalysisWorker.Outcome outcome = worker(2, LONG_TIMEOUT_MS).analyze("x");

        assertEquals(502, outcome.status());
        JsonNode body = json(outcome);
        assertEquals("decode_failed", body.get("error").asText());
        assertEquals("403 from the source", body.get("message").asText());
    }

    @Test
    void successCarriesFeaturesAndAudioBlockAndExplicitNullHighlight() throws Exception {
        // Ten seconds of silence at 48 kHz stereo, fed in 20 ms chunks.
        decoder.decode = sink -> {
            short[] chunk = new short[960 * 2];
            for (int i = 0; i < 500; i++) {
                sink.accept(chunk, 960);
            }
        };
        AnalysisWorker.Outcome outcome = worker(2, LONG_TIMEOUT_MS).analyze("x");

        assertEquals(200, outcome.status());
        assertEquals("application/json", outcome.contentType());
        JsonNode body = json(outcome);
        assertEquals(1, body.get("featuresVersion").asInt());
        assertEquals(10_000, body.get("durationMs").asInt());
        assertTrue(body.has("highlightMs") && body.get("highlightMs").isNull(), "highlightMs must be an explicit null");
        assertEquals("youtube", body.get("audio").get("sourceName").asText());
        assertEquals("abc123", body.get("audio").get("identifier").asText());
        assertEquals(180_000, body.get("audio").get("length").asLong());
        String line = metricLines.get(0);
        assertTrue(line.startsWith("mewbeat-job identifier=abc123 durationMs=10000 "), line);
        assertTrue(line.endsWith("result=ok"), line);
    }

    @Test
    void pcmWavIs24kMono16Bit() throws Exception {
        decoder.decode = sink -> {
            short[] chunk = new short[960 * 2];
            for (int i = 0; i < 50; i++) { // one second
                sink.accept(chunk, 960);
            }
        };
        AnalysisWorker.Outcome outcome = worker(2, LONG_TIMEOUT_MS).pcmWav("x");

        assertEquals(200, outcome.status());
        assertEquals("audio/wav", outcome.contentType());
        java.nio.ByteBuffer wav = java.nio.ByteBuffer.wrap(outcome.body()).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        assertEquals("RIFF", new String(outcome.body(), 0, 4));
        assertEquals(1, wav.getShort(22)); // mono
        assertEquals(24_000, wav.getInt(24));
        assertEquals(16, wav.getShort(34));
        assertEquals(24_000 * 2, wav.getInt(40)); // one second of samples
        assertEquals(44 + 24_000 * 2, outcome.body().length);
    }
}
