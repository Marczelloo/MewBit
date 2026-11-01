package dev.mewbit.mewbeat.dsp;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class AnalysisTierTest {

    @Test
    void parseIsCaseInsensitiveAndTrims() {
        assertEquals(AnalysisTier.FULL, AnalysisTier.parse("full"));
        assertEquals(AnalysisTier.LIGHT, AnalysisTier.parse("light"));
        assertEquals(AnalysisTier.LIGHT, AnalysisTier.parse("LIGHT"));
        assertEquals(AnalysisTier.LIGHT, AnalysisTier.parse("Light"));
        assertEquals(AnalysisTier.LIGHT, AnalysisTier.parse("  light \t"));
        assertEquals(AnalysisTier.FULL, AnalysisTier.parse(" FuLl\n"));
    }

    @Test
    void nullAndUnknownGiveFull() {
        assertEquals(AnalysisTier.FULL, AnalysisTier.parse(null));
        assertEquals(AnalysisTier.FULL, AnalysisTier.parse(""));
        assertEquals(AnalysisTier.FULL, AnalysisTier.parse("   "));
        assertEquals(AnalysisTier.FULL, AnalysisTier.parse("medium"));
        assertEquals(AnalysisTier.FULL, AnalysisTier.parse("lite"));
    }

    @Test
    void wireNamesRoundTrip() {
        for (AnalysisTier tier : AnalysisTier.values()) {
            assertEquals(tier, AnalysisTier.parse(tier.wireName()));
        }
    }
}
