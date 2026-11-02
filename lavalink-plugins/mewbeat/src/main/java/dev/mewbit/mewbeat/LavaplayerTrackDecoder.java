package dev.mewbit.mewbeat;

import com.sedmelluq.discord.lavaplayer.format.AudioDataFormat;
import com.sedmelluq.discord.lavaplayer.format.StandardAudioDataFormats;
import com.sedmelluq.discord.lavaplayer.player.AudioConfiguration;
import com.sedmelluq.discord.lavaplayer.player.AudioPlayerManager;
import com.sedmelluq.discord.lavaplayer.player.AudioPlayerOptions;
import com.sedmelluq.discord.lavaplayer.tools.FriendlyException;
import com.sedmelluq.discord.lavaplayer.tools.io.MessageInput;
import com.sedmelluq.discord.lavaplayer.track.AudioTrack;
import com.sedmelluq.discord.lavaplayer.track.DecodedTrackHolder;
import com.sedmelluq.discord.lavaplayer.track.InternalAudioTrack;
import com.sedmelluq.discord.lavaplayer.track.TrackStateListener;
import com.sedmelluq.discord.lavaplayer.track.playback.LocalAudioTrackExecutor;
import com.sedmelluq.discord.lavaplayer.track.playback.MutableAudioFrame;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Base64;
import java.util.Collections;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Decodes a track with Lavalink's own {@link AudioPlayerManager} (so every
 * source plugin works) but without a player or a voice connection.
 *
 * <p>A {@link LocalAudioTrackExecutor} is built by hand with a copy of the
 * manager's configuration whose output format is PCM instead of Opus. Its
 * {@code execute} loop (source I/O, container parsing, codec, resampling) runs
 * on a private minimum-priority thread and fills the executor's frame buffer;
 * the calling thread drains that buffer. The loop only blocks when the buffer
 * is full, so the track decodes as fast as the source delivers bytes and the
 * CPU allows, not at playback speed. Nothing runs on Lavalink's playback
 * threads or lavaplayer's shared track pool.
 */
@Component
public final class LavaplayerTrackDecoder implements TrackDecoder {

    /** 48 kHz, 2 channels, 960 samples per channel (20 ms) per chunk, little-endian 16-bit. */
    private static final AudioDataFormat PCM_FORMAT = StandardAudioDataFormats.DISCORD_PCM_S16_LE;
    /** Decoder-side buffer: the decode thread runs at most this far ahead of the analysis thread. */
    private static final int BUFFER_MS = 5_000;
    private static final long POLL_MS = 500;
    /** 48 kHz stereo Opus, 960 samples (20 ms) per packet. */
    private static final AudioDataFormat OPUS_FORMAT = StandardAudioDataFormats.DISCORD_OPUS;
    /** Opus encoder effort 0-10; 5 keeps a Raspberry Pi well ahead of real time. */
    private static final int OPUS_QUALITY = 5;

    private final AudioPlayerManager playerManager;

    @Autowired
    public LavaplayerTrackDecoder(AudioPlayerManager playerManager) {
        this.playerManager = playerManager;
    }

    @Override
    public TrackMeta describe(String encodedTrack) throws BadTrackException {
        AudioTrack track = decodeTrack(encodedTrack);
        return new TrackMeta(
                track.getInfo().identifier,
                track.getSourceManager() == null ? "unknown" : track.getSourceManager().getSourceName(),
                track.getInfo().length,
                track.getInfo().isStream);
    }

    @Override
    public void decode(String encodedTrack, PcmSink sink) throws DecodeException, InterruptedException {
        AudioConfiguration configuration = playerManager.getConfiguration().copy();
        configuration.setOutputFormat(PCM_FORMAT);
        // The analysis downsamples to 24 kHz anyway; the cheapest resampler is accurate enough.
        configuration.setResamplingQuality(AudioConfiguration.ResamplingQuality.LOW);
        run(encodedTrack, configuration, new AudioPlayerOptions(), executor -> drain(executor, sink));
    }

    @Override
    public void decodeOpus(String encodedTrack, OpusSink sink) throws DecodeException, InterruptedException {
        AudioConfiguration configuration = playerManager.getConfiguration().copy();
        configuration.setOutputFormat(OPUS_FORMAT);
        configuration.setOpusEncodingQuality(OPUS_QUALITY);
        AudioPlayerOptions options = new AudioPlayerOptions();
        // When the source is Opus too, lavaplayer forwards its packets untouched unless
        // processing is required (AudioPipelineFactory.isProcessingRequired: a non-100
        // volume or any filter factory). Passed-through packets would carry the source's
        // own timeline and pre-skip, so force the PCM path with a factory that adds no
        // filters. Unlike volume 99 this leaves the samples bit-for-bit unscaled.
        options.filterFactory.set((track, format, output) -> Collections.emptyList());
        run(encodedTrack, configuration, options, executor -> drainOpus(executor, sink));
    }

