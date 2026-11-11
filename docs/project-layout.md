<!-- Split out of README.md. -->

[← Back to the README](../README.md)

# Project layout

```text
activity/                 Discord Activity frontend (Vite)
web/                      Landing page, command reference, changelog and dashboard (Vite)
assets/                   Branding, artwork, and static assets
commands/music/           Music slash commands
commands/utility/         Setup, moderation, health, tickets, and utility commands
events/                   Discord event handlers
helpers/activity/         Activity gateway and shared-state API
helpers/dashboard/        Dashboard OAuth, sessions, access control and routes
helpers/help/             The command reference /help and the website both read
helpers/announcements/    Patch notes and the release announcer
helpers/lavalink/         Lavalink integration, autoplay, provider logic, filters
helpers/playlists/        Playlist storage and operations
helpers/data/             Persisted local bot data (runtime)
helpers/lavalink/plugins/ Lavalink plugins used by the node, including the built mewbeat plugin jar
helpers/mewbeat/          mewbeat server side: chart store and worker, rooms, ranking, scores, reports
helpers/mewbeat/charts/   The chart generator: four levels from one analysis, plus the star rating
helpers/data/mewbeat/     mewbeat's runtime data: analysis, audio, melodies, charts, scores (runtime)
activity/src/mewbeat/     The mewbeat game: song select, play field, rooms, results, settings, tour
lavalink-plugins/mewbeat/ Source of the Lavalink plugin that analyses songs and renders their audio
scripts/mewbeat-melody/   Melody decoder: the decoder service (Docker) and its build and measuring tools
scripts/mewbeat-debug/    The chart debugger, a local web page for looking at a generated chart
scripts/mewbeat-docs/     Takes the screenshots in docs/images from the Activity's mock mode
docs/mewbeat/             Working notes on mewbeat (Polish); docs/mewbeat.md is the guide
docs/images/              Screenshots and the pipeline diagram used by the guides
tests/                    Node test suite
docker-compose.yml        Production bot + Lavalink stack
docker-compose.local.yml  Development overlay that builds the bot from this checkout
```

Additional internal design notes live in [`DESIGN.md`](../DESIGN.md) and [`PRODUCT.md`](../PRODUCT.md). The dedicated Activity setup reference is [`activity/README.md`](../activity/README.md).

# Security and provider responsibility

MewBit integrates with third-party services whose access rules, content availability, and APIs can change independently. You are responsible for configuring provider credentials lawfully, respecting each service's terms, and protecting every token/cookie/secret used by your deployment.

Before publishing or sharing a repository clone, check that `.env`, `.env.*`, cookie files, logs, and runtime data are excluded. If a secret was ever pasted into chat, a commit, or a public location, revoke and rotate it immediately.
