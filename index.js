require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Client, Collection, GatewayIntentBits, Partials } = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const logsCommand = require("./commands/utility/logs.js");
const { createActivityServer } = require("./helpers/activity/server.js");
const { setClient } = require("./helpers/clientRegistry.js");
const dashboardAccess = require("./helpers/dashboard/access.js");
const djStore = require("./helpers/dj/store.js");
const guildState = require("./helpers/guildState.js");
const equalizerStore = require("./helpers/lavalink/equalizerStore.js");
const { createPoru } = require("./helpers/lavalink/index.js");
const { applyNormalizedVolume } = require("./helpers/lavalink/loudness.js");
const Log = require("./helpers/logs/log.js");
const health = require("./helpers/monitoring/health.js");
const statsStore = require("./helpers/stats/store.js");
const userPrefs = require("./helpers/users/preferences.js");
const { flushMewbeatStores } = require("./helpers/mewbeat/stores");

if (!token) {
  Log.error("DISCORD_TOKEN is not set in the environment variables.");
  process.exit(1);
}

Log.info("Token:", token ? "Loaded" : "Not Found");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User],
});

client.commands = new Collection();
setClient(client);
const foldersPath = path.join(__dirname, "commands");
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if ("data" in command && "execute" in command) {
      client.commands.set(command.data.name, command);
    } else {
      Log.warning(`The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
  }
}

const eventsPath = path.join(__dirname, "events");
const eventsFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith(".js"));

for (const file of eventsFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

// Handle channel updates (including region changes)
client.on("channelUpdate", async (oldChannel, newChannel) => {
  // Only handle voice channels
  if (newChannel.type !== 2) return; // 2 = GUILD_VOICE

  const { getPoru } = require("./helpers/lavalink/players");
  const { cloneTrack } = require("./helpers/lavalink/state");
  const poru = getPoru();
  if (!poru) return;

  const player = poru.players.get(newChannel.guild.id);
  if (!player || player.voiceChannel !== newChannel.id) return;

  // Check if the region changed
  if (oldChannel.rtcRegion !== newChannel.rtcRegion) {
    Log.warning(
      "Voice channel region changed, reconnecting player",
      "",
      `guild=${newChannel.guild.id}`,
      `channel=${newChannel.name}`,
      `oldRegion=${oldChannel.rtcRegion || "auto"}`,
      `newRegion=${newChannel.rtcRegion || "auto"}`
    );

    try {
      // Save current playback state
      const currentTrack = player.currentTrack ? cloneTrack(player.currentTrack) : null;
      const currentPosition = player.position || 0;
      const queue = player.queue.map((track) => cloneTrack(track));
      const isPaused = player.isPaused;
      const volume = player.volume;
      const loopMode = player.loop;
      const textChannel = player.textChannel;

      const trackTitle = currentTrack?.info?.title || "none";

      Log.info(
        "💾 Saving playback state",
        `track=${trackTitle}`,
        `position=${currentPosition}ms`,
        `queue=${queue.length}`,
        `paused=${isPaused}`,
        `guild=${newChannel.guild.id}`
      );

      // Destroy old connection
      await player.destroy();
      Log.info("🔌 Player destroyed", `guild=${newChannel.guild.id}`);

      // Wait for Discord to settle
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Create new connection
      const newPlayer = await poru.createConnection({
        guildId: newChannel.guild.id,
        voiceChannel: newChannel.id,
        textChannel: textChannel,
        deaf: true,
      });

      Log.info("🔌 Player created", `guild=${newChannel.guild.id}`);

      // Restore volume and loop mode
      newPlayer.userVolume = player.userVolume ?? volume;
      await applyNormalizedVolume(newPlayer, currentTrack);
      newPlayer.loop = loopMode;

      // Restore queue
      for (const track of queue) {
        await newPlayer.queue.add(track);
      }

      Log.info("✅ Queue restored", `size=${queue.length}`, `guild=${newChannel.guild.id}`);

      // Resume playback if there was a track playing
      if (currentTrack) {
        // Add current track to the front of queue
        await newPlayer.queue.unshift(currentTrack);

        Log.info(
          "Starting playback",
          "",
          `guild=${newChannel.guild.id}`,
          `track=${currentTrack.info?.title}`,
          `position=${currentPosition}ms`
        );

        // Start playback
        await newPlayer.play();

        // Wait a moment for playback to start
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Seek to previous position if not paused
        if (currentPosition > 1000 && !isPaused) {
          await newPlayer.seekTo(currentPosition);
          Log.info("Seeked to position", "", `guild=${newChannel.guild.id}`, `position=${currentPosition}ms`);
        }

        // Apply pause state if needed
        if (isPaused) {
          await newPlayer.pause(true);
          Log.info("Applied pause state", "", `guild=${newChannel.guild.id}`);
        }

        Log.success(
          "Player reconnected and playback resumed",
          "",
          `guild=${newChannel.guild.id}`,
          `track=${currentTrack.info?.title}`,
          `position=${currentPosition}ms`,
          `queueRestored=${queue.length}`
        );
      } else {
        Log.info("Player reconnected with empty queue", "", `guild=${newChannel.guild.id}`);
      }
    } catch (error) {
      Log.error(
        "Failed to reconnect player after region change",
        error,
        `guild=${newChannel.guild.id}`,
        `error=${error.message}`
      );
    }
  }
});

client.on("voiceStateUpdate", (oldState, newState) => {
  if (oldState.member.user.id === client.user.id && newState.channelId === null) {
    Log.info(
      "👋 Bot left voice",
      `channel=${oldState.channel.name}`,
      `guild=${newState.guild.name}`,
      `id=${newState.guild.id}`
    );
    const { getPoru } = require("./helpers/lavalink/players");
    const { saveRecoverySnapshot } = require("./helpers/lavalink/recovery");
    const player = getPoru()?.players?.get(newState.guild.id);
    if (player) {
      void saveRecoverySnapshot(player, "discord_disconnect").finally(() => player.destroy().catch(() => null));
    }
  }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  const oldChannel = oldState.channel;
  const newChannel = newState.channel;
  const guild = newState.guild;

  // Handle bot being moved between channels or voice region changes
  if (newState.member?.user?.id === client.user.id && oldChannel && newChannel) {
    const { getPoru } = require("./helpers/lavalink/players");
    const { cloneTrack } = require("./helpers/lavalink/state");
    const poru = getPoru();
    const player = poru?.players?.get(guild.id);

    // Check if bot was moved to a different channel
    if (oldChannel.id !== newChannel.id) {
      Log.info(
        "Bot moved to different voice channel",
        "",
        `guild=${guild.id}`,
        `from=${oldChannel.name}`,
        `to=${newChannel.name}`
      );

      if (player) {
        player.voiceChannel = newChannel.id;
        Log.info("Updated player voice channel reference", "", `guild=${guild.id}`, `channel=${newChannel.id}`);
      }
    }

    // Detect voice region/server changes (Discord moving to different server)
    // This requires a full player reconnection to work properly
    if (oldChannel.rtcRegion !== newChannel.rtcRegion) {
      Log.warning(
        "Voice channel region changed, reconnecting player",
        "",
        `guild=${guild.id}`,
        `oldRegion=${oldChannel.rtcRegion || "auto"}`,
        `newRegion=${newChannel.rtcRegion || "auto"}`
      );

      if (player) {
        try {
          // Save current playback state
          const currentTrack = player.currentTrack ? cloneTrack(player.currentTrack) : null;
          const currentPosition = player.position || 0;
          const queue = player.queue.map((track) => cloneTrack(track));
          const isPaused = player.isPaused;
          const volume = player.volume;
          const loopMode = player.loop;
          const textChannel = player.textChannel;

          Log.info(
            "Saving playback state before reconnection",
            "",
            `guild=${guild.id}`,
            `track=${currentTrack?.info?.title || "none"}`,
            `position=${currentPosition}ms`,
            `queueLength=${queue.length}`,
            `isPaused=${isPaused}`
          );

          // Destroy old connection
          await player.destroy();
          Log.info("Destroyed old player connection", "", `guild=${guild.id}`);

          // Wait a moment for Discord to settle
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Create new connection
          const newPlayer = await poru.createConnection({
            guildId: guild.id,
            voiceChannel: newChannel.id,
            textChannel: textChannel,
            deaf: true,
          });

          // Restore volume and loop mode
          newPlayer.userVolume = player.userVolume ?? volume;
          await applyNormalizedVolume(newPlayer, currentTrack);
          newPlayer.loop = loopMode;

          // Restore queue
          for (const track of queue) {
            await newPlayer.queue.add(track);
          }

          // Resume playback if there was a track playing
          if (currentTrack) {
            // Add current track to the front of queue
            await newPlayer.queue.unshift(currentTrack);

            // Start playback
            await newPlayer.play();

            // Seek to previous position if not paused
            if (currentPosition > 0 && !isPaused) {
              await newPlayer.seekTo(currentPosition);
            }

            // Apply pause state if needed
            if (isPaused) {
              await newPlayer.pause(true);
            }

            Log.success(
              "Player reconnected and playback resumed",
              "",
              `guild=${guild.id}`,
              `track=${currentTrack.info?.title}`,
              `position=${currentPosition}ms`,
              `queueRestored=${queue.length}`
            );
          } else {
            Log.info("Player reconnected with empty queue", "", `guild=${guild.id}`);
          }
        } catch (error) {
          Log.error(
            "Failed to reconnect player after region change",
            error,
            `guild=${guild.id}`,
            `error=${error.message}`
          );
        }
      }
    }
  }

  if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
    const oldMembers = oldChannel.members.size;
    const newMembers = newChannel.members.size;

    if (oldMembers !== newMembers && newMembers === 1) {
      Log.info("😴 Bot alone in voice", `channel=${newChannel.name}`, `guild=${guild.name}`, `id=${guild.id}`);
      Log.info("⏱️ Leaving in 60 seconds", `guild=${guild.id}`);
    }
  }
});

client.ws.on("error", (error) => {
  Log.error("WebSocket error:", error);
  reconnectClient();
});

const maxRetries = 3;
let currentAttempt = 0;

function connectClient() {
  client
    .login(token)
    .then(() => {
      currentAttempt = 0;
      Log.success("Successfully connected to Discord!");
    })
    .catch((err) => {
      Log.error("Failed to connect to Discord:", err);
      if (currentAttempt < maxRetries) {
        currentAttempt++;
        Log.warning(`Attempting to reconnect... Attempt ${currentAttempt}/${maxRetries}`);
        setTimeout(connectClient, 5000);
      } else {
        Log.error("Failed to connect to Discord after several attempts.");
      }
    });
}

function reconnectClient() {
  if (currentAttempt < maxRetries) {
    currentAttempt++;
    Log.warning(`Attempting to reconnect... Attempt ${currentAttempt}/${maxRetries}`);
    client.destroy();
    setTimeout(connectClient, 5000);
  } else {
    Log.error("Failed to reconnect to Discord after several attempts.");
    process.exit(1);
  }
}

const poru = createPoru(client);
client.on("raw", (d) => poru.packetUpdate(d));

const activityServer = createActivityServer(client);

async function bootstrap() {
  const stores = [
    ["Stats store", statsStore.init()],
    ["DJ store", djStore.init()],
    ["Guild state", guildState.init()],
    ["Equalizer store", equalizerStore.init()],
    ["Dashboard access", dashboardAccess.init()],
    ["User preferences", userPrefs.init()],
    ["Server logs config", logsCommand.loadConfig()],
  ];
  const results = await Promise.allSettled(stores.map(([, task]) => task));
  if (results.some((result) => result.status === "rejected")) {
    results.forEach((result, index) => {
      if (result.status === "rejected") Log.error(`Failed to initialize ${stores[index][0]}`, result.reason);
    });
    process.exitCode = 1;
    return;
  }
  stores.forEach(([name]) => Log.info(`✅ ${name} initialized`));
  activityServer.start();
  health.startMonitoring();
  connectClient();
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  Log.info(`Received ${signal}; shutting down cleanly.`);
  activityServer.stop();
  health.stopMonitoring?.();
  await Promise.allSettled([statsStore.flush?.(), userPrefs.flush?.(), flushMewbeatStores()]);
  client.destroy();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
void bootstrap();

// Function to measure Lavalink node latency
async function measureNodeLatency(node) {
  if (!node || !node.rest) return null;

  try {
    const start = Date.now();
    // Make a lightweight request to measure round-trip time
    await node.rest.get(`/v4/info`);
    const latency = Date.now() - start;
    return Math.round(latency);
  } catch {
    return null;
  }
}

// Update Lavalink connection status
poru.on("nodeConnect", async (node) => {
  Log.success("Lavalink node connected", node.name);

  // Measure latency by pinging the REST API
  const latency = await measureNodeLatency(node);
  health.updateLavalinkStatus(true, latency);
});

poru.on("nodeDisconnect", (node) => {
  Log.error("❌ Lavalink disconnected", `node=${node.name}`);
  health.updateLavalinkStatus(false);
  const { saveRecoverySnapshot } = require("./helpers/lavalink/recovery");
  for (const player of poru.players.values()) void saveRecoverySnapshot(player, "lavalink_disconnect");
});

poru.on("nodeError", (node, error) => {
  Log.error("❌ Lavalink error", error, `node=${node.name}`);
  health.recordError(error, { node: node.name });
});

// Update latency when node stats are received (every ~1 minute)
poru.on("nodeStats", async (node) => {
  const latency = await measureNodeLatency(node);
  if (latency !== null) {
    health.updateLavalinkStatus(true, latency);
  }
});
