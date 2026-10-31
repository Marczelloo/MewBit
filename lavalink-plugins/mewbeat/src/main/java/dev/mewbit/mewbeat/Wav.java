package dev.mewbit.mewbeat;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** Minimal WAV writer for the debug PCM route: 16-bit mono PCM. */
final class Wav {

    private static final int HEADER_BYTES = 44;

    private Wav() {}

    /** Wraps little-endian 16-bit mono {@code pcm} bytes in a RIFF/WAVE header. */
    static byte[] mono16(byte[] pcm, int length, int sampleRate) {
        ByteBuffer out = ByteBuffer.allocate(HEADER_BYTES + length).order(ByteOrder.LITTLE_ENDIAN);
        out.put(new byte[] {'R', 'I', 'F', 'F'});
        out.putInt(36 + length);
        out.put(new byte[] {'W', 'A', 'V', 'E', 'f', 'm', 't', ' '});
        out.putInt(16); // fmt chunk size
        out.putShort((short) 1); // PCM
        out.putShort((short) 1); // mono
        out.putInt(sampleRate);
        out.putInt(sampleRate * 2); // byte rate
        out.putShort((short) 2); // block align
        out.putShort((short) 16); // bits per sample
        out.put(new byte[] {'d', 'a', 't', 'a'});
        out.putInt(length);
        out.put(pcm, 0, length);
        return out.array();
    }
}
