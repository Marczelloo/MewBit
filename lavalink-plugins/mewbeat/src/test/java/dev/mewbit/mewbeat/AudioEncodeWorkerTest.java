package dev.mewbit.mewbeat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.mewbit.mewbeat.TrackDecoder.DecodeException;
import dev.mewbit.mewbeat.TrackDecoder.OpusSink;
import dev.mewbit.mewbeat.TrackDecoder.PcmSink;
import dev.mewbit.mewbeat.TrackDecoder.TrackMeta;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class AudioEncodeWorkerTest {

    private static final class FakeDecoder implements TrackDecoder {
        TrackMeta meta = new TrackMeta("abc123", "youtube", 180_000, false);
        Opus opus = sink -> {};

        interface Opus {
            void run(OpusSink sink) throws DecodeException, InterruptedException;
        }

        @Override
        public TrackMeta describe(String encodedTrack) {
            return meta;
        }

        @Override
        public void decode(String encodedTrack, PcmSink sink) {}

        @Override
        public void decodeOpus(String encodedTrack, OpusSink sink) throws DecodeException, InterruptedException {
            opus.run(sink);
        }
    }

    private final FakeDecoder decoder = new FakeDecoder();
    private final List<String> metricLines = new CopyOnWriteArrayList<>();
    private final List<AudioEncodeWorker> workers = new ArrayList<>();
    private final ExecutorService callers = Executors.newCachedThreadPool();

    private AudioEncodeWorker worker(int maxQueue, long timeoutMs) {
        AudioEncodeWorker worker =
                new AudioEncodeWorker(decoder, new MetricsLog(metricLines::add), maxQueue, 1_200_000, timeoutMs);
        workers.add(worker);
        return worker;
    }

    @AfterEach
    void shutDown() {
        callers.shutdownNow();
        workers.forEach(AudioEncodeWorker::close);
    }

    private static String text(AnalysisWorker.Outcome outcome) {
        return new String(outcome.body(), StandardCharsets.UTF_8);
    }

    @Test
    void encodesPacketsIntoAnOggStream() {
        decoder.opus = sink -> {
            for (int i = 0; i < 50; i++) {
                sink.accept(new byte[] {(byte) 0xFC, 1, 2, 3});
            }
        };
        AnalysisWorker.Outcome outcome = worker(2, 30_000).encode("x");

        assertEquals(200, outcome.status());
        assertEquals("audio/ogg", outcome.contentType());
        assertEquals("OggS", new String(outcome.body(), 0, 4, StandardCharsets.US_ASCII));
        assertTrue(metricLines.get(0).contains("result=audio_ok"));
    }

    @Test
    void streamsAndUnloadableTracksAre422() {
        decoder.meta = new TrackMeta("live1", "twitch", Long.MAX_VALUE, true);
        assertEquals(422, worker(2, 30_000).encode("x").status());

        decoder.meta = new TrackMeta("abc123", "youtube", 1000, false);
        decoder.opus = sink -> {
            throw new DecodeException("video unavailable");
        };
        AnalysisWorker.Outcome outcome = worker(2, 30_000).encode("x");
        assertEquals(422, outcome.status());
        assertTrue(text(outcome).contains("video unavailable"));
    }

    @Test
    void anEmptyDecodeIs422() {
        assertEquals(422, worker(2, 30_000).encode("x").status());
    }

    @Test
    void turnsAwayRequestsBeyondTheQueue() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        decoder.opus = sink -> {
            started.countDown();
            release.await();
            sink.accept(new byte[] {(byte) 0xFC});
        };
        AudioEncodeWorker worker = worker(2, 30_000);

        List<Future<AnalysisWorker.Outcome>> accepted = new ArrayList<>();
        accepted.add(callers.submit(() -> worker.encode("x")));
        assertTrue(started.await(5, TimeUnit.SECONDS));
        accepted.add(callers.submit(() -> worker.encode("x")));
        accepted.add(callers.submit(() -> worker.encode("x")));
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (executorQueueSize(worker) < 2 && System.nanoTime() < deadline) {
            Thread.sleep(10);
        }

        AnalysisWorker.Outcome refused = worker.encode("x");
        assertEquals(503, refused.status());
        assertEquals("{\"error\":\"busy\"}", text(refused));

        release.countDown();
        for (Future<AnalysisWorker.Outcome> future : accepted) {
            assertEquals(200, future.get(10, TimeUnit.SECONDS).status());
        }
    }

    private static int executorQueueSize(AudioEncodeWorker worker) throws Exception {
        var field = AudioEncodeWorker.class.getDeclaredField("executor");
        field.setAccessible(true);
        return ((java.util.concurrent.ThreadPoolExecutor) field.get(worker)).getQueue().size();
    }

    @Test
    void aJobThatRunsTooLongIsInterrupted() {
        decoder.opus = sink -> Thread.sleep(60_000);
        AnalysisWorker.Outcome outcome = worker(2, 200).encode("x");

        assertEquals(502, outcome.status());
        assertTrue(metricLines.get(0).contains("result=audio_timeout"));
    }
}
