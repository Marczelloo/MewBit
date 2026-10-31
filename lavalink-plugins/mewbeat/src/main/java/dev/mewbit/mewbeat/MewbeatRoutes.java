package dev.mewbit.mewbeat;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.Properties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * HTTP routes the mewbeat plugin adds to Lavalink. Lavalink's own
 * Authorization check covers every route here.
 */
@RestController
public class MewbeatRoutes {

    private static final String PLUGIN_NAME = "mewbeat";

    private final String version;
    private final int featuresVersion;

    public MewbeatRoutes() {
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
        this.featuresVersion = Integer.parseInt(properties.getProperty("featuresVersion"));
    }

    public record VersionResponse(String plugin, String version, int featuresVersion) {}

    @GetMapping("/v4/mewbeat/version")
    public VersionResponse version() {
        return new VersionResponse(PLUGIN_NAME, version, featuresVersion);
    }
}
