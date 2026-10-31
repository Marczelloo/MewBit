package dev.mewbit.mewbeat;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class MetricsLogTest {

    @Test
    void formatsOneStableLine() {
        assertEquals(
                "mewbeat-job identifier=abc durationMs=200000 wallMs=8000 realtimeFactor=25.0 peakHeapMb=120 result=ok",
                MetricsLog.line("abc", 200_000, 8_000, 120, "ok"));
    }

    @Test
    void zeroWallTimeAndBlankIdentifierStayParseable() {
        assertEquals(
                "mewbeat-job identifier=- durationMs=0 wallMs=0 realtimeFactor=0.0 peakHeapMb=0 result=busy",
                MetricsLog.line(" ", 0, 0, 0, "busy"));
    }
}
