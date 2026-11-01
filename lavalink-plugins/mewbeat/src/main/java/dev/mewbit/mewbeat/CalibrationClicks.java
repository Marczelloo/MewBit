package dev.mewbit.mewbeat;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A metronome track the Activity calibrates its audio offset against: silence for
 * {@code leadInMs}, then {@code beats} clicks at {@code bpm}, then a short tail. Every
 * parameter is in the identifier, {@code mewbeat:calibration:<bpm>:<beats>:<leadInMs>}, so the
 * bot charts the clicks from the same string the track was made from.
 */
public record CalibrationClicks(int bpm, int beats, int leadInMs) {

    public static final String PREFIX = "mewbeat:calibration:";
    public static final int SAMPLE_RATE = 48_000;
    static final int TAIL_MS = 1_500;

    private static final Pattern IDENTIFIER = Pattern.compile("^mewbeat:calibration:(\\d{1,3}):(\\d{1,3}):(\\d{1,5})$");
    private static final int MIN_BPM = 40;
    private static final int MAX_BPM = 240;
    private static final int MAX_BEATS = 256;
    private static final int MAX_LEAD_IN_MS = 10_000;

    private static final double CLICK_MS = 30;
    private static final double DECAY_MS = 6; // a sharp attack and a fast decay keep the onset unambiguous
    private static final double CLICK_HZ = 1_320;
    private static final double ACCENT_HZ = 1_760; // the first beat of every bar
    private static final double AMPLITUDE = 0.6;
    private static final int BAR = 4;

    /** The clicks an identifier describes, or null when it is not a calibration identifier. */
    public static CalibrationClicks parse(String identifier) {
        if (identifier == null) return null;
        Matcher match = IDENTIFIER.matcher(identifier);
        if (!match.matches()) return null;
        int bpm = Integer.parseInt(match.group(1));
        int beats = Integer.parseInt(match.group(2));
        int leadInMs = Integer.parseInt(match.group(3));
        if (bpm < MIN_BPM || bpm > MAX_BPM || beats < 1 || beats > MAX_BEATS || leadInMs > MAX_LEAD_IN_MS) return null;
        return new CalibrationClicks(bpm, beats, leadInMs);
    }

    public String identifier() {
        return PREFIX + bpm + ":" + beats + ":" + leadInMs;
    }

    /** When click {@code i} starts, in milliseconds from the start of the track. */
    public double clickMs(int i) {
        return leadInMs + i * 60_000.0 / bpm;
    }

    public long lengthMs() {
        return Math.round(clickMs(beats - 1) + 60_000.0 / bpm) + TAIL_MS;
    }

    /** The whole track as a 16-bit mono WAV file. */
    public byte[] wav() {
        int samples = (int) (lengthMs() * SAMPLE_RATE / 1000);
        short[] pcm = new short[samples];
        int clickSamples = (int) (CLICK_MS * SAMPLE_RATE / 1000);
        for (int i = 0; i < beats; i++) {
            int start = (int) Math.round(clickMs(i) * SAMPLE_RATE / 1000);
            double hz = i % BAR == 0 ? ACCENT_HZ : CLICK_HZ;
            for (int s = 0; s < clickSamples && start + s < samples; s++) {
                double t = (double) s / SAMPLE_RATE;
                double envelope = Math.exp(-t * 1000 / DECAY_MS);
                pcm[start + s] = (short) Math.round(Math.sin(2 * Math.PI * hz * t) * envelope * AMPLITUDE * Short.MAX_VALUE);
            }
        }
        ByteBuffer bytes = ByteBuffer.allocate(samples * 2).order(ByteOrder.LITTLE_ENDIAN);
        bytes.asShortBuffer().put(pcm);
        return Wav.mono16(bytes.array(), samples * 2, SAMPLE_RATE);
    }
}
