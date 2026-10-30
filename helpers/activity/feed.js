const MAX_ACTIVITY_EVENTS = 32;
const eventsByGuild = new Map();

function text(value, max = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function pushActivityEvent(guildId, event = {}) {
  const key = String(guildId || "");
  if (!key) return null;

  const entry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    level: ["error", "warning", "success", "info"].includes(event.level) ? event.level : "info",
    title: text(event.title, 90) || "MewBit update",
    detail: text(event.detail, 220),
    actor: text(event.actor, 80) || null,
  };

  const events = eventsByGuild.get(key) || [];
  events.unshift(entry);
  if (events.length > MAX_ACTIVITY_EVENTS) events.length = MAX_ACTIVITY_EVENTS;
  eventsByGuild.set(key, events);
  return entry;
}

function getActivityEvents(guildId, limit = 20) {
  return (eventsByGuild.get(String(guildId || "")) || []).slice(0, Math.max(0, limit));
}

function clearActivityEvents(guildId) {
  eventsByGuild.delete(String(guildId || ""));
}

function actionDetail(action, payload, beforeTrack, result) {
  const resultTrack = result?.track?.info || result?.track || null;
  const trackTitle = text(resultTrack?.title || beforeTrack?.title || payload?.track?.title || payload?.query, 100);
  switch (action) {
    case "play": return payload?.playNow ? (trackTitle ? `started ${trackTitle}` : "started playback") : (trackTitle ? `queued ${trackTitle}` : "added a track to the queue");
    case "surprise_me": return trackTitle ? `picked ${trackTitle}${result?.surpriseIntent && result.surpriseIntent !== "freestyle" ? " from the room’s taste" : " from today’s chart"}` : "picked a verified surprise track";
    case "pause": return "paused playback";
    case "resume": return "resumed playback";
    case "stop": return "stopped playback and cleared the queue";
    case "skip": return trackTitle ? `skipped ${trackTitle}` : "skipped the current track";
    case "previous": return "returned to the previous track";
    case "loop": return "changed the loop mode";
    case "shuffle": return "shuffled the queue";
    case "autoplay": return payload?.enabled ? "turned autoplay on" : "turned autoplay off";
    case "play_next": return "moved a track to play next";
    case "replace_autoplay": return "asked MewBit for a different autoplay pick";
    case "remove_queue": return "removed a queued track";
    case "clear_queue": return "cleared the queue";
    case "undo_queue": return "restored the queue";
    case "toggle_like": return result?.liked ? "saved a track to Liked Songs" : "removed a track from Liked Songs";
    case "add_to_playlist": return payload?.name ? `saved a track to ${text(payload.name, 80)}` : "saved a track to a playlist";
    case "filter": return text(payload?.preset, 40).toLowerCase() === "off" ? "reset the audio effects" : `applied the ${text(payload?.preset, 40)} effect`;
    case "equalizer_preset": return `changed the EQ preset to ${text(payload?.preset, 40)}`;
    case "play_playlist": return payload?.shuffle ? "started a playlist in shuffle" : "started a playlist";
    case "queue_tracks": return `queued ${Number(result?.count) || "some"} tracks`;
    case "save_tracks_as_playlist": return payload?.name ? `saved ${Number(result?.count) || "some"} tracks as ${text(payload.name, 80)}` : "saved tracks as a playlist";
    case "change_source": return `switched the current track to ${text(payload?.source, 30) || "another"}`;
    case "track_feedback": return payload?.sentiment === "more" ? "asked for more tracks like this" : "asked MewBit to avoid this direction";
    default: return null;
  }
}

function recordActivityAction(guildId, identity, action, payload, beforeTrack, result) {
  const detail = actionDetail(action, payload, beforeTrack, result);
  if (!detail) return null;
  return pushActivityEvent(guildId, {
    level: "info",
    title: "Room activity",
    detail,
    actor: text(identity?.username || identity?.tag, 80) || "Someone",
  });
}

function reportActivityIssue(guildId, title, detail, level = "error") {
  return pushActivityEvent(guildId, { level, title, detail });
}

module.exports = {
  pushActivityEvent,
  getActivityEvents,
  clearActivityEvents,
  recordActivityAction,
  reportActivityIssue,
};
