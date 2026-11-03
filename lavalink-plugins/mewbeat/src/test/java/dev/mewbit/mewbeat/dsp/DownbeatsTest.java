package dev.mewbit.mewbeat.dsp;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import org.junit.jupiter.api.Test;

class DownbeatsTest {

    private static float[] pitchClass(int pc) {
        float[] chroma = new float[12];
        chroma[pc] = 1;
        return chroma;
    }

    /** A chord for each bar, changing on the beats with index mod 4 == phase. */
    private static float[][] chordsFrom(int beats, int phase) {
        float[][] chroma = new float[beats][];
        for (int i = 0; i < beats; i++) {
            chroma[i] = pitchClass(Math.floorMod(Math.floorDiv(i - phase, 4) * 5, 12));
        }
        return chroma;
    }

    private static int[] everyFourth(int from, int beats) {
        int[] out = new int[(beats - from + 3) / 4];
        for (int k = 0; k < out.length; k++) {
            out[k] = from + 4 * k;
        }
        return out;
    }

    @Test
    void noBeatsNoDownbeats() {
        assertEquals(0, Downbeats.pick(new float[0], new float[0][]).length);
    }

    @Test
    void silenceKeepsARegularBar() {
        assertArrayEquals(everyFourth(0, 64), Downbeats.pick(new float[64], new float[64][12]));
    }

    @Test
    void theKickFindsTheBarWhenTheHarmonyStandsStill() {
        int beats = 64;
        float[] low = new float[beats];
        float[][] chroma = new float[beats][];
        for (int i = 0; i < beats; i++) {
            low[i] = i % 4 == 2 ? 1 : 0.2f;
            chroma[i] = pitchClass(0);
        }
        assertArrayEquals(everyFourth(2, beats), Downbeats.pick(low, chroma));
    }

    @Test
    void theHarmonyTellsTheOneFromTheThree() {
        // A kick on the one and the three says nothing about which is which; the chord change on the three's bar does.
        int beats = 64;
        float[] low = new float[beats];
        for (int i = 0; i < beats; i++) {
            low[i] = i % 2 == 1 ? 1 : 0.2f;
        }
        assertArrayEquals(everyFourth(3, beats), Downbeats.pick(low, chordsFrom(beats, 3)));
    }

    @Test
    void theBarFollowsABeatSlipWithoutAShortBar() {
        int beats = 128;
        float[][] chroma = new float[beats][];
        for (int i = 0; i < beats; i++) {
            int bar = i < 64 ? Math.floorDiv(i, 4) : Math.floorDiv(i - 1, 4);
            chroma[i] = pitchClass(Math.floorMod(bar * 5, 12));
        }
        int[] picked = Downbeats.pick(new float[beats], chroma);
        assertTrue(Arrays.stream(picked).anyMatch(i -> i == 20), Arrays.toString(picked));
        assertTrue(Arrays.stream(picked).anyMatch(i -> i == 101), Arrays.toString(picked));
        for (int k = 1; k < picked.length; k++) {
            assertTrue(picked[k] - picked[k - 1] >= 3, Arrays.toString(picked));
        }
    }

    @Test
    void aFewStrayChangesDoNotMoveTheBar() {
        int beats = 64;
        float[][] chroma = chordsFrom(beats, 0);
        chroma[30] = pitchClass(9);
        assertArrayEquals(everyFourth(0, beats), Downbeats.pick(new float[beats], chroma));
    }
}
