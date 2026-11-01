package dev.mewbit.mewbeat;

import com.sedmelluq.discord.lavaplayer.container.wav.WavAudioTrack;
import com.sedmelluq.discord.lavaplayer.player.AudioPlayerManager;
import com.sedmelluq.discord.lavaplayer.source.AudioSourceManager;
import com.sedmelluq.discord.lavaplayer.tools.io.SeekableInputStream;
import com.sedmelluq.discord.lavaplayer.track.AudioItem;
import com.sedmelluq.discord.lavaplayer.track.AudioReference;
import com.sedmelluq.discord.lavaplayer.track.AudioTrack;
import com.sedmelluq.discord.lavaplayer.track.AudioTrackInfo;
import com.sedmelluq.discord.lavaplayer.track.DelegatedAudioTrack;
import com.sedmelluq.discord.lavaplayer.track.info.AudioTrackInfoProvider;
import com.sedmelluq.discord.lavaplayer.track.playback.LocalAudioTrackExecutor;
import java.io.DataInput;
import java.io.DataOutput;
import java.io.IOException;
import java.util.List;

/**
 * Plays {@link CalibrationClicks} tracks: {@code /v4/loadtracks?identifier=mewbeat:calibration:...}
 * returns a track whose audio is synthesised on the Lavalink host, so no HTTP or local-file
 * source has to be opened for it.
 */
public final class CalibrationSourceManager implements AudioSourceManager {

    public static final String SOURCE_NAME = "mewbeat";

    @Override
    public String getSourceName() {
        return SOURCE_NAME;
    }

    @Override
    public AudioItem loadItem(AudioPlayerManager manager, AudioReference reference) {
        CalibrationClicks clicks = CalibrationClicks.parse(reference.identifier);
        return clicks == null ? null : new ClickTrack(infoOf(clicks), clicks, this);
    }

    static AudioTrackInfo infoOf(CalibrationClicks clicks) {
        return new AudioTrackInfo("mewbeat calibration", "MewBit", clicks.lengthMs(), clicks.identifier(), false, null, null, null);
    }

    @Override
    public boolean isTrackEncodable(AudioTrack track) {
        return true;
    }

    @Override
    public void encodeTrack(AudioTrack track, DataOutput output) {
        // Everything the track needs is in its identifier.
    }

    @Override
    public AudioTrack decodeTrack(AudioTrackInfo trackInfo, DataInput input) throws IOException {
        CalibrationClicks clicks = CalibrationClicks.parse(trackInfo.identifier);
        if (clicks == null) throw new IOException("not a calibration track: " + trackInfo.identifier);
        return new ClickTrack(trackInfo, clicks, this);
    }

    @Override
    public void shutdown() {}

    static final class ClickTrack extends DelegatedAudioTrack {

        private final CalibrationClicks clicks;
        private final CalibrationSourceManager source;

        ClickTrack(AudioTrackInfo trackInfo, CalibrationClicks clicks, CalibrationSourceManager source) {
            super(trackInfo);
            this.clicks = clicks;
            this.source = source;
        }

        @Override
        public void process(LocalAudioTrackExecutor executor) throws Exception {
            processDelegate(new WavAudioTrack(trackInfo, new BytesInputStream(clicks.wav())), executor);
        }

        @Override
        public AudioSourceManager getSourceManager() {
            return source;
        }

        @Override
        protected AudioTrack makeShallowClone() {
            return new ClickTrack(trackInfo, clicks, source);
        }
    }

    /** A seekable stream over bytes in memory. */
    static final class BytesInputStream extends SeekableInputStream {

        private final byte[] data;
        private int position;

        BytesInputStream(byte[] data) {
            super(data.length, 0);
            this.data = data;
        }

        @Override
        public int read() {
            return position < data.length ? data[position++] & 0xff : -1;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) {
            if (length == 0) return 0;
            if (position >= data.length) return -1;
            int count = Math.min(length, data.length - position);
            System.arraycopy(data, position, buffer, offset, count);
            position += count;
            return count;
        }

        @Override
        public int available() {
            return data.length - position;
        }

        @Override
        public long getPosition() {
            return position;
        }

        @Override
        protected void seekHard(long target) {
            position = (int) Math.max(0, Math.min(target, data.length));
        }

        @Override
        public boolean canSeekHard() {
            return true;
        }

        @Override
        public List<AudioTrackInfoProvider> getTrackInfoProviders() {
            return List.of();
        }
    }
}
