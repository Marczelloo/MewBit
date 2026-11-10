const { EmbedBuilder, WebhookClient } = require("discord.js");
const { BRAND } = require("../brand");
const Log = require("../logs/log");
const { audioKeyFile, trackFromAudioKey } = require("./audioKey");

const MIN_TEXT = 10;
const MAX_TEXT = 1000;
const REPORT_COOLDOWN_MS = 60_000;
const MAX_CONTEXT = 100;
const TYPES = { bug: "Bug report", idea: "Idea", map: "Map problem" };
const DEFAULT_DEBUG_URL = "http://localhost:5180";
const FIELD_MAX = 1024; // what Discord allows in one embed field
const SOURCES = { activity: "Activity", command: "Slash command" };

// Every error carries what the player is shown and the status the Activity gateway answers with.
const reportError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

// Names, songs and levels are user data (the last three come from the browser): markdown specials and line breaks
// would bend the embed layout, so they are dropped, and the text is cut to a sane length.
function plain(value, max = MAX_CONTEXT) {
  const text = String(value ?? "").replace(/[*_~`|>#\\[\]]/g, "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function validateReport({ type, text } = {}) {
  if (!Object.hasOwn(TYPES, type)) throw reportError("Choose whether this is a bug, a map problem or an idea.", 400);
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length < MIN_TEXT) throw reportError(`Write at least ${MIN_TEXT} characters so there is something to go on.`, 400);
  if (trimmed.length > MAX_TEXT) throw reportError(`Keep it to ${MAX_TEXT} characters or fewer.`, 400);
  return { type, text: trimmed };
}

// "Server name (id)", or "private conversation" when there is no server (a DM, a group DM).
function placeLabel(guildName, guildId) {
  if (!guildId) return "private conversation";
  const name = plain(guildName);
  return name ? `${name} (${guildId})` : String(guildId);
}

// The link that opens the played song in the debugger (scripts/mewbeat-debug) on the level, at the start. The base is
// MEWBEAT_DEBUG_URL, read when the report is sent. The song's id there is the hash of its audio key.
function debuggerUrl(audioKey, difficulty, base = process.env.MEWBEAT_DEBUG_URL) {
  const root = String(base || DEFAULT_DEBUG_URL).replace(/\/+$/, "");
  return `${root}/#${encodeURIComponent(`played:${audioKeyFile(audioKey)}`)}/${encodeURIComponent(difficulty)}/0`;
}

// What a map report says about its run, all of it from the stored round and the server's own chart data: the song, the
// result, the chart version played and in use now, and the debugger link. A field with no value is left out, and the
// URLs go in as they are (plain() would strip their brackets), so one too long for a field is dropped rather than cut.
function mapFields({ round, chart }, debugBase) {
  const fields = [];
  const add = (name, value, inline = true) => {
    const text = typeof value === "number" ? String(value) : value;
    if (text) fields.push({ name, value: text.slice(0, FIELD_MAX), inline });
  };
  const addUrl = (name, url) => {
    if (typeof url === "string" && /^https?:\/\/\S+$/i.test(url) && url.length <= FIELD_MAX) fields.push({ name, value: url, inline: false });
  };
  const level = plain(round.difficulty, 20);
  const title = plain(round.title);
  const artist = plain(round.artist);
  add("Song", title && artist ? `${title} - ${artist}` : title || artist, false);
  addUrl("Link", round.uri);
  add("Level", level ? level[0].toUpperCase() + level.slice(1) : "");
  if (Number.isFinite(round.at)) add("Played", `<t:${Math.floor(round.at / 1000)}:f>`);
  add("Mode", plain(round.mode, 20));
  const result = [
    Number.isFinite(round.score) ? `${round.score} points` : "",
    Number.isFinite(round.accuracy) ? `${round.accuracy}%` : "",
    plain(round.grade, 5),
    Number.isFinite(round.maxCombo) ? `${round.maxCombo} combo` : "",
  ].filter(Boolean);
  add("Result", result.join(" · "));
  const played = round.chartVersion === undefined || round.chartVersion === null ? "" : plain(round.chartVersion, 30);
  const current = chart?.version === undefined || chart?.version === null ? "" : plain(chart.version, 30);
  if (played || current) add("Chart version", !current || played === current ? played : `${played || "unknown"} (current: ${current})`);
  if (Number.isFinite(chart?.stars)) add("Stars", chart.stars.toFixed(1));
  if (Number.isFinite(chart?.notes)) add("Notes", chart.notes);
  if (Number.isFinite(chart?.bpm)) add("BPM", Math.round(chart.bpm));
  add("Audio key", `\`${String(round.audioKey).replace(/`/g, "").slice(0, 200)}\``, false);
  addUrl("Debugger", debuggerUrl(round.audioKey, round.difficulty, debugBase));
  return fields;
}

