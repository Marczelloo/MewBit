package dev.mewbit.mewbeat.dsp;

/** In-place radix-2 complex FFT of a fixed power-of-two size. */
final class Fft {

    private final int size;
    /**
     * The twiddle factors of every stage, one after the other, so each stage reads its own run front to back: the
     * stage with butterflies {@code half} apart starts at {@code half - 1} and holds {@code cos} and the negated
     * {@code sin} of {@code 2 * pi * j * (size / span) / size} for {@code j} below {@code half}.
     */
    private final float[] twiddleRe;
    private final float[] twiddleIm;
    private final int[] reversed;

    Fft(int size) {
        if (size < 2 || Integer.bitCount(size) != 1) {
            throw new IllegalArgumentException("FFT size must be a power of two: " + size);
        }
        this.size = size;
        float[] cos = new float[size / 2];
        float[] sin = new float[size / 2];
        for (int k = 0; k < size / 2; k++) {
            double angle = 2 * Math.PI * k / size;
            cos[k] = (float) Math.cos(angle);
            sin[k] = (float) Math.sin(angle);
        }
        twiddleRe = new float[size - 1];
        twiddleIm = new float[size - 1];
        for (int span = 2; span <= size; span <<= 1) {
            int half = span >> 1;
            int step = size / span;
            for (int j = 0, k = 0; j < half; j++, k += step) {
                twiddleRe[half - 1 + j] = cos[k];
                twiddleIm[half - 1 + j] = -sin[k];
            }
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
            int table = half - 1;
            if (half < 32) {
                // Few butterflies per group: walk down the groups with one twiddle factor instead (the butterflies
                // of a stage are independent, so their order changes nothing).
                for (int j = 0; j < half; j++) {
                    float wr = twiddleRe[table + j];
                    float wi = twiddleIm[table + j];
                    for (int a = j; a < size; a += span) {
                        int b = a + half;
                        float tr = re[b] * wr - im[b] * wi;
                        float ti = re[b] * wi + im[b] * wr;
                        re[b] = re[a] - tr;
                        im[b] = im[a] - ti;
                        re[a] += tr;
                        im[a] += ti;
                    }
                }
                continue;
            }
            for (int start = 0; start < size; start += span) {
                for (int j = 0; j < half; j++) {
                    float wr = twiddleRe[table + j];
                    float wi = twiddleIm[table + j];
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
