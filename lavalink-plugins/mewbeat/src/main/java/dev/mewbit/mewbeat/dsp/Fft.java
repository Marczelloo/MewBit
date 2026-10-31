package dev.mewbit.mewbeat.dsp;

/** In-place radix-2 complex FFT of a fixed power-of-two size. */
final class Fft {

    private final int size;
    private final float[] cos;
    private final float[] sin;
    private final int[] reversed;

    Fft(int size) {
        if (size < 2 || Integer.bitCount(size) != 1) {
            throw new IllegalArgumentException("FFT size must be a power of two: " + size);
        }
        this.size = size;
        cos = new float[size / 2];
        sin = new float[size / 2];
        for (int k = 0; k < size / 2; k++) {
            double angle = 2 * Math.PI * k / size;
            cos[k] = (float) Math.cos(angle);
            sin[k] = (float) Math.sin(angle);
        }
        reversed = new int[size];
        int bits = Integer.numberOfTrailingZeros(size);
        for (int i = 0; i < size; i++) {
            reversed[i] = Integer.reverse(i) >>> (32 - bits);
        }
    }

    /** Forward transform of {@code re} + i·{@code im}, both of length {@code size}. */
    void transform(float[] re, float[] im) {
        for (int i = 0; i < size; i++) {
            int j = reversed[i];
            if (j > i) {
                float t = re[i];
                re[i] = re[j];
                re[j] = t;
                t = im[i];
                im[i] = im[j];
                im[j] = t;
            }
        }
        for (int span = 2; span <= size; span <<= 1) {
            int half = span >> 1;
            int step = size / span;
            for (int start = 0; start < size; start += span) {
                for (int j = 0, k = 0; j < half; j++, k += step) {
                    float wr = cos[k];
                    float wi = -sin[k];
                    int a = start + j;
                    int b = a + half;
                    float tr = re[b] * wr - im[b] * wi;
                    float ti = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
            }
        }
    }
}
