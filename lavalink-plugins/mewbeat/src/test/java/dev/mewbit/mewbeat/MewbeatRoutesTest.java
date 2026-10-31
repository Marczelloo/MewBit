package dev.mewbit.mewbeat;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.mewbit.mewbeat.dsp.Features;
import org.junit.jupiter.api.Test;

class MewbeatRoutesTest {

    @Test
    void versionEndpointReportsTheFeaturesVersionOfThePayload() {
        MewbeatRoutes.VersionResponse response = new MewbeatRoutes(null, false).version();

        assertEquals(Features.VERSION, response.featuresVersion());
        assertEquals("mewbeat", response.plugin());
    }
}