    private interface Drain {
        void run(LocalAudioTrackExecutor executor) throws InterruptedException;
    }

    private void run(String encodedTrack, AudioConfiguration configuration, AudioPlayerOptions options, Drain drain)
            throws DecodeException, InterruptedException {
        AudioTrack decoded = decodeTrack(encodedTrack);
        if (!(decoded instanceof InternalAudioTrack track)) {
            throw new DecodeException("track type is not decodable: " + decoded.getClass().getName());
        }

        LocalAudioTrackExecutor executor =
                new LocalAudioTrackExecutor(track, configuration, options, false, BUFFER_MS);
        track.assignExecutor(executor, true);

        AtomicReference<Throwable> failure = new AtomicReference<>();
        TrackStateListener listener = new TrackStateListener() {
            @Override
            public void onTrackException(AudioTrack failed, FriendlyException exception) {
                failure.compareAndSet(null, exception);
            }

            @Override
            public void onTrackStuck(AudioTrack stuck, long thresholdMs) {
                // Only a player reports this; there is no player here.
            }
        };
        Thread decodeThread = new Thread(
                () -> {
                    try {
                        executor.execute(listener);
                    } catch (Throwable t) {
                        failure.compareAndSet(null, t);
                    } finally {
                        executor.getAudioBuffer().setTerminateOnEmpty();
                    }
                },
                "mewbeat-decode");
        decodeThread.setPriority(Thread.MIN_PRIORITY);
        decodeThread.setDaemon(true);
        decodeThread.start();

        try {
            drain.run(executor);
        } finally {
            executor.stop();
            decodeThread.interrupt();
        }
        Throwable cause = failure.get();
        if (cause != null) {
            throw new DecodeException(messageOf(cause), cause);
        }
    }

    private static void drainOpus(LocalAudioTrackExecutor executor, OpusSink sink) throws InterruptedException {
        MutableAudioFrame frame = new MutableAudioFrame();
        frame.setBuffer(ByteBuffer.allocate(OPUS_FORMAT.maximumChunkSize()));
        while (true) {
            boolean provided;
            try {
                provided = executor.provide(frame, POLL_MS, TimeUnit.MILLISECONDS);
            } catch (TimeoutException e) {
                continue; // the source is slow; the caller's watchdog bounds the total time
            }
            if (!provided || frame.isTerminator()) {
                return;
            }
            int length = frame.getDataLength();
            if (length <= 0) {
                continue;
            }
            byte[] packet = new byte[length];
            frame.getData(packet, 0);
            sink.accept(packet);
        }
    }

    private static void drain(LocalAudioTrackExecutor executor, PcmSink sink) throws InterruptedException {
        MutableAudioFrame frame = new MutableAudioFrame();
        ByteBuffer buffer = ByteBuffer.allocate(PCM_FORMAT.maximumChunkSize());
        frame.setBuffer(buffer);
        byte[] bytes = new byte[PCM_FORMAT.maximumChunkSize()];
        short[] samples = new short[PCM_FORMAT.maximumChunkSize() / 2];
        while (true) {
            boolean provided;
            try {
                provided = executor.provide(frame, POLL_MS, TimeUnit.MILLISECONDS);
            } catch (TimeoutException e) {
                continue; // the source is slow; the caller's watchdog bounds the total time
            }
            if (!provided || frame.isTerminator()) {
                return;
            }
            int length = frame.getDataLength();
            frame.getData(bytes, 0);
            ByteBuffer.wrap(bytes, 0, length).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples, 0, length / 2);
            sink.accept(samples, length / 4);
        }
    }

    private AudioTrack decodeTrack(String encodedTrack) throws BadTrackException {
        try {
            byte[] bytes = Base64.getMimeDecoder().decode(encodedTrack);
            DecodedTrackHolder holder = playerManager.decodeTrack(new MessageInput(new ByteArrayInputStream(bytes)));
            if (holder == null || holder.decodedTrack == null) {
                throw new BadTrackException("unknown track format or source", null);
            }
            return holder.decodedTrack;
        } catch (IllegalArgumentException | IOException e) {
            throw new BadTrackException("cannot decode track: " + messageOf(e), e);
        }
    }

    private static String messageOf(Throwable e) {
        String message = e.getMessage();
        if (e instanceof FriendlyException && e.getCause() != null && e.getCause().getMessage() != null) {
            message = message + ": " + e.getCause().getMessage();
        }
        return message == null || message.isBlank() ? e.getClass().getSimpleName() : message;
    }
}
