package dev.mewbit.mewbeat;

import com.sedmelluq.discord.lavaplayer.player.AudioPlayerManager;
import dev.arbjerg.lavalink.api.AudioPlayerManagerConfiguration;
import org.springframework.stereotype.Component;

/** Registers the calibration click source with Lavalink's player manager. */
@Component
public final class CalibrationSourceConfiguration implements AudioPlayerManagerConfiguration {

    @Override
    public AudioPlayerManager configure(AudioPlayerManager manager) {
        manager.registerSourceManager(new CalibrationSourceManager());
        return manager;
    }
}
