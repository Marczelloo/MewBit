package dev.mewbit.mewbeat;

import dev.mewbit.mewbeat.dsp.Features;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Properties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * HTTP routes the mewbeat plugin adds to Lavalink. Lavalink's own
 * Authorization check covers every route here.
 */
@RestController
public class MewbeatRoutes {

    private static final String PLUGIN_NAME = "mewbeat";

    private final String version;
    private final AnalysisWorker worker;
    private final AudioEncodeWorker audioWorker;
    private final boolean debugRoutes;

    public MewbeatRoutes(
            AnalysisWorker worker,
            AudioEncodeWorker audioWorker,
            @Value("${plugins.mewbeat.debugRoutes:false}") boolean debugRoutes) {
        this.worker = worker;
        this.audioWorker = audioWorker;
        this.debugRoutes = debugRoutes;
        Properties properties = new Properties();
        try (InputStream in = MewbeatRoutes.class.getResourceAsStream("/mewbeat.properties")) {
            if (in == null) {
                throw new IllegalStateException("mewbeat.properties is missing from the plugin jar");
            }
            properties.load(in);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        this.version = properties.getProperty("version");
    }

    public record VersionResponse(String plugin, String version, int featuresVersion) {}

    public record AnalyzeRequest(String encodedTrack) {}

    @GetMapping("/v4/mewbeat/version")
    public VersionResponse version() {
        return new VersionResponse(PLUGIN_NAME, version, Features.VERSION);
    }

    @PostMapping(value = "/v4/mewbeat/analyze", consumes = "application/json")
    public void analyze(@RequestBody AnalyzeRequest request, HttpServletResponse response) throws IOException {
        if (request == null || request.encodedTrack() == null || request.encodedTrack().isBlank()) {
            respond(
                    response,
                    new AnalysisWorker.Outcome(
                            400,
                            AnalysisWorker.JSON,
                            "{\"error\":\"bad_request\",\"message\":\"encodedTrack is required\"}"
                                    .getBytes(StandardCharsets.UTF_8)));
            return;
        }
        respond(response, worker.analyze(request.encodedTrack()));
    }

    /** The whole track as Ogg Opus (48 kHz stereo) for solo play in the Activity. */
    @PostMapping(value = "/v4/mewbeat/audio", consumes = "application/json")
    public void audio(@RequestBody AnalyzeRequest request, HttpServletResponse response) throws IOException {
        if (request == null || request.encodedTrack() == null || request.encodedTrack().isBlank()) {
            respond(
                    response,
                    new AnalysisWorker.Outcome(
                            400,
                            AnalysisWorker.JSON,
                            "{\"error\":\"encodedTrack is required\"}".getBytes(StandardCharsets.UTF_8)));
            return;
        }
        respond(response, audioWorker.encode(request.encodedTrack()));
    }

    /** Answers 404 unless {@code plugins.mewbeat.debugRoutes} is true. */
    @GetMapping("/v4/mewbeat/debug/pcm")
    public void debugPcm(@RequestParam("track") String encodedTrack, HttpServletResponse response)
            throws IOException {
        if (!debugRoutes) {
            response.setStatus(404);
            return;
        }
        respond(response, worker.pcmWav(encodedTrack));
    }

    /**
     * Writes the bytes straight to the servlet response. Lavalink registers a
     * kotlinx.serialization message converter ahead of the byte[] one, which would
     * turn a {@code byte[]} body into a JSON array of numbers.
     */
    private static void respond(HttpServletResponse response, AnalysisWorker.Outcome outcome) throws IOException {
        response.setStatus(outcome.status());
        response.setContentType(outcome.contentType());
        response.setContentLength(outcome.body().length);
        response.getOutputStream().write(outcome.body());
    }
}
