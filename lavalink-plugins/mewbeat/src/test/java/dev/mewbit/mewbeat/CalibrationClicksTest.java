package dev.mewbit.mewbeat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.junit.jupiter.api.Test;

class CalibrationClicksTest {

    private static final int HEADER_BYTES = 44;

    @Test
    void parsesItsOwnIdentifier() {
        CalibrationClicks clicks = CalibrationClicks.parse("mewbeat:calibration:120:64:3000");

        assertEquals(new CalibrationClicks(120, 64, 3000), clicks);
        assertEquals("mewbeat:calibration:120:64:3000", clicks.identifier());
    }

    @Test
    void rejectsOtherIdentifiersAndOutOfRangeValues() {
        assertNull(CalibrationClicks.parse(null));
        assertNull(CalibrationClicks.parse("ytsearch:mewbeat calibration"));
        assertNull(CalibrationClicks.parse("mewbeat:calibration:120:64"));
        assertNull(CalibrationClicks.parse("mewbeat:calibration:20:64:3000"));
        assertNull(CalibrationClicks.parse("mewbeat:calibration:120:0:3000"));
        assertNull(CalibrationClicks.parse("mewbeat:calibration:120:64:20000"));
    }

    @Test
    void lastsFromTheLeadInThroughTheLastBeatAndTheTail() {
        CalibrationClicks clicks = new CalibrationClicks(120, 64, 3000);

        assertEquals(3000 + 64 * 500 + CalibrationClicks.TAIL_MS, clicks.lengthMs());
        assertEquals(3500, clicks.clickMs(1));
    }

    @Test
    void eachClickStartsOnItsSampleAndSilenceSurroundsIt() {
        CalibrationClicks clicks = new CalibrationClicks(120, 4, 1000);
        short[] pcm = pcmOf(clicks.wav());

        assertEquals(clicks.lengthMs() * CalibrationClicks.SAMPLE_RATE / 1000, pcm.length);
        for (int i = 0; i < 4; i++) {
            int start = (int) Math.round(clicks.clickMs(i) * CalibrationClicks.SAMPLE_RATE / 1000);
            assertEquals(0, maxAbs(pcm, start - 480, start), "silence before click " + i);
            assertTrue(maxAbs(pcm, start, start + 48) > 10_000, "click " + i + " is loud from its first millisecond");
        }
        assertEquals(0, maxAbs(pcm, 0, 47_000), "the lead-in is silent");
    }

    private static short[] pcmOf(byte[] wav) {
        short[] pcm = new short[(wav.length - HEADER_BYTES) / 2];
        ByteBuffer.wrap(wav, HEADER_BYTES, wav.length - HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(pcm);
        return pcm;
    }

    private static int maxAbs(short[] pcm, int from, int to) {
        int max = 0;
        for (int i = Math.max(0, from); i < Math.min(pcm.length, to); i++) max = Math.max(max, Math.abs(pcm[i]));
        return max;
    }
}
