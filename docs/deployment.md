<!-- Split out of README.md. -->

[← Back to the README](../README.md)

# Deployment

## Production with Docker Compose

1. Create production configuration:

   ```powershell
   Copy-Item .env-example .env
   ```

2. Edit `.env` and set real credentials. The Compose stack sets `LAVALINK_HOST` and `LAVALINK_PORT` for the bot itself (the `lavalink` service is the only address Lavalink has inside the stack), so whatever `.env` says for those two is ignored there. Two values you do need to set:

   ```env
   ACTIVITY_ALLOWED_ORIGINS=https://<application id>.discordsays.com
   TZ=Europe/London
   ```

   - `ACTIVITY_ALLOWED_ORIGINS` is not optional in this stack. Compose runs the bot with `NODE_ENV=production`, and in production the default is empty, so the Activity's realtime connection is refused until the Discord Activity origin is listed. `<application id>` is your Discord application ID.
   - `TZ` is the time zone of the bot's clock (log times, the AI DJ's time of day). It defaults to `UTC`; use your own zone name.
   - `ACTIVITY_HOST` and `ACTIVITY_PORT` default to `0.0.0.0` and `8787` inside the container and rarely need changing. `ACTIVITY_PUBLIC_PORT` (default `8788`) is the port on `127.0.0.1` that the host publishes, for your tunnel or reverse proxy.

3. Create the YouTube cookies file as an empty file, even if you do not use cookies:

   ```bash
   touch helpers/lavalink/youtube-cookies.txt
   ```

   On PowerShell: `New-Item -ItemType File helpers/lavalink/youtube-cookies.txt`

   The Lavalink service mounts this path unconditionally. If it does not exist when the stack first starts, Docker creates a directory with that name and the mount then fails. The file is ignored by Git; put cookies in it only from an account you control.

4. Build the pinned YouTube-source patch before the first start or after clearing `helpers/lavalink/plugins/`:

   ```bash
   pnpm lavalink:youtube:patch
   ```

   It compiles youtube-source 1.18.2 with the targeted PS4 TV user-agent fix and writes the JAR to `helpers/lavalink/plugins/`. Docker and Git must be available. The Compose stack also starts a private `yt-cipher` service, which handles current YouTube signature scripts.

5. Check the mewbeat plugin. The Lavalink plugin that analyses songs for [mewbeat](mewbeat.md) is a built jar, `helpers/lavalink/plugins/mewbeat-plugin-0.1.0.jar`, and it is tracked in Git, so a fresh clone already has it. Rebuild it only after changing `lavalink-plugins/mewbeat`:

   ```bash
   pnpm lavalink:mewbeat:build
   ```

   It compiles the plugin inside a Gradle Docker image, runs the plugin's tests (`--skip-tests` leaves them out) and writes the jar into `helpers/lavalink/plugins/`, with a stamp file next to it, `mewbeat-plugin.source.json`, that records which source the jar was built from. `pnpm test` compares that stamp with the plugin source and fails when the source has moved on without a new jar, so commit the jar and the stamp together. Restart the `lavalink` service to load a new jar. Its settings (queue length, longest track, debug routes) are under `plugins.mewbeat` in `helpers/lavalink/application.yml`.

6. Build the Activity if you serve it yourself (see [Discord setup](discord-setup.md)):

   ```bash
   pnpm --dir activity install
   pnpm activity:build
   ```

   The bot does not serve the Activity's files. `activity/dist` is static output that you host over HTTPS; the Compose stack only runs the gateway behind it. mewbeat is part of that same build, there is nothing extra to turn on.

7. Start the stack:

   ```bash
   docker compose up -d --build
   docker compose ps
   ```

   The first build also builds the `mewbeat-decoder` image, which downloads its Python packages and the `basic-pitch` package that carries the model (checked against a fixed SHA-256), so it needs network access and takes longer than later builds.

8. Follow logs during the first startup:

   ```bash
   docker compose logs -f lavalink
   docker compose logs -f bot
   docker compose logs -f mewbeat-decoder
   ```

The Compose stack persists bot data in `helpers/data` and file logs in `logs`. Back up these folders before rebuilding a host. Everything mewbeat keeps (analysis, audio, melodies, charts and, unless you use AtlasHub, scores) is under `helpers/data/mewbeat/`; see [mewbeat](mewbeat.md#what-is-stored-where).

### The mewbeat decoder service

`mewbeat-decoder` runs the melody decoder (Basic Pitch on onnxruntime) as its own container, next to `bot`. The bot sends it the audio of a song and gets back the melody.

- Reachable on the Compose network only, at `http://mewbeat-decoder:8090`; no port is published. Compose sets `MEWBEAT_DECODER_URL` for the bot to that address.
- Limits: 2 CPUs and 2 GB of memory. A 20-minute track peaks near 1.1 GB, a 3-minute one near 0.4 GB. The root filesystem is read-only, all capabilities are dropped, and `no-new-privileges` is set.
- It decodes one song at a time and unloads the model after 5 idle minutes (`MEWBEAT_DECODER_IDLE_MIN`). `MEWBEAT_DECODER_THREADS` is 2.
- The bot does not wait for it at start. `bot` has no `depends_on` for it on purpose: when the decoder is down, a chart is made without a melody after a wait, and the bot retries the decode later.
- Its health check calls `/health` inside the container. The model is loaded on the first decode, not at start, so healthy only means the service answers.

If you run the bot outside Compose, either run the decoder service yourself and set `MEWBEAT_DECODER_URL` (for example `http://127.0.0.1:8090`), or leave it empty and the bot starts a throwaway decoder container per song through the Docker CLI. Where neither is possible, charts are still made, without the melody.

The whole stack, decoder included, has been run on an x86 PC only. The decoder's Dockerfile can build an arm64 image (it downloads the matching Python wheels for the target architecture), but that build has not been run, so a Raspberry Pi 5 is the intended target and not a tested one.

## Raspberry Pi / ARM image

The repository includes an ARM64 image-build script:

```bash
pnpm docker:build
```

It publishes the configured `linux/arm64` image name from `package.json`. Use the normal Compose instructions on the Pi once the image is available.

## Updating safely

```bash
git pull
pnpm install
pnpm --dir activity install
pnpm test
pnpm lint
pnpm activity:build
docker compose up -d --build
```

Run `pnpm deploy:prod` only when Discord slash-command definitions changed. For Activity-only frontend changes, rebuild the Activity and reload the static host/reverse proxy as appropriate.
