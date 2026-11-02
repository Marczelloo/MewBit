package dev.mewbit.mewbeat;

/**
 * Turns an encoded Lavalink track into raw PCM, outside any guild player.
 * The interface exists so {@link AnalysisWorker} can be tested without lavaplayer.
 */
public interface TrackDecoder {

    /** What an encoded track says about itself, read without touching the network. */
    record TrackMeta(String identifier, String sourceName, long lengthMs, boolean stream) {}

    /** Receives decoded audio: 48 kHz interleaved stereo 16-bit samples. */
    interface PcmSink {
        /** @param frames number of stereo frames at the start of {@code interleaved} */
        void accept(short[] interleaved, int frames);
    }

    /** Receives encoded audio: one Opus packet (20 ms, 48 kHz stereo) per call. */
    interface OpusSink {
        void accept(byte[] packet);
    }

    /** The track could not be decoded, or its source failed while it was being decoded. */
    class DecodeException extends Exception {
        public DecodeException(String message) {
            super(message);
        }

        public DecodeException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /** The encoded track is not something this server can decode (bad base64, unknown source). */
    class BadTrackException extends DecodeException {
        public BadTrackException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /** Reads the track's metadata. No audio is fetched. */
    TrackMeta describe(String encodedTrack) throws BadTrackException;

    /**
     * Decodes the whole track, as fast as the source delivers it, and pushes the
     * PCM to {@code sink} on the calling thread. Returns when the track has ended.
     * Interrupting the calling thread cancels the decode.
     */
    void decode(String encodedTrack, PcmSink sink) throws DecodeException, InterruptedException;

    /**
     * Decodes the whole track and re-encodes it as 48 kHz stereo Opus, pushing each
     * packet to {@code sink} on the calling thread. The first packet starts at
     * track time 0; the source's own Opus packets are never passed through.
     * Interrupting the calling thread cancels the job.
     */
    default void decodeOpus(String encodedTrack, OpusSink sink) throws DecodeException, InterruptedException {
        throw new DecodeException("opus output is not supported by this decoder");
    }
}
