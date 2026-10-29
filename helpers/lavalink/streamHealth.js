const Log = require("../logs/log");

// Lavalink reports frame counters averaged over the last minute; a healthy
// player sends 3000 frames per minute (one every 20 ms).
const DEFAULT_INTERVAL_MS = 60 * 1000;
const DEFAULT_MIN_LOSS_FRAMES = 25;

function evaluateFrameStats(stats, { minLossFrames = DEFAULT_MIN_LOSS_FRAMES } = {}) {
  const frameStats = stats?.frameStats;
  if (!frameStats) return null;

  const sent = Math.max(0, Number(frameStats.sent) || 0);
  const nulled = Math.max(0, Number(frameStats.nulled) || 0);
  const deficit = Math.max(0, Number(frameStats.deficit) || 0);
  const lost = nulled + deficit;
  const expected = sent + lost;
  const lossPct = expected > 0 ? Math.round((lost / expected) * 1000) / 10 : 0;

  return {
    degraded: lost >= minLossFrames,
    sent,
    nulled,
    deficit,
    lossPct,
  };
}

function formatLoad(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "?";
}

function describeSocketClose(player, data = {}) {
  return {
    guildId: player?.guildId || data.guildId || null,
    code: data.code ?? null,
    reason: data.reason || null,
    byRemote: Boolean(data.byRemote),
  };
}

function startStreamHealthMonitor(poru, { intervalMs = DEFAULT_INTERVAL_MS, minLossFrames } = {}) {
  const lastSeenUptime = new Map();

  const check = () => {
    let reported = 0;
    for (const node of poru?.nodes?.values?.() || []) {
      const stats = node?.stats;
      if (!stats || !stats.frameStats) continue;
      // Only look at each stats packet once.
      if (lastSeenUptime.get(node.name) === stats.uptime) continue;
      lastSeenUptime.set(node.name, stats.uptime);

      const health = evaluateFrameStats(stats, { minLossFrames });
      if (!health?.degraded) continue;

      Log.warning(
        "Lavalink audio frames dropped",
        "",
        `node=${node.name}`,
        `playing=${stats.playingPlayers ?? "?"}`,
        `sent=${health.sent}`,
        `nulled=${health.nulled}`,
        `deficit=${health.deficit}`,
        `loss=${health.lossPct}%`,
        `systemLoad=${formatLoad(stats.cpu?.systemLoad)}`,
        `lavalinkLoad=${formatLoad(stats.cpu?.lavalinkLoad)}`
      );
      reported += 1;
    }
    return reported;
  };

  const timer = setInterval(check, intervalMs);
  timer.unref?.();
  return { check, stop: () => clearInterval(timer) };
}

module.exports = {
  describeSocketClose,
  evaluateFrameStats,
  startStreamHealthMonitor,
};