function reportMessage(report, run = null, debugBase) {
  const embed = new EmbedBuilder()
    .setColor(report.type === "bug" ? BRAND.colors.error : report.type === "map" ? BRAND.colors.warning : BRAND.colors.primary)
    .setTitle(TYPES[report.type])
    .setDescription(report.text)
    .addFields(
      { name: "Reporter", value: `${plain(report.reporter?.name) || "Unknown"} (${plain(report.reporter?.id, 30)})`, inline: true },
      { name: "Source", value: SOURCES[report.source] || "Unknown", inline: true },
      { name: "Place", value: plain(report.place, 140) || "unknown", inline: true }, // room for a long name and its id
    );
  if (run) {
    embed.addFields(mapFields(run, debugBase));
  } else {
    for (const [name, value] of [["Mode", report.mode], ["Song", report.song], ["Level", report.level]]) {
      const shown = plain(value);
      if (shown) embed.addFields({ name, value: shown, inline: true });
    }
  }
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

// A client per report, closed afterwards: reports are rare, and a client keeps timers while it lives.
async function postToWebhook(url, message) {
  const webhook = new WebhookClient({ url });
  try {
    await webhook.send(message);
  } finally {
    webhook.destroy();
  }
}

// send(report) validates, then posts one embed to the webhook of the author's private channel; it resolves once the
// post is made and rejects with a statusCode and a message safe to show the player. The cooldown (one report per
// player per minute) starts only when a post succeeded, so a failure never costs the player their turn. webhookUrl is
// a string or a function, read at send time. The address holds the webhook's token, so it never goes into a log.
//
// A map report names the run it is about ({ audioKey, difficulty, at }); findRun(userId, run) looks it up in that
// player's own history and gives { round, chart } (the stored round, and the summary of the chart now in use), or null.
// Nothing the browser says about the song is used: without a run found the report is refused.
function createReporter({
  webhookUrl = () => process.env.MEWBEAT_REPORT_WEBHOOK_URL,
  post = postToWebhook,
  now = Date.now,
  findRun = (userId, run) => runLookup?.(userId, run) ?? null,
  debugUrl,
} = {}) {
  const lastSent = new Map(); // player id -> time of their last report
  const sending = new Set(); // player ids with a post in flight

  async function send(report) {
    const { type, text } = validateReport(report);
    const userId = String(report.reporter?.id ?? "");
    if (!userId) throw reportError("MewBit could not tell who is sending this report.", 400);

    let found = null;
    if (type === "map") {
      found = findRun(userId, report.run);
      if (!found) throw reportError("MewBit could not find that run in your history. Pick it from the list again.", 400);
    }

    for (const [id, at] of lastSent) if (now() - at >= REPORT_COOLDOWN_MS) lastSent.delete(id);
    if (sending.has(userId) || lastSent.has(userId)) throw reportError("You just sent a report. Wait a minute before sending another.", 429);

    const url = typeof webhookUrl === "function" ? webhookUrl() : webhookUrl;
    if (!url) throw reportError("Reports are not set up on this bot right now.", 503);

    sending.add(userId);
    try {
      try {
        await post(url, reportMessage({ ...report, type, text }, found, debugUrl));
      } catch (error) {
        Log.error("Could not post a report to the webhook", error?.message);
        throw reportError("MewBit could not send the report. Try again in a moment.", 503);
      }
      lastSent.set(userId, now());
    } finally {
      sending.delete(userId);
    }
  }

  return { send };
}

// The bot gives the reporter its way to find a run (see createRunLookup) once, when it starts.
let runLookup = null;
function setRunLookup(lookup) {
  runLookup = lookup;
}

// findRun for a bot with a history store and a chart store: the round must be the reporter's own, and the chart is the
// one in use now (null while the song has none stored).
function createRunLookup({ historyStore, summaryReader }) {
  return (userId, run) => {
    const { audioKey, difficulty, at } = run ?? {};
    if (typeof audioKey !== "string" || typeof difficulty !== "string" || !Number.isFinite(at)) return null;
    const round = historyStore.roundOf(userId, audioKey, difficulty, at);
    if (!round) return null;
    return { round, chart: summaryReader()(trackFromAudioKey(audioKey))?.[difficulty] ?? null };
  };
}

// One reporter for the whole bot, so the Activity and /report share a single per-player cooldown.
let shared = null;
function getReporter() {
  shared ??= createReporter();
  return shared;
}

module.exports = { MAX_TEXT, MIN_TEXT, REPORT_COOLDOWN_MS, createReporter, createRunLookup, debuggerUrl, getReporter, placeLabel, setRunLookup, validateReport };
